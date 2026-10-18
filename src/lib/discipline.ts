/**
 * Discipline & greed report (Phase 6). Pure: derived only from the user's own
 * trades and violations, so the discipline page, reports and AI context can
 * share one calculation.
 */
import { countConsecutiveLosses } from "./trading-status";
import { dayKey, dayStart } from "./trading-day";
import { isGreed, REVENGE_MARKER } from "./emotions";

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

const REVENGE_MS = 15 * 60_000;
const QUICK_MS = 5 * 60_000;
export const WINDOW_DAYS = 30;

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
  opts: { maxRiskPerTrade: number; now?: Date; tz?: string | null },
): DisciplineReport {
  const now = opts.now ?? new Date();
  const tz = opts.tz;
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const trades = allTrades.filter((t) => new Date(t.opened_at).getTime() >= since);
  const violations = allViolations.filter((v) => new Date(v.occurred_at).getTime() >= since);
  const interventions = todayInterventions(allTrades, allViolations, now, tz);

  const n = trades.length;
  const empty = {
    planAdherenceRate: null,
    stopLossSetRate: null,
    lossWithinRiskRate: null,
    violations: violations.length,
    gateOverrides: violations.filter((v) => v.trade_id).length,
    revengeCount: 0,
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
  const withStop = trades.filter((t) => t.stop_loss != null).length;
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
      if (gap >= 0 && gap < REVENGE_MS) revengeCount++;
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
    neg.push(`فتحت ${revengeCount} صفقة خلال 15 دقيقة بعد خسارة (تداول انتقامي محتمل).`);
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
      row.pnl += t.pnl ?? 0;
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
): Intervention[] {
  const start = dayStart(now, tz).getTime();
  const out: Intervention[] = [];
  const closedToday = trades.filter(
    (t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= start,
  );
  const streak = countConsecutiveLosses(closedToday);
  if (streak >= 2)
    out.push({
      kind: "cooldown",
      message: `${streak} خسائر متتالية اليوم. خذ فترة تهدئة قبل أي قرار، ولا تبحث عن صفقة تعوّض.`,
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
