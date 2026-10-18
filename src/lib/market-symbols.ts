export type MarketSymbol = { key: string; label: string; yahoo: string; tv: string; aliases: string[]; digits: number };

// Arabic aliases are bare stems: the article and attached prefixes (ال، ب، بال، و…) are matched in detectSymbols.
// No bare 'ين' for the yen: it sits inside وين/الحين/بين/لين and pulled USDJPY into gold analyses.
export const MARKET_SYMBOLS: MarketSymbol[] = [
  { key: "XAUUSD", tv: "OANDA:XAUUSD", label: "ذهب", yahoo: "GC=F", aliases: ["XAUUSD", "GOLD", "GOLD SPOT", "ذهب"], digits: 2 },
  { key: "XAGUSD", tv: "TVC:SILVER", label: "فضة", yahoo: "SI=F", aliases: ["XAGUSD", "SILVER", "فضة"], digits: 3 },
  { key: "US500", tv: "SP:SPX", label: "S&P 500", yahoo: "^GSPC", aliases: ["US500", "SPX", "SP500", "S&P"], digits: 1 },
  { key: "US100", tv: "NASDAQ:NDX", label: "ناسداك", yahoo: "^NDX", aliases: ["US100", "NAS100", "NASDAQ", "ناسداك", "نازداك"], digits: 1 },
  { key: "US30", tv: "OANDA:US30USD", label: "داو", yahoo: "^DJI", aliases: ["US30USD", "US30", "DOW", "داو"], digits: 1 },
  { key: "USOIL", tv: "NYMEX:CL1!", label: "نفط", yahoo: "CL=F", aliases: ["USOIL", "WTI", "OIL", "نفط"], digits: 3 },
  { key: "EURUSD", tv: "OANDA:EURUSD", label: "EURUSD", yahoo: "EURUSD=X", aliases: ["EURUSD", "يورو"], digits: 5 },
  { key: "GBPUSD", tv: "OANDA:GBPUSD", label: "GBPUSD", yahoo: "GBPUSD=X", aliases: ["GBPUSD", "باوند", "استرليني"], digits: 5 },
  { key: "USDJPY", tv: "OANDA:USDJPY", label: "USDJPY", yahoo: "JPY=X", aliases: ["USDJPY", "USJPY", "دولار ين", "ين ياباني"], digits: 3 },
];

/** Diacritics and tatweel dropped, alef/taa marbuta/alef maqsura unified — how the phone actually types. */
const normAr = (s: string) =>
  s
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");

const AR_LETTER = "\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FC";
// و/ف, then ب/ل/ك, then the article: بالذهب، والذهب، للذهب، فالنفط.
const AR_PREFIX = "(?:[وف]?(?:بال|كال|لل|ال|ب|ل|ك)?)";

/** A whole Arabic word (or phrase) on Arabic-letter boundaries; only the first word takes و/ب prefixes. */
function arabicMatcher(alias: string): RegExp {
  const [first = "", ...rest] = normAr(alias).split(/\s+/);
  const words = [`${AR_PREFIX}${first}`, ...rest.map((w) => `(?:ال)?${w}`)];
  return new RegExp(`(^|[^${AR_LETTER}])${words.join("[\\s/-]+")}(?![${AR_LETTER}])`);
}

function latinMatcher(alias: string): RegExp {
  return new RegExp(`(^|[^A-Z])${alias.replace(/[&]/g, "\\&")}(?=[^A-Z]|$)`);
}

const MATCHERS = MARKET_SYMBOLS.map((s) => ({
  s,
  res: s.aliases.map((a) => (/^[A-Z0-9& ]+$/.test(a.toUpperCase()) ? latinMatcher(a.toUpperCase()) : arabicMatcher(a))),
}));

/** Finds every one of the nine symbols mentioned in free text, in the order mentioned. */
export function detectSymbols(text: string): MarketSymbol[] {
  const up = normAr(text).toUpperCase();
  const pos = (res: RegExp[]) => {
    let best = -1;
    for (const re of res) {
      const m = re.exec(up);
      const i = m ? m.index + m[1]!.length : -1;
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  };
  return MATCHERS.map(({ s, res }) => ({ s, i: pos(res) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}
