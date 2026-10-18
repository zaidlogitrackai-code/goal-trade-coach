import type { Trade, Violation } from "./queries";
import { inRevengeWindow, isGreed, REVENGE_WINDOW_MIN } from "./emotions";

export function tradeStats(trades: Trade[]) {
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (Number(t.pnl) || 0) > 0);
  const losses = closed.filter((t) => (Number(t.pnl) || 0) < 0);
  const sum = (a: Trade[]) => a.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const grossWin = sum(wins), grossLoss = Math.abs(sum(losses));
  return {
    total: trades.length,
    closed: closed.length,
    open: trades.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    netPnl: sum(closed),
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    best: closed.reduce((m, t) => Math.max(m, Number(t.pnl) || 0), 0),
    worst: closed.reduce((m, t) => Math.min(m, Number(t.pnl) || 0), 0),
  };
}

export function groupPnl(trades: Trade[], key: (t: Trade) => string) {
  const map = new Map<string, { name: string; pnl: number; count: number; wins: number }>();
  for (const t of trades.filter((x) => x.status === "closed")) {
    const k = key(t);
    const g = map.get(k) ?? { name: k, pnl: 0, count: 0, wins: 0 };
    g.pnl += Number(t.pnl) || 0; g.count++; if ((Number(t.pnl) || 0) > 0) g.wins++;
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl);
}

export function equityCurve(trades: Trade[], start: number) {
  let bal = start;
  return trades
    .filter((t) => t.status === "closed")
    .sort((a, b) => +new Date(a.closed_at ?? a.opened_at) - +new Date(b.closed_at ?? b.opened_at))
    .map((t, i) => { bal += Number(t.pnl) || 0; return { n: i + 1, balance: Math.round(bal * 100) / 100 }; });
}

/** Discipline 0-100 and greed signals, derived only from the user's own data. */
export function disciplineReport(trades: Trade[], violations: Violation[], maxRisk: number, revengeWindowMin = REVENGE_WINDOW_MIN()) {
  const signals: string[] = [];
  if (trades.length === 0) return { score: null as number | null, signals, checklistRate: 0, overRisk: 0, revenge: 0, revengeWindowMin, greedy: 0 };
  const checklistRate = (trades.filter((t) => t.checklist_passed).length / trades.length) * 100;
  const overRisk = maxRisk > 0 ? trades.filter((t) => Number(t.risk_amount) > maxRisk).length : 0;
  const sorted = [...trades].sort((a, b) => +new Date(a.opened_at) - +new Date(b.opened_at));
  let revenge = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!; const cur = sorted[i]!;
    if (prev.status === "closed" && (Number(prev.pnl) || 0) < 0 && prev.closed_at) {
      const gap = +new Date(cur.opened_at) - +new Date(prev.closed_at);
      if (inRevengeWindow(gap, revengeWindowMin)) revenge++;
    }
  }
  const greedy = trades.filter((t) => isGreed(t.emotion)).length;
  let score = 100;
  score -= (100 - checklistRate) * 0.3;
  score -= Math.min(25, overRisk * 5);
  score -= Math.min(20, revenge * 5);
  score -= Math.min(15, greedy * 3);
  score -= Math.min(20, violations.length * 4);
  if (checklistRate < 80) signals.push(`دخلت ${Math.round(100 - checklistRate)}٪ من صفقاتك بدون إكمال قائمة التحقق.`);
  if (overRisk) signals.push(`${overRisk} صفقة تجاوزت حد المخاطرة للصفقة.`);
  if (revenge) signals.push(`${revenge} صفقة فتحتها خلال ${revengeWindowMin} دقيقة بعد خسارة (تداول انتقامي محتمل).`);
  if (greedy) signals.push(`${greedy} صفقة سجّلت فيها مشاعر طمع أو انتقام أو خوف من الفوات.`);
  if (violations.length) signals.push(`${violations.length} مخالفة مسجلة لقواعدك.`);
  return { score: Math.max(0, Math.round(score)), signals, checklistRate, overRisk, revenge, revengeWindowMin, greedy };
}
