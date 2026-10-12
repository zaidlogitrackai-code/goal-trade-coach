/** Matching a trade the AI read (e.g. from an MT5 screenshot) against trades already saved. */
export type DedupeRow = {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number | null;
  status: string;
  opened_at: string;
};
export type DedupeCandidate = {
  symbol: string;
  direction: string;
  entry_price?: number | null | undefined;
  opened_at?: string | null | undefined;
};

/** Same symbol + direction + entry price (within 0.01%), and opened within 24h when a time is known. */
export function findDuplicate(rows: DedupeRow[], c: DedupeCandidate): DedupeRow | null {
  if (c.entry_price == null || !Number.isFinite(c.entry_price)) return null;
  const sym = c.symbol.trim().toUpperCase();
  for (const r of rows) {
    if (r.symbol.trim().toUpperCase() !== sym || r.direction !== c.direction) continue;
    if (r.entry_price == null) continue;
    const tol = Math.max(Math.abs(c.entry_price) * 0.0001, 1e-9);
    if (Math.abs(Number(r.entry_price) - c.entry_price) > tol) continue;
    if (c.opened_at) {
      const a = new Date(c.opened_at).getTime();
      const b = new Date(r.opened_at).getTime();
      if (Number.isFinite(a) && Math.abs(a - b) > 24 * 3600_000) continue;
    }
    return r;
  }
  return null;
}
