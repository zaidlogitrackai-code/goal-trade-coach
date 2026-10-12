export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return e;
}

export function atr(c: Candle[], period = 14): number | null {
  if (c.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i]!.h - c[i]!.l, Math.abs(c[i]!.h - c[i - 1]!.c), Math.abs(c[i]!.l - c[i - 1]!.c)));
  const s = tr.slice(-period);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

/** Price bucket with the most volume (approximate POC). Null when no volume. */
export function approxPoc(c: Candle[], buckets = 30): number | null {
  const vol = c.reduce((a, x) => a + x.v, 0);
  if (!c.length || vol <= 0) return null;
  const lo = Math.min(...c.map((x) => x.l)), hi = Math.max(...c.map((x) => x.h));
  if (hi <= lo) return lo;
  const step = (hi - lo) / buckets;
  const b = new Array(buckets).fill(0);
  for (const x of c) b[Math.min(buckets - 1, Math.floor(((x.h + x.l + x.c) / 3 - lo) / step))] += x.v;
  const i = b.indexOf(Math.max(...b));
  return lo + step * (i + 0.5);
}

export function summarize(c: Candle[], digits: number) {
  if (!c.length) return null;
  const f = (n: number | null) => (n == null ? "—" : n.toFixed(digits));
  const closes = c.map((x) => x.c);
  const last = c[c.length - 1]!;
  const recent = c.slice(-20);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const trend = e20 != null && e50 != null ? (e20 > e50 && last.c > e20 ? "صاعد" : e20 < e50 && last.c < e20 ? "هابط" : "متذبذب") : "غير واضح";
  return `آخر=${f(last.c)} | قمة آخر20=${f(Math.max(...recent.map((x) => x.h)))} | قاع آخر20=${f(Math.min(...recent.map((x) => x.l)))} | EMA20=${f(e20)} EMA50=${f(e50)} | ATR14=${f(atr(c))} | POC تقريبي=${f(approxPoc(c))} | الاتجاه=${trend} | آخر 5 شموع (o/h/l/c): ${c.slice(-5).map((x) => `${f(x.o)}/${f(x.h)}/${f(x.l)}/${f(x.c)}`).join(" ; ")}`;
}
