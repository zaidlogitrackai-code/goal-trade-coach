/** Money limits stored as % of balance (limits_pct) so they follow the trader's real current balance. Pure. */
export const PCT_FIELDS = [
  "daily_target", "max_daily_profit", "max_daily_loss", "max_risk_per_trade", "max_daily_risk",
  "weekly_target", "weekly_max_loss", "monthly_target", "monthly_max_loss",
] as const;
export type PctField = (typeof PCT_FIELDS)[number];
type Pct = Partial<Record<PctField, number>>;

const r2 = (n: number) => Math.round(n * 100) / 100;

function readPct(v: unknown): Pct {
  if (!v || typeof v !== "object") return {};
  const out: Pct = {};
  for (const k of PCT_FIELDS) { const n = Number((v as Record<string, unknown>)[k]); if (Number.isFinite(n) && n > 0) out[k] = n; }
  return out;
}

/** Replace dollar limits with pct × current balance; adds current_balance. */
export function applyPctLimits<S extends Record<string, unknown>>(s: S, balance: number): S & { current_balance: number } {
  const pct = readPct(s["limits_pct"]);
  const out: Record<string, unknown> = { ...s, current_balance: balance };
  if (balance > 0) for (const k of PCT_FIELDS) if (pct[k] != null) out[k] = r2((pct[k]! / 100) * balance);
  return out as S & { current_balance: number };
}

/** When dollar limits are written, store them also as % of the current balance. */
export function pctFromDollars(patch: Record<string, unknown>, balance: number, prev: unknown): Pct | undefined {
  if (!(balance > 0)) return undefined;
  const pct = readPct(prev);
  let touched = false;
  for (const k of PCT_FIELDS) {
    if (!(k in patch)) continue;
    touched = true;
    const n = Number(patch[k]);
    if (Number.isFinite(n) && n > 0) pct[k] = Math.round((n / balance) * 100 * 10000) / 10000; else delete pct[k];
  }
  return touched ? pct : undefined;
}
