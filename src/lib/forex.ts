/**
 * The system is Forex only: currency pairs plus gold (XAUUSD) and silver (XAGUSD).
 * Crypto, stocks, indices and oil are rejected everywhere a symbol is entered.
 */
export const FOREX_ONLY_MSG = "النظام للفوركس فقط: أزواج العملات والذهب والفضة.";

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
};

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
  if (letters.length < 6 || letters.length > 10) return null;
  const base = letters.slice(0, 3);
  const quote = letters.slice(3, 6);
  if (base === quote || !CURRENCIES.has(quote)) return null;
  if (!CURRENCIES.has(base) && !METALS.has(base)) return null;
  return base + quote;
}

export const isForex = (s: string | null | undefined) => forexSymbol(s) !== null;
