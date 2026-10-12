export type MarketSymbol = { key: string; label: string; yahoo: string; aliases: string[]; digits: number };

export const MARKET_SYMBOLS: MarketSymbol[] = [
  { key: "XAUUSD", label: "ذهب", yahoo: "GC=F", aliases: ["XAUUSD", "GOLD", "GOLD SPOT", "ذهب", "الذهب"], digits: 2 },
  { key: "XAGUSD", label: "فضة", yahoo: "SI=F", aliases: ["XAGUSD", "SILVER", "فضة", "الفضة"], digits: 3 },
  { key: "US500", label: "S&P 500", yahoo: "^GSPC", aliases: ["US500", "SPX", "SP500", "S&P"], digits: 1 },
  { key: "US100", label: "ناسداك", yahoo: "^NDX", aliases: ["US100", "NAS100", "NASDAQ", "ناسداك", "النازداك"], digits: 1 },
  { key: "US30", label: "داو", yahoo: "^DJI", aliases: ["US30USD", "US30", "DOW", "داو"], digits: 1 },
  { key: "USOIL", label: "نفط", yahoo: "CL=F", aliases: ["USOIL", "WTI", "OIL", "نفط", "النفط"], digits: 3 },
  { key: "EURUSD", label: "EURUSD", yahoo: "EURUSD=X", aliases: ["EURUSD", "يورو"], digits: 5 },
  { key: "GBPUSD", label: "GBPUSD", yahoo: "GBPUSD=X", aliases: ["GBPUSD", "باوند", "استرليني"], digits: 5 },
  { key: "USDJPY", label: "USDJPY", yahoo: "JPY=X", aliases: ["USDJPY", "USJPY", "ين"], digits: 3 },
];

/** Finds every one of the nine symbols mentioned in free text. */
export function detectSymbols(text: string): MarketSymbol[] {
  const up = text.toUpperCase();
  return MARKET_SYMBOLS.filter((s) => s.aliases.some((a) => {
    const A = a.toUpperCase();
    if (/^[A-Z0-9& ]+$/.test(A)) return new RegExp(`(^|[^A-Z])${A.replace(/[&]/g, "\\&")}([^A-Z]|$)`).test(up);
    return up.includes(A);
  }));
}
