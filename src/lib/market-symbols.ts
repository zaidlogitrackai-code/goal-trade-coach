export type MarketSymbol = { key: string; label: string; yahoo: string; tv: string; aliases: string[]; digits: number };

export const MARKET_SYMBOLS: MarketSymbol[] = [
  { key: "XAUUSD", tv: "OANDA:XAUUSD", label: "ذهب", yahoo: "GC=F", aliases: ["XAUUSD", "GOLD", "GOLD SPOT", "ذهب", "الذهب"], digits: 2 },
  { key: "XAGUSD", tv: "TVC:SILVER", label: "فضة", yahoo: "SI=F", aliases: ["XAGUSD", "SILVER", "فضة", "الفضة"], digits: 3 },
  { key: "US500", tv: "SP:SPX", label: "S&P 500", yahoo: "^GSPC", aliases: ["US500", "SPX", "SP500", "S&P"], digits: 1 },
  { key: "US100", tv: "NASDAQ:NDX", label: "ناسداك", yahoo: "^NDX", aliases: ["US100", "NAS100", "NASDAQ", "ناسداك", "النازداك"], digits: 1 },
  { key: "US30", tv: "OANDA:US30USD", label: "داو", yahoo: "^DJI", aliases: ["US30USD", "US30", "DOW", "داو"], digits: 1 },
  { key: "USOIL", tv: "NYMEX:CL1!", label: "نفط", yahoo: "CL=F", aliases: ["USOIL", "WTI", "OIL", "نفط", "النفط"], digits: 3 },
  { key: "EURUSD", tv: "OANDA:EURUSD", label: "EURUSD", yahoo: "EURUSD=X", aliases: ["EURUSD", "يورو"], digits: 5 },
  { key: "GBPUSD", tv: "OANDA:GBPUSD", label: "GBPUSD", yahoo: "GBPUSD=X", aliases: ["GBPUSD", "باوند", "استرليني"], digits: 5 },
  { key: "USDJPY", tv: "OANDA:USDJPY", label: "USDJPY", yahoo: "JPY=X", aliases: ["USDJPY", "USJPY", "ين"], digits: 3 },
];

/** Finds every one of the nine symbols mentioned in free text, in the order mentioned. */
export function detectSymbols(text: string): MarketSymbol[] {
  const up = text.toUpperCase();
  const pos = (s: MarketSymbol) => {
    let best = -1;
    for (const a of s.aliases) {
      const A = a.toUpperCase();
      let i = -1;
      if (/^[A-Z0-9& ]+$/.test(A)) {
        const m = new RegExp(`(^|[^A-Z])${A.replace(/[&]/g, "\\&")}([^A-Z]|$)`).exec(up);
        if (m) i = m.index + m[1]!.length;
      } else i = up.indexOf(A);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  };
  return MARKET_SYMBOLS.map((s) => ({ s, i: pos(s) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.s);
}
