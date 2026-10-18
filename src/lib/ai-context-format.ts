// Pure: the facts every agent is grounded in, as one prompt text. The numbers come from the
// engines that own them (breaker, pipeline, gate, reviews, patterns); the model quotes them.
import { breakerForPrompt, money, type BreakerResult } from "./circuit-breaker";
import { pipelineForPrompt, type DayPipeline } from "./day-pipeline";
import { DECISION_META, type GateDecision, type LastLoss } from "./pre-trade-gate";
import { patternsForPrompt, type PeriodReview } from "./patterns";
import { TAG_META, VERDICT_META, type TagCode, type Verdict } from "./trade-review";
import { toWallInput } from "./trading-day";

export type ContextMode = "agent" | "brief";

/** How much of each list a mode may carry: the day agents need history, one-shot notes don't. */
export const CONTEXT_CAPS: Record<ContextMode, { checks: number; reviews: number; sessions: number; trades: number; notes: number; noteChars: number; tradeNoteChars: number; examples: number }> = {
  agent: { checks: 10, reviews: 10, sessions: 3, trades: 40, notes: 30, noteChars: 400, tradeNoteChars: 300, examples: 40 },
  brief: { checks: 5, reviews: 5, sessions: 1, trades: 15, notes: 10, noteChars: 0, tradeNoteChars: 120, examples: 15 },
};

export type CtxTrade = {
  id: string; symbol: string; direction: string; status: string;
  entry_price: number | null; stop_loss: number | null; take_profit: number | null; exit_price: number | null;
  pnl: number | null; risk_amount: number | null; emotion: string | null;
  notes: string | null; close_notes: string | null;
  opened_at: string; closed_at: string | null; strategy_id: string | null;
};
export type CtxCheck = { id: string; created_at: string; symbol: string | null; direction: string | null; intent: string; decision: string; proceeded: boolean | null; reasons: unknown; override_reason: string | null };
export type CtxReview = { trade_id: string | null; created_at: string; verdict: string; tags: unknown; root_cause: string | null };
export type CtxViolation = { rule_id: string | null; source: string; occurred_at: string };
export type CtxSession = { id: string; started_at: string; ended_at: string | null; plan: string | null; review: string | null; mood: string | null };
export type CtxStrategy = { id: string; name: string; description: string | null; entry_conditions: string | null; exit_conditions: string | null; markets: string | null; timeframes: string | null; allowed: boolean };
export type CtxRule = { id: string; title: string; description: string | null; active: boolean };
export type CtxPlan = { day: string; target: number | null; max_trades: number | null; risk_per_trade: number | null; max_loss: number | null; note: string | null; no_trading: boolean | null; revised_count?: number | null };

export type ContextData = {
  now: Date;
  tz: string;
  currency: string;
  todayKey: string;
  breaker: BreakerResult | null;
  pipeline: DayPipeline;
  today: { trades: number; pnl: number; open: number; planReached: string | null; protect: string | null; plan: CtxPlan | null; planFlags: string[] };
  /** Newest first. */
  checks: CtxCheck[];
  lastLoss: LastLoss | null;
  /** Newest first, trade reviews only. */
  reviews: CtxReview[];
  periods: PeriodReview[];
  /** The last 30 days. */
  violations: CtxViolation[];
  /** Newest first. */
  sessions: CtxSession[];
  /** Newest first. */
  trades: CtxTrade[];
  strategies: CtxStrategy[];
  rules: CtxRule[];
  /** null = training switched off. */
  examples: { verdict: string; reason: string; symbol: string | null; timeframe: string | null; strategy_id: string | null }[] | null;
  /** null = knowledge switched off. */
  notes: { title: string; category: string | null; content: string | null }[] | null;
  /** Already-formatted lines from their own engines (capital, focus, streak, settings…). */
  profile: string[];
};

const cut = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return !t || n <= 0 ? "" : t.length > n ? `${t.slice(0, n)}…` : t;
};
const num = (v: number | null | undefined) => (v == null ? "—" : String(v));
const reasonTexts = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap((x) => (x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? [(x as { text: string }).text] : [])) : [];
const tagCodes = (v: unknown): TagCode[] =>
  Array.isArray(v) ? v.flatMap((x) => (x && typeof x === "object" && typeof (x as { tag?: unknown }).tag === "string" && (x as { tag: string }).tag in TAG_META ? [(x as { tag: TagCode }).tag] : [])) : [];
const decisionLabel = (d: string) => DECISION_META[d as GateDecision]?.label ?? d;
const verdictLabel = (v: string) => VERDICT_META[v as Verdict]?.label ?? v;

export const TODAY_HEAD = "حالة اليوم (محسوبة، لا تعيد حسابها):";

export function formatContext(d: ContextData, mode: ContextMode): string {
  const cap = CONTEXT_CAPS[mode];
  const m = (n: number) => money(n, d.currency);
  const wall = (iso: string) => toWallInput(iso, d.tz).replace("T", " ");
  const isToday = (iso: string) => wall(iso).slice(0, 10) === d.todayKey;
  const symbolOf = new Map(d.trades.map((t) => [t.id, t.symbol]));
  const stratName = new Map(d.strategies.map((s) => [s.id, s.name]));
  const blocks: string[] = [];

  // 1. Who may trade comes first: everything below is read under it.
  blocks.push(d.breaker ? breakerForPrompt(d.breaker, d.currency) : "قاطع الحماية: ما انحسب (الإعدادات ناقصة).");
  // 2. The one step of the day, as the Today card shows it.
  blocks.push(pipelineForPrompt(d.pipeline));

  // 3. Today's numbers.
  const t = d.today;
  const plan = t.plan
    ? t.plan.no_trading
      ? "خطة اليوم: يوم راحة، ما في تداول."
      : `خطة اليوم: هدف ${num(t.plan.target)}، أقصى ${num(t.plan.max_trades)} صفقات، مخاطرة الصفقة ${num(t.plan.risk_per_trade)}، أقصى خسارة ${num(t.plan.max_loss)}${t.plan.note ? `، ملاحظة: ${cut(t.plan.note, 160)}` : ""}${t.plan.revised_count ? ` (عدّلها ${t.plan.revised_count} مرة)` : ""}.`
    : "خطة اليوم: ما حددها بعد.";
  blocks.push([
    TODAY_HEAD,
    `صفقات اليوم: ${t.trades}، ربح/خسارة محققة اليوم: ${m(t.pnl)}، مفتوحة الحين: ${t.open}.`,
    plan,
    t.planReached ? `${t.planReached}.` : null,
    t.protect ? `احمِ ربحك: ${t.protect}` : null,
    t.planFlags.length ? `فحص الخطة: ${t.planFlags.join(" | ")}` : null,
  ].filter(Boolean).join("\n"));

  // 4. The gate: today's decisions, then the latest checks.
  const todayChecks = d.checks.filter((c) => isToday(c.created_at));
  const counts = new Map<string, number>();
  for (const c of todayChecks) counts.set(c.decision, (counts.get(c.decision) ?? 0) + 1);
  const checkLine = (c: CtxCheck) => {
    const why = reasonTexts(c.reasons).slice(0, 2).join("؛ ");
    return `- ${wall(c.created_at)} ${c.symbol ?? "؟"} ${c.direction ?? ""} (${c.intent}): ${decisionLabel(c.decision)}${c.proceeded === true ? "، ودخل" : c.proceeded === false ? "، وما دخل" : ""}${why ? ` — ${why}` : ""}${c.override_reason ? ` — سببه: ${cut(c.override_reason, 120)}` : ""}`;
  };
  blocks.push([
    `قرارات البوابة اليوم: ${todayChecks.length ? [...counts].map(([k, n]) => `${decisionLabel(k)} ×${n}`).join("، ") : "ما فحص أي صفقة اليوم"}.`,
    ...(d.checks.length ? [`آخر ${Math.min(cap.checks, d.checks.length)} فحوصات:`, ...d.checks.slice(0, cap.checks).map(checkLine)] : []),
  ].join("\n"));

  // 5. Revenge window facts.
  blocks.push(d.lastLoss
    ? `آخر خسارة قبل ${d.lastLoss.minutesAgo} دقيقة (${m(d.lastLoss.pnl)} على ${symbolOf.get(d.lastLoss.tradeId) ?? "صفقة"}${d.lastLoss.trim ? "، إغلاق جزئي" : ""}).`
    : "آخر خسارة: ما في خسارة مسجّلة.");

  // 6. Trade reviews and what they keep tagging.
  const reviews = d.reviews.slice(0, cap.reviews);
  const tagCount = new Map<TagCode, number>();
  for (const r of reviews) for (const k of tagCodes(r.tags)) if (k !== "no_pattern_detected") tagCount.set(k, (tagCount.get(k) ?? 0) + 1);
  blocks.push([
    `آخر ${reviews.length} مراجعات صفقات:${reviews.length ? "" : " ما في مراجعات بعد."}`,
    ...reviews.map((r) => `- ${wall(r.created_at).slice(0, 10)} ${r.trade_id ? symbolOf.get(r.trade_id) ?? "" : ""}: ${verdictLabel(r.verdict)}${tagCodes(r.tags).length ? ` — ${tagCodes(r.tags).map((k) => TAG_META[k].label).join("، ")}` : ""}`),
    tagCount.size ? `تكرار الوسوم: ${[...tagCount].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${TAG_META[k].label} ×${n}`).join("، ")}.` : null,
  ].filter(Boolean).join("\n"));

  // 7. Weeks and the month, from their own engine.
  blocks.push(patternsForPrompt(d.periods, d.currency));

  // 8. Violations by rule, last 30 days.
  const ruleTitle = new Map(d.rules.map((r) => [r.id, r.title]));
  const byRule = new Map<string, { n: number; sources: Map<string, number> }>();
  for (const v of d.violations) {
    const k = (v.rule_id && ruleTitle.get(v.rule_id)) || "بدون قاعدة محددة";
    const e = byRule.get(k) ?? { n: 0, sources: new Map() };
    e.n++;
    e.sources.set(v.source, (e.sources.get(v.source) ?? 0) + 1);
    byRule.set(k, e);
  }
  blocks.push(byRule.size
    ? `المخالفات آخر 30 يوم حسب القاعدة: ${[...byRule].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => `${k} ×${e.n} (${[...e.sources].map(([s, n]) => `${s} ${n}`).join("، ")})`).join(" | ")}.`
    : "المخالفات آخر 30 يوم: ما في.");

  // 9. His own session words.
  const sessions = d.sessions.slice(0, cap.sessions);
  blocks.push([
    `آخر ${sessions.length} جلسات:${sessions.length ? "" : " ما في جلسات."}`,
    ...sessions.map((s) => `- ${wall(s.started_at)}${s.ended_at ? "" : " (مفتوحة)"}: خطة «${cut(s.plan, 200) || "—"}»، مراجعة «${cut(s.review, 300) || "—"}»${s.mood ? `، مزاج ${s.mood}` : ""}`),
  ].join("\n"));

  // 10. One line per trade, with his notes.
  const trades = d.trades.slice(0, cap.trades);
  blocks.push([
    "آخر الصفقات (id للإشارة إليها):",
    ...trades.map((x) => {
      const notes = cut(x.notes, cap.tradeNoteChars), close = cut(x.close_notes, cap.tradeNoteChars);
      return `- ${x.id} | ${wall(x.opened_at)} | ${x.symbol} ${x.direction} ${x.status === "closed" ? "مسكّرة" : x.status === "open" ? "مفتوحة" : x.status} | دخول ${num(x.entry_price)} وقف ${num(x.stop_loss)} هدف ${num(x.take_profit)}${x.exit_price != null ? ` خروج ${x.exit_price}` : ""} | نتيجة ${x.pnl == null ? "—" : m(Number(x.pnl))} | مخاطرة ${num(x.risk_amount)}${x.strategy_id ? ` | ${stratName.get(x.strategy_id) ?? "استراتيجية محذوفة"}` : ""}${x.emotion ? ` | ${x.emotion}` : ""}${notes ? ` | ملاحظاته: ${notes}` : ""}${close ? ` | عند الإغلاق: ${close}` : ""}`;
    }),
  ].join("\n"));

  // 11. Ids an action may point at today.
  const todayTrades = d.trades.filter((x) => isToday(x.opened_at));
  const openSession = d.sessions.find((s) => !s.ended_at);
  blocks.push(`معرّفات اليوم: صفقات اليوم ${todayTrades.length ? todayTrades.map((x) => `${x.symbol}=${x.id}`).join("، ") : "لا شيء"}؛ الجلسة المفتوحة ${openSession?.id ?? "لا شيء"}؛ آخر فحص ${todayChecks[0]?.id ?? "لا شيء"}.`);

  // The trader's own profile: strategies, rules, training, notes, settings.
  blocks.push(`الاستراتيجيات:\n${d.strategies.length ? d.strategies.map((s) => `- ${s.name}${s.allowed ? "" : " (ممنوعة)"}: أسواق ${s.markets || "—"}، فريمات ${s.timeframes || "—"}. ${cut(s.description, 200)}${s.entry_conditions ? ` دخول: ${cut(s.entry_conditions, 300)}` : ""}${s.exit_conditions ? ` خروج: ${cut(s.exit_conditions, 300)}` : ""}`).join("\n") : "- ما في استراتيجية مكتوبة."}`);
  blocks.push(`القواعد: ${d.rules.length ? d.rules.map((r) => `${r.title}${r.active ? "" : " (موقوفة)"}${r.description ? `: ${cut(r.description, 160)}` : ""}`).join(" | ") : "ما في قواعد."}`);
  blocks.push(d.examples
    ? `أمثلة تدريب هادي على استراتيجيته (good = دخول صحيح، bad = غلط) — طبّقها دايماً في الحكم على أي صفقة:\n${d.examples.slice(0, cap.examples).map((e) => `- ${e.verdict} ${e.symbol ?? ""} ${e.timeframe ?? ""}${e.strategy_id ? ` (${stratName.get(e.strategy_id) ?? ""})` : ""}: ${cut(e.reason, 200)}`).join("\n") || "- ما في أمثلة بعد."}`
    : "هادي أوقف استخدام التدريب من الإعدادات — لا تعتمد على أمثلته ولا تذكرها حتى يفعّلها.");
  blocks.push(d.notes
    ? `ملاحظاته في مركز المعرفة:\n${d.notes.slice(0, cap.notes).map((n) => `- ${n.title}${n.category ? ` [${n.category}]` : ""}${cap.noteChars ? `: ${cut(n.content, cap.noteChars)}` : ""}`).join("\n") || "- ما في ملاحظات."}`
    : "هادي أوقف استخدام مركز المعرفة من الإعدادات — لا تعتمد على ملاحظاته.");
  blocks.push(...d.profile);

  return blocks.filter(Boolean).join("\n\n");
}
