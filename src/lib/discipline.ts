/**
 * The one discipline & greed report. Pure: derived only from the user's own
 * trades and violations, so the discipline page, reports and AI context share
 * one score, one set of reasons and one "right after a loss".
 */
import { countConsecutiveLosses } from "./trading-status";
import { dayKey, dayStart } from "./trading-day";
import { inRevengeWindow, isGreed, REVENGE_MARKER, REVENGE_WINDOW_MIN } from "./emotions";

export interface DisciplineTrade {
  status: string;
  pnl: number | null;
  risk_amount: number;
  stop_loss: number | null;
  checklist_passed: boolean;
  emotion: string | null;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
}
export interface DisciplineViolation {
  occurred_at: string;
  trade_id: string | null;
}

// A sharper signal inside the revenge window: straight back in after the loss.
const QUICK_MS = 5 * 60_000;
export const WINDOW_DAYS = 30;

/** The trader's own cooldown length, 30 minutes when he never set one. */
export const cooldownMinutes = (s?: { cooldown_minutes?: number | null } | null) => {
  const m = Math.round(Number(s?.cooldown_minutes));
  return Number.isFinite(m) && m > 0 ? m : 30;
};
// A stop of 0 is what a chat-logged trade carries for "no stop".
const hasStop = (t: DisciplineTrade) => t.stop_loss != null && Number(t.stop_loss) > 0;

export interface EmotionRow {
  emotion: string;
  count: number;
  closed: number;
  wins: number;
  winRate: number | null;
  pnl: number;
}

export interface Intervention {
  kind: "cooldown" | "review" | "overtrading";
  message: string;
  /** cooldown only: how long the suggested pause is (the trader's cooldown_minutes). */
  minutes?: number;
}

export interface DisciplineReport {
  sample: number;
  score: number | null;
  /** Concrete sentences explaining the score: concerns first, then strengths. */
  reasons: string[];
  concerns: string[];
  strengths: string[];
  metrics: {
    planAdherenceRate: number | null;
    stopLossSetRate: number | null;
    lossWithinRiskRate: number | null;
    violations: number;
    gateOverrides: number;
    revengeCount: number;
    /** Minutes after a losing close that count as revenge (REVENGE_WINDOW_MIN). */
    revengeWindowMin: number;
    quickReentryCount: number;
    selfDeclaredRevenge: number;
    greedCount: number;
    overRisk: number;
    avgMinutesBetweenTrades: number | null;
    tradesAfterTwoLosses: number;
  };
  emotionVsResult: EmotionRow[];
  interventions: Intervention[];
}

export function disciplineReport(
  allTrades: DisciplineTrade[],
  allViolations: DisciplineViolation[],
  opts: {
    maxRiskPerTrade: number;
    now?: Date;
    tz?: string | null | undefined;
    revengeWindowMin?: number;
    cooldownMinutes?: number;
    /** The reports page's period; the last WINDOW_DAYS days by default. */
    range?: { start: Date; end: Date };
  },
): DisciplineReport {
  const now = opts.now ?? new Date();
  const tz = opts.tz;
  const windowMin = opts.revengeWindowMin ?? REVENGE_WINDOW_MIN();
  const from = opts.range?.start.getTime() ?? now.getTime() - WINDOW_DAYS * 86_400_000;
  const to = opts.range?.end.getTime() ?? Infinity;
  const inRange = (at: string) => {
    const x = new Date(at).getTime();
    return x >= from && x <= to;
  };
  const trades = allTrades.filter((t) => inRange(t.opened_at));
  const violations = allViolations.filter((v) => inRange(v.occurred_at));
  const interventions = todayInterventions(allTrades, allViolations, now, tz, opts.cooldownMinutes);

  const n = trades.length;
  const empty = {
    planAdherenceRate: null,
    stopLossSetRate: null,
    lossWithinRiskRate: null,
    violations: violations.length,
    gateOverrides: violations.filter((v) => v.trade_id).length,
    revengeCount: 0,
    revengeWindowMin: windowMin,
    quickReentryCount: 0,
    selfDeclaredRevenge: 0,
    greedCount: 0,
    overRisk: 0,
    avgMinutesBetweenTrades: null,
    tradesAfterTwoLosses: 0,
  };
  if (n === 0)
    return {
      sample: 0,
      score: null,
      reasons: [],
      concerns: [],
      strengths: [],
      metrics: empty,
      emotionVsResult: [],
      interventions,
    };

  const checklistOk = trades.filter((t) => t.checklist_passed).length;
  const withStop = trades.filter(hasStop).length;
  const losers = trades.filter(
    (t) => t.status === "closed" && (t.pnl ?? 0) < 0 && (t.risk_amount ?? 0) > 0,
  );
  const lossWithin = losers.filter(
    (t) => Math.abs(t.pnl ?? 0) <= (t.risk_amount ?? 0) * 1.1,
  ).length;
  const overRisk =
    opts.maxRiskPerTrade > 0
      ? trades.filter((t) => (t.risk_amount ?? 0) > opts.maxRiskPerTrade).length
      : 0;
  const greedCount = trades.filter((t) => isGreed(t.emotion)).length;
  const selfDeclaredRevenge = trades.filter((t) => t.notes?.includes(REVENGE_MARKER)).length;

  // Re-entries after a loss, gaps between trades, and trading on after two losses.
  const sorted = [...trades].sort((a, b) => +new Date(a.opened_at) - +new Date(b.opened_at));
  let revengeCount = 0;
  let quickReentryCount = 0;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (dayKey(prev.opened_at, tz) === dayKey(cur.opened_at, tz))
      gaps.push(+new Date(cur.opened_at) - +new Date(prev.opened_at));
    if (prev.status === "closed" && (prev.pnl ?? 0) < 0 && prev.closed_at) {
      const gap = +new Date(cur.opened_at) - +new Date(prev.closed_at);
      if (inRevengeWindow(gap, windowMin)) revengeCount++;
      if (gap >= 0 && gap < QUICK_MS) quickReentryCount++;
    }
  }
  let tradesAfterTwoLosses = 0;
  for (const t of sorted) {
    const opened = +new Date(t.opened_at);
    const sameDayBefore = sorted.filter(
      (x) =>
        x.status === "closed" &&
        x.closed_at &&
        dayKey(x.closed_at, tz) === dayKey(t.opened_at, tz) &&
        +new Date(x.closed_at) <= opened,
    );
    if (countConsecutiveLosses(sameDayBefore) >= 2) tradesAfterTwoLosses++;
  }

  const gateOverrides = violations.filter((v) => v.trade_id).length;
  const planAdherenceRate = (checklistOk / n) * 100;
  const stopLossSetRate = (withStop / n) * 100;

  let score = 100;
  score -= (100 - planAdherenceRate) * 0.25;
  score -= (100 - stopLossSetRate) * 0.15;
  score -= Math.min(20, overRisk * 5);
  score -= Math.min(20, revengeCount * 5);
  score -= Math.min(15, greedCount * 3);
  score -= Math.min(20, violations.length * 4);
  score -= Math.min(10, tradesAfterTwoLosses * 5);

  const neg: string[] = [];
  const pos: string[] = [];
  const of = (a: number, b: number) => `${a} من ${b}`;
  if (quickReentryCount) neg.push(`دخلت ${quickReentryCount} مرة خلال 5 دقائق بعد خسارة.`);
  if (revengeCount > quickReentryCount)
    neg.push(`فتحت ${revengeCount} صفقة خلال ${windowMin} دقيقة بعد خسارة (تداول انتقامي محتمل).`);
  if (selfDeclaredRevenge) neg.push(`أقررت أن ${selfDeclaredRevenge} صفقة كانت تعويضًا عن خسارة.`);
  if (tradesAfterTwoLosses)
    neg.push(`واصلت التداول ${tradesAfterTwoLosses} مرة بعد خسارتين متتاليتين في نفس اليوم.`);
  if (overRisk) neg.push(`${overRisk} صفقة تجاوزت حد المخاطرة لكل صفقة.`);
  if (violations.length)
    neg.push(
      `${violations.length} مخالفة مسجلة${gateOverrides ? `، منها ${gateOverrides} استثناء من بوابة التداول` : ""}.`,
    );
  if (greedCount) neg.push(`${greedCount} صفقة سجّلت فيها حالة طمع أو انتقام أو خوف من الفوات.`);
  if (withStop < n) neg.push(`${n - withStop} صفقة بدون وقف خسارة.`);
  if (checklistOk < n) neg.push(`${n - checklistOk} صفقة بدون إكمال قائمة التحقق.`);
  if (withStop > 0) pos.push(`حددت وقف الخسارة في ${of(withStop, n)} صفقات.`);
  if (losers.length)
    pos.push(`${of(lossWithin, losers.length)} صفقات خاسرة بقيت خسارتها ضمن المخاطرة المخططة.`);
  if (checklistOk > 0) pos.push(`أكملت قائمة التحقق في ${of(checklistOk, n)} صفقات.`);

  return {
    sample: n,
    score: Math.max(0, Math.round(score)),
    reasons: [...neg, ...pos],
    concerns: neg,
    strengths: pos,
    metrics: {
      planAdherenceRate,
      stopLossSetRate,
      lossWithinRiskRate: losers.length ? (lossWithin / losers.length) * 100 : null,
      violations: violations.length,
      gateOverrides,
      revengeCount,
      revengeWindowMin: windowMin,
      quickReentryCount,
      selfDeclaredRevenge,
      greedCount,
      overRisk,
      avgMinutesBetweenTrades: gaps.length
        ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 60_000)
        : null,
      tradesAfterTwoLosses,
    },
    emotionVsResult: emotionVsResult(trades),
    interventions,
  };
}

/** One-line summary in the brief's format: the strongest positive, then the strongest negative. */
export function scoreSummary(r: DisciplineReport): string | null {
  if (r.score == null) return null;
  const pos = r.strengths[0] ?? null;
  const neg = r.concerns[0] ?? null;
  if (pos && neg) return `${pos.replace(/\.$/, "")}، لكن: ${neg}`;
  return pos ?? neg ?? null;
}

function emotionVsResult(trades: DisciplineTrade[]): EmotionRow[] {
  const map = new Map<string, EmotionRow>();
  for (const t of trades) {
    const key = t.emotion?.trim() || "غير محدد";
    const row = map.get(key) ?? {
      emotion: key,
      count: 0,
      closed: 0,
      wins: 0,
      winRate: null,
      pnl: 0,
    };
    row.count++;
    if (t.status === "closed") {
      row.closed++;
      row.pnl += Number(t.pnl) || 0;
      if ((t.pnl ?? 0) > 0) row.wins++;
    }
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      pnl: Math.round(r.pnl * 100) / 100,
      winRate: r.closed ? (r.wins / r.closed) * 100 : null,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Practical nudges for today only. Never suggests a trade. */
export function todayInterventions(
  trades: DisciplineTrade[],
  violations: DisciplineViolation[],
  now = new Date(),
  tz?: string | null,
  cooldownMin = cooldownMinutes(),
): Intervention[] {
  const start = dayStart(now, tz).getTime();
  const out: Intervention[] = [];
  const closedToday = trades.filter(
    (t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= start,
  );
  // Today's closes only: yesterday's losing run is not a reason to stop now.
  const streak = countConsecutiveLosses(closedToday);
  if (streak >= 2)
    out.push({
      kind: "cooldown",
      message: `${streak} خسائر متتالية اليوم. خذ تهدئة ${cooldownMin} دقيقة قبل أي قرار، ولا تدوّر صفقة تعوّض.`,
      minutes: cooldownMin,
    });
  if (violations.some((v) => v.trade_id && new Date(v.occurred_at).getTime() >= start))
    out.push({
      kind: "review",
      message:
        "سجّلت صفقة مخالفة اليوم. اكتب مراجعة قصيرة لها: ما الذي دفعك، وما الذي ستفعله بشكل مختلف؟",
    });

  const todayCount = trades.filter((t) => new Date(t.opened_at).getTime() >= start).length;
  const pastDays = new Map<string, number>();
  for (const t of trades)
    if (new Date(t.opened_at).getTime() < start)
      pastDays.set(dayKey(t.opened_at, tz), (pastDays.get(dayKey(t.opened_at, tz)) ?? 0) + 1);
  if (pastDays.size >= 3) {
    const avg = [...pastDays.values()].reduce((a, b) => a + b, 0) / pastDays.size;
    if (todayCount >= Math.max(avg * 1.5, avg + 2))
      out.push({
        kind: "overtrading",
        message: `نفذت ${todayCount} صفقات اليوم، ومتوسطك ${Math.round(avg * 10) / 10} في أيام التداول. هل هذا ضمن خطتك؟`,
      });
  }
  return out;
}
