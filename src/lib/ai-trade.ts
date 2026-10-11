export type AiTrade = {
  action: "open" | "close"; symbol: string | null; direction: "long" | "short" | null;
  entry: number | null; sl: number | null; tp: number | null; size: number | null; risk: number | null;
  exit_price: number | null; pnl: number | null; strategy: string | null; emotion: string | null; notes: string | null;
};
export const EMOTIONS = ["هادئ", "واثق", "متوتر", "متحمس", "خائف", "غاضب", "طمع"];
const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? String(x) : "");

/** Map an AI-parsed trade to the new-trade form values (strings). */
export function toForm(t: AiTrade, strategies: { id: string; name: string }[]) {
  const strat = t.strategy ? strategies.find((s) => s.name.trim() === t.strategy!.trim()) : undefined;
  return {
    symbol: (t.symbol ?? "").trim().toUpperCase().replace(/[\s/]/g, ""),
    direction: t.direction === "short" ? "short" : "long",
    strategy_id: strat?.id ?? "",
    entry: n(t.entry), sl: n(t.sl), tp: n(t.tp), size: n(t.size),
    risk: typeof t.risk === "number" && t.risk > 0 ? String(Math.abs(t.risk)) : "",
    emotion: t.emotion && EMOTIONS.includes(t.emotion) ? t.emotion : "",
    notes: (t.notes ?? "").slice(0, 1000),
  };
}

/** Find the open trade a "close" instruction refers to (latest matching symbol). */
export function matchOpen<T extends { symbol: string; status: string; direction: string }>(t: AiTrade, trades: T[]): T | undefined {
  const sym = (t.symbol ?? "").toUpperCase().replace(/[\s/]/g, "");
  return trades.find((x) => x.status === "open" && x.symbol === sym && (!t.direction || x.direction === t.direction));
}
