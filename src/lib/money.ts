/**
 * The one money formatter (re-exported by queries.ts). Intl throws a RangeError on a
 * code it doesn't know — the old settings form saved "USDT" — and one bad code blanked
 * every screen that shows money, so an unknown code falls back to "1,234.5 USDT".
 */
const formats = new Map<string, Intl.NumberFormat | null>();

function format(code: string, whole: boolean): Intl.NumberFormat | null {
  const key = `${code}|${whole ? 0 : 2}`;
  let f = formats.get(key);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : { maximumFractionDigits: 2 }),
      });
    } catch {
      f = null;
    }
    formats.set(key, f);
  }
  return f;
}

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** `trim` drops ".00" on whole amounts, for cards and gauges. */
export function fmtMoney(
  n: number | null | undefined,
  currency: string | null | undefined = "USD",
  opts: { trim?: boolean } = {},
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const code = (currency ?? "").trim().toUpperCase() || "USD";
  // 29.999999 from summed floats is still "$30" on a card.
  const f = format(code, !!opts.trim && Math.round(n * 100) % 100 === 0);
  return f ? f.format(n) : `${plain.format(n)} ${code}`;
}
