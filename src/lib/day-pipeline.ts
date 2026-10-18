/**
 * The trader's day as one gated sequence of seven steps (0-6, the «Step flow» in
 * docs/plan-sanad-steps.md) with one current step and one main button. Pure — the caller
 * loads the rows; pipelineState turns them into facts through the shared engines (the
 * circuit breaker, the gate's review cutoff, protectProfit), so the Today card, the nav
 * dot and سَنَد's line can't disagree about what to do now.
 */
import { breakerCopy, evaluateBreaker, money, type BreakerResult, type BreakerSettings, type BreakerTrade, type LatchedBreak, type LedgerIssues, type PartialEvent } from "./circuit-breaker";
import { unreviewedCloses } from "./pre-trade-gate";
import { protectProfit, type ProtectProfit } from "./trading-status";
import { addDays, dayKey, dayStart, isoWeekKey, safeTz, weekStart, zonedMidnight } from "./trading-day";
import type { NavPath } from "./nav-registry";

export const STEP_KEYS = ["setup", "gate", "plan", "trade", "review", "close", "week"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export type StepN = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Cta = { label: string; to: NavPath };
export type Tone = "neutral" | "success" | "warning" | "danger";

/** The step flow's titles, what each step is for, and the button it usually carries. */
export const STEPS: readonly { key: StepKey; title: string; hint: string; cta: Cta }[] = [
  { key: "setup", title: "الإعداد", hint: "مرة وحدة: ملف تركيزك، استراتيجيتك وقواعدك.", cta: { label: "كمّل الإعداد", to: "/coach" } },
  { key: "gate", title: "بوابة اليوم", hint: "مسموح لك تاخذ مخاطرة جديدة اليوم؟", cta: { label: "شوف حالة يومك", to: "/dashboard" } },
  { key: "plan", title: "خطة اليوم", hint: "الهدف وعدد الصفقات والمخاطرة وأقصى خسارة، قبل أول صفقة.", cta: { label: "اكتب خطتك مع سَنَد", to: "/session" } },
  { key: "trade", title: "فحص الصفقة", hint: "كل صفقة تمر على البوابة قبل ما تدخل.", cta: { label: "صفقة جديدة", to: "/new-trade" } },
  { key: "review", title: "سكّر وراجع الصفقة", hint: "وقف لكل صفقة مفتوحة، ومراجعة لكل صفقة مسكّرة.", cta: { label: "شوف صفقاتك", to: "/trades" } },
  { key: "close", title: "سكّر يومك", hint: "شو التزمت فيه وشو كسرته، وقاعدة وحدة لبكرة.", cta: { label: "سكّر يومك", to: "/session" } },
  { key: "week", title: "مراجعة الأسبوع", hint: "أنماط أسبوعك وقاعدة للأسبوع الجاي.", cta: { label: "راجع أسبوعك", to: "/reports" } },
];

export type SetupItem = "focus" | "strategy" | "rules";
const SETUP: Record<SetupItem, { text: string; cta: Cta }> = {
  focus: { text: "يا هادي، قبل كل شيء: احكي لسَنَد زوجك وهدفك ونقطة ضعفك، وهو بيحفظهم.", cta: { label: "احكي لسَنَد", to: "/coach" } },
  strategy: { text: "أضف استراتيجيتك: شروط الدخول والخروج والأزواج اللي بتتداولها.", cta: { label: "أضف استراتيجية", to: "/strategies" } },
  rules: { text: "اكتب قواعدك: اللي ما بتكسرها مهما صار.", cta: { label: "اكتب قواعدك", to: "/rules" } },
};

/** Effective settings: the dollar limits already taken from limits_pct (settingsQuery). */
export type PipelineSettings = BreakerSettings & {
  timezone?: string | null;
  currency?: string | null;
  current_balance?: number | null;
  breaker_since?: string | null;
  limits_accepted_at?: string | null;
  paused_until?: string | null;
  reviews_since?: string | null;
  max_trades_per_day?: number | null;
  max_daily_profit?: number | null;
};
export type PipelineTrade = BreakerTrade & { stop_loss?: number | null };
/** Today's daily_plans row. */
export type PipelinePlan = {
  no_trading?: boolean | null;
  max_trades?: number | null;
  target?: number | null;
  max_loss?: number | null;
  start_balance?: number | null;
};
export type PipelineSession = { started_at: string; ended_at: string | null };
export type FocusFacts = { markets: readonly string[]; goal?: string | null; weakness?: string | null };

export type PipelineRows = {
  settings: PipelineSettings | null;
  /** The live balance; settings.current_balance when left out. */
  balance?: number | null;
  /** Every trade, or at least this month's, the latest closes and every open one. */
  trades: PipelineTrade[];
  partialEvents?: PartialEvent[];
  latched?: LatchedBreak[];
  ledgerIssues?: LedgerIssues | null;
  plan: PipelinePlan | null;
  /** Today's sessions and any still open. */
  sessions: readonly PipelineSession[];
  focus: FocusFacts | null;
  strategies: number;
  /** Active rules. */
  rules: number;
  reviewedTradeIds?: Iterable<string>;
  /** period_key of every weekly review; null = weekly reviews can't be written yet, so never due. */
  weeklyReviewKeys?: readonly string[] | null;
  now?: Date;
};

type TradeRef = { id: string; symbol: string };

/** The facts the steps are picked from. */
export type PipelineState = {
  now: Date;
  tz: string;
  currency: string;
  /** Setup items still missing, in the order سَنَد asks for them. */
  setupMissing: SetupItem[];
  /** null when it couldn't be computed (no settings). */
  breaker: BreakerResult | null;
  plan: PipelinePlan | null;
  /** The oldest session still open from an earlier day: it must be closed first. */
  staleSession: PipelineSession | null;
  /** Today's latest session. */
  session: { active: boolean; ended: boolean } | null;
  tradesToday: number;
  pnlToday: number;
  openTrades: number;
  openWithoutStop: TradeRef[];
  /** Closes at or after reviews_since still owed a review (the gate's own unreviewedCloses). */
  unreviewedClosed: TradeRef[];
  /** Max trades or the profit cap reached («احمِ ربحك»). */
  protect: ProtectProfit | null;
  /** The plan's own trade count or target reached. */
  planReached: string | null;
  /** Last week's review: null while weekly reviews aren't tracked. */
  weekly: { key: string; due: boolean } | null;
};

const ms = (s: string | null | undefined) => {
  const v = s ? Date.parse(s) : NaN;
  return Number.isFinite(v) ? v : null;
};
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

export const focusReady = (f: FocusFacts | null) => !!f && f.markets.length > 0 && !!(f.goal || f.weakness);

/** The rows turned into facts, every one through the engine that owns it. */
export function pipelineState(r: PipelineRows): PipelineState {
  const now = r.now ?? new Date();
  const t = now.getTime();
  const s = r.settings;
  const tz = safeTz(s?.timezone);
  const currency = s?.currency || "USD";
  const start = dayStart(now, tz).getTime();

  const breaker = s
    ? evaluateBreaker({
        settings: s,
        startBalance: r.plan?.start_balance ?? null,
        balance: Number(r.balance ?? s.current_balance) || 0,
        trades: r.trades,
        partialEvents: r.partialEvents ?? [],
        ledgerIssues: r.ledgerIssues ?? null,
        latched: r.latched ?? [],
        planMaxLoss: r.plan?.max_loss ?? null,
        limitsAcceptedAt: s.limits_accepted_at ?? null,
        breakerSince: s.breaker_since ?? null,
        pausedUntil: s.paused_until ?? null,
        tz,
        now,
      })
    : null;

  const setupMissing: SetupItem[] = [];
  if (!focusReady(r.focus)) setupMissing.push("focus");
  if (!(r.strategies > 0)) setupMissing.push("strategy");
  if (!(r.rules > 0)) setupMissing.push("rules");

  // Counted like computeDayMetrics (opened today); realized P&L from the breaker, trims included.
  const tradesToday = r.trades.filter((x) => (ms(x.opened_at) ?? -Infinity) >= start).length;
  const pnlToday = breaker
    ? breaker.pnl.day
    : r2(r.trades.filter((x) => x.status === "closed" && (ms(x.closed_at) ?? -Infinity) >= start).reduce((a, x) => a + (Number(x.pnl) || 0), 0));
  const protect = s ? protectProfit({ tradesToday, todayPnl: pnlToday }, s) : null;

  const p = r.plan;
  const maxTrades = pos(p?.max_trades);
  const target = pos(p?.target);
  const planReached = !p || p.no_trading
    ? null
    : maxTrades && tradesToday >= maxTrades
      ? `خلصت صفقات خطتك اليوم (${tradesToday} من ${maxTrades})`
      : target && pnlToday >= target
        ? `وصلت هدف خطتك اليوم (${money(pnlToday, currency)} من ${money(target, currency)})`
        : null;

  const started = (x: PipelineSession) => ms(x.started_at) ?? 0;
  const staleSession = r.sessions.filter((x) => !x.ended_at && started(x) < start).sort((a, b) => started(a) - started(b))[0] ?? null;
  const latest = r.sessions.filter((x) => started(x) >= start).sort((a, b) => started(b) - started(a))[0];

  const open = r.trades.filter((x) => x.status === "open");
  const ref = (x: { id: string; symbol: string }): TradeRef => ({ id: x.id, symbol: x.symbol });

  let weekly: PipelineState["weekly"] = null;
  if (r.weeklyReviewKeys) {
    const thisWeek = weekStart(now, tz);
    const lastWeek = zonedMidnight(addDays(dayKey(thisWeek, tz), -7), tz);
    const key = isoWeekKey(lastWeek, tz);
    // A week with no closes has nothing to review.
    const traded = r.trades.some((x) => {
      const at = ms(x.closed_at);
      return x.status === "closed" && at != null && at >= lastWeek.getTime() && at < thisWeek.getTime();
    });
    weekly = { key, due: traded && !r.weeklyReviewKeys.includes(key) };
  }

  return {
    now,
    tz,
    currency,
    setupMissing,
    breaker,
    plan: p,
    staleSession,
    session: latest ? { active: !latest.ended_at, ended: !!latest.ended_at } : null,
    tradesToday,
    pnlToday,
    openTrades: open.length,
    openWithoutStop: open.filter((x) => !(pos(x.stop_loss) > 0)).map(ref),
    unreviewedClosed: unreviewedCloses(r.trades, r.reviewedTradeIds ?? [], s?.reviews_since, now).map(ref),
    protect,
    planReached,
    weekly,
  };
}

/** Whether new risk is off for now: anything but TRADING_ALLOWED (PARTIAL is HALTED). */
export const isBlocked = (b: BreakerResult | null | undefined) => !!b && b.state !== "TRADING_ALLOWED";

export type BlockerCode =
  | "setup"
  | "stale_session"
  | "partial"
  | "weekly_due"
  | "breaker"
  | "no_stop"
  | "unreviewed"
  | "no_plan"
  | "protect_profit"
  | "rest_day";

/** Something that holds the day before «فحص الصفقة», in priority order. */
export type Blocker = { code: BlockerCode; n: StepN; text: string; tone: Tone; cta: Cta };

export type PipelineStep = {
  n: StepN;
  key: StepKey;
  title: string;
  hint: string;
  done: boolean;
  /** blocked: can't happen now (the breaker, a rest day, protect-profit). */
  status: "done" | "current" | "todo" | "blocked";
};

export type DayPipeline = {
  steps: PipelineStep[];
  current: { n: StepN; key: StepKey; title: string; message: string; tone: Tone };
  cta: Cta;
  secondary: Cta | null;
  /** Every holding condition, the current one first. */
  blockers: Blocker[];
  /** Whether «صفقة جديدة» may be offered on Today at all. */
  newTrade: boolean;
  /** The day is closed and nothing holds it: nothing left to do today. */
  finished: boolean;
};

const lastLosses = (n: number) => (n === 1 ? "آخر خسارة" : n === 2 ? "آخر خسارتين" : n <= 10 ? `آخر ${n} خسارات` : `آخر ${n} خسارة`);
const listed = (xs: TradeRef[]) => [...new Set(xs.map((x) => x.symbol))].join("، ");

/**
 * The current step, in the plan's priority order: setup → 0, a session left open from an
 * earlier day → 1, PARTIAL → 1 (repair), the weekly review due → 6, HALTED or COOLDOWN → 1,
 * an open trade with no stop → 4 (danger), an unreviewed close → 4, then — unless the day
 * is already closed — no plan → 2, the plan or protect-profit reached → 5 (no new trade),
 * a rest day → 5, otherwise → 3.
 */
export function dayPipeline(s: PipelineState): DayPipeline {
  const b = s.breaker;
  const blockers: Blocker[] = [];
  const add = (code: BlockerCode, n: StepN, text: string, tone: Tone, cta: Cta) => blockers.push({ code, n, text, tone, cta });
  // Today's session was closed (end_session): the day is done unless something still holds it.
  const closed = !!s.session?.ended;
  const breakerOff = isBlocked(b);

  for (const item of s.setupMissing) add("setup", 0, SETUP[item].text, "neutral", SETUP[item].cta);

  if (s.staleSession)
    add("stale_session", 1, `عندك جلسة مفتوحة من ${dayKey(s.staleSession.started_at, s.tz)}. سكّرها أول قبل ما تبدأ يوم جديد.`, "warning", { label: "سكّر الجلسة القديمة", to: "/session" });

  if (b?.partial) add("partial", 1, breakerCopy(b, s.currency).reason, "danger", { label: "صلّح الصفقات", to: "/trades" });

  if (s.weekly?.due) add("weekly_due", 6, "أسبوع جديد. راجع أسبوعك الماضي قبل خطة اليوم.", "neutral", STEPS[6]!.cta);

  if (b && !b.partial && b.state !== "TRADING_ALLOWED") {
    const c = breakerCopy(b, s.currency);
    const text = `${c.reason}${c.release ? ` ${c.release}.` : ""}${b.preview ? " (معاينة: القاطع لسا ما تفعّل)" : ""}`;
    if (b.state === "COOLDOWN")
      add("breaker", 1, text, "warning", { label: b.streak.losses > 0 ? `راجع ${lastLosses(b.streak.losses)} مع المحلل` : "راجع صفقاتك مع المحلل", to: "/analyst" });
    else
      // HALTED: only managing, closing and reviewing open trades is left.
      add("breaker", 1, text, "danger", s.openTrades > 0 ? { label: "دير صفقاتك المفتوحة", to: "/trades" } : closed ? { label: "شوف أداءك", to: "/performance" } : STEPS[5]!.cta);
  }

  if (s.openWithoutStop.length)
    add("no_stop", 4, `${s.openWithoutStop.length === 1 ? "عندك صفقة مفتوحة" : `عندك ${s.openWithoutStop.length} صفقات مفتوحة`} بدون وقف خسارة (${listed(s.openWithoutStop)}). حط الوقف الحين.`, "danger", { label: "حط الوقف", to: "/trades" });

  if (s.unreviewedClosed.length)
    add("unreviewed", 4, `${s.unreviewedClosed.length === 1 ? "في صفقة مسكّرة" : `في ${s.unreviewedClosed.length} صفقات مسكّرة`} ما راجعتها (${listed(s.unreviewedClosed)}). راجعها قبل الجديدة.`, "warning", { label: "راجع الصفقة", to: "/trades" });

  // Once the day is closed, planning or protecting it is moot; while the breaker holds, so is a plan.
  if (!closed) {
    if (!s.plan && !breakerOff) add("no_plan", 2, "ما في خطة مكتوبة لليوم. اكتبها قبل أول صفقة: الهدف، عدد الصفقات، المخاطرة وأقصى خسارة.", "neutral", STEPS[2]!.cta);
    const reached = s.planReached ?? s.protect?.text;
    if (reached) add("protect_profit", 5, `${reached}. احمِ ربحك، لا تزيد صفقات، وسكّر يومك.`, "success", STEPS[5]!.cta);
    if (s.plan?.no_trading) add("rest_day", 5, "اليوم يوم راحة في خطتك. لا صفقات اليوم، وارجع بكرة.", "neutral", STEPS[5]!.cta);
  }

  const top = blockers[0];
  const finished = closed && !top;
  const n: StepN = top?.n ?? (finished ? 5 : 3);
  const message = top?.text ?? (finished
    ? "خلصت يومك. ارتاح، والسوق باقي بكرة."
    : "خطتك جاهزة. ارفع صورة أو قل لسَنَد صفقتك، والبوابة بتفحصها قبل الدخول.");
  const tone: Tone = top?.tone ?? (finished ? "success" : "neutral");
  const cta: Cta = top?.cta ?? (finished ? { label: "شوف أداءك", to: "/performance" } : STEPS[3]!.cta);

  const newTrade = !breakerOff && !closed && !s.plan?.no_trading && !s.planReached && !s.protect;

  // A second button only where it can't compete with the main one.
  let secondary: Cta | null = null;
  if (n === 3 && s.tradesToday > 0) secondary = STEPS[5]!.cta;
  else if (n === 1 && b?.state === "COOLDOWN" && s.openTrades > 0) secondary = { label: "شوف صفقاتك", to: "/trades" };
  else if (n === 5 && !closed && s.openTrades > 0) secondary = { label: "شوف صفقاتك المفتوحة", to: "/trades" };

  const done = [
    s.setupMissing.length === 0,
    !!b && !breakerOff && !s.staleSession,
    !!s.plan,
    s.tradesToday > 0,
    s.tradesToday > 0 && s.openTrades === 0 && s.unreviewedClosed.length === 0,
    closed,
    !!s.weekly && !s.weekly.due,
  ];
  const steps: PipelineStep[] = STEPS.map((x, i) => {
    const k = i as StepN;
    // No new trade outranks «traded today»; a plan already written stays done.
    const noTrade = k === 3 && !newTrade && !closed;
    const noPlan = k === 2 && breakerOff;
    return {
      n: k,
      key: x.key,
      title: x.title,
      hint: x.hint,
      done: done[i]!,
      status: k === n && !finished ? "current" : noTrade ? "blocked" : done[i] ? "done" : noPlan ? "blocked" : "todo",
    };
  });

  return { steps, current: { n, key: STEPS[n]!.key, title: STEPS[n]!.title, message, tone }, cta, secondary, blockers, newTrade, finished };
}

/** The step for the AI, computed: it quotes it and never re-derives it. */
export function pipelineForPrompt(p: DayPipeline): string {
  const done = p.steps.filter((x) => x.done).map((x) => x.title);
  const head = p.finished
    ? "خطوات اليوم (محسوبة): العميل أنهى يومه وسكّر جلسته، ما في خطوة باقية اليوم."
    : `خطوة العميل الحالية (محسوبة، لا تعيد حسابها): ${p.current.n} من 6 «${p.current.title}» — ${p.current.message} الزر: «${p.cta.label}».`;
  const rest = p.blockers.slice(1).map((x) => `${x.n} «${STEPS[x.n]!.title}»: ${x.text}`);
  return [
    head,
    rest.length ? `بعدها: ${rest.join(" | ")}` : null,
    p.newTrade ? null : "صفقة جديدة مو مطروحة اليوم.",
    `المنجز: ${done.join("، ") || "لا شيء"}.`,
  ].filter(Boolean).join("\n");
}
