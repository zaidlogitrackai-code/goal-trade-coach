import type { Trade } from "./queries";

// Performance helpers only; discipline numbers come from discipline.ts.

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
