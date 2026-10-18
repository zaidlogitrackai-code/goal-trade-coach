/**
 * The circuit breaker: may new risk be taken right now? Losses only, after the
 * drawdown-circuit-breaker skill. Code decides; the AI only quotes breakerForPrompt.
 * Pure — the caller loads the rows (trades, partial closes, latched circuit_breaks).
 *
 * P&L convention: trades.pnl is the whole trade's result, partial trims included.
 * A trim (trade_events partial_close.realized_pnl) is booked at its own time and the
 * rest of the trade (pnl − its trims) at closed_at, so a trim loss counts on the day
 * it happened and nothing is counted twice.
 */
import { anchorBalance, applyPctLimits } from "./effective-limits";
import { findDuplicate } from "./trade-dedupe";
import {
  addDays, dayKey, dayStart, isWeekendDay, isoWeekKey, monthKey, monthStart, nextTradingDayStart,
  safeTz, wallClock, weekStart, zonedMidnight,
} from "./trading-day";

export type BreakerState = "TRADING_ALLOWED" | "COOLDOWN" | "HALTED";
export const STATE_RANK: Record<BreakerState, number> = { TRADING_ALLOWED: 0, COOLDOWN: 1, HALTED: 2 };

/** Exactly the circuit_breaks.rule CHECK (0012). Max trades and the profit cap are not here: see protectProfit. */
export const BREAKER_RULES = [
  "max_daily_loss", "weekly_drawdown_halt", "monthly_drawdown_halt",
  "losing_streak_cooldown", "manual_pause", "manual_cooldown", "incomplete_data",
] as const;
export type BreakerRule = (typeof BREAKER_RULES)[number];
type LossRule = "max_daily_loss" | "weekly_drawdown_halt" | "monthly_drawdown_halt";

/**
 * The survival defaults card (owner decision 7). Until limits_accepted_at they only warn;
 * once accepted they fill only the limits left at 0 — never one he set himself.
 */
export const SURVIVAL_DEFAULTS = { dailyPct: 2, weeklyPct: 5, monthlyPct: 8, streak: 2, cooldownHours: 24 } as const;

export type BreakerSettings = {
  max_daily_loss?: number | null;
  weekly_max_loss?: number | null;
  monthly_max_loss?: number | null;
  limits_pct?: unknown;
  max_consecutive_losses?: number | null;
  streak_cooldown_hours?: number | null;
  trading_paused?: boolean | null;
  cooldown_until?: string | null;
};

export type BreakerTrade = {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number | null;
  exit_price?: number | null;
  status: string;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  created_at?: string | null;
};

/** trade_events rows of kind partial_close. */
export type PartialEvent = { id?: string; trade_id: string; kind?: string; realized_pnl: number | null; at: string };

/** parseLedger's report on the capital ledger. */
export type LedgerIssues = { dropped: { id: string | null; at: string | null }[]; corrupt: boolean };

/** A circuit_breaks row: a halt that a later edit of the trades must not clear. */
export type LatchedBreak = {
  rule: string;
  state: string;
  period_key: string;
  threshold: number | null;
  observed: number | null;
  active_until: string | null;
  released_at: string | null;
};

export type BreakerInput = {
  settings: BreakerSettings;
  /** daily_plans.start_balance of today; null until the day is snapshotted. */
  startBalance: number | null;
  /** The live balance, the anchor until the day has a start balance. */
  balance: number;
  /** At least this month's trades and the latest closes (for the streak). */
  trades: BreakerTrade[];
  partialEvents?: PartialEvent[];
  ledgerIssues?: LedgerIssues | null;
  latched?: LatchedBreak[];
  /** daily_plans.max_loss: it can only make the daily limit stricter. */
  planMaxLoss?: number | null;
  limitsAcceptedAt?: string | null;
  /** When the breaker was switched on; null = preview. */
  breakerSince?: string | null;
  pausedUntil?: string | null;
  tz: string | null | undefined;
  now?: Date;
};

export type BreakerTrigger = {
  rule: BreakerRule;
  state: Exclude<BreakerState, "TRADING_ALLOWED">;
  /** circuit_breaks.period_key: the day, ISO week, month, or the last loss's trade id. */
  periodKey: string;
  threshold: number | null;
  observed: number | null;
  /** When this rule stops blocking; null = until he resumes (manual pause) or the data is repaired. */
  releaseAt: Date | null;
  /** Held by a circuit_breaks row. */
  latched: boolean;
  /** A manual pause with no end («لين أرجّعه»): remind him every morning. */
  indefinite?: boolean;
};

export type IssueKind = "null_pnl" | "bad_close_time" | "duplicate" | "bad_trim" | "ledger_dropped" | "ledger_corrupt";
export type DataIssue = {
  kind: IssueKind;
  tradeId: string | null;
  symbol: string | null;
  /** Rows written after breaker_since block (PARTIAL = HALTED); older ones only warn. */
  blocking: boolean;
};

export type BreakerWarning =
  | { kind: "limits_not_active"; rules: (LossRule | "losing_streak_cooldown")[]; text: string }
  | { kind: "default_would_trigger"; rule: LossRule | "losing_streak_cooldown"; text: string }
  | { kind: "old_data"; count: number; text: string };

export type LossLimit = {
  rule: LossRule;
  /** Dollars, from the % limits on the day's anchor balance. */
  threshold: number;
  pct: number | null;
  source: "own" | "plan" | "default";
  /** false: an unaccepted survival default, it only warns. */
  binding: boolean;
  /** Realized loss in the period, ≥ 0. */
  loss: number;
  remaining: number;
};

export type StreakInfo = {
  losses: number;
  threshold: number;
  binding: boolean;
  cooldownHours: number;
  lastLossId: string | null;
  lastLossAt: string | null;
};

export type BreakerResult = {
  state: BreakerState;
  /** Broken data after breaker_since: counts as HALTED until repaired. */
  partial: boolean;
  preview: boolean;
  /** Every triggered rule, strictest first. */
  triggers: BreakerTrigger[];
  /** When every trigger has ended; null when nothing triggered or one has no end. */
  releaseAt: Date | null;
  warnings: BreakerWarning[];
  issues: DataIssue[];
  pnl: { day: number; week: number; month: number };
  limits: LossLimit[];
  streak: StreakInfo;
  anchor: number;
  tz: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
function ms(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = Date.parse(s);
  return Number.isFinite(v) ? v : null;
}

/** First Mon–Fri day of next month, 00:00. */
function nextMonthStart(now: Date, tz: string): Date {
  const [y, m] = monthKey(now, tz).split("-").map(Number) as [number, number];
  let k = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  while (isWeekendDay(k)) k = addDays(k, 1);
  return zonedMidnight(k, tz);
}

const DAY_MS = 86_400_000;
const lossesWord = (n: number) => (n === 1 ? "خسارة" : n === 2 ? "خسارتين" : n <= 10 ? `${n} خسارات` : `${n} خسارة`);

const nextMonday = (now: Date, tz: string) => zonedMidnight(addDays(dayKey(weekStart(now, tz), tz), 7), tz);

export function evaluateBreaker(input: BreakerInput): BreakerResult {
  const now = input.now ?? new Date();
  const t = now.getTime();
  const tz = safeTz(input.tz);
  const since = ms(input.breakerSince);
  const preview = since == null;
  // A row is new when any of its times falls after the switch-on (and is not in the future).
  const isNew = (...times: (string | null | undefined)[]) =>
    since != null && times.some((x) => { const v = ms(x); return v != null && v <= t && v >= since; });

  const issues: DataIssue[] = [];
  const flag = (kind: IssueKind, x: BreakerTrade | null, blocking: boolean) =>
    issues.push({ kind, tradeId: x?.id ?? null, symbol: x?.symbol ?? null, blocking });

  // Closed trades whose result and close time can be trusted.
  type Valid = BreakerTrade & { pnl: number; closeMs: number };
  const valid: Valid[] = [];
  for (const x of input.trades) {
    if (x.status !== "closed") continue;
    const open = ms(x.opened_at);
    const close = ms(x.closed_at);
    const isNewRow = isNew(x.created_at, x.opened_at, x.closed_at);
    if (close == null || close > t || (open != null && close < open)) flag("bad_close_time", x, isNewRow);
    else if (!fin(x.pnl)) flag("null_pnl", x, isNewRow);
    else valid.push({ ...x, pnl: x.pnl, closeMs: close });
  }

  // Two identical closes — same symbol, side and entry within 24h (trade-dedupe, as for AI
  // uploads) and the same result: the later-written one is the suspected copy.
  const dupes = new Set<string>();
  const opened = (x: BreakerTrade) => ms(x.opened_at) ?? 0;
  const written = (x: BreakerTrade) => ms(x.created_at) ?? opened(x);
  const sameResult = (a: Valid, b: Valid) =>
    Math.abs(a.pnl - b.pnl) < 0.005 &&
    (a.exit_price == null || b.exit_price == null || Math.abs(Number(a.exit_price) - Number(b.exit_price)) <= Math.abs(Number(a.exit_price)) * 0.0001);
  const groups = new Map<string, Valid[]>();
  for (const x of valid) {
    const k = `${x.symbol.trim().toUpperCase()}|${x.direction}`;
    const g = groups.get(k);
    if (g) g.push(x); else groups.set(k, [x]);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => opened(a) - opened(b));
    g.forEach((x, i) => {
      // Only rows opened within the previous 24h can match, so this stays linear in practice.
      for (let j = i - 1; j >= 0 && opened(x) - opened(g[j]!) <= DAY_MS && !dupes.has(x.id); j--) {
        const y = g[j]!;
        if (dupes.has(y.id) || !sameResult(x, y) || !findDuplicate([y], x)) continue;
        const copy = written(x) > written(y) || (written(x) === written(y) && x.id > y.id) ? x : y;
        dupes.add(copy.id);
        flag("duplicate", copy, isNew(copy.created_at, copy.opened_at, copy.closed_at));
      }
    });
  }

  const tradeById = new Map(input.trades.map((x) => [x.id, x]));
  const trims: { tradeId: string; at: number; pnl: number }[] = [];
  for (const e of input.partialEvents ?? []) {
    if (e.kind && e.kind !== "partial_close") continue;
    const at = ms(e.at);
    // A trim that can't be placed in time can't be proven old: once live it blocks.
    if (at == null || at > t || !fin(e.realized_pnl)) flag("bad_trim", tradeById.get(e.trade_id) ?? null, !preview && (at == null || at >= since!));
    else trims.push({ tradeId: e.trade_id, at, pnl: e.realized_pnl });
  }

  const led = input.ledgerIssues;
  // A ledger that cannot be read can't be dated: once live it blocks, like a dropped entry with no date.
  if (led?.corrupt) flag("ledger_corrupt", null, !preview);
  for (const d of led?.dropped ?? []) { const at = ms(d.at); flag("ledger_dropped", null, !preview && (at == null || at >= since!)); }

  const partial = issues.some((i) => i.blocking);
  // While PARTIAL the suspected copy is left out; otherwise both count (never looser on a guess).
  const counted = partial ? valid.filter((x) => !dupes.has(x.id)) : valid;

  const trimOf = new Map<string, number>();
  for (const x of trims) trimOf.set(x.tradeId, (trimOf.get(x.tradeId) ?? 0) + x.pnl);
  const booked = [
    ...trims.map((x) => ({ at: x.at, pnl: x.pnl })),
    ...counted.map((x) => ({ at: x.closeMs, pnl: x.pnl - (trimOf.get(x.id) ?? 0) })),
  ];
  const pnlFrom = (from: Date) => r2(booked.filter((b) => b.at >= from.getTime() && b.at <= t).reduce((a, b) => a + b.pnl, 0));
  const pnl = { day: pnlFrom(dayStart(now, tz)), week: pnlFrom(weekStart(now, tz)), month: pnlFrom(monthStart(now, tz)) };

  // % limits on the day's start balance: losses taken today don't shrink today's limit.
  const anchor = anchorBalance({ start_balance: input.startBalance }, input.balance);
  const s = applyPctLimits(input.settings, anchor);
  const accepted = !!input.limitsAcceptedAt;

  const triggers: BreakerTrigger[] = [];
  const warnings: BreakerWarning[] = [];
  const advisory: (LossRule | "losing_streak_cooldown")[] = [];
  const limits: LossLimit[] = [];

  const periods: { rule: LossRule; own: number; defPct: number; pnl: number; releaseAt: Date; periodKey: string; label: string }[] = [
    { rule: "max_daily_loss", own: pos(s.max_daily_loss), defPct: SURVIVAL_DEFAULTS.dailyPct, pnl: pnl.day, releaseAt: nextTradingDayStart(now, tz), periodKey: dayKey(now, tz), label: "اليوم" },
    { rule: "weekly_drawdown_halt", own: pos(s.weekly_max_loss), defPct: SURVIVAL_DEFAULTS.weeklyPct, pnl: pnl.week, releaseAt: nextMonday(now, tz), periodKey: isoWeekKey(now, tz), label: "الأسبوع" },
    { rule: "monthly_drawdown_halt", own: pos(s.monthly_max_loss), defPct: SURVIVAL_DEFAULTS.monthlyPct, pnl: pnl.month, releaseAt: nextMonthStart(now, tz), periodKey: monthKey(now, tz), label: "الشهر" },
  ];
  for (const p of periods) {
    let threshold = p.own;
    let source: LossLimit["source"] = "own";
    const plan = p.rule === "max_daily_loss" ? pos(input.planMaxLoss) : 0;
    if (plan > 0 && (threshold === 0 || plan < threshold)) { threshold = plan; source = "plan"; }
    let binding = true;
    if (threshold === 0) {
      if (!(anchor > 0)) continue; // no balance: a % default means nothing
      threshold = r2((p.defPct / 100) * anchor);
      source = "default";
      binding = accepted;
    }
    const loss = r2(Math.max(0, -p.pnl));
    limits.push({ rule: p.rule, threshold, pct: anchor > 0 ? r2((threshold / anchor) * 100) : null, source, binding, loss, remaining: r2(Math.max(0, threshold - loss)) });
    if (!binding) advisory.push(p.rule);
    if (loss < threshold) continue;
    if (binding) triggers.push({ rule: p.rule, state: "HALTED", periodKey: p.periodKey, threshold, observed: loss, releaseAt: p.releaseAt, latched: false });
    else warnings.push({ kind: "default_would_trigger", rule: p.rule, text: `لو فعّلت الحدود المقترحة كان وقف ${p.label}: خسرت ${loss} والحد ${threshold}.` });
  }

  // Losing streak by close time, counting back from the latest close; break-even is a win.
  const ownStreak = Math.floor(pos(s.max_consecutive_losses));
  const streakThreshold = ownStreak || SURVIVAL_DEFAULTS.streak;
  const streakBinding = ownStreak > 0 || accepted;
  const cooldownHours = pos(s.streak_cooldown_hours) || SURVIVAL_DEFAULTS.cooldownHours;
  const byClose = [...counted].sort((a, b) => b.closeMs - a.closeMs);
  let losses = 0;
  for (const x of byClose) { if (x.pnl < 0) losses++; else break; }
  const last = losses > 0 ? byClose[0]! : null;
  const streak: StreakInfo = { losses, threshold: streakThreshold, binding: streakBinding, cooldownHours, lastLossId: last?.id ?? null, lastLossAt: last?.closed_at ?? null };
  if (!streakBinding) advisory.push("losing_streak_cooldown");
  if (last && losses >= streakThreshold) {
    const until = last.closeMs + cooldownHours * 3_600_000;
    if (until > t) {
      if (streakBinding) triggers.push({ rule: "losing_streak_cooldown", state: "COOLDOWN", periodKey: last.id, threshold: streakThreshold, observed: losses, releaseAt: new Date(until), latched: false });
      else warnings.push({ kind: "default_would_trigger", rule: "losing_streak_cooldown", text: `لو فعّلت الحدود المقترحة كان وقفك ${cooldownHours} ساعة بعد ${lossesWord(losses)} ورا بعض.` });
    }
  }

  if (s.trading_paused) {
    const until = ms(input.pausedUntil);
    // Paused with no end, or an end that can't be read: an explicit «لين أرجّعه».
    if (until == null) triggers.push({ rule: "manual_pause", state: "HALTED", periodKey: dayKey(now, tz), threshold: null, observed: null, releaseAt: null, latched: false, indefinite: true });
    else if (until > t) triggers.push({ rule: "manual_pause", state: "HALTED", periodKey: dayKey(now, tz), threshold: null, observed: null, releaseAt: new Date(until), latched: false });
  }
  const cooldownUntil = ms(s.cooldown_until);
  if (cooldownUntil != null && cooldownUntil > t)
    triggers.push({ rule: "manual_cooldown", state: "COOLDOWN", periodKey: new Date(cooldownUntil).toISOString(), threshold: null, observed: null, releaseAt: new Date(cooldownUntil), latched: false });

  if (partial)
    triggers.push({ rule: "incomplete_data", state: "HALTED", periodKey: dayKey(now, tz), threshold: null, observed: issues.filter((i) => i.blocking).length, releaseAt: null, latched: false });

  for (const row of input.latched ?? []) {
    if (row.released_at || !(BREAKER_RULES as readonly string[]).includes(row.rule)) continue;
    if (row.state !== "COOLDOWN" && row.state !== "HALTED") continue;
    const until = ms(row.active_until);
    if (row.active_until && !(until != null && until > t)) continue;
    const rule = row.rule as BreakerRule;
    const releaseAt = until == null ? null : new Date(until);
    const same = triggers.find((x) => x.rule === rule && x.periodKey === row.period_key);
    if (same) {
      same.latched = true;
      if (STATE_RANK[row.state] > STATE_RANK[same.state]) same.state = row.state;
      same.releaseAt = same.releaseAt && releaseAt ? new Date(Math.max(same.releaseAt.getTime(), until!)) : null;
    } else {
      triggers.push({ rule, state: row.state, periodKey: row.period_key, threshold: row.threshold, observed: row.observed, releaseAt, latched: true });
    }
  }

  triggers.sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || BREAKER_RULES.indexOf(a.rule) - BREAKER_RULES.indexOf(b.rule));
  const state: BreakerState = triggers[0]?.state ?? "TRADING_ALLOWED";
  const releaseAt = !triggers.length || triggers.some((x) => !x.releaseAt)
    ? null
    : new Date(Math.max(...triggers.map((x) => x.releaseAt!.getTime())));

  if (advisory.length)
    warnings.unshift({ kind: "limits_not_active", rules: advisory, text: `حدودك غير مفعّلة (${advisory.map((r) => RULE_LABEL[r]).join("، ")}): تنبهك بس وما توقفك لين تفعّلها.` });
  const old = issues.filter((i) => !i.blocking).length;
  if (old) warnings.push({ kind: "old_data", count: old, text: `في ${old} ${old === 1 ? "مشكلة" : "مشاكل"} بيانات قبل تشغيل القاطع: تنبيه بس، صلّحها من التدقيق.` });

  return { state, partial, preview, triggers, releaseAt, warnings, issues, pnl, limits, streak, anchor, tz };
}

export const RULE_LABEL: Record<BreakerRule, string> = {
  max_daily_loss: "حد الخسارة اليومي",
  weekly_drawdown_halt: "حد الخسارة الأسبوعي",
  monthly_drawdown_halt: "حد الخسارة الشهري",
  losing_streak_cooldown: "الخسارات المتتالية",
  manual_pause: "إيقاف يدوي",
  manual_cooldown: "تهدئة يدوية",
  incomplete_data: "بيانات ناقصة",
};

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const pad = (n: number) => String(n).padStart(2, "0");

/** «الاثنين 19/10 00:00» on the trader's clock: weekday, date and time, the same on every device. */
export function releaseLabel(at: Date, tz: string | null | undefined): string {
  const k = dayKey(at, tz);
  const w = wallClock(at, tz);
  return `${WEEKDAYS[new Date(`${k}T12:00:00Z`).getUTCDay()]} ${w.day}/${w.month} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** «120$» in copy and prompts (the gate's lines use it too, so the money reads the same). */
export const money = (n: number, currency: string) => (currency === "USD" ? `${r2(n)}$` : `${r2(n)} ${currency}`);

const STOP_LABEL: Record<LossRule, string> = {
  max_daily_loss: "إيقاف اليوم",
  weekly_drawdown_halt: "إيقاف الأسبوع",
  monthly_drawdown_halt: "إيقاف الشهر",
};

/** «باقي لك 120$ (1.2%) قبل إيقاف اليوم» for one binding loss limit. */
export function limitRoom(l: LossLimit, anchor: number, currency = "USD"): string {
  const pct = anchor > 0 ? ` (${r2((l.remaining / anchor) * 100)}%)` : "";
  return `باقي لك ${money(l.remaining, currency)}${pct} قبل ${STOP_LABEL[l.rule]}`;
}

function triggerReason(x: BreakerTrigger, currency: string): string {
  const m = (n: number | null) => money(n ?? 0, currency);
  switch (x.rule) {
    case "max_daily_loss": return `خسارة اليوم ${m(x.observed)} وصلت حدّك ${m(x.threshold)}. وقف لليوم، السوق باقي.`;
    case "weekly_drawdown_halt": return `خسارة الأسبوع ${m(x.observed)} وصلت حدّك الأسبوعي ${m(x.threshold)}.`;
    case "monthly_drawdown_halt": return `خسارة الشهر ${m(x.observed)} وصلت حدّك الشهري ${m(x.threshold)}.`;
    case "losing_streak_cooldown": return `${(x.observed ?? 0) > 1 ? `${lossesWord(x.observed!)} ورا بعض` : "خسرت آخر صفقة"}. خذ استراحة، لا تدخل صفقة تعويض.`;
    case "manual_pause": return x.indefinite ? "أوقفت التداول لين ترجّعه بنفسك." : "أوقفت التداول بنفسك.";
    case "manual_cooldown": return "أنت طلبت تهدئة. لا تدخل صفقة لين تخلص.";
    case "incomplete_data": return `في ${x.observed} ${x.observed === 1 ? "صفقة بياناتها ناقصة" : "صفقات بياناتها ناقصة"} بعد تشغيل القاطع. صلّحها وبيرجع الحساب.`;
  }
}

export type BreakerCopy = { chip: string; tone: "success" | "warning" | "destructive"; reason: string; release: string | null };

/** One chip, one reason line and one release line for the Today card, the sheet and the journey. */
export function breakerCopy(r: BreakerResult, currency = "USD"): BreakerCopy {
  const top = r.triggers[0];
  if (!top) {
    const binding = r.limits.filter((l) => l.binding).sort((a, b) => a.remaining - b.remaining)[0];
    const notActive = r.warnings.find((w) => w.kind === "limits_not_active");
    return {
      chip: "التداول مسموح",
      tone: notActive ? "warning" : "success",
      reason: notActive?.text ?? (binding ? limitRoom(binding, r.anchor, currency) : "ما في حد خسارة مفعّل."),
      release: null,
    };
  }
  const release = r.releaseAt
    ? `يرجع التداول ${releaseLabel(r.releaseAt, r.tz)}`
    : r.partial ? "لين تصلّح البيانات" : r.triggers.some((x) => x.indefinite) ? "لين ترجّعه بنفسك" : null;
  if (r.partial) return { chip: "بيانات ناقصة", tone: "destructive", reason: triggerReason(r.triggers.find((x) => x.rule === "incomplete_data")!, currency), release };
  return {
    chip: r.state === "HALTED" ? "التداول موقوف" : "تهدئة",
    tone: r.state === "HALTED" ? "destructive" : "warning",
    reason: triggerReason(top, currency),
    release,
  };
}

const STATE_AR: Record<BreakerState, string> = { TRADING_ALLOWED: "التداول مسموح", COOLDOWN: "تهدئة", HALTED: "موقوف" };

/** The breaker's facts for the AI: state, why, until when, and the room left before each limit. */
export function breakerForPrompt(r: BreakerResult, currency = "USD"): string {
  const lines = [
    `قاطع الحماية: ${STATE_AR[r.state]}${r.partial ? " (بيانات ناقصة)" : ""}${r.preview ? " — معاينة: القاطع مو مفعّل بعد، ينبّه بس" : ""}.`,
  ];
  for (const x of r.triggers)
    lines.push(`- ${RULE_LABEL[x.rule]}: ${triggerReason(x, currency)}${x.releaseAt ? ` يرجع ${releaseLabel(x.releaseAt, r.tz)}.` : ""}`);
  if (r.triggers.length) lines.push(r.releaseAt ? `يرجع التداول: ${releaseLabel(r.releaseAt, r.tz)}.` : "يرجع التداول: ما في وقت محدد.");
  const room = r.limits.filter((l) => l.binding).map((l) => limitRoom(l, r.anchor, currency));
  if (room.length) lines.push(`الحدود: ${room.join(" | ")}.`);
  lines.push(`ربح/خسارة محققة: اليوم ${money(r.pnl.day, currency)}، الأسبوع ${money(r.pnl.week, currency)}، الشهر ${money(r.pnl.month, currency)}. خسارات متتالية: ${r.streak.losses} من ${r.streak.threshold}.`);
  for (const w of r.warnings) lines.push(`تنبيه: ${w.text}`);
  return lines.join("\n");
}
