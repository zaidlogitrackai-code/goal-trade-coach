/**
 * Supported markets: currency pairs, gold (XAUUSD), silver (XAGUSD), the three
 * US indices (US500, US100, US30) and US oil (USOIL).
 * Crypto and stocks are rejected everywhere a symbol is entered.
 */
export const FOREX_ONLY_MSG =
  "الأصول المدعومة: أزواج العملات، الذهب، الفضة، المؤشرات (US500, US100, US30) والنفط USOIL.";

/** Indices and oil, by broker spelling. */
const INDEX_ALIASES: Record<string, string> = {
  US500: "US500", SPX500: "US500", SPX: "US500", SP500: "US500", US500INDEX: "US500",
  US100: "US100", NAS100: "US100", NDX: "US100", USTEC: "US100", NASDAQ: "US100", NQ100: "US100",
  US30: "US30", US30USD: "US30", DJ30: "US30", DJI: "US30", WS30: "US30", DOW: "US30",
  USOIL: "USOIL", WTI: "USOIL", XTIUSD: "USOIL", USOUSD: "USOIL", CRUDE: "USOIL", OIL: "USOIL",
};

const CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "SGD",
  "HKD",
  "TRY",
  "ZAR",
  "MXN",
  "PLN",
  "CZK",
  "HUF",
  "CNH",
  "SAR",
  "AED",
  "KWD",
  "QAR",
  "BHD",
  "ILS",
  "THB",
  "INR",
]);
const METALS = new Set(["XAU", "XAG"]);

/** Arabic and common names traders type instead of the pair. */
export const FOREX_ALIASES: Record<string, string> = {
  ذهب: "XAUUSD",
  الذهب: "XAUUSD",
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  فضة: "XAGUSD",
  الفضة: "XAGUSD",
  SILVER: "XAGUSD",
  XAG: "XAGUSD",
  يورو: "EURUSD",
  اليورو: "EURUSD",
  باوند: "GBPUSD",
  الباوند: "GBPUSD",
  استرليني: "GBPUSD",
  ين: "USDJPY",
  الين: "USDJPY",
  فرنك: "USDCHF",
  كندي: "USDCAD",
  أسترالي: "AUDUSD",
  نيوزلندي: "NZDUSD",
  النفط: "USOIL",
  نفط: "USOIL",
  الداو: "US30",
  ناسداك: "US100",
};

function indexSymbol(raw: string): string | null {
  const a = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (INDEX_ALIASES[a]) return INDEX_ALIASES[a];
  // broker suffixes such as US500.cash / USOIL.m
  for (let n = 1; n <= 4; n++) {
    const base = a.slice(0, a.length - n);
    if (base.length >= 3 && /[A-Z0-9]$/.test(base) && INDEX_ALIASES[base]) return INDEX_ALIASES[base];
  }
  return null;
}

/**
 * Canonical pair ("eur/usd", "EURUSD.m", "ذهب" -> "EURUSD"/"XAUUSD"), or null
 * when the symbol isn't Forex. Broker suffixes of up to 4 letters are dropped.
 */
export function forexSymbol(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, "");
  const alias = FOREX_ALIASES[raw] ?? FOREX_ALIASES[letters];
  if (alias) return alias;
  const idx = indexSymbol(raw);
  if (idx) return idx;
  if (letters.length < 6 || letters.length > 10) return null;
  const base = letters.slice(0, 3);
  const quote = letters.slice(3, 6);
  if (base === quote || !CURRENCIES.has(quote)) return null;
  if (!CURRENCIES.has(base) && !METALS.has(base)) return null;
  return base + quote;
}

export const isForex = (s: string | null | undefined) => forexSymbol(s) !== null;
