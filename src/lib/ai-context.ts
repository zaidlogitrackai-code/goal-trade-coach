// Server-side loader for the agents' context: every read in one Promise.all, errors thrown
// (a failed read must not look like a clean day), then formatted by the pure ai-context-format.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { formatContext, type ContextData, type ContextMode } from "./ai-context-format";
import { CAPITAL_CATEGORY, capitalForPrompt, computeCapital, parseLedger } from "./capital";
import { dayPipeline, pipelineState } from "./day-pipeline";
import { planCheck } from "./daily-plan";
import { applyPctLimits } from "./effective-limits";
import { REVENGE_WINDOW_MIN } from "./emotions";
import { fetchAll } from "./fetch-all";
import { buildInsights, deriveSignals, FOCUS_CATEGORY, focusForPrompt, parseFocus } from "./focus";
import { GUARD_STYLE_CATEGORY, HIDDEN_NOTES, KNOWLEDGE_OFF_CATEGORY, TRAINING_OFF_CATEGORY } from "./hidden-notes";
import { periodOf, periodReview, shiftPeriod, type Period } from "./patterns";
import { strategyStats } from "./perf";
import { lastLoss } from "./pre-trade-gate";
import { loginStreak } from "./streak";
import { dayKey, dayStart, monthStart, safeTz } from "./trading-day";

type Sb = SupabaseClient<Database>;

/** A Supabase result or a thrown error. */
function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}
const list = <T,>(r: { data: T[] | null; error: unknown }): T[] => must(r) ?? [];

const TRADE_COLS = "id,symbol,direction,entry_price,exit_price,status,pnl,emotion,strategy_id,stop_loss,take_profit,risk_amount,notes,close_notes,pre_trade_check_id,opened_at,closed_at,created_at";

export async function loadContextData(sb: Sb, mode: ContextMode, now = new Date()): Promise<ContextData> {
  const s = must(await sb.from("trading_settings").select("*").maybeSingle());
  const tz = safeTz(s?.timezone);
  const todayFrom = dayStart(now, tz);
  const since30 = new Date(Math.min(now.getTime() - 30 * 86_400_000, monthStart(now, tz).getTime()));
  // Patterns compare up to 8 earlier weeks, and the month must be whole.
  const since = new Date(Math.min(now.getTime() - 84 * 86_400_000, since30.getTime())).toISOString();
  const caps = mode === "agent" ? 40 : 15;

  const [rules, strategies, examples, notes, openSession, focusRow, trades, todaySessions, capitalRow, closedAll, alerts, reminders, visits, violations180, guardRow, trainingOff, knowledgeOff, plans, checks, reviews, sessions, reviewed] = await Promise.all([
    sb.from("trading_rules").select("id,title,description,active").then(list),
    sb.from("strategies").select("id,name,description,entry_conditions,exit_conditions,markets,timeframes,allowed").then(list),
    sb.from("strategy_examples").select("verdict,reason,symbol,timeframe,strategy_id").order("created_at", { ascending: false }).limit(caps).then(list),
    sb.from("knowledge_notes").select("title,category,content").not("category", "in", HIDDEN_NOTES).order("created_at", { ascending: false }).limit(50).then(list),
    sb.from("trading_sessions").select("started_at,plan,mood").is("ended_at", null).order("started_at", { ascending: false }).limit(1).then(list),
    sb.from("knowledge_notes").select("content").eq("category", FOCUS_CATEGORY).order("created_at").limit(1).then(list),
    // Paged by close and open time: these rows feed the breaker, and a capped read would read as «allowed».
    fetchAll((from, to) => sb.from("trades").select(TRADE_COLS).or(`opened_at.gte.${since},closed_at.gte.${since},status.eq.open`).order("opened_at").order("id").range(from, to)),
    sb.from("trading_sessions").select("started_at,ended_at").gte("started_at", todayFrom.toISOString()).order("started_at", { ascending: false }).limit(1).then(list),
    sb.from("knowledge_notes").select("content").eq("category", CAPITAL_CATEGORY).order("created_at").order("id").limit(1).then(list),
    // Same paged read as the browser balance, so سَنَد never sees limits built on 1000 trades.
    fetchAll((from, to) => sb.from("trades").select("status,pnl,opened_at,closed_at").eq("status", "closed").order("id").range(from, to)),
    sb.from("notifications").select("title,body,created_at").in("kind", ["risk", "reminder"]).order("created_at", { ascending: false }).limit(8).then(list),
    sb.from("reminders").select("title,repeat,at_time,next_at").eq("active", true).limit(20).then(list),
    sb.from("user_visits").select("day").order("day", { ascending: false }).limit(200).then(list),
    fetchAll((from, to) => sb.from("rule_violations").select("rule_id,source,occurred_at,trade_id,pre_trade_check_id").gte("occurred_at", new Date(now.getTime() - 180 * 86_400_000).toISOString()).order("id").range(from, to)),
    sb.from("knowledge_notes").select("content").eq("category", GUARD_STYLE_CATEGORY).limit(1).maybeSingle().then(must),
    sb.from("knowledge_notes").select("id").eq("category", TRAINING_OFF_CATEGORY).limit(1).maybeSingle().then(must),
    sb.from("knowledge_notes").select("id").eq("category", KNOWLEDGE_OFF_CATEGORY).limit(1).maybeSingle().then(must),
    sb.from("daily_plans").select("day,target,max_trades,risk_per_trade,max_loss,note,revised_count,no_trading,start_balance").order("day", { ascending: false }).limit(7).then(list),
    fetchAll((from, to) => sb.from("pre_trade_checks").select("id,created_at,symbol,direction,intent,decision,proceeded,reasons,override_reason,planned_risk,actual_risk,trade_id").gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to)),
    fetchAll((from, to) => sb.from("trade_reviews").select("trade_id,review_type,period_key,verdict,tags,root_cause,process_score,risk_score,execution_score,quality_score,next_rules,decision,created_at").gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to)),
    sb.from("trading_sessions").select("id,started_at,ended_at,plan,review,mood").order("started_at", { ascending: false }).limit(3).then(list),
    s?.reviews_since
      // A failed review read switches the review rule off for this reply rather than calling every close unreviewed.
      ? fetchAll((from, to) => sb.from("trade_reviews").select("trade_id").not("trade_id", "is", null).gte("created_at", s.reviews_since!).order("id").range(from, to)).catch(() => null)
      : Promise.resolve([] as { trade_id: string | null }[]),
  ]);

  const todayKey = dayKey(now, tz);
  const todayPlan = plans.find((p) => p.day === todayKey) ?? null;
  const ledger = parseLedger(capitalRow[0]?.content);
  const capital = computeCapital({ starting: Number(s?.starting_balance) || 0, since: s?.created_at ?? null, trades: closedAll, entries: ledger.entries });
  // The same pct-to-dollar step as the browser settingsQuery, on the live balance.
  const eff = s ? applyPctLimits(s, capital.balance) : null;
  const cur = eff?.currency ?? "USD";
  const focus = parseFocus(focusRow[0]?.content);
  const month = trades.filter((x) => Date.parse(x.opened_at) >= since30.getTime());
  const isToday = (iso: string) => Date.parse(iso) >= todayFrom.getTime();

  const state = pipelineState({
    settings: eff && { ...eff, reviews_since: reviewed ? eff.reviews_since : null },
    balance: capital.balance,
    trades,
    plan: todayPlan,
    sessions: [...openSession.map((x) => ({ started_at: x.started_at, ended_at: null })), ...todaySessions],
    focus,
    strategies: strategies.length,
    rules: rules.filter((x) => x.active).length,
    reviewedTradeIds: (reviewed ?? []).flatMap((x) => (x.trade_id ? [x.trade_id] : [])),
    // Weekly reviews stay untracked until T30 can write them (see usePipeline).
    weeklyReviewKeys: null,
    now,
  });

  const winDays = new Map<string, number>();
  for (const x of closedAll) { const k = dayKey(x.closed_at ?? x.opened_at, tz); winDays.set(k, (winDays.get(k) ?? 0) + (Number(x.pnl) || 0)); }
  const wins = [...winDays.values()].filter((v) => v > 0);
  const n = (v: unknown) => (v == null ? null : Number(v));
  const planStatus = planCheck(todayPlan && { ...todayPlan, target: n(todayPlan.target), risk_per_trade: n(todayPlan.risk_per_trade), max_loss: n(todayPlan.max_loss) }, month.filter((x) => isToday(x.opened_at)), eff ?? {}, wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null);

  // The latest 4 weeks and this month, with every earlier review there for the trend.
  const tradeReviews = reviews.filter((r) => r.trade_id);
  const rulesLite = rules.map((r) => ({ id: r.id, title: r.title }));
  const periodsOf = (p: Period | null) => p && periodReview({ period: p, tz, reviews: tradeReviews, trades, violations: violations180, rules: rulesLite, checks, now });
  const thisWeek = periodOf("week", now, tz);
  const periods = [0, -1, -2, -3].map((k) => periodsOf(shiftPeriod(thisWeek, k))).concat(periodsOf(periodOf("month", now, tz))).filter((p) => p != null);

  const streak = loginStreak(visits.map((x) => x.day), violations180, tz);
  const insights = buildInsights(deriveSignals(month, strategies, focus, now, REVENGE_WINDOW_MIN(eff)), focus, (v) => `${Math.round(v * 100) / 100} ${cur}`);
  const guardStyle = guardRow?.content?.trim() || "";

  return {
    now,
    tz,
    currency: cur,
    todayKey,
    breaker: state.breaker,
    pipeline: dayPipeline(state),
    today: {
      trades: state.tradesToday,
      pnl: state.pnlToday,
      open: state.openTrades,
      planReached: state.planReached,
      protect: state.protect?.text ?? null,
      plan: todayPlan && { ...todayPlan, target: n(todayPlan.target), max_trades: n(todayPlan.max_trades), risk_per_trade: n(todayPlan.risk_per_trade), max_loss: n(todayPlan.max_loss) },
      planFlags: planStatus.flags,
    },
    checks,
    lastLoss: lastLoss(trades, [], now),
    reviews: tradeReviews,
    periods,
    violations: violations180.filter((v) => Date.parse(v.occurred_at) >= now.getTime() - 30 * 86_400_000),
    sessions,
    trades: [...trades].reverse().map((x) => ({ ...x, risk_amount: n(x.risk_amount) })),
    strategies,
    rules,
    examples: trainingOff ? null : examples,
    notes: knowledgeOff ? null : notes,
    profile: [
      `الأصول التي يغطيها النظام وتحللها دائماً بدون أي رفض أو اعتذار: XAUUSD (الذهب)، XAGUSD (الفضة)، US500، US100، US30 (يسمّى أيضاً US30USD)، EURUSD، GBPUSD، USDJPY، USOIL (نفط WTI)، وأي زوج عملات. العملات الرقمية والأسهم فقط خارج النظام؛ إذا طلبها قله بلطف.\nاليوم عند هادي: ${todayKey} (منطقته ${tz}) — "اليوم" و"هالأسبوع" بتوقيته هو.`,
      `ستريك الانضباط: ${streak.current} يوم سوق متتالي (أفضل ${streak.best}). يزيد لما يسكّر جلسته بمراجعة بدون مخالفة؛ السبت والأحد ما ينحسبون.`,
      capitalForPrompt(capital, ledger.entries, cur),
      `طريقة حارس الانضباط اللي طلبها هادي: ${guardStyle || "لم يحددها بعد"}`,
      `ملف تركيز المتداول (اللي قاله عن نفسه، خلّ كل ردودك ونصايحك مربوطة فيه):\n${focusForPrompt(focus)}`,
      `أنماط من صفقاته آخر 30 يوم: ${insights.length ? insights.map((i) => i.text).join(" ") : "لا يوجد بعد"}`,
      `أداء كل استراتيجية (من آخر 30 يوم): ${JSON.stringify(strategyStats(month, strategies))}`,
      `الإعدادات والحدود (بالدولار من نسبها على رصيده الحالي): ${JSON.stringify(eff ?? {})}`,
      `آخر 7 خطط: ${JSON.stringify(plans)}`,
      `الجلسة المفتوحة: ${JSON.stringify(openSession[0] ?? null)}`,
      `آخر تنبيهات حارس المخاطر: ${JSON.stringify(alerts)}`,
      `التذكيرات المفعّلة: ${JSON.stringify(reminders)}`,
    ],
  };
}

export async function buildContext(sb: Sb, mode: ContextMode = "agent"): Promise<string> {
  return formatContext(await loadContextData(sb, mode), mode);
}
