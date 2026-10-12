/**
 * Pure paper-trading self-test for the analyst: virtual scalp trades, never real ones.
 * Results are in R (1R = distance from entry to stop).
 */
export type PaperTrade = {
  id: number;
  symbol: string;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  openedAt: number;
  reason: string;
  closedAt?: number;
  exit?: number;
  outcome?: "tp" | "sl" | "time";
  r?: number;
};

export const TEST_MS = 10 * 60_000;

export function rMultiple(t: PaperTrade, price: number): number {
  const risk = Math.abs(t.entry - t.stop) || 1;
  const move = t.direction === "long" ? price - t.entry : t.entry - price;
  return Math.round((move / risk) * 100) / 100;
}

/** Closes the trade if price hit the stop or target, or if forced at the end of the test. */
export function stepTrade(t: PaperTrade, price: number, now: number, forceClose = false): PaperTrade {
  if (t.outcome) return t;
  const long = t.direction === "long";
  const hitSl = long ? price <= t.stop : price >= t.stop;
  const hitTp = long ? price >= t.target : price <= t.target;
  if (hitSl) return { ...t, closedAt: now, exit: t.stop, outcome: "sl", r: rMultiple(t, t.stop) };
  if (hitTp) return { ...t, closedAt: now, exit: t.target, outcome: "tp", r: rMultiple(t, t.target) };
  if (forceClose) return { ...t, closedAt: now, exit: price, outcome: "time", r: rMultiple(t, price) };
  return t;
}

/** Valid scalp: stop and target on the correct sides of the entry. */
export function validScalp(direction: "long" | "short", entry: number, stop: number, target: number): boolean {
  if (![entry, stop, target].every((n) => Number.isFinite(n) && n > 0)) return false;
  return direction === "long" ? stop < entry && target > entry : stop > entry && target < entry;
}

export function summarizeTest(trades: PaperTrade[]) {
  const closed = trades.filter((t) => t.outcome);
  const wins = closed.filter((t) => (t.r ?? 0) > 0).length;
  const totalR = Math.round(closed.reduce((a, t) => a + (t.r ?? 0), 0) * 100) / 100;
  return { count: closed.length, wins, losses: closed.length - wins, winRate: closed.length ? Math.round((wins / closed.length) * 100) : 0, totalR };
}
