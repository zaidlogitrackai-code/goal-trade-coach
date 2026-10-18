/**
 * The pre-trade gate: one decision for one trade idea, after the pre-trade-discipline-gate
 * skill. Code decides; the AI can only raise it (applyAiOpinion) and never computes money.
 * Pure — the caller loads the breaker result, today's plan, the closes and partial trims.
 *
 * GO < NO_ACTIONABLE < REVIEW_REQUIRED < NO_GO (the pre_trade_checks.decision CHECK order).
 * Every rule can only raise the decision and every reason is kept, so one bad answer
 * can't hide another. Saving is never blocked: a NO_GO asks for a reason (owner decision 1).
 */
import { breakerCopy, money, type BreakerResult, type BreakerState, type PartialEvent } from "./circuit-breaker";
import { inRevengeWindow, isSensitive, REVENGE_WINDOW_MIN } from "./emotions";
import { checkLevels, lotForRisk, riskUsd, type LevelsCheck } from "./trade-idea";
import { wallClock } from "./trading-day";
import type { ProtectProfit } from "./trading-status";
import type { Database } from "@/integrations/supabase/types";

export type GateDecision = "GO" | "NO_ACTIONABLE" | "REVIEW_REQUIRED" | "NO_GO";
export const DECISION_RANK: Record<GateDecision, number> = { GO: 0, NO_ACTIONABLE: 1, REVIEW_REQUIRED: 2, NO_GO: 3 };

/**
 * pre_entry: before the order goes in. already_placed: an open trade he (or the AI from an
 * MT5 screenshot) logs after entering. historical: an old or already-closed row. watch:
 * the analyst's «راقبها» card. Only the first two are decisions to act on.
 */
export const GATE_INTENTS = ["pre_entry", "already_placed", "historical", "watch"] as const;
export type GateIntent = (typeof GATE_INTENTS)[number];

/** The skill's four questions. null = not answered. */
export const ANSWER_KEYS = ["in_written_plan", "stop_predefined", "size_within_plan", "not_revenge"] as const;
export type AnswerKey = (typeof ANSWER_KEYS)[number];
export type Answers = Record<AnswerKey, boolean | null>;

export const GATE_QUESTIONS: Record<AnswerKey, string> = {
  in_written_plan: "الصفقة من خطتك المكتوبة؟",
  stop_predefined: "حطيت الوقف قبل الدخول؟",
  size_within_plan: "الحجم ضمن خطتك؟",
  not_revenge: "مو صفقة تعويض؟",
};

export type ReasonCode =
  | "not_actionable"
  | "breaker"
  | "breaker_unknown"
  | "no_settings"
  | "rest_day"
  | "no_plan"
  | "no_stop"
  | "bad_levels"
  | "risk_over_plan"
  | "risk_unknown"
  | "not_in_plan"
  | "stop_not_predefined"
  | "size_over_plan"
  | "revenge_declared"
  | "revenge_window"
  | "protect_profit"
  | "outside_session"
  | "unreviewed"
  | "unanswered"
  | "ai_mismatch";

/** One reason, stored as is in pre_trade_checks.reasons. */
export type GateReason = { code: ReasonCode; decision: Exclude<GateDecision, "GO">; text: string };
/** Shown at the gate, never changes the decision. */
export type GateWarning = { code: "temp_rule" | "heat" | "emotion"; text: string };

export type GateTicket = {
  symbol: string | null;
  direction: string | null;
  entry: number | null;
  stop: number | null;
  targets?: (number | null)[];
  lots: number | null;
  /** A risk amount he typed; the gate uses the larger of it and the lots' risk. */
  typedRisk?: number | null;
  emotion?: string | null;
  /** already_placed: when he entered. The revenge window and session hours are judged then. */
  openedAt?: string | null;
};

/** Effective settings: dollar limits already taken from limits_pct on the day's anchor. */
export type GateSettings = {
  max_risk_per_trade?: number | null;
  cooldown_minutes?: number | null;
  session_start?: string | null;
  session_end?: string | null;
  timezone?: string | null;
  /** Closes at or after this need a review before the next entry; null = the rule is off. */
  reviews_since?: string | null;
};

/** Today's daily_plans row; null when no plan was written. */
export type GatePlan = { no_trading?: boolean | null; risk_per_trade?: number | null };

export type GateTrade = { id: string; status: string; pnl: number | null; closed_at: string | null };

/** An accepted time-boxed rule (daily_plans.rules_today). */
export type TempRule = { text: string; left?: number | null };

export type GateInput = {
  intent: GateIntent;
  ticket: GateTicket;
  /** His own answers; computed ones are filled in by the gate. */
  answers?: Partial<Answers> | null;
  /** The circuit breaker now; null when it couldn't be computed. */
  breaker: BreakerResult | null;
  settings: GateSettings | null;
  plan: GatePlan | null;
  /** protectProfit for today: max trades or the profit cap reached. */
  protect?: ProtectProfit | null;
  /** Closes for the revenge window and the review rule. */
  trades?: GateTrade[];
  partialEvents?: PartialEvent[];
  reviewedTradeIds?: Iterable<string>;
  tempRules?: TempRule[];
  /** Risk already open, for the heat warning. */
  openRisk?: number | null;
  currency?: string;
  now?: Date;
};

export type LastLoss = { tradeId: string; at: string; pnl: number; trim: boolean; minutesAgo: number };

export type GateResult = {
  decision: GateDecision;
  /** Strictest first. */
  reasons: GateReason[];
  warnings: GateWarning[];
  /** His answers with the computed ones filled in; an explicit «لا» always wins. */
  answers: Answers;
  /** Answered by code (shown as «✓ محسوبة», skipped by the stepper). */
  computed: AnswerKey[];
  plannedRisk: number | null;
  actualRisk: number | null;
  /** The lot size that fits the planned risk. */
  maxLots: number | null;
  /** The latest realized loss before the entry, and whether it is inside the revenge window. */
  lastLoss: LastLoss | null;
  revengeWindowMin: number;
  inRevengeWindow: boolean;
  /** pre_trade_checks.upstream: the breaker state, PARTIAL when its data is broken. */
  upstream: BreakerState | "PARTIAL" | null;
};

export const DECISION_META: Record<GateDecision, { label: string; hint: string; tone: "success" | "warning" | "destructive" | "primary" }> = {
  GO: { label: "تقدر تدخل", hint: "الصفقة ضمن خطتك وحدودك. التزم بالوقف.", tone: "success" },
  REVIEW_REQUIRED: { label: "راجع قبل الدخول", hint: "في شي ناقص أو يبي تأكيد قبل ما تدخل.", tone: "warning" },
  NO_GO: { label: "لا تدخل", hint: "الصفقة تكسر خطتك أو حدودك. لو دخلت، اكتب السبب وتنحسب مخالفة.", tone: "destructive" },
  NO_ACTIONABLE: { label: "توثيق بس", hint: "صفقة قديمة أو فكرة مراقبة: تنحفظ بدون قرار دخول.", tone: "primary" },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
function ms(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Date.parse(s);
  return Number.isFinite(v) ? v : null;
}
/** A cent: risk is rounded to cents, so float noise must not read as over the plan. */
const CENT = 0.005;

export const stricter = (a: GateDecision, b: GateDecision): GateDecision => (DECISION_RANK[b] > DECISION_RANK[a] ? b : a);

/**
 * One decision for several (a screenshot with three trades, today's checks): the strictest
 * actionable one. History and watch rows don't count unless nothing else was decided.
 */
export function aggregateDecisions(ds: readonly GateDecision[]): GateDecision | null {
  const act: GateDecision[] = ds.filter((d) => d !== "NO_ACTIONABLE");
  if (act.length) return act.reduce(stricter);
  return ds.length ? "NO_ACTIONABLE" : null;
}

/** The risk he planned for one trade: today's plan, never looser than his per-trade limit. */
export function plannedRisk(settings: Pick<GateSettings, "max_risk_per_trade"> | null | undefined, plan: Pick<GatePlan, "risk_per_trade"> | null | undefined): number | null {
  const own = pos(settings?.max_risk_per_trade);
  const today = pos(plan?.risk_per_trade);
  if (own && today) return Math.min(own, today);
  return own || today || null;
}

/**
 * The latest realized loss at or before `now`: a losing close (trades.pnl is the whole
 * trade) or a losing partial trim at its own time — a trim loss stings like a close.
 */
export function lastLoss(trades: readonly GateTrade[], partialEvents: readonly PartialEvent[], now: Date): LastLoss | null {
  const t = now.getTime();
  const losses = [
    ...trades.filter((x) => x.status === "closed").map((x) => ({ tradeId: x.id, at: ms(x.closed_at), pnl: x.pnl, trim: false })),
    ...partialEvents.filter((e) => !e.kind || e.kind === "partial_close").map((e) => ({ tradeId: e.trade_id, at: ms(e.at), pnl: e.realized_pnl, trim: true })),
  ].filter((x): x is { tradeId: string; at: number; pnl: number; trim: boolean } => x.at != null && x.at <= t && fin(x.pnl) && x.pnl < 0);
  if (!losses.length) return null;
  const b = losses.reduce((a, x) => (x.at > a.at ? x : a));
  return { tradeId: b.tradeId, at: new Date(b.at).toISOString(), pnl: b.pnl, trim: b.trim, minutesAgo: Math.floor((t - b.at) / 60_000) };
}

/** The last loss if it is still inside the revenge window (REVENGE_WINDOW_MIN minutes). */
export function lastLossWithin(trades: readonly GateTrade[], partialEvents: readonly PartialEvent[], windowMin: number, now: Date): LastLoss | null {
  const l = lastLoss(trades, partialEvents, now);
  return l && inRevengeWindow(now.getTime() - Date.parse(l.at), windowMin) ? l : null;
}

/**
 * Closes he still owes a review: closed at or after reviews_since and not after `now`.
 * reviews_since null switches the rule off, so years of old history never lock the gate.
 */
export function unreviewedCloses<T extends GateTrade>(trades: readonly T[], reviewed: Iterable<string>, reviewsSince: string | null | undefined, now: Date): T[] {
  const since = ms(reviewsSince);
  if (since == null) return [];
  const done = new Set(reviewed);
  return trades.filter((x) => {
    const at = ms(x.closed_at);
    return x.status === "closed" && at != null && at >= since && at <= now.getTime() && !done.has(x.id);
  });
}

function clockMin(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Inside his session hours on his own clock? null when they aren't both set. An overnight session wraps midnight. */
export function inSessionHours(at: Date, start: string | null | undefined, end: string | null | undefined, tz: string | null | undefined): boolean | null {
  const a = clockMin(start);
  const b = clockMin(end);
  if (a == null || b == null || a === b) return null;
  const w = wallClock(at, tz);
  const t = w.hour * 60 + w.minute;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

const minutesAgo = (n: number) =>
  n < 1 ? "أقل من دقيقة" : n === 1 ? "دقيقة" : n === 2 ? "دقيقتين" : n <= 10 ? `${n} دقايق` : `${n} دقيقة`;

export function evaluatePreTrade(input: GateInput): GateResult {
  const now = input.now ?? new Date();
  const cur = input.currency ?? "USD";
  const t = input.ticket;
  const s = input.settings;

  const reasons: GateReason[] = [];
  const warnings: GateWarning[] = [];
  const add = (code: ReasonCode, decision: GateReason["decision"], text: string) => {
    if (!reasons.some((r) => r.code === code)) reasons.push({ code, decision, text });
  };
  const has = (code: ReasonCode) => reasons.some((r) => r.code === code);

  // A placed trade is judged at its entry time: "right after a loss" means before he entered.
  const opened = input.intent === "already_placed" ? ms(t.openedAt) : null;
  const at = opened != null && opened <= now.getTime() ? new Date(opened) : now;

  // The numbers, also kept for history and watch rows (journaled, never decided).
  const dir = t.direction === "long" || t.direction === "short" ? t.direction : null;
  const sym = t.symbol?.trim() ? t.symbol.trim().toUpperCase() : null;
  const entry = fin(t.entry) ? t.entry : null;
  const stop = fin(t.stop) && t.stop > 0 ? t.stop : null;
  const lots = pos(t.lots) || null;
  let levels: LevelsCheck | null = null;
  if (dir && entry != null && stop != null)
    levels = checkLevels({ direction: dir, entry, stop, targets: (t.targets ?? []).filter(fin) });
  const levelsOk = !!levels?.ok;
  const fromLots = levelsOk && sym && lots ? riskUsd(sym, entry!, stop!, lots) : null;
  const typed = Math.abs(Number(t.typedRisk));
  const typedRisk = Number.isFinite(typed) && typed > 0 ? typed : null;
  // Never looser on a guess: a typed amount below what the lots really risk doesn't count.
  const actualRisk = fromLots == null && typedRisk == null ? null : r2(Math.max(fromLots ?? 0, typedRisk ?? 0));
  const planned = plannedRisk(s, input.plan);
  const maxLots = planned != null && levelsOk && sym ? lotForRisk(sym, entry!, stop!, planned) : null;

  const windowMin = REVENGE_WINDOW_MIN(s);
  const loss = lastLoss(input.trades ?? [], input.partialEvents ?? [], at);
  const inWindow = !!loss && inRevengeWindow(at.getTime() - Date.parse(loss.at), windowMin);

  const b = input.breaker;
  const upstream: GateResult["upstream"] = b ? (b.partial ? "PARTIAL" : b.state) : null;
  const given = input.answers ?? {};
  const base = { plannedRisk: planned, actualRisk, maxLots, lastLoss: loss, revengeWindowMin: windowMin, inRevengeWindow: inWindow, upstream };

  if (input.intent === "historical" || input.intent === "watch") {
    const answers = Object.fromEntries(ANSWER_KEYS.map((k) => [k, given[k] ?? null])) as Answers;
    const text = input.intent === "watch" ? "فكرة للمراقبة: تنحفظ بدون دخول." : "صفقة قديمة: تنحفظ للتوثيق بس.";
    return { ...base, decision: "NO_ACTIONABLE", reasons: [{ code: "not_actionable", decision: "NO_ACTIONABLE", text }], warnings, answers, computed: [] };
  }

  // 1. Upstream: the breaker decides whether new risk may be taken at all. PARTIAL is HALTED.
  if (!b) add("breaker_unknown", "REVIEW_REQUIRED", "ما قدرت أتأكد من حالة يومك، راجعها قبل الدخول.");
  else if (b.state !== "TRADING_ALLOWED") {
    const c = breakerCopy(b, cur);
    // Before breaker_since the breaker only warns (preview), so its stop is a review here too.
    if (b.preview) add("breaker", "REVIEW_REQUIRED", `قاطع الحماية (معاينة، مو مفعّل): ${c.reason}`);
    else add("breaker", "NO_GO", `${c.chip}: ${c.reason}${c.release ? ` ${c.release}.` : ""}`);
  }

  if (!s) add("no_settings", "REVIEW_REQUIRED", "ما في حدود محفوظة، كمّل الإعداد أول.");

  if (!input.plan) add("no_plan", "REVIEW_REQUIRED", "ما في خطة مكتوبة لليوم.");
  else if (input.plan.no_trading) add("rest_day", "NO_GO", "اليوم يوم راحة في خطتك.");

  // 2. The ticket: a stop, consistent levels, and a risk inside the plan.
  if (stop == null) add("no_stop", "NO_GO", "ما في وقف خسارة. حط الوقف قبل الدخول.");
  if (levels && !levels.ok) add("bad_levels", "NO_GO", `أرقام الصفقة متناقضة: ${levels.problems.join("، ")}.`);
  if (stop != null && !has("bad_levels")) {
    if (actualRisk == null) {
      const missing = [!sym && "الأصل", entry == null && "سعر الدخول", !dir && "الاتجاه", !lots && "الحجم"].filter((x): x is string => !!x);
      add("risk_unknown", "REVIEW_REQUIRED", `ما قدرت أحسب مخاطرة الصفقة${missing.length ? ` (ناقص ${missing.join(" و")})` : ""}.`);
    } else if (planned != null && actualRisk > planned + CENT) {
      add("risk_over_plan", "NO_GO", `مخاطرتك ${money(actualRisk, cur)} أكبر من المخططة ${money(planned, cur)}${maxLots ? `، الحجم الصح ${maxLots} لوت` : ""}.`);
    }
  }

  // 3. The four answers: computed where code can know, an explicit «لا» always wins.
  const computed: Partial<Answers> = {};
  if (stop == null) computed.stop_predefined = false;
  else if (input.intent === "pre_entry") computed.stop_predefined = true; // typed before the order goes in
  if (actualRisk != null && planned != null) computed.size_within_plan = actualRisk <= planned + CENT;
  if (inWindow) computed.not_revenge = false;
  else if (!isSensitive(t.emotion)) computed.not_revenge = true; // no loss just before and a calm state: nothing to ask
  const answers = {} as Answers;
  for (const k of ANSWER_KEYS) {
    const c = computed[k];
    const g = given[k];
    answers[k] = c === false || g === false ? false : c === true || g === true ? true : null;
  }
  if (given.in_written_plan === false) add("not_in_plan", "NO_GO", "قلت إن الصفقة مو من خطتك المكتوبة.");
  if (given.stop_predefined === false && !has("no_stop")) add("stop_not_predefined", "NO_GO", "قلت إن الوقف ما كان محدد قبل الدخول.");
  if (given.size_within_plan === false && !has("risk_over_plan")) add("size_over_plan", "NO_GO", "قلت إن الحجم أكبر من خطتك.");
  if (given.not_revenge === false) add("revenge_declared", "NO_GO", "قلت إنها صفقة تعويض.");

  if (inWindow && loss)
    add("revenge_window", "NO_GO", at === now
      ? `خسرت قبل ${minutesAgo(loss.minutesAgo)}، ونافذة الانتقام ${windowMin} دقيقة. لا تدخل صفقة تعويض.`
      : `دخلت بعد ${minutesAgo(loss.minutesAgo)} من خسارة، داخل نافذة الانتقام (${windowMin} دقيقة).`);

  // 4. Reviews: protect the profit, keep to the session, review the last close.
  if (input.protect) add("protect_profit", "REVIEW_REQUIRED", `${input.protect.text}. احمِ ربحك، لا تزيد صفقات.`);
  if (inSessionHours(at, s?.session_start, s?.session_end, s?.timezone) === false)
    add("outside_session", "REVIEW_REQUIRED", `برّا ساعات جلستك (${s!.session_start!.slice(0, 5)}–${s!.session_end!.slice(0, 5)}).`);
  const owed = unreviewedCloses(input.trades ?? [], input.reviewedTradeIds ?? [], s?.reviews_since, at).length;
  if (owed)
    add("unreviewed", "REVIEW_REQUIRED", owed === 1 ? "في صفقة مسكّرة ما راجعتها. راجعها قبل الجديدة." : `في ${owed} صفقات مسكّرة ما راجعتها. راجعها قبل الجديدة.`);

  // A blank answer is a review, not a NO_GO (owner decision 5).
  const blank = ANSWER_KEYS.filter((k) => answers[k] == null);
  if (blank.length) add("unanswered", "REVIEW_REQUIRED", `ما جاوبت: ${blank.map((k) => GATE_QUESTIONS[k]).join(" ")}`);

  // Warnings: shown, never decisive.
  for (const r of input.tempRules ?? [])
    warnings.push({ code: "temp_rule", text: `قاعدة مؤقتة: ${r.text}${r.left != null ? ` — باقي ${r.left}` : ""}` });
  // Heat only while trading is allowed: once stopped, the breaker reason already says so.
  const room = b?.state === "TRADING_ALLOWED" ? b.limits.find((l) => l.rule === "max_daily_loss" && l.binding) : undefined;
  const heat = actualRisk != null ? r2(pos(input.openRisk) + actualRisk) : null;
  if (room && heat != null && heat > room.remaining + CENT)
    warnings.push({ code: "heat", text: `لو ضربت كل الوقوف بتخسر ${money(heat, cur)}، وباقي لك ${money(room.remaining, cur)} قبل إيقاف اليوم.` });
  if (isSensitive(t.emotion))
    warnings.push({ code: "emotion", text: `حالتك «${t.emotion}» حساسة: تأكد إن الدخول مو انتقام ولا طمع.` });

  reasons.sort((x, y) => DECISION_RANK[y.decision] - DECISION_RANK[x.decision]);
  const decision = aggregateDecisions(reasons.map((r) => r.decision)) ?? "GO";
  return { ...base, decision, reasons, warnings, answers, computed: ANSWER_KEYS.filter((k) => computed[k] != null) };
}

/** gateOpinion's verdict on the setup against the strategy's written conditions (T29). */
export type AiOpinion = { plan_match: string | null; missing?: string[] | null };

/**
 * The AI's second opinion can only raise a decision, and only to a review: a setup that
 * misses a written condition is not GO. It never lowers one and never touches history.
 */
export function applyAiOpinion(r: GateResult, op: AiOpinion | null | undefined): GateResult {
  if (!op || r.decision === "NO_ACTIONABLE") return r;
  if (op.plan_match !== "mismatch" && op.plan_match !== "partial") return r;
  const missing = (op.missing ?? []).map((x) => x.trim()).filter(Boolean);
  const text = missing.length
    ? `سَنَد شايف إن ${missing.length === 1 ? "شرط" : "شروط"} ${missing.map((x) => `«${x}»`).join(" و")} ${missing.length === 1 ? "ناقص" : "ناقصة"}.`
    : "سَنَد شايف إن الإعداد مو مطابق لاستراتيجيتك المكتوبة.";
  const reasons = [...r.reasons.filter((x) => x.code !== "ai_mismatch"), { code: "ai_mismatch" as const, decision: "REVIEW_REQUIRED" as const, text }];
  reasons.sort((x, y) => DECISION_RANK[y.decision] - DECISION_RANK[x.decision]);
  return { ...r, decision: stricter(r.decision, "REVIEW_REQUIRED"), reasons };
}

type CheckInsert = Database["public"]["Tables"]["pre_trade_checks"]["Insert"];

/**
 * The pre_trade_checks row for a decision (user_id is the writer's). Every candidate is
 * journaled, GO included; answers holds only what he said himself (null = nothing yet).
 */
export function gateRow(input: GateInput, r: GateResult, source: "form" | "ai"): Omit<CheckInsert, "user_id"> {
  const own = ANSWER_KEYS.filter((k) => input.answers?.[k] != null);
  return {
    source,
    intent: input.intent,
    symbol: input.ticket.symbol?.trim().toUpperCase() || null,
    direction: input.ticket.direction,
    decision: r.decision,
    reasons: r.reasons.map((x) => ({ code: x.code, decision: x.decision, text: x.text })),
    answers: own.length ? Object.fromEntries(own.map((k) => [k, input.answers![k]!])) : null,
    planned_risk: r.plannedRisk,
    actual_risk: r.actualRisk,
    max_lots: r.maxLots,
    position_size: pos(input.ticket.lots) || null,
    upstream: r.upstream,
    minutes_since_loss: r.lastLoss?.minutesAgo ?? null,
  };
}
