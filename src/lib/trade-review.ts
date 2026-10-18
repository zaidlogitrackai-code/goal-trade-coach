/**
 * The review of one trade, after the trade-performance-coach skill: process, risk and
 * execution findings, possible behaviour patterns with their evidence, scores, the quadrant
 * (process × result) and one verdict. Code decides; reviewTradeAI only explains and can never
 * lower the verdict (stricterVerdict). Pure — the caller loads the trade, its gate check, its
 * trade_events, the day's plan, the latched circuit_breaks and the history.
 *
 * One mistake counts once: a NO_GO he entered on is a market_regime_gate finding only for the
 * reasons no other rule already judges (his own «لا», the size), as the gate does with its own
 * reasons. A missing number is "unclear", never "missed": data-only warnings give `warn`.
 */
import { BREAKER_RULES, money, RULE_LABEL, type BreakerRule, type PartialEvent } from "./circuit-breaker";
import { inRevengeWindow, REVENGE_MARKER, REVENGE_WINDOW_MIN } from "./emotions";
import { ANSWER_KEYS, lastLoss, plannedRisk, type Answers, type TempRule } from "./pre-trade-gate";
import { riskUsd } from "./trade-idea";
import { addDays, dayKey, dayStart, nextTradingDayStart, weekStart, zonedMidnight } from "./trading-day";
import type { Database } from "@/integrations/supabase/types";

/** Exactly the trade_reviews.verdict CHECK (0013), mildest first. */
export type Verdict = "ok" | "warn" | "review" | "violation" | "cooldown";
export const VERDICT_RANK: Record<Verdict, number> = { ok: 0, warn: 1, review: 2, violation: 3, cooldown: 4 };
/** The stricter of two verdicts: an AI opinion can only raise the code's. */
export const stricterVerdict = (a: Verdict, b: Verdict): Verdict => (VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a);

export const VERDICT_META: Record<Verdict, { label: string; tone: "success" | "primary" | "warning" | "destructive" }> = {
  ok: { label: "التزمت بخطتك", tone: "success" },
  warn: { label: "ناقصها بيانات", tone: "primary" },
  review: { label: "تبي مراجعة", tone: "warning" },
  violation: { label: "مخالفة", tone: "destructive" },
  cooldown: { label: "خذ استراحة", tone: "destructive" },
};

/** Exactly the trade_reviews.root_cause CHECK (0013). */
export const ROOT_CAUSES = ["thesis_quality", "execution", "risk_sizing", "market_environment", "rule_violation", "randomness", "unknown"] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];
export type SecondaryCause = "execution" | "risk_sizing" | "market_environment" | "rule_violation" | "behavior_pattern";

export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  thesis_quality: "فكرة الصفقة",
  execution: "التنفيذ",
  risk_sizing: "حجم المخاطرة",
  market_environment: "ظروف اليوم",
  rule_violation: "كسر قاعدة",
  randomness: "عشوائية السوق",
  unknown: "غير واضح",
};

export type Outcome = "win" | "loss" | "breakeven" | "open" | "unknown";
/** Process × result. Break-even sits with the wins, as in the breaker's streak. */
export type Quadrant = "clean_win" | "clean_loss" | "lucky_win" | "dirty_loss";
export const QUADRANT_LABEL: Record<Quadrant, string> = {
  clean_win: "ربح مستحق",
  clean_loss: "خسارة نظيفة",
  lucky_win: "ربح بالحظ",
  dirty_loss: "خسارة مستحقة",
};

export type Severity = "info" | "warning" | "critical";
/** unclear: the data to judge it is missing. It warns, but never counts as a broken rule. */
export type FindingStatus = "met" | "missed" | "unclear";
export type FindingArea = "process" | "risk" | "execution";
export type FindingRule =
  | "market_regime_gate"
  | "setup_confirmation"
  | "stop_predefined"
  | "size_within_plan"
  | "gate_answers"
  | "gate_review"
  | "logged_violation"
  | "pre_entry_thesis_record"
  | "position_size"
  | "portfolio_heat"
  | "losing_streak"
  | "weekly_limit"
  | "overconfidence_after_winner"
  | "stop"
  | "exit"
  | "size_added";
export type Finding = { area: FindingArea; rule: FindingRule; status: FindingStatus; severity: Severity; evidence: string };

/** Possible patterns, in the order their questions are asked. */
export const TAGS = [
  "fomo_entry", "revenge_trade", "added_to_loser", "premature_exit", "overconfidence_after_winner",
  "stop_moved", "size_creep", "unknown_size", "hesitation", "rule_drift", "no_pattern_detected",
] as const;
export type TagCode = (typeof TAGS)[number];
export type Tag = { tag: TagCode; confidence: "low" | "medium" | "high"; evidence: string; question: string };

export const TAG_META: Record<TagCode, { label: string; question: string }> = {
  fomo_entry: { label: "دخول خوف من الفوات", question: "وش كان عندك قبل الدخول ما كان بيكون عندك لو انتظرت التأكيد؟" },
  revenge_trade: { label: "صفقة تعويض", question: "كنت بتدخل هالصفقة لو اللي قبلها كانت رابحة؟" },
  added_to_loser: { label: "تزويد على خسرانة", question: "زوّدت لأن الإعداد تحسّن، ولا عشان ترجّع الخسارة؟" },
  premature_exit: { label: "خروج بدري", question: "أي قاعدة طلّعتك من الصفقة، ولا كان الضيق؟" },
  overconfidence_after_winner: { label: "ثقة زايدة بعد ربح", question: "الربح اللي قبلها غيّر حجمك أو شروط دخولك؟" },
  stop_moved: { label: "تحريك الوقف", question: "الوقف الجديد كان جزء من خطتك قبل الدخول؟" },
  size_creep: { label: "حجم أكبر من الخطة", question: "كيف كانت بتطلع الصفقة لو دخلت بالحجم المخطط؟" },
  unknown_size: { label: "الحجم غير معروف", question: "تقدر تسجّل المخاطرة المخططة والفعلية بالصفقة الجاية عشان نتأكد من الحجم؟" },
  hesitation: { label: "تردد", question: "أي إشارة واضحة كانت بتشيل التردد؟" },
  rule_drift: { label: "انحراف عن القواعد", question: "أي قاعدة وحدة تبسّطها وتلتزم فيها الجلسة الجاية؟" },
  no_pattern_detected: { label: "ما في نمط واضح", question: "في شي ثاني تبي تضيفه لملاحظاتك قبل ما نقفل المراجعة؟" },
};

export const RULE_DURATIONS = ["next_trade", "next_two_trades", "next_session", "next_week", "next_month"] as const;
export type RuleDuration = (typeof RULE_DURATIONS)[number];
export const DURATION_LABEL: Record<RuleDuration, string> = {
  next_trade: "الصفقة الجاية",
  next_two_trades: "الصفقتين الجاية",
  next_session: "الجلسة الجاية",
  next_week: "الأسبوع الجاي",
  next_month: "الشهر الجاي",
};
const DURATION_TRADES: Partial<Record<RuleDuration, number>> = { next_trade: 1, next_two_trades: 2 };

/** One time-boxed rule card; nothing changes until he accepts it (journal_only is the default). */
export type NextRule = { text: string; duration: RuleDuration; trigger: TagCode | "cooldown" | "none"; reason: string };

/** What a complete record has; review_quality = 40 + 60 × present / 7. */
export const QUALITY_FIELDS = ["risk", "planned_risk", "entry_stop", "answers", "entry_notes", "exit_reason", "close_notes"] as const;
export type QualityField = (typeof QUALITY_FIELDS)[number];
export const QUALITY_LABEL: Record<QualityField, string> = {
  risk: "المخاطرة الفعلية",
  planned_risk: "المخاطرة المخططة",
  entry_stop: "الوقف وقت الدخول",
  answers: "أجوبة الأسئلة الأربعة",
  entry_notes: "سبب الدخول",
  exit_reason: "سبب الخروج",
  close_notes: "ملاحظة الإغلاق",
};

/** What its risk is read from (trades columns). */
export type RiskTrade = {
  symbol: string;
  risk_amount: number | null;
  risk_source?: string | null;
  source?: string | null;
  entry_price?: number | null;
  initial_stop_loss?: number | null;
  stop_loss?: number | null;
  position_size?: number | null;
};
export type HistoryTrade = RiskTrade & { id: string; status: string; pnl: number | null; opened_at: string; closed_at: string | null };
export type ReviewTrade = HistoryTrade & {
  direction: string;
  exit_price?: number | null;
  take_profit?: number | null;
  notes?: string | null;
  close_notes?: string | null;
  emotion?: string | null;
  exit_emotion?: string | null;
  exit_reason?: string | null;
};

/** Effective settings: dollar limits already taken from limits_pct on the day's anchor. */
export type ReviewSettings = {
  max_risk_per_trade?: number | null;
  cooldown_minutes?: number | null;
  max_daily_loss?: number | null;
  weekly_max_loss?: number | null;
  timezone?: string | null;
};

/** The pre_trade_checks row linked to the trade. */
export type ReviewCheck = {
  id?: string;
  intent: string;
  decision: string;
  /** His own answers only; null = he answered nothing. */
  answers?: unknown;
  reasons?: unknown;
  planned_risk?: number | null;
  actual_risk?: number | null;
  override_reason?: string | null;
};

export type ReviewEvent = {
  trade_id: string;
  kind: string;
  at: string;
  old_value?: number | null;
  new_value?: number | null;
  planned?: boolean | null;
  realized_pnl?: number | null;
};

export type ReviewViolation = { trade_id: string | null; pre_trade_check_id?: string | null; source: string; note?: string | null };
/** A circuit_breaks row. */
export type ReviewBreak = { rule: string; state: string; triggered_at: string; active_until: string | null; released_at: string | null };
/** The daily_plans row of the trade's day. */
export type ReviewPlan = { set_at?: string | null; risk_per_trade?: number | null; max_loss?: number | null };
/** The analyst's chart_analyses row behind the trade. */
export type ReviewAnalysis = { created_at: string };
/** His own answers on the review sheet. */
export type Postmortem = { rootCause?: string | null; note?: string | null };

export type ReviewCtx = {
  settings: ReviewSettings | null;
  allTrades?: readonly HistoryTrade[];
  violations?: readonly ReviewViolation[];
  check?: ReviewCheck | null;
  /** This trade's events; partial closes of other trades also book their P&L at their own time. */
  events?: readonly ReviewEvent[];
  plan?: ReviewPlan | null;
  latchedBreaks?: readonly ReviewBreak[];
  analysisCard?: ReviewAnalysis | null;
  postmortem?: Postmortem | null;
  currency?: string;
  now?: Date;
};

/** The numbers behind the findings (trade_reviews.facts). */
export type ReviewFacts = {
  plannedRisk: number | null;
  actualRisk: number | null;
  sizeRatio: number | null;
  realizedR: number | null;
  exitR: number | null;
  plannedRR: number | null;
  heat: number | null;
  room: number | null;
  lossesBefore: number;
  weekLoss: number;
  minutesSinceLoss: number | null;
};

export type TradeReview = {
  reviewType: "single_trade" | "partial_close";
  verdict: Verdict;
  outcome: Outcome;
  rootCause: RootCause;
  secondary: SecondaryCause[];
  confidence: "low" | "medium" | "high";
  scores: { process: number; risk: number; execution: number; quality: number };
  process: Finding[];
  risk: Finding[];
  execution: Finding[];
  /** Never empty: no_pattern_detected when nothing else applies. */
  tags: Tag[];
  quadrant: Quadrant | null;
  quadrantLabel: string | null;
  nextRules: NextRule[];
  /** The first four tags' questions. */
  questions: string[];
  missingFields: QualityField[];
  facts: ReviewFacts;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
function ms(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Date.parse(s);
  return Number.isFinite(v) ? v : null;
}
/** A cent: money is rounded to cents, so float noise must not read as over the plan. */
const CENT = 0.005;

const lossesWord = (n: number) => (n === 1 ? "خسارة" : n === 2 ? "خسارتين" : n <= 10 ? `${n} خسارات` : `${n} خسارة`);
const minutesWord = (n: number) =>
  n < 1 ? "أقل من دقيقة" : n === 1 ? "دقيقة" : n === 2 ? "دقيقتين" : n <= 10 ? `${n} دقايق` : `${n} دقيقة`;

/**
 * Dollars at risk when he entered: the risk he recorded, else what the lots risked at the entry
 * stop. A legacy or backfilled row's 0 is a missing number, not a free trade; risk_source
 * 'unknown' is never guessed.
 */
export function riskAtEntry(t: RiskTrade): number | null {
  if (t.risk_source === "unknown") return null;
  const recorded = pos(t.risk_amount);
  if (recorded) return r2(recorded);
  if (t.risk_source === "legacy_recomputed" || t.source === "backfill") return null;
  const entry = pos(t.entry_price);
  const stop = pos(t.initial_stop_loss) || pos(t.stop_loss);
  const lots = pos(t.position_size);
  if (!entry || !stop || !lots || entry === stop) return null;
  return riskUsd(t.symbol, entry, stop, lots) || null;
}

/** The trade's result in R: its P&L over the dollars risked at entry. */
export function realizedR(t: RiskTrade & { pnl: number | null }, risk: number | null = riskAtEntry(t)): number | null {
  return fin(t.pnl) && risk != null && risk > 0 ? r2(t.pnl / risk) : null;
}

type Levels = Pick<ReviewTrade, "direction" | "entry_price" | "exit_price" | "initial_stop_loss" | "stop_loss" | "take_profit">;
const sideOf = (d: string) => (d === "long" ? 1 : d === "short" ? -1 : 0);

/** Where the exit landed in R of the entry stop (+ in profit, − in loss). */
export function exitR(t: Levels): number | null {
  const entry = pos(t.entry_price), exit = pos(t.exit_price), stop = pos(t.initial_stop_loss) || pos(t.stop_loss);
  const side = sideOf(t.direction);
  if (!entry || !exit || !stop || !side || entry === stop) return null;
  return r2((side * (exit - entry)) / Math.abs(entry - stop));
}

/** The planned reward-to-risk: target distance over the entry stop's distance. */
function plannedRR(t: Levels): number | null {
  const entry = pos(t.entry_price), tp = pos(t.take_profit), stop = pos(t.initial_stop_loss) || pos(t.stop_loss);
  if (!entry || !tp || !stop || entry === stop) return null;
  return r2(Math.abs(tp - entry) / Math.abs(entry - stop));
}

/**
 * Everything at risk the moment he entered: this trade plus every trade still open then
 * ("if every stop hits"). Another trade with an unknown risk adds nothing it can't prove.
 */
export function heatAtEntry(t: HistoryTrade, all: readonly HistoryTrade[], own: number | null = riskAtEntry(t)): number | null {
  const at = ms(t.opened_at);
  if (at == null || own == null) return null;
  let heat = own;
  for (const x of all) {
    if (x.id === t.id) continue;
    const o = ms(x.opened_at);
    if (o == null || o > at) continue;
    if (x.status === "closed") {
      const c = ms(x.closed_at);
      if (c == null || c <= at) continue;
    } else if (x.status !== "open") continue;
    heat += riskAtEntry(x) ?? 0;
  }
  return r2(heat);
}

type Close = { id: string; at: number; pnl: number };
/** Closes before the entry, latest first. */
function closesBefore(t: HistoryTrade, all: readonly HistoryTrade[]): Close[] {
  const at = ms(t.opened_at);
  if (at == null) return [];
  const out: Close[] = [];
  for (const x of all) {
    const c = ms(x.closed_at);
    if (x.id !== t.id && x.status === "closed" && fin(x.pnl) && c != null && c <= at) out.push({ id: x.id, at: c, pnl: x.pnl });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Losing closes in a row right before the entry, by close time; break-even is a win (as in the breaker). */
export function lossesBefore(t: HistoryTrade, all: readonly HistoryTrade[]): number {
  let n = 0;
  for (const x of closesBefore(t, all)) {
    if (x.pnl < 0) n++;
    else break;
  }
  return n;
}

/** Realized P&L in [from, to): partial trims at their own time and the rest of each trade at its close. */
function bookedPnl(all: readonly HistoryTrade[], trims: readonly PartialEvent[], from: number, to: number): number {
  const trimOf = new Map<string, number>();
  let sum = 0;
  for (const e of trims) {
    const at = ms(e.at);
    if (!fin(e.realized_pnl)) continue;
    trimOf.set(e.trade_id, (trimOf.get(e.trade_id) ?? 0) + e.realized_pnl);
    if (at != null && at >= from && at < to) sum += e.realized_pnl;
  }
  for (const x of all) {
    const c = ms(x.closed_at);
    if (x.status === "closed" && fin(x.pnl) && c != null && c >= from && c < to) sum += x.pnl - (trimOf.get(x.id) ?? 0);
  }
  return r2(sum);
}

/** The stop when he entered: initial_stop_loss, else the first stop move's old value, else the stop on file. */
function stopAtEntry(t: ReviewTrade, ownEvents: readonly ReviewEvent[]): number {
  if (t.initial_stop_loss != null) return pos(t.initial_stop_loss);
  const first = ownEvents.find((e) => e.kind === "stop_moved");
  return first ? pos(first.old_value) : pos(t.stop_loss);
}

function parseAnswers(v: unknown): Partial<Answers> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: Partial<Answers> = {};
  for (const k of ANSWER_KEYS) {
    const a = o[k];
    if (typeof a === "boolean") out[k] = a;
  }
  return Object.keys(out).length ? out : null;
}

type StoredReason = { code: string; decision: string; text: string };
function parseReasons(v: unknown): StoredReason[] {
  if (!Array.isArray(v)) return [];
  const out: StoredReason[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const code = o["code"];
    if (typeof code === "string" && !out.some((r) => r.code === code))
      out.push({ code, decision: String(o["decision"] ?? ""), text: String(o["text"] ?? "").trim() });
  }
  return out;
}

/** NO_GO reasons another finding already judges: entering on them is that finding, not a second one. */
const JUDGED_BY: Partial<Record<string, FindingRule[]>> = {
  not_in_plan: ["setup_confirmation"],
  stop_not_predefined: ["stop_predefined"],
  no_stop: ["stop_predefined"],
  size_over_plan: ["size_within_plan", "position_size"],
  risk_over_plan: ["size_within_plan", "position_size"],
};
/** REVIEW_REQUIRED reasons that are a step he skipped (missing data is already its own finding). */
const REVIEW_LAPSES = new Set(["no_plan", "protect_profit", "outside_session", "unreviewed", "ai_mismatch", "breaker"]);

// ---- His own words -------------------------------------------------------------------------

/** The app's own yes/no revenge line is read as a fact, never as his words. */
const MARKER_LINE = /^\s*\[هل هو تعويض\]:.*$/gm;
/** Folded for matching: no tashkeel or tatweel, one alef, ه for ة, ي for ى, lower-case Latin. */
const fold = (s: string) =>
  s.replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();

// Matched on folded text, so أعوّض, اعوض and أعوض are one word.
const PATTERNS = {
  revenge: /انتقام|اعوض|نعوض|تعويض|ارجع (?:اللي|الي) خسرت|استرجع|revenge|make it back|win it back/,
  fomo: /fomo|فومو|خوف من الفوات|يفوتني|تفوتني|ما بغيت (?:يفوت|تفوت)|(?:الحق|لحقت) (?:السعر|الحركه)|طار السعر|chas(?:e|ing)|miss the move|didn'?t want to miss/,
  premature: /خفت (?:من|ان|لا|يرجع|ترجع|يضرب|تضرب)|(?:طلعت|سكرت(?:ها)?|قفلت(?:ها)?) بدري|ما قدرت اصبر|ما صبرت|got scared|took it off early|couldn'?t hold/,
  overconfidence: /مضمونه|ما (?:راح |رح )?(?:ت|بت)خسر|اكيد بتطلع|فلوس سهله|واثق (?:جدا|مره)|زودت (?:اللوت|الحجم) بعد (?:الربح|ربح)|easy money|can'?t lose|sure thing/,
  hesitation: /ترددت|تردد|تاخرت (?:ب|في|عن|على) ?الدخول|فاتني الدخول|hesitat|froze|missed my entry/,
} as const;
type JournalKind = keyof typeof PATTERNS;
// «مو تعويض», «مش fomo»: a negation one or two words before the match.
const NEGATED = /(?:^|[\s،,.])(?:مو|مش|مب|ما|لا|not|never|no|didn'?t|wasn'?t|isn'?t)\s+(?:\S+\s+)?$/;

type Line = { raw: string; f: string };
const clip = (s: string) => { const one = s.replace(/\s+/g, " ").trim(); return one.length > 80 ? `${one.slice(0, 79)}…` : one; };

/** The first line of his notes that says it, quoted as he wrote it. */
function said(lines: readonly Line[], kind: JournalKind): string | null {
  const re = new RegExp(PATTERNS[kind].source, "g");
  for (const l of lines)
    for (const m of l.f.matchAll(re))
      if (!NEGATED.test(l.f.slice(Math.max(0, m.index - 24), m.index))) return `من ملاحظاتك: «${clip(l.raw)}»`;
  return null;
}

/** His notes without the app's revenge line: what is left is his own reason for the entry. */
const entryNotes = (notes: string | null | undefined) => (notes ?? "").replace(MARKER_LINE, "").trim();
const FOMO_EMOTION = /خوف من الفوات|fomo/i;
const FEAR_EMOTION = /خائف|متوتر|خوف(?! من الفوات)/;

// ---- The review ----------------------------------------------------------------------------

function breakActiveAt(b: ReviewBreak, at: number): b is ReviewBreak & { rule: BreakerRule } {
  if (!(BREAKER_RULES as readonly string[]).includes(b.rule) || (b.state !== "HALTED" && b.state !== "COOLDOWN")) return false;
  const from = ms(b.triggered_at), until = ms(b.active_until), released = ms(b.released_at);
  return from != null && from <= at && (until == null || until > at) && (released == null || released > at);
}

const score = (fs: readonly Finding[]) =>
  Math.max(0, Math.min(100, fs.reduce((s, f) => s - (f.severity === "critical" ? 30 : f.severity === "warning" ? 15 : 0), 100)));
const isRootCause = (v: unknown): v is RootCause => typeof v === "string" && (ROOT_CAUSES as readonly string[]).includes(v);

export function reviewTrade(trade: ReviewTrade, ctx: ReviewCtx): TradeReview {
  const now = ctx.now ?? new Date();
  const cur = ctx.currency ?? "USD";
  const m = (n: number) => money(n, cur);
  const s = ctx.settings;
  const tz = s?.timezone;
  const opened = ms(trade.opened_at) ?? now.getTime();
  const allTrades = ctx.allTrades ?? [];
  const others = allTrades.filter((x) => x.id !== trade.id);
  const events = (ctx.events ?? []).filter((e) => { const at = ms(e.at); return at != null && at <= now.getTime(); });
  const own = events.filter((e) => e.trade_id === trade.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const trims: PartialEvent[] = events
    .filter((e) => e.trade_id !== trade.id && e.kind === "partial_close")
    .map((e) => ({ trade_id: e.trade_id, kind: e.kind, realized_pnl: e.realized_pnl ?? null, at: e.at }));
  const check = ctx.check ?? null;
  const answers = parseAnswers(check?.answers);
  const reasons = parseReasons(check?.reasons);
  const actionable = !!check && check.intent !== "historical" && check.intent !== "watch";
  const legacy = trade.source === "backfill" || trade.risk_source === "legacy_recomputed";

  const outcome: Outcome = trade.status !== "closed" ? "open" : !fin(trade.pnl) ? "unknown" : trade.pnl > CENT ? "win" : trade.pnl < -CENT ? "loss" : "breakeven";

  // The numbers: risk at the entry stop, never looser than what the gate measured.
  const entryStop = stopAtEntry(trade, own);
  const atEntry: ReviewTrade = { ...trade, initial_stop_loss: entryStop || null };
  const known = [riskAtEntry(atEntry), pos(check?.actual_risk) || null].filter((x): x is number => x != null);
  const actual = known.length ? r2(Math.max(...known)) : null;
  const planned = pos(check?.planned_risk) || plannedRisk(s, ctx.plan);
  const sizeRatio = actual != null && planned ? r2(actual / planned) : null;
  const overPlan = actual != null && planned != null && actual > planned + CENT;

  const windowMin = REVENGE_WINDOW_MIN(s);
  const loss = lastLoss(others, trims, new Date(opened));
  const inWindow = !!loss && inRevengeWindow(opened - Date.parse(loss.at), windowMin);
  const losses = lossesBefore(trade, allTrades);
  const prev = closesBefore(trade, allTrades)[0] ?? null;
  const dayLoss = Math.max(0, -bookedPnl(others, trims, dayStart(opened, tz).getTime(), opened));
  const weekLoss = r2(Math.max(0, -bookedPnl(others, trims, weekStart(opened, tz).getTime(), opened)));

  // ---- Risk
  const risk: Finding[] = [];
  const R = (rule: FindingRule, status: FindingStatus, severity: Severity, evidence: string) => risk.push({ area: "risk", rule, status, severity, evidence });
  if (actual != null && planned != null) {
    if (actual > planned * 1.25 + CENT) R("position_size", "missed", "critical", `مخاطرتك ${m(actual)} أكبر بكثير من المخططة ${m(planned)} (${sizeRatio}×).`);
    else if (overPlan) R("position_size", "missed", "warning", `مخاطرتك ${m(actual)} فوق المخططة ${m(planned)} (${sizeRatio}×).`);
    else R("position_size", "met", "info", `مخاطرتك ${m(actual)} ضمن خطتك (${m(planned)}).`);
  } else {
    R("position_size", "unclear", "warning", actual == null
      ? `ما أعرف كم خاطرت بهالصفقة${legacy ? " (صفقة قديمة بدون مخاطرة مسجّلة)" : ""}، فما أقدر أحكم على الحجم.`
      : "ما في مخاطرة مخططة (حد الصفقة أو خطة اليوم)، فما أقدر أحكم على الحجم.");
  }
  const dailyLimit = [pos(s?.max_daily_loss), pos(ctx.plan?.max_loss)].filter((x) => x > 0).reduce((a, b) => Math.min(a, b), Infinity);
  const room = Number.isFinite(dailyLimit) ? r2(Math.max(0, dailyLimit - dayLoss)) : null;
  const heat = room != null ? heatAtEntry(atEntry, allTrades, actual) : null;
  if (room != null && heat != null) {
    if (heat > room + CENT) R("portfolio_heat", "missed", "critical", `لو ضربت كل الوقوف وقت الدخول كان بتخسر ${m(heat)}، أكثر من الباقي لك اليوم ${m(room)}.`);
    else if (heat > room * 0.9 + CENT) R("portfolio_heat", "missed", "warning", `المخاطرة المفتوحة وقت الدخول ${m(heat)} قريبة من الباقي لك اليوم ${m(room)}.`);
  }
  if (losses >= 3) R("losing_streak", "missed", losses >= 4 ? "critical" : "warning", `دخلت بعد ${lossesWord(losses)} ورا بعض.`);
  const weekly = pos(s?.weekly_max_loss);
  if (weekly && weekLoss >= weekly * 0.9 - CENT)
    R("weekly_limit", "missed", "warning", `دخلت وخسارة الأسبوع ${m(weekLoss)} ${weekLoss >= weekly - CENT ? "واصلة" : "قريبة من"} حدّك ${m(weekly)}.`);
  const afterWin = prev && prev.pnl > CENT && dayKey(prev.at, tz) === dayKey(opened, tz) ? prev : null;
  if (overPlan && afterWin) R("overconfidence_after_winner", "missed", "warning", `بعد ربح ${m(afterWin.pnl)} دخلت بمخاطرة ${sizeRatio}× من خطتك.`);

  // ---- Process
  const process: Finding[] = [];
  const P = (rule: FindingRule, status: FindingStatus, severity: Severity, evidence: string) => process.push({ area: "process", rule, status, severity, evidence });
  const judged = (rule: FindingRule) => [...process, ...risk].some((f) => f.rule === rule && f.status === "missed");

  if (answers?.in_written_plan === false) P("setup_confirmation", "missed", "critical", "قلت إن الصفقة مو من خطتك المكتوبة.");
  else if (answers?.in_written_plan === true) P("setup_confirmation", "met", "info", "الصفقة من خطتك المكتوبة.");

  if (answers?.stop_predefined === false) P("stop_predefined", "missed", "critical", "قلت إن الوقف ما كان محدد قبل الدخول.");
  else if (!entryStop) P("stop_predefined", legacy ? "unclear" : "missed", legacy ? "warning" : "critical", legacy ? "ما في وقف مسجّل لهالصفقة القديمة." : "دخلت بدون وقف خسارة.");
  else if (answers?.stop_predefined === true) P("stop_predefined", "met", "info", "الوقف كان محدد قبل الدخول.");

  if (!judged("position_size")) {
    if (answers?.size_within_plan === false) P("size_within_plan", "missed", "critical", "قلت إن الحجم أكبر من خطتك.");
    else if (answers?.size_within_plan === true) P("size_within_plan", "met", "info", "قلت إن الحجم ضمن خطتك.");
  }

  // No answers is not a «لا»: he may simply not have been asked (an AI-logged or old trade).
  if (!answers)
    P("gate_answers", "unclear", "warning", check ? "ما جاوبت الأسئلة الأربعة قبل الدخول، فما أقدر أحكم على الالتزام." : "ما في فحص قبل الدخول لهالصفقة، فما أقدر أحكم على الأسئلة الأربعة.");

  if (actionable)
    for (const r of reasons)
      if (r.decision === "REVIEW_REQUIRED" && REVIEW_LAPSES.has(r.code)) P("gate_review", "missed", "warning", `دخلت رغم «راجع قبل الدخول»: ${r.text}`);

  const linked = (ctx.violations ?? []).filter((v) => v.trade_id === trade.id || (!!check?.id && v.pre_trade_check_id === check.id));
  // Gate and breaker rows are the NO_GO he entered on, judged below from the check itself.
  const logged = linked.filter((v) => v.source !== "gate" && v.source !== "breaker");
  if (logged.length) {
    const notes = logged.map((v) => v.note?.trim()).filter((x): x is string => !!x).join("، ");
    P("logged_violation", "missed", "critical", `${logged.length === 1 ? "في مخالفة مسجّلة" : `في ${logged.length} مخالفات مسجّلة`} على الصفقة${notes ? `: ${notes}` : "."}`);
  }

  const notes = entryNotes(trade.notes);
  const analysed = !!ctx.analysisCard && (ms(ctx.analysisCard.created_at) ?? Infinity) <= opened;
  const planFirst = (ms(ctx.plan?.set_at) ?? Infinity) <= opened;
  if (notes || analysed || planFirst)
    P("pre_entry_thesis_record", "met", "info", notes ? "سبب الدخول مكتوب." : analysed ? "في تحليل قبل الدخول." : "خطة اليوم مكتوبة قبل الدخول.");
  else P("pre_entry_thesis_record", "missed", "warning", "ما في سبب دخول مكتوب ولا تحليل ولا خطة يوم قبل الدخول.");

  // The day said stop: an active latched break at entry, or a NO_GO for a reason nothing else judged.
  const regime = new Set<string>();
  for (const b of ctx.latchedBreaks ?? [])
    if (breakActiveAt(b, opened)) regime.add(`دخلت والتداول ${b.state === "HALTED" ? "موقوف" : "بتهدئة"} (${RULE_LABEL[b.rule]}).`);
  const latchedAtEntry = regime.size > 0;
  if (actionable && check.decision === "NO_GO") {
    const nogo = reasons.filter((r) => r.decision === "NO_GO");
    // The gate's breaker reason is the latched break itself, already said above.
    const left = nogo.filter((r) => !(r.code === "breaker" && latchedAtEntry) && !(JUDGED_BY[r.code] ?? []).some(judged));
    if (!nogo.length) regime.add("دخلت رغم «لا تدخل».");
    else if (left.length) regime.add(`دخلت رغم «لا تدخل»: ${left.map((r) => r.text).join(" ")}`);
  }
  if (!regime.size && !check && linked.some((v) => v.source === "gate" || v.source === "breaker")) regime.add("في مخالفة مسجّلة: دخلت رغم «لا تدخل».");
  if (regime.size) {
    process.unshift({ area: "process", rule: "market_regime_gate", status: "missed", severity: "critical", evidence: [...regime].join(" ") });
    // With the day's loss limit already used up, any heat is over it: that is the same stop, not a second finding.
    const heatAt = risk.findIndex((f) => f.rule === "portfolio_heat");
    if (heatAt >= 0 && room != null && room <= CENT) risk.splice(heatAt, 1);
  }

  // ---- Execution
  const execution: Finding[] = [];
  const X = (rule: FindingRule, status: FindingStatus, severity: Severity, evidence: string) => execution.push({ area: "execution", rule, status, severity, evidence });
  const moves = own.filter((e) => e.kind === "stop_moved");
  const curStop = pos(trade.stop_loss);
  // A stop that differs from the entry stop with no event behind it moved without a plan on record.
  const silent = !moves.length && entryStop > 0 && curStop > 0 && Math.abs(curStop - entryStop) > entryStop * 1e-9;
  const loose: [number, number][] = [
    ...moves.filter((e) => e.planned !== true).map((e): [number, number] => [pos(e.old_value), pos(e.new_value)]),
    ...(silent ? [[entryStop, curStop] as [number, number]] : []),
  ];
  const entry = pos(trade.entry_price);
  const side = sideOf(trade.direction);
  // Wider = more money at risk: removed, or moved away from the entry side of the trade.
  const wider = ([from, to]: [number, number]) =>
    !to ? true : !from ? false : side ? side * (to - from) < 0 : Math.abs(to - entry) > Math.abs(from - entry);
  const lvl = (n: number) => (n ? String(n) : "بدون وقف");
  if (loose.length) {
    const path = `من ${lvl(loose[0]![0])} إلى ${lvl(loose[loose.length - 1]![1])}`;
    if (loose.some(wider)) X("stop", "missed", "critical", `وسّعت الوقف بدون خطة (${path}).`);
    else X("stop", "missed", "warning", `حرّكت الوقف بدون خطة (${path})، بس قرّبته وقلّلت المخاطرة.`);
  } else if (moves.length) X("stop", "met", "info", "حرّكت الوقف حسب خطتك.");

  const lines: Line[] = [entryNotes(trade.notes), trade.close_notes, check?.override_reason, ctx.postmortem?.note]
    .flatMap((t) => (t ?? "").split(/\n+/))
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, f: fold(raw) }));

  const rr = plannedRR(atEntry);
  const er = exitR(atEntry);
  const fearful = trade.exit_reason === "fear" || FEAR_EMOTION.test(trade.exit_emotion ?? "") || !!said(lines, "premature");
  // Closed by its own rules (stop, target, trailing) or at the stop itself is not early.
  const ruled = trade.exit_reason === "stop" || trade.exit_reason === "target" || trade.exit_reason === "trailing";
  if (outcome !== "open" && fearful && !ruled && rr != null && er != null && er > -0.95 && Math.abs(er) < 0.8 * rr)
    X("exit", "missed", "warning", `طلعت بخوف عند ${er}R والهدف كان ${rr}R.`);

  const adds = own.filter((e) => e.kind === "size_added");
  if (adds.length) {
    if (outcome === "loss") X("size_added", "missed", "critical", "زوّدت على صفقة طلعت خسرانة.");
    else if (adds.some((e) => e.planned !== true)) X("size_added", "missed", "warning", "زوّدت الحجم بدون خطة.");
    else X("size_added", "met", "info", "زوّدت حسب خطتك.");
  }

  // ---- Possible patterns, strongest evidence first
  const tags: Tag[] = [];
  const tag = (code: TagCode, confidence: Tag["confidence"], evidence: string | null) => {
    if (evidence && !tags.some((x) => x.tag === code)) tags.push({ tag: code, confidence, evidence, question: TAG_META[code].question });
  };
  const found = (list: Finding[], rule: FindingRule) => list.find((f) => f.rule === rule && f.status === "missed")?.evidence ?? null;

  if (answers?.in_written_plan === false) tag("fomo_entry", "high", "قلت إن الصفقة مو من خطتك المكتوبة.");
  if (FOMO_EMOTION.test(trade.emotion ?? "")) tag("fomo_entry", "high", `حالتك وقت الدخول «${trade.emotion}».`);
  tag("fomo_entry", "medium", said(lines, "fomo"));

  if (trade.notes?.includes(REVENGE_MARKER) || answers?.not_revenge === false) tag("revenge_trade", "high", "قلت إنها صفقة تعويض.");
  if (/انتقام/.test(trade.emotion ?? "")) tag("revenge_trade", "high", `حالتك وقت الدخول «${trade.emotion}».`);
  if (inWindow && loss) tag("revenge_trade", "medium", `دخلت بعد ${minutesWord(loss.minutesAgo)} من خسارة ${m(-loss.pnl)}، داخل نافذة الانتقام (${windowMin} دقيقة).`);
  tag("revenge_trade", "medium", said(lines, "revenge"));

  if (execution.some((f) => f.rule === "size_added" && f.severity === "critical")) tag("added_to_loser", "high", "زوّدت على صفقة طلعت خسرانة.");
  tag("premature_exit", "high", found(execution, "exit"));
  tag("premature_exit", "medium", said(lines, "premature"));
  tag("overconfidence_after_winner", "high", found(risk, "overconfidence_after_winner"));
  tag("overconfidence_after_winner", "medium", said(lines, "overconfidence"));
  tag("stop_moved", "high", found(execution, "stop"));
  if (overPlan) tag("size_creep", "high", `مخاطرتك ${m(actual!)} فوق المخططة ${m(planned!)}.`);
  tag("unknown_size", "medium", risk.find((f) => f.rule === "position_size" && f.status === "unclear")?.evidence ?? null);
  tag("hesitation", "medium", said(lines, "hesitation"));
  const lapses = process.filter((f) => f.status === "missed").length;
  if (lapses >= 3) tag("rule_drift", "medium", `${lapses} أخطاء بالعملية في نفس الصفقة.`);
  if (!tags.length) tag("no_pattern_detected", "low", "ما بان نمط من المعطيات المتوفرة.");
  tags.sort((a, b) => TAGS.indexOf(a.tag) - TAGS.indexOf(b.tag));
  const has = (c: TagCode) => tags.some((x) => x.tag === c);

  // ---- Verdict: only up
  const findings = [...process, ...risk, ...execution];
  const criticals = findings.filter((f) => f.severity === "critical").length;
  const verdict: Verdict =
    criticals >= 2 || (has("revenge_trade") && losses >= 2) ? "cooldown"
    : criticals ? "violation"
    : findings.some((f) => f.severity === "warning" && f.status !== "unclear") ? "review"
    : findings.some((f) => f.severity === "warning") ? "warn"
    : "ok";
  const clean = verdict === "ok" || verdict === "warn";

  // ---- Root cause: his own word first, then the findings in a fixed order
  const missed = (list: Finding[], rules?: FindingRule[]) => list.some((f) => f.status === "missed" && (!rules || rules.includes(f.rule)));
  const causes: SecondaryCause[] = [];
  if (process.some((f) => f.severity === "critical" && f.status === "missed" && f.rule !== "market_regime_gate")) causes.push("rule_violation");
  if (missed(risk, ["position_size", "portfolio_heat", "overconfidence_after_winner"])) causes.push("risk_sizing");
  if (missed(execution)) causes.push("execution");
  if (process.some((f) => f.rule === "market_regime_gate")) causes.push("market_environment");
  const theirs = ctx.postmortem?.rootCause;
  const rootCause: RootCause = isRootCause(theirs) ? theirs : (causes[0] as RootCause | undefined) ?? (outcome === "loss" && clean ? "randomness" : "unknown");
  const secondary: SecondaryCause[] = causes.filter((c) => c !== rootCause);
  if (has("fomo_entry") || has("revenge_trade") || has("stop_moved") || has("added_to_loser")) secondary.push("behavior_pattern");

  // ---- Next rules: one card per pattern, strictest first
  const nextRules: NextRule[] = [];
  const rule = (trigger: NextRule["trigger"], duration: RuleDuration, text: string, reason: string) => {
    if (!nextRules.some((r) => r.text === text)) nextRules.push({ text, duration, trigger, reason });
  };
  if (verdict === "cooldown" || has("revenge_trade"))
    rule(has("revenge_trade") ? "revenge_trade" : "cooldown", "next_session", "الجلسة الجاية مراجعة بس: لا مخاطرة جديدة لين تكتب مراجعة القاعدة.", "الخسارات ورا بعض وصفقات التعويض ترفع المخاطرة.");
  if (has("size_creep")) rule("size_creep", "next_two_trades", "خاطر بنص حدك (0.5R) لصفقتين، إلا لو عدّلت خطتك بنفسك.", "مخاطرتك الفعلية كانت أكبر من خطتك.");
  if (has("added_to_loser")) rule("added_to_loser", "next_week", "لا تزوّد على صفقة ضدك. الوقف هو الخطة.", "التزويد على خسرانة يكبّر الخسارة.");
  if (has("stop_moved")) rule("stop_moved", "next_month", "أي تحريك للوقف يتكتب قبل الدخول، وأي تحريك بدون خطة يبي مراجعة على طول.", "احترام الوقف يحمي حد خسارتك ويخلي النتيجة قابلة للمراجعة.");
  if (has("fomo_entry")) rule("fomo_entry", "next_week", "لا دخول بدون سبب مكتوب ونقطة إلغاء وتأكيد الإعداد قبل الدخول.", "في علامات دخول قبل التأكيد أو خوف من الفوات.");
  if (has("premature_exit")) rule("premature_exit", "next_two_trades", "الصفقتين الجاية لا تسكّر يدوي قبل الوقف أو الهدف إلا بسبب مكتوب في خطتك.", "طلعت بخوف قبل ما توصل الصفقة لخطتها.");
  if (has("overconfidence_after_winner")) rule("overconfidence_after_winner", "next_trade", "بعد أي ربح، الصفقة اللي بعده بنفس حجم خطتك أو أقل.", "الربح اللي قبلها كبّر حجمك.");
  // Unverifiable is not "exceeded": ask for the numbers, never cap a size nobody measured.
  if (has("unknown_size")) rule("unknown_size", "next_trade", "بالصفقة الجاية سجّل المخاطرة المخططة والفعلية عشان نتأكد من الحجم.", "ما قدرنا نحكم على الحجم لأن المخاطرة ناقصة.");
  if (!nextRules.length) rule("none", "next_session", "كمّل على نفس قواعدك وسجّل كل صفقة.", "ما بان كسر قاعدة من المعطيات المتوفرة.");

  // ---- Quality: how much of the record is there
  const present: Record<QualityField, boolean> = {
    risk: actual != null,
    planned_risk: planned != null,
    entry_stop: entryStop > 0,
    answers: !!answers,
    entry_notes: !!notes || analysed,
    exit_reason: !!trade.exit_reason,
    close_notes: !!trade.close_notes?.trim() || !!ctx.postmortem?.note?.trim(),
  };
  const missingFields = QUALITY_FIELDS.filter((k) => !present[k]);
  const quality = Math.floor(40 + (60 * (QUALITY_FIELDS.length - missingFields.length)) / QUALITY_FIELDS.length + 1e-9);

  const quadrant: Quadrant | null =
    outcome === "loss" ? (clean ? "clean_loss" : "dirty_loss")
    : outcome === "win" || outcome === "breakeven" ? (clean ? "clean_win" : "lucky_win")
    : null;

  return {
    reviewType: trade.status !== "closed" && own.some((e) => e.kind === "partial_close") ? "partial_close" : "single_trade",
    verdict,
    outcome,
    rootCause,
    secondary,
    confidence: quality < 60 ? "low" : quality >= 85 ? "high" : "medium",
    scores: { process: score(process), risk: score(risk), execution: score(execution), quality },
    process,
    risk,
    execution,
    tags,
    quadrant,
    quadrantLabel: quadrant ? QUADRANT_LABEL[quadrant] : null,
    nextRules,
    questions: tags.slice(0, 4).map((x) => x.question),
    missingFields,
    facts: {
      plannedRisk: planned,
      actualRisk: actual,
      sizeRatio,
      realizedR: realizedR(atEntry, actual),
      exitR: er,
      plannedRR: rr,
      heat,
      room,
      lossesBefore: losses,
      weekLoss,
      minutesSinceLoss: loss?.minutesAgo ?? null,
    },
  };
}

type ReviewInsert = Database["public"]["Tables"]["trade_reviews"]["Insert"];

/** The trade_reviews row for a review (user_id is the writer's; decision stays journal_only). */
export function reviewRow(tradeId: string, r: TradeReview): Omit<ReviewInsert, "user_id"> {
  return {
    trade_id: tradeId,
    review_type: r.reviewType,
    verdict: r.verdict,
    outcome: r.outcome,
    root_cause: r.rootCause,
    quadrant: r.quadrant,
    process_score: r.scores.process,
    risk_score: r.scores.risk,
    execution_score: r.scores.execution,
    quality_score: r.scores.quality,
    tags: r.tags,
    findings: [...r.process, ...r.risk, ...r.execution],
    next_rules: r.nextRules,
    questions: r.questions,
    facts: r.facts,
  };
}

// ---- Accepted rules (daily_plans.rules_today) ------------------------------------------------

/** A rules_today item: an accepted next rule, or a plain line written for that day. */
export type TempRuleEntry = { text: string; duration?: RuleDuration | null; accepted_at?: string | null; until?: string | null; trades?: number | null };

/** The rules_today item for a rule he accepted at `at`; it applies from that moment. */
export function acceptRule(rule: NextRule, at: Date): TempRuleEntry {
  return { text: rule.text, duration: rule.duration, accepted_at: at.toISOString(), trades: DURATION_TRADES[rule.duration] ?? null };
}

function parseEntry(v: unknown): TempRuleEntry | null {
  if (typeof v === "string") return v.trim() ? { text: v.trim() } : null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = typeof o["text"] === "string" ? o["text"].trim() : "";
  if (!text) return null;
  const d = o["duration"];
  const n = Number(o["trades"]);
  return {
    text,
    duration: (RULE_DURATIONS as readonly unknown[]).includes(d) ? (d as RuleDuration) : null,
    accepted_at: typeof o["accepted_at"] === "string" ? o["accepted_at"] : null,
    until: typeof o["until"] === "string" ? o["until"] : null,
    trades: Number.isInteger(n) && n > 0 ? n : null,
  };
}

export type ActiveTempRule = TempRule & { left: number | null; until: string | null };

/**
 * The accepted rules still in force at `now`, for the gate's «قاعدة مؤقتة» warnings. A
 * trade-count rule ends after that many entries since it was accepted; next_session ends with
 * the next trading day, next_week / next_month after 7 / 30 days; a plain line lives for its
 * plan's day. The same rule accepted twice counts from its latest acceptance.
 */
export function activeTempRules(
  plans: readonly { day: string; rules_today: unknown }[],
  trades: readonly { opened_at: string }[],
  now: Date,
  tz?: string | null,
): ActiveTempRule[] {
  const t = now.getTime();
  const out = new Map<string, ActiveTempRule & { from: number }>();
  for (const p of plans) {
    if (!Array.isArray(p.rules_today)) continue;
    const dayFrom = zonedMidnight(p.day, tz).getTime();
    for (const raw of p.rules_today) {
      const e = parseEntry(raw);
      if (!e) continue;
      const from = ms(e.accepted_at) ?? dayFrom;
      if (!Number.isFinite(from) || from > t) continue;
      const n = e.trades ?? (e.duration ? DURATION_TRADES[e.duration] : undefined) ?? null;
      let until = ms(e.until);
      if (until == null) {
        if (e.duration === "next_session") until = nextTradingDayStart(nextTradingDayStart(from, tz), tz).getTime();
        else if (e.duration === "next_week") until = zonedMidnight(addDays(dayKey(from, tz), 8), tz).getTime();
        else if (e.duration === "next_month") until = zonedMidnight(addDays(dayKey(from, tz), 31), tz).getTime();
        else if (!n) until = zonedMidnight(addDays(p.day, 1), tz).getTime();
      }
      if (until != null && !(until > t)) continue;
      let left: number | null = null;
      if (n) {
        left = n - trades.filter((x) => { const o = ms(x.opened_at); return o != null && o >= from && o <= t; }).length;
        if (left <= 0) continue;
      }
      const key = fold(e.text).replace(/\s+/g, " ");
      const prev = out.get(key);
      if (!prev || from >= prev.from) out.set(key, { text: e.text, left, until: until != null ? new Date(until).toISOString() : null, from });
    }
  }
  return [...out.values()].map(({ from: _from, ...r }) => r);
}
