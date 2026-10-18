/**
 * Pattern memory: one week (Monday, in the trader's zone) or one month of reviewed trades,
 * turned into what keeps repeating, after the trade-performance-coach skill's period review.
 * Code counts; سَنَد only narrates (patternsForPrompt). Pure — the caller loads the rows.
 *
 * A trade belongs to the period it closed in, with its whole P&L (its review judges the whole
 * trade); checks and violations belong to the moment they were written. A tag counts once per
 * trade, and one mistake counts once: a violation row, the NO_GO he entered on and the trade's
 * own violation verdict are one event.
 */
import { money } from "./circuit-breaker";
import {
  DURATION_LABEL, QUADRANT_LABEL, TAG_META, TAGS, VERDICT_META, VERDICT_RANK, stricterVerdict,
  type NextRule, type Quadrant, type RuleDuration, type TagCode, type Verdict,
} from "./trade-review";
import { addDays, isoWeekKey, monthKey, zonedMidnight } from "./trading-day";
import type { Database } from "@/integrations/supabase/types";

export type PeriodKind = "week" | "month";
/** key: "2026-W42" (ISO week, Monday start) or "2026-10". */
export type Period = { kind: PeriodKind; key: string };

/** A trade_reviews row: one per trade, plus the weekly and monthly ones (trade_id null). */
export type PatternReview = {
  trade_id: string | null;
  review_type: string;
  period_key?: string | null;
  verdict: string;
  tags?: unknown;
  process_score?: number | null;
  risk_score?: number | null;
  execution_score?: number | null;
  quality_score?: number | null;
  next_rules?: unknown;
  decision?: string | null;
  created_at: string;
};
export type PatternTrade = {
  id: string;
  status: string;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  symbol?: string | null;
  direction?: string | null;
  pre_trade_check_id?: string | null;
};
export type PatternViolation = {
  id?: string;
  rule_id?: string | null;
  source: string;
  occurred_at: string;
  trade_id?: string | null;
  pre_trade_check_id?: string | null;
};
/** A trading_rules row, for the violation labels. */
export type PatternRule = { id: string; title: string };
export type PatternCheck = {
  id?: string;
  created_at: string;
  intent: string;
  decision: string;
  proceeded?: boolean | null;
  planned_risk?: number | null;
  actual_risk?: number | null;
  symbol?: string | null;
  direction?: string | null;
  trade_id?: string | null;
};
/** A chart_analyses row; card is the analyst's ```trade block. */
export type PatternAnalysis = { created_at: string; trade_id?: string | null; card?: unknown };

export type PeriodInput = {
  period: Period;
  tz?: string | null;
  reviews: readonly PatternReview[];
  trades: readonly PatternTrade[];
  violations?: readonly PatternViolation[];
  rules?: readonly PatternRule[];
  checks?: readonly PatternCheck[];
  analyses?: readonly PatternAnalysis[];
  now?: Date;
};

export type Trend = "up" | "down" | "flat";
export type TagCount = {
  tag: TagCode;
  label: string;
  count: number;
  tradeIds: string[];
  /** Per earlier period that had reviewed trades; null when there is none yet. */
  prevAvg: number | null;
  trend: Trend | null;
};

export const VIOLATION_SOURCES = ["manual", "gate", "breaker", "plan", "ai"] as const;
export type ViolationSource = (typeof VIOLATION_SOURCES)[number];
export type RuleViolations = { key: string; ruleId: string | null; label: string; count: number; bySource: Partial<Record<ViolationSource, number>> };

export type Confidence = "high" | "medium" | "low" | "unknown";
export type HitRate = { n: number; hits: number; rate: number | null };
export type AnalystHitRate = HitRate & { byConfidence: Record<Confidence, HitRate>; small: boolean };

export type RuleAdherence = { text: string; trigger: string; kept: boolean | null; evidence: string };
export type LastRuleAdherence = { period: string; kept: boolean | null; rules: RuleAdherence[] };

export type PeriodReview = {
  kind: PeriodKind;
  key: string;
  label: string;
  from: string;
  to: string;
  /** now is still inside the period: the numbers are "so far". */
  inProgress: boolean;
  verdict: Verdict;
  /** Why the verdict, strictest first. */
  reasons: string[];
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  reviewed: number;
  unreviewed: number;
  /** Most frequent first; a tag that dropped to 0 stays listed with its downward trend. */
  tagCounts: TagCount[];
  /** Earlier periods with reviewed trades the trend is measured against (up to TREND_LOOKBACK). */
  baselinePeriods: number;
  /** Seen on ≥2 trades. */
  recurring: TagCode[];
  /** One behaviour seen on ≥3 trades. */
  ruleDrift: TagCode[];
  quadrants: Record<Quadrant, number>;
  cleanLosses: number;
  luckyWins: number;
  /** Clean process (ok/warn) vs rule-breaking (review and up) vs not reviewed. */
  processPnl: { clean: number; dirty: number; unreviewed: number; cleanTrades: number; dirtyTrades: number; unreviewedTrades: number };
  avgScores: { process: number | null; risk: number | null; execution: number | null; quality: number | null };
  maxLosingStreak: number;
  /** Distinct mistakes (one per trade or check), for the verdict. */
  violationCount: number;
  /** The rule_violations rows, by rule (or by source when no rule is linked). */
  violationsByRule: RuleViolations[];
  violationsBySource: Partial<Record<ViolationSource, number>>;
  /** NO_GO decisions he walked away from (proceeded=false) and the risk he didn't take. */
  gateSaved: { count: number; risk: number };
  enteredOnNoGo: { count: number; pnl: number; tradeIds: string[] };
  /** The analyst's «راقبها» cards (intent='watch'), and how many he later took anyway. */
  watchedNotTaken: { count: number; taken: number; symbols: string[] };
  analystHitRate: AnalystHitRate;
  lastRuleAdherence: LastRuleAdherence | null;
  /** 1-2 time-boxed rules for the next period; nothing changes until he accepts one. */
  nextRules: NextRule[];
};

/** Earlier periods the trend looks back over, and how many make it more than a hint. */
export const TREND_LOOKBACK = 8;
export const TREND_MIN_PERIODS = 4;
export const RECURRING_MIN = 2;
export const DRIFT_MIN = 3;
/** Two mistakes this close together make the period a cooldown. */
export const COOLDOWN_WINDOW_DAYS = 7;
/** A sample below this is «عيّنة صغيرة». */
export const SMALL_SAMPLE = 10;

const DAY_MS = 86_400_000;
/** Money is rounded to cents, so float noise is neither a win nor a loss. */
const CENT = 0.005;
/** Missing data and «nothing found» are not behaviour: they never make rule drift. */
const DATA_TAGS = new Set<TagCode>(["no_pattern_detected", "unknown_size"]);

const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
function ms(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Date.parse(s);
  return Number.isFinite(v) ? v : null;
}
const pad = (n: number) => String(n).padStart(2, "0");
const sideOf = (d: string | null | undefined) => {
  const x = (d ?? "").toLowerCase();
  return x === "long" || x === "buy" ? 1 : x === "short" || x === "sell" ? -1 : 0;
};

/** Arabic counting: 1 صفقة، 2 صفقتين، 3-10 صفقات، 11+ صفقة. */
const counted = (n: number, one: string, two: string, few: string) =>
  n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${one}`;
const tradesWord = (n: number) => (n === 0 ? "ولا صفقة" : counted(n, "صفقة", "صفقتين", "صفقات"));
const timesWord = (n: number) => counted(n, "مرة", "مرتين", "مرات");
const mistakesWord = (n: number) => counted(n, "مخالفة", "مخالفتين", "مخالفات");

// ---- Periods -------------------------------------------------------------------------------

const WEEK_KEY = /^(\d{4})-W(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const weekKeyOfDay = (day: string) => isoWeekKey(`${day}T12:00:00Z`, "UTC");

/** The first calendar day (YYYY-MM-DD) of the period; null when the key isn't a real week or month. */
function firstDay(p: Period): string | null {
  if (p.kind === "week") {
    const m = WEEK_KEY.exec(p.key);
    if (!m) return null;
    const jan4 = Date.UTC(Number(m[1]), 0, 4);
    const monday = new Date(jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS + (Number(m[2]) - 1) * 7 * DAY_MS)
      .toISOString().slice(0, 10);
    // W00, W54 or a W53 the year doesn't have reads back as another week.
    return weekKeyOfDay(monday) === p.key ? monday : null;
  }
  const m = MONTH_KEY.exec(p.key);
  const month = m ? Number(m[2]) : 0;
  return month >= 1 && month <= 12 ? `${p.key}-01` : null;
}

function shiftMonth(key: string, n: number): string {
  const t = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${pad((((t % 12) + 12) % 12) + 1)}`;
}

/** The week or month an instant falls in, on the trader's calendar. */
export function periodOf(kind: PeriodKind, at: Date | string | number, tz: string | null | undefined): Period {
  return { kind, key: kind === "week" ? isoWeekKey(at, tz) : monthKey(at, tz) };
}

/** The period n weeks / months later (n < 0: earlier); null for a malformed key. */
export function shiftPeriod(p: Period, n: number): Period | null {
  const first = firstDay(p);
  if (!first) return null;
  return p.kind === "week" ? { kind: "week", key: weekKeyOfDay(addDays(first, 7 * n)) } : { kind: "month", key: shiftMonth(p.key, n) };
}

/** [from, to) in the trader's zone: Monday 00:00 to the next Monday, or the 1st to the next 1st. */
export function periodBounds(p: Period, tz: string | null | undefined): { from: Date; to: Date } | null {
  const first = firstDay(p);
  if (!first) return null;
  const next = p.kind === "week" ? addDays(first, 7) : `${shiftMonth(p.key, 1)}-01`;
  return { from: zonedMidnight(first, tz), to: zonedMidnight(next, tz) };
}

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** «أسبوع 12/10–16/10» (Monday to Friday) or «أكتوبر 2026». */
export function periodLabel(p: Period): string {
  const first = firstDay(p);
  if (!first) return p.key;
  if (p.kind === "month") return `${MONTHS[Number(p.key.slice(5, 7)) - 1]} ${p.key.slice(0, 4)}`;
  const dm = (k: string) => `${Number(k.slice(8, 10))}/${Number(k.slice(5, 7))}`;
  return `أسبوع ${dm(first)}–${dm(addDays(first, 4))}`;
}

// ---- Reading stored rows -------------------------------------------------------------------

const isTag = (v: unknown): v is TagCode => typeof v === "string" && (TAGS as readonly string[]).includes(v);
const asVerdict = (v: unknown): Verdict | null => (typeof v === "string" && v in VERDICT_RANK ? (v as Verdict) : null);
const asSource = (v: unknown): ViolationSource =>
  typeof v === "string" && (VIOLATION_SOURCES as readonly string[]).includes(v) ? (v as ViolationSource) : "manual";

/** trade_reviews.tags: [{tag, …}] as reviewTrade stores them (plain codes are read too), each once. */
function parseTags(v: unknown): TagCode[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<TagCode>();
  for (const x of v) {
    const code = x && typeof x === "object" ? (x as Record<string, unknown>)["tag"] : x;
    if (isTag(code)) out.add(code);
  }
  return [...out];
}

type StoredRule = { text: string; trigger: string; duration: string | null };
function parseRules(v: unknown): StoredRule[] {
  if (!Array.isArray(v)) return [];
  const out: StoredRule[] = [];
  for (const x of v) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    const text = (typeof x === "string" ? x : typeof o?.["text"] === "string" ? (o["text"] as string) : "").trim();
    if (!text) continue;
    out.push({ text, trigger: typeof o?.["trigger"] === "string" ? (o["trigger"] as string) : "", duration: typeof o?.["duration"] === "string" ? (o["duration"] as string) : null });
  }
  return out;
}

/** The analyst card's direction and confidence («عالية|متوسطة|ضعيفة»); null without a direction. */
function cardOf(v: unknown): { side: 1 | -1; confidence: Confidence } | null {
  let o = v;
  if (typeof o === "string") {
    try { o = JSON.parse(o); } catch { return null; }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const side = sideOf(String(r["direction"] ?? ""));
  if (!side) return null;
  const c = String(r["confidence"] ?? "").toLowerCase();
  const confidence: Confidence = /عالي|high/.test(c) ? "high" : /متوسط|medium/.test(c) ? "medium" : /ضعيف|منخفض|low/.test(c) ? "low" : "unknown";
  return { side: side as 1 | -1, confidence };
}

// ---- The review ----------------------------------------------------------------------------

type Closed = { t: PatternTrade; at: number; review: PatternReview | null; verdict: Verdict | null; tags: TagCode[] };

const SOURCE_LABEL: Record<ViolationSource, string> = {
  manual: "مخالفة بدون قاعدة محددة",
  gate: "دخول رغم «لا تدخل»",
  breaker: "دخول والتداول موقوف",
  plan: "كسر خطة اليوم",
  ai: "مخالفة سجّلها سَنَد",
};

/** Next-period rules, one per pattern; the text says what to do, the card shows for how long. */
const TAG_RULE: Record<Exclude<TagCode, "no_pattern_detected">, string> = {
  revenge_trade: "بعد أي خسارة لا تدخل قبل ما تخلص التهدئة وتكتب سطر: ليش الصفقة الجاية مو تعويض.",
  fomo_entry: "لا دخول بدون سبب مكتوب ونقطة إلغاء وتأكيد الإعداد قبل الدخول.",
  added_to_loser: "لا تزوّد على صفقة ضدك. الوقف هو الخطة.",
  premature_exit: "لا تسكّر يدوي قبل الوقف أو الهدف إلا بسبب مكتوب في خطتك.",
  overconfidence_after_winner: "بعد أي ربح، الصفقة اللي بعده بنفس حجم خطتك أو أقل.",
  stop_moved: "أي تحريك للوقف يتكتب قبل الدخول، وأي تحريك بدون خطة يبي مراجعة على طول.",
  size_creep: "خاطر بنص حدك (0.5R) بكل صفقة، إلا لو عدّلت خطتك بنفسك.",
  unknown_size: "سجّل المخاطرة المخططة والفعلية بكل صفقة عشان نقدر نحكم على الحجم.",
  hesitation: "قبل الجلسة اكتب نقطة الدخول والإلغاء، ولو تحققت نفّذ بالحجم المخطط.",
  rule_drift: "اختار قاعدة وحدة من قواعدك والتزم فيها بكل صفقة.",
};
const COOLDOWN_RULE = "خاطر بنص حدك (0.5R) بكل صفقة، واكتب مراجعة بعد كل صفقة.";
const KEEP_RULE = "كمّل على نفس قواعدك وسجّل كل صفقة.";

function avg(xs: readonly (number | null | undefined)[]): number | null {
  const ok = xs.filter(fin);
  return ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null;
}

export function periodReview(input: PeriodInput): PeriodReview {
  const { period } = input;
  const tz = input.tz ?? null;
  const now = input.now ?? new Date();
  const bounds = periodBounds(period, tz);
  if (!bounds) throw new RangeError(`Not a ${period.kind} key: ${period.key}`);
  const from = bounds.from.getTime(), to = bounds.to.getTime();
  const inside = (t: number | null): t is number => t != null && t >= from && t < to;
  const thisPeriod = period.kind === "week" ? "هالأسبوع" : "هالشهر";
  const nextDuration: RuleDuration = period.kind === "week" ? "next_week" : "next_month";

  // One review per trade (trade_id is unique); the latest wins if a stale copy slips in.
  const reviewOf = new Map<string, PatternReview>();
  for (const r of input.reviews) {
    if (!r.trade_id || (r.review_type !== "single_trade" && r.review_type !== "partial_close")) continue;
    const prev = reviewOf.get(r.trade_id);
    if (!prev || (ms(r.created_at) ?? 0) >= (ms(prev.created_at) ?? 0)) reviewOf.set(r.trade_id, r);
  }
  const closedAll: Closed[] = [];
  for (const t of input.trades) {
    const at = ms(t.closed_at);
    if (t.status !== "closed" || at == null) continue;
    const review = reviewOf.get(t.id) ?? null;
    const verdict = asVerdict(review?.verdict);
    closedAll.push({ t, at, review: verdict ? review : null, verdict, tags: verdict ? parseTags(review?.tags) : [] });
  }
  closedAll.sort((a, b) => a.at - b.at);
  const mine = closedAll.filter((c) => inside(c.at));
  const reviewed = mine.filter((c) => c.verdict);

  // ---- Results
  const pnlOf = (list: readonly Closed[]) => r2(list.reduce((s, c) => s + (fin(c.t.pnl) ? c.t.pnl : 0), 0));
  const wins = mine.filter((c) => fin(c.t.pnl) && c.t.pnl > CENT).length;
  const losses = mine.filter((c) => fin(c.t.pnl) && c.t.pnl < -CENT).length;
  // Break-even is a win (as in the breaker); a close with no P&L is skipped, not a win.
  let run = 0, maxLosingStreak = 0;
  for (const c of mine) {
    if (!fin(c.t.pnl)) continue;
    run = c.t.pnl < -CENT ? run + 1 : 0;
    maxLosingStreak = Math.max(maxLosingStreak, run);
  }

  // ---- Process vs result: the review's verdict against the trade's P&L now
  const isClean = (v: Verdict) => VERDICT_RANK[v] <= VERDICT_RANK.warn;
  const quadrants: Record<Quadrant, number> = { clean_win: 0, clean_loss: 0, lucky_win: 0, dirty_loss: 0 };
  for (const c of reviewed) {
    if (!fin(c.t.pnl)) continue;
    const clean = isClean(c.verdict!);
    quadrants[c.t.pnl < -CENT ? (clean ? "clean_loss" : "dirty_loss") : clean ? "clean_win" : "lucky_win"]++;
  }
  const cleanList = reviewed.filter((c) => isClean(c.verdict!));
  const dirtyList = reviewed.filter((c) => !isClean(c.verdict!));
  const unreviewedList = mine.filter((c) => !c.verdict);
  const processPnl = {
    clean: pnlOf(cleanList), dirty: pnlOf(dirtyList), unreviewed: pnlOf(unreviewedList),
    cleanTrades: cleanList.length, dirtyTrades: dirtyList.length, unreviewedTrades: unreviewedList.length,
  };
  const avgScores = {
    process: avg(reviewed.map((c) => c.review!.process_score)),
    risk: avg(reviewed.map((c) => c.review!.risk_score)),
    execution: avg(reviewed.map((c) => c.review!.execution_score)),
    quality: avg(reviewed.map((c) => c.review!.quality_score)),
  };

  // ---- Tags and their trend against earlier periods that had reviewed trades (a week off proves nothing)
  const tagTrades = new Map<TagCode, string[]>();
  for (const c of reviewed) for (const tag of c.tags) tagTrades.set(tag, [...(tagTrades.get(tag) ?? []), c.t.id]);
  const baseline: Map<TagCode, number>[] = [];
  for (let i = 1; i <= TREND_LOOKBACK; i++) {
    const pb = periodBounds(shiftPeriod(period, -i)!, tz)!;
    const list = closedAll.filter((c) => c.verdict && c.at >= pb.from.getTime() && c.at < pb.to.getTime());
    if (!list.length) continue;
    const counts = new Map<TagCode, number>();
    for (const c of list) for (const tag of c.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    baseline.push(counts);
  }
  const prevAvgOf = (tag: TagCode) =>
    baseline.length ? r2(baseline.reduce((s, m) => s + (m.get(tag) ?? 0), 0) / baseline.length) : null;
  const trendOf = (count: number, prevAvg: number | null): Trend | null =>
    prevAvg == null ? null : count - prevAvg >= 1 ? "up" : count - prevAvg <= -1 ? "down" : "flat";
  const tagCounts: TagCount[] = [];
  for (const tag of TAGS) {
    const ids = tagTrades.get(tag) ?? [];
    const prevAvg = prevAvgOf(tag);
    const trend = trendOf(ids.length, prevAvg);
    if (ids.length || (trend === "down" && tag !== "no_pattern_detected"))
      tagCounts.push({ tag, label: TAG_META[tag].label, count: ids.length, tradeIds: ids, prevAvg, trend });
  }
  tagCounts.sort((a, b) => b.count - a.count || TAGS.indexOf(a.tag) - TAGS.indexOf(b.tag));
  const recurring = tagCounts.filter((x) => x.tag !== "no_pattern_detected" && x.count >= RECURRING_MIN).map((x) => x.tag);
  const ruleDrift = tagCounts.filter((x) => !DATA_TAGS.has(x.tag) && x.count >= DRIFT_MIN).map((x) => x.tag);

  // ---- The gate's decisions
  const checks = input.checks ?? [];
  const tradeById = new Map(input.trades.map((t) => [t.id, t]));
  const tradeByCheck = new Map<string, PatternTrade>();
  for (const t of input.trades) if (t.pre_trade_check_id) tradeByCheck.set(t.pre_trade_check_id, t);
  const checkById = new Map<string, PatternCheck>();
  for (const c of checks) if (c.id) checkById.set(c.id, c);
  const tradeIdOf = (c: PatternCheck) => c.trade_id ?? (c.id ? tradeByCheck.get(c.id)?.id ?? null : null);
  const myChecks = checks.filter((c) => inside(ms(c.created_at)));
  // historical and watch are not decisions to act on.
  const acted = myChecks.filter((c) => c.decision === "NO_GO" && (c.intent === "pre_entry" || c.intent === "already_placed"));

  // A NO_GO followed by a trade is an entry whatever the flag says; only an explicit «ما رح أدخل» is a save.
  const saved = acted.filter((c) => c.proceeded === false && !tradeIdOf(c));
  const gateSaved = { count: saved.length, risk: r2(saved.reduce((s, c) => s + (pos(c.actual_risk) || pos(c.planned_risk)), 0)) };
  const entered = acted.filter((c) => c.proceeded === true || !!tradeIdOf(c));
  const enteredKeys = new Set<string>();
  const enteredIds = new Set<string>();
  entered.forEach((c, i) => {
    const id = tradeIdOf(c);
    enteredKeys.add(id ? `t:${id}` : `c:${c.id ?? i}`);
    if (id) enteredIds.add(id);
  });
  const enteredOnNoGo = {
    count: enteredKeys.size,
    pnl: r2([...enteredIds].reduce((s, id) => { const t = tradeById.get(id); return s + (t?.status === "closed" && fin(t.pnl) ? t.pnl : 0); }, 0)),
    tradeIds: [...enteredIds],
  };

  // A watch card he later took (the same symbol and side within a day) is not "watched, not taken".
  const watches = myChecks.filter((c) => c.intent === "watch");
  const takenWatch = (c: PatternCheck) => {
    if (tradeIdOf(c)) return true;
    const at = ms(c.created_at)!;
    const sym = (c.symbol ?? "").trim().toUpperCase();
    const side = sideOf(c.direction);
    return !!sym && input.trades.some((t) => {
      const o = ms(t.opened_at);
      const ts = sideOf(t.direction);
      return o != null && o >= at && o <= at + DAY_MS && (t.symbol ?? "").trim().toUpperCase() === sym && (!side || !ts || side === ts);
    });
  };
  const notTaken = watches.filter((c) => !takenWatch(c));
  const watchedNotTaken = {
    count: notTaken.length,
    taken: watches.length - notTaken.length,
    symbols: [...new Set(notTaken.map((c) => (c.symbol ?? "").trim().toUpperCase()).filter(Boolean))],
  };

  // ---- Violations: rows by rule, and distinct mistakes for the verdict
  const myViolations = (input.violations ?? []).filter((v) => inside(ms(v.occurred_at)));
  const ruleTitle = new Map((input.rules ?? []).map((r) => [r.id, r.title]));
  const groups = new Map<string, RuleViolations>();
  const violationsBySource: Partial<Record<ViolationSource, number>> = {};
  for (const v of myViolations) {
    const src = asSource(v.source);
    const key = v.rule_id ? `rule:${v.rule_id}` : `source:${src}`;
    const g = groups.get(key) ?? {
      key, ruleId: v.rule_id ?? null, count: 0, bySource: {},
      label: v.rule_id ? ruleTitle.get(v.rule_id) ?? "قاعدة محذوفة" : SOURCE_LABEL[src],
    };
    g.count++;
    g.bySource[src] = (g.bySource[src] ?? 0) + 1;
    groups.set(key, g);
    violationsBySource[src] = (violationsBySource[src] ?? 0) + 1;
  }
  const violationsByRule = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const events = new Map<string, number>();
  const event = (key: string, at: number) => { const p = events.get(key); if (p == null || at < p) events.set(key, at); };
  myViolations.forEach((v, i) => {
    const c = v.pre_trade_check_id ? checkById.get(v.pre_trade_check_id) : undefined;
    const tid = v.trade_id ?? (c ? tradeIdOf(c) : v.pre_trade_check_id ? tradeByCheck.get(v.pre_trade_check_id)?.id ?? null : null);
    event(tid ? `t:${tid}` : v.pre_trade_check_id ? `c:${v.pre_trade_check_id}` : `v:${v.id ?? i}`, ms(v.occurred_at)!);
  });
  entered.forEach((c, i) => { const id = tradeIdOf(c); event(id ? `t:${id}` : `c:${c.id ?? i}`, ms(c.created_at)!); });
  for (const c of reviewed) if (VERDICT_RANK[c.verdict!] >= VERDICT_RANK.violation) event(`t:${c.t.id}`, c.at);
  const times = [...events.values()].sort((a, b) => a - b);
  const closeTogether = times.some((t, i) => i > 0 && t - times[i - 1]! <= COOLDOWN_WINDOW_DAYS * DAY_MS);

  // ---- The analyst: trades he took on a card, in the card's direction
  const cardFor = new Map<string, { at: number; side: 1 | -1; confidence: Confidence }>();
  for (const a of input.analyses ?? []) {
    const card = a.trade_id ? cardOf(a.card) : null;
    if (!card || !a.trade_id) continue;
    const at = ms(a.created_at) ?? 0;
    const prev = cardFor.get(a.trade_id);
    if (!prev || at >= prev.at) cardFor.set(a.trade_id, { at, ...card });
  }
  const rate = (n: number, hits: number): HitRate => ({ n, hits, rate: n ? r2(hits / n) : null });
  const tally: Record<Confidence, [number, number]> = { high: [0, 0], medium: [0, 0], low: [0, 0], unknown: [0, 0] };
  for (const c of mine) {
    const card = cardFor.get(c.t.id);
    if (!card || !fin(c.t.pnl) || sideOf(c.t.direction) !== card.side) continue;
    tally[card.confidence][0]++;
    if (c.t.pnl > CENT) tally[card.confidence][1]++;
  }
  const hitN = Object.values(tally).reduce((s, [n]) => s + n, 0);
  const hitHits = Object.values(tally).reduce((s, [, h]) => s + h, 0);
  const analystHitRate: AnalystHitRate = {
    ...rate(hitN, hitHits),
    byConfidence: { high: rate(...tally.high), medium: rate(...tally.medium), low: rate(...tally.low), unknown: rate(...tally.unknown) },
    small: hitN < SMALL_SAMPLE,
  };

  // ---- Last period's accepted rule: kept when its pattern didn't come back
  const prevPeriod = shiftPeriod(period, -1)!;
  const rowType = period.kind === "week" ? "weekly" : "monthly";
  const prevRow = input.reviews
    .filter((r) => !r.trade_id && r.review_type === rowType && r.period_key === prevPeriod.key)
    .sort((a, b) => (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0))[0];
  const chosen = prevRow && (prevRow.decision === "accept_rules" || prevRow.decision === "modify_rules") ? parseRules(prevRow.next_rules) : [];
  const judge = (r: StoredRule): RuleAdherence => {
    const base = { text: r.text, trigger: r.trigger };
    if (!reviewed.length) return { ...base, kept: null, evidence: `ما في صفقات مراجعة ${thisPeriod} نحكم عليها.` };
    if (isTag(r.trigger) && r.trigger !== "no_pattern_detected") {
      const n = tagTrades.get(r.trigger)?.length ?? 0;
      const label = TAG_META[r.trigger].label;
      return n
        ? { ...base, kept: false, evidence: `«${label}» رجع ${timesWord(n)} ${thisPeriod}.` }
        : { ...base, kept: true, evidence: `ما رجع «${label}» ${thisPeriod}.` };
    }
    if (r.trigger === "cooldown" || r.trigger === "none")
      return events.size
        ? { ...base, kept: false, evidence: `صار في ${mistakesWord(events.size)} ${thisPeriod}.` }
        : { ...base, kept: true, evidence: `ما في مخالفات ${thisPeriod}.` };
    return { ...base, kept: null, evidence: "ما أقدر أقيس هالقاعدة من الأرقام." };
  };
  const judged = chosen.map(judge);
  const lastRuleAdherence: LastRuleAdherence | null = judged.length
    ? { period: prevPeriod.key, kept: judged.some((r) => r.kept === false) ? false : judged.every((r) => r.kept === true) ? true : null, rules: judged }
    : null;

  // ---- Verdict: only up
  const reasons: string[] = [];
  // Raised inside raise(), so TS must not narrow it to "ok".
  let verdict = "ok" as Verdict;
  const raise = (v: Verdict, why: string) => { verdict = stricterVerdict(verdict, v); reasons.push(why); };
  if (events.size >= 2 && closeTogether)
    raise("cooldown", period.kind === "week" || events.size === 2
      ? `${mistakesWord(events.size)} ${period.kind === "week" ? thisPeriod : `خلال ${COOLDOWN_WINDOW_DAYS} أيام`}.`
      : `${mistakesWord(events.size)} ${thisPeriod}، ثنتين منها خلال ${COOLDOWN_WINDOW_DAYS} أيام.`);
  else if (events.size) raise("violation", `${events.size === 1 ? "في مخالفة وحدة" : `في ${mistakesWord(events.size)}`} ${thisPeriod}.`);
  for (const tag of ruleDrift) raise("review", `«${TAG_META[tag].label}» تكرر ${timesWord(tagTrades.get(tag)!.length)} ${thisPeriod}.`);
  const toReview = reviewed.filter((c) => c.verdict === "review").length;
  if (toReview) raise("review", `${tradesWord(toReview)} تبي مراجعة.`);
  if (unreviewedList.length) raise("warn", `${tradesWord(unreviewedList.length)} ما راجعتها لحد الحين.`);
  const dataOnly = reviewed.filter((c) => c.verdict === "warn").length;
  if (dataOnly) raise("warn", `${tradesWord(dataOnly)} ناقصها بيانات.`);

  // ---- Next rules: the strictest first, at most two
  const nextRules: NextRule[] = [];
  const rule = (trigger: NextRule["trigger"], text: string, reason: string) => {
    if (nextRules.length < 2 && !nextRules.some((r) => r.text === text || (trigger !== "none" && r.trigger === trigger)))
      nextRules.push({ text, duration: nextDuration, trigger, reason });
  };
  if (verdict === "cooldown") rule("cooldown", COOLDOWN_RULE, `${mistakesWord(events.size)} قريبة من بعض ${thisPeriod}.`);
  for (const r of judged)
    if (r.kept === false) rule(isTag(r.trigger) || r.trigger === "cooldown" ? (r.trigger as NextRule["trigger"]) : "none", r.text, `ما مشت ${period.kind === "week" ? "الأسبوع اللي فات" : "الشهر اللي فات"}: ${r.evidence}`);
  const patterns = [...ruleDrift, ...recurring.filter((t) => !ruleDrift.includes(t))];
  // Behaviour first; a data gap only asks for the numbers.
  patterns.sort((a, b) => Number(DATA_TAGS.has(a)) - Number(DATA_TAGS.has(b)));
  for (const tag of patterns)
    if (tag !== "no_pattern_detected") rule(tag, TAG_RULE[tag], `«${TAG_META[tag].label}» تكرر ${timesWord(tagTrades.get(tag)!.length)} ${thisPeriod}.`);
  if (!nextRules.length && events.size) rule("rule_drift", TAG_RULE.rule_drift, `${mistakesWord(events.size)} ${thisPeriod}.`);
  if (!nextRules.length) rule("none", KEEP_RULE, mine.length ? "ما بان نمط يتكرر." : `ما في صفقات ${thisPeriod}.`);

  return {
    kind: period.kind,
    key: period.key,
    label: periodLabel(period),
    from: bounds.from.toISOString(),
    to: bounds.to.toISOString(),
    inProgress: now.getTime() >= from && now.getTime() < to,
    verdict,
    reasons,
    trades: mine.length,
    wins,
    losses,
    pnl: pnlOf(mine),
    reviewed: reviewed.length,
    unreviewed: unreviewedList.length,
    tagCounts,
    baselinePeriods: baseline.length,
    recurring,
    ruleDrift,
    quadrants,
    cleanLosses: quadrants.clean_loss,
    luckyWins: quadrants.lucky_win,
    processPnl,
    avgScores,
    maxLosingStreak,
    violationCount: events.size,
    violationsByRule,
    violationsBySource,
    gateSaved,
    enteredOnNoGo,
    watchedNotTaken,
    analystHitRate,
    lastRuleAdherence,
    nextRules,
  };
}

type ReviewInsert = Database["public"]["Tables"]["trade_reviews"]["Insert"];

/** The weekly / monthly trade_reviews row (user_id is the writer's; decision stays journal_only). */
export function periodRow(r: PeriodReview): Omit<ReviewInsert, "user_id"> {
  return {
    trade_id: null,
    review_type: r.kind === "week" ? "weekly" : "monthly",
    period_key: r.key,
    verdict: r.verdict,
    process_score: r.avgScores.process,
    risk_score: r.avgScores.risk,
    execution_score: r.avgScores.execution,
    quality_score: r.avgScores.quality,
    tags: r.tagCounts.map(({ tag, count, trend }) => ({ tag, count, trend })),
    findings: [],
    next_rules: r.nextRules,
    questions: [],
    facts: r,
  };
}

// ---- For سَنَد -----------------------------------------------------------------------------

const TREND_WORD: Record<Trend, string> = { up: "زاد", down: "قلّ", flat: "ثابت" };
const KEPT_WORD = (k: boolean | null) => (k === true ? "التزمت" : k === false ? "ما التزمت" : "ما تنقاس");

function periodLines(p: PeriodReview, m: (n: number) => string): string[] {
  const head = `- ${p.label} (${p.key})${p.inProgress ? " لحد الحين" : ""}: ${VERDICT_META[p.verdict].label} · ${tradesWord(p.trades)}`;
  const out = [p.trades ? `${head} · ${m(p.pnl)} · ربح ${p.wins} / خسارة ${p.losses}` : head];
  if (p.reasons.length) out.push(`  ليش: ${p.reasons.join(" ")}`);
  if (p.trades) {
    const pp = p.processPnl;
    const parts = [`عملية نظيفة ${m(pp.clean)} (${pp.cleanTrades})`, `قواعد مكسورة ${m(pp.dirty)} (${pp.dirtyTrades})`];
    if (pp.unreviewedTrades) parts.push(`بدون مراجعة ${m(pp.unreviewed)} (${pp.unreviewedTrades})`);
    parts.push(`${QUADRANT_LABEL.clean_loss} ${p.cleanLosses}`, `${QUADRANT_LABEL.lucky_win} ${p.luckyWins}`, `أطول خسارات ورا بعض ${p.maxLosingStreak}`);
    out.push(`  النتيجة: ${parts.join(" · ")}`);
  }
  // «ما في نمط واضح» is a clean trade, not a pattern to narrate.
  const seen = p.tagCounts.filter((t) => t.tag !== "no_pattern_detected");
  if (seen.length) {
    const tags = seen.map((t) => `${t.label} ${t.count}${t.trend ? ` (${TREND_WORD[t.trend]})` : ""}`).join("، ");
    const base = p.kind === "week" ? counted(p.baselinePeriods, "أسبوع", "أسبوعين", "أسابيع") : counted(p.baselinePeriods, "شهر", "شهرين", "شهور");
    const small = p.baselinePeriods && p.baselinePeriods < TREND_MIN_PERIODS ? ` — مقارنة ب${p.baselinePeriods > 2 ? "ـ" : ""}${base} قبل بس` : "";
    out.push(`  الأنماط: ${tags}${small}${p.ruleDrift.length ? ` · يتكرر كثير: ${p.ruleDrift.map((t) => TAG_META[t].label).join("، ")}` : ""}`);
  }
  if (p.violationsByRule.length) out.push(`  المخالفات: ${p.violationsByRule.map((v) => `${v.label} ${v.count}`).join("، ")}`);
  const gate: string[] = [];
  if (p.gateSaved.count) gate.push(`وقفت ${timesWord(p.gateSaved.count)} عند «لا تدخل» (مخاطرة ما دخلتها ${m(p.gateSaved.risk)})`);
  if (p.enteredOnNoGo.count) gate.push(`دخلت رغم «لا تدخل» ${timesWord(p.enteredOnNoGo.count)} (النتيجة ${m(p.enteredOnNoGo.pnl)})`);
  if (p.watchedNotTaken.count) gate.push(`راقبت وما دخلت ${p.watchedNotTaken.count}`);
  if (gate.length) out.push(`  البوابة: ${gate.join(" · ")}`);
  const a = p.analystHitRate;
  if (a.n) out.push(`  المحلل: من ${tradesWord(a.n)} دخلتها على بطاقته، ${a.hits} طلعت رابحة${a.small ? " — عيّنة صغيرة، مو نسبة نجاح" : ` (${Math.round((a.rate ?? 0) * 100)}%)`}`);
  if (p.lastRuleAdherence)
    out.push(`  قاعدة ${p.kind === "week" ? "الأسبوع اللي فات" : "الشهر اللي فات"}: ${p.lastRuleAdherence.rules.map((r) => `«${r.text}» ${KEPT_WORD(r.kept)} (${r.evidence})`).join("، ")}`);
  if (p.nextRules.length) out.push(`  المقترح: ${p.nextRules.map((r) => `«${r.text}» (${DURATION_LABEL[r.duration]})`).join("، ")}`);
  return out;
}

/** The period reviews for every prompt: the latest 4 weeks and the latest month, quoted, never recomputed. */
export function patternsForPrompt(periods: readonly PeriodReview[], currency = "USD"): string {
  const m = (n: number) => money(n, currency);
  // Newest first, one per key: the first copy given wins.
  const latest = (kind: PeriodKind) => {
    const byKey = new Map<string, PeriodReview>();
    for (const p of periods) if (p.kind === kind && !byKey.has(p.key)) byKey.set(p.key, p);
    return [...byKey.values()].sort((a, b) => b.from.localeCompare(a.from));
  };
  const picked = [...latest("week").slice(0, 4), ...latest("month").slice(0, 1)];
  const lines = ["أنماطك بالأسابيع والشهر (محسوبة من مراجعاتك، انقلها ولا تعيد حسابها):"];
  if (!picked.length) lines.push("- ما في مراجعات أسابيع لحد الحين.");
  for (const p of picked) lines.push(...periodLines(p, m));
  return lines.join("\n");
}
