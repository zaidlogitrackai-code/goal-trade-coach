/**
 * Pure checks for a trade idea (entry / stop / targets). The analyst writes the
 * numbers; this file decides whether they are consistent and what they cost.
 */
export type Direction = "long" | "short";

export interface TradeLevels {
  direction: Direction;
  entry: number;
  stop: number;
  targets: number[];
}

export interface LevelsCheck {
  ok: boolean;
  problems: string[];
  /** Reward-to-risk for each target (same order as input). */
  rr: number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkLevels(l: TradeLevels): LevelsCheck {
  const problems: string[] = [];
  const nums = [l.entry, l.stop, ...l.targets];
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) {
    return { ok: false, problems: ["أرقام الدخول/الوقف/الأهداف غير صالحة"], rr: [] };
  }
  const long = l.direction === "long";
  if (l.stop === l.entry) problems.push("الوقف يساوي الدخول");
  else if (long && l.stop > l.entry) problems.push("في الشراء الوقف لازم يكون تحت الدخول");
  else if (!long && l.stop < l.entry) problems.push("في البيع الوقف لازم يكون فوق الدخول");
  l.targets.forEach((t, i) => {
    if (long && t <= l.entry) problems.push(`الهدف ${i + 1} لازم يكون فوق الدخول في الشراء`);
    if (!long && t >= l.entry) problems.push(`الهدف ${i + 1} لازم يكون تحت الدخول في البيع`);
  });
  const risk = Math.abs(l.entry - l.stop);
  const rr = l.targets.map((t) => (risk > 0 ? round2(Math.abs(t - l.entry) / risk) : 0));
  return { ok: problems.length === 0, problems, rr };
}

/** Units of the instrument in one standard lot (USD per 1.00 price move). */
export function contractSize(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s === "XAUUSD") return 100;
  if (s === "XAGUSD") return 5000;
  if (s === "USOIL") return 1000;
  if (s === "US500" || s === "US100" || s === "US30") return 1;
  return 100_000; // currency pairs
}

/**
 * USD risk of a position: price distance × lots × contract size. A pair pays out in its quote
 * currency, so USD-based pairs (USDJPY, USDCHF, USDCAD) are converted exactly at the entry rate;
 * JPY crosses have no USD leg here and keep the entry as an approximation.
 */
export function riskUsd(symbol: string, entry: number, stop: number, lots: number): number {
  const s = symbol.toUpperCase();
  const dist = Math.abs(entry - stop);
  let usd = dist * lots * contractSize(s);
  if ((/^USD[A-Z]{3}$/.test(s) || /^[A-Z]{3}JPY$/.test(s)) && entry > 0) usd /= entry;
  return round2(usd);
}

/** Largest lot size (rounded down to 0.01) that keeps the loss within `maxRiskUsd`. */
export function lotForRisk(symbol: string, entry: number, stop: number, maxRiskUsd: number): number {
  const perLot = riskUsd(symbol, entry, stop, 1);
  if (!(perLot > 0) || !(maxRiskUsd > 0)) return 0;
  return Math.floor((maxRiskUsd / perLot) * 100 + 1e-9) / 100;
}

/**
 * P&L sign the exit price implies: 1 profit, -1 loss, 0 flat, null when unknown.
 * Fees and swap can still flip a near-flat trade, so callers warn on a mismatch, never block.
 */
export function expectedPnlSign(
  direction: string | null | undefined,
  entry: number | null | undefined,
  exit: number | null | undefined,
): -1 | 0 | 1 | null {
  if (entry == null || exit == null || !(entry > 0) || !(exit > 0) || !Number.isFinite(entry + exit)) return null;
  const up = exit > entry ? 1 : exit < entry ? -1 : 0;
  if (direction === "long") return up;
  if (direction === "short") return up === 0 ? 0 : up === 1 ? -1 : 1;
  return null;
}

/** The "risk within limits" check may tick only for a real computed risk under a real limit. */
export function withinRiskLimit(risk: number | null | undefined, limit: number | null | undefined): boolean {
  const l = Number(limit);
  return risk != null && risk > 0 && Number.isFinite(l) && l > 0 && risk <= l;
}
