import type { Candle } from "./indicators";
import { summarize } from "./indicators";
import type { MarketSymbol } from "./market-symbols";

const cache = new Map<string, { at: number; v: unknown }>();
const TTL_PRICE = 3_000; // الأسعار: طلب حي كل مرة (الرد يتأخر ~250ms فقط)
const TTL_CANDLES = 30_000;
// A slow feed must not hold the analyst's reply: give up and say the number is unavailable.
const TIMEOUT = 4_000;

const TFS = ["15", "60", "240"] as const;
const COLS = ["close", "change", "high", "low", ...TFS.flatMap((t) => [`EMA20|${t}`, `EMA50|${t}`, `ATR|${t}`, `RSI|${t}`]), "Pivot.M.Classic.S2|240", "Pivot.M.Classic.S1|240", "Pivot.M.Classic.Middle|240", "Pivot.M.Classic.R1|240", "Pivot.M.Classic.R2|240"];

/** Live snapshot from TradingView's public scanner (same feed as the chart). */
async function tvSnapshot(tickers: string[]) {
  const key = tickers.join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_PRICE) return hit.v as Map<string, (number | null)[]>;
  const res = await fetch("https://scanner.tradingview.com/global/scan", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify({ symbols: { tickers }, columns: COLS }), signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`tradingview ${res.status}`);
  const j = (await res.json()) as { data?: { s: string; d: (number | null)[] }[] };
  const m = new Map((j.data ?? []).map((r) => [r.s, r.d]));
  cache.set(key, { at: Date.now(), v: m });
  return m;
}

async function chart(yahoo: string, interval: string, range: string) {
  const key = `${yahoo}|${interval}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_CANDLES) return hit.v as { meta: Record<string, number>; candles: Candle[] };
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`price source ${res.status}`);
  const j = (await res.json()) as any;
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error("no data");
  const q = r.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = (r.timestamp ?? []).map((t: number, i: number) => ({ t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] ?? 0 })).filter((x: Candle) => x.c != null && x.h != null && x.l != null && x.o != null);
  const v = { meta: r.meta, candles };
  cache.set(key, { at: Date.now(), v });
  return v;
}

const shift = (c: Candle[], d: number) => c.map((x) => ({ ...x, o: x.o + d, h: x.h + d, l: x.l + d, c: x.c + d }));

function to4h(candles: Candle[]) {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += 4) {
    const g = candles.slice(i, i + 4);
    if (!g.length) continue;
    out.push({ t: g[0]!.t, o: g[0]!.o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1]!.c, v: g.reduce((a, x) => a + x.v, 0) });
  }
  return out;
}

/** Short text block of live market data for the analyst prompt. */
export async function marketContext(syms: MarketSymbol[]): Promise<string> {
  const list = syms.slice(0, 3);
  let snap = new Map<string, (number | null)[]>();
  try { snap = await tvSnapshot(list.map((s) => s.tv)); } catch { /* fall back below */ }
  const parts = await Promise.all(list.map(async (s) => {
    const d = snap.get(s.tv);
    const f = (n: number | null | undefined) => (n == null ? "غير متاح" : n.toFixed(s.digits));
    let head = "";
    let price: number | null = null;
    if (d && d[0] != null) {
      price = d[0];
      const ind = TFS.map((t, i) => `${t === "240" ? "4H" : t === "60" ? "1H" : "15M"}: EMA20=${f(d[4 + i * 4])} EMA50=${f(d[5 + i * 4])} ATR=${f(d[6 + i * 4])} RSI=${d[7 + i * 4] == null ? "غير متاح" : (d[7 + i * 4] as number).toFixed(0)}`).join(" | ");
      head = `### ${s.key} (${s.label}) — السعر الآن ${f(price)} من TradingView (${s.tv}) | تغير اليوم ${d[1] == null ? "غير متاح" : (d[1] as number).toFixed(2)}% | قمة اليوم ${f(d[2])} قاع اليوم ${f(d[3])}\n${ind}\nPivot شهري: S2=${f(d[16])} S1=${f(d[17])} P=${f(d[18])} R1=${f(d[19])} R2=${f(d[20])}`;
    }
    try {
      const [m15, h1, h1long] = await Promise.all([chart(s.yahoo, "15m", "5d"), chart(s.yahoo, "60m", "1mo"), chart(s.yahoo, "60m", "60d")]);
      const off = price != null ? price - m15.meta.regularMarketPrice : 0;
      if (!head) head = `### ${s.key} (${s.label}) — السعر الآن ${f(m15.meta.regularMarketPrice)} (تقريبي ومتأخر، TradingView ما رد — قل لهادي إن السعر مو حي)`;
      return `${head}\nهيكل الشموع (مُعدّل على سعر TradingView):\n4H: ${summarize(shift(to4h(h1long.candles), off), s.digits)}\n1H: ${summarize(shift(h1.candles, off), s.digits)}\n15M: ${summarize(shift(m15.candles, off), s.digits)}`;
    } catch { return head || `### ${s.key}: ما قدرت أجيب السعر الحي الآن.`; }
  }));
  return `\n\n## بيانات السوق الحية (وقت ${new Date().toISOString()})\n${parts.join("\n\n")}\nاعتمد سعر TradingView والمؤشرات أعلاه أساسًا للدخول وTP1/TP2/SL حتى بدون صورة. لا تذكر مصدر البيانات إلا لو سألك. لو البيانات غير متوفرة اطلب صورة الشارت.`;
}

/** Draws the 4H/1H/15M charts the analyst looks at (prices shifted onto TradingView's). */
export async function chartImages(s: MarketSymbol): Promise<{ images: string[]; legend: string; thumb: string } | null> {
  try {
    const { rasterize, rasterToPng, chartSvg } = await import("./chart-render");
    let price: number | null = null;
    try { price = (await tvSnapshot([s.tv])).get(s.tv)?.[0] ?? null; } catch { /* use Yahoo price */ }
    const [m15, h1, h1long] = await Promise.all([chart(s.yahoo, "15m", "5d"), chart(s.yahoo, "60m", "1mo"), chart(s.yahoo, "60m", "60d")]);
    const off = price != null ? price - m15.meta.regularMarketPrice : 0;
    const sets: [string, Candle[]][] = [["4H", shift(to4h(h1long.candles), off)], ["1H", shift(h1.candles, off)], ["15M", shift(m15.candles, off)]];
    const images: string[] = [];
    const lines: string[] = [];
    for (const [tf, c] of sets) {
      if (c.length < 5) continue;
      const r = rasterize(c);
      images.push(await rasterToPng(r));
      lines.push(`صورة ${images.length} = ${s.key} فريم ${tf}: أعلى الصورة ${r.hi.toFixed(s.digits)} وأسفلها ${r.lo.toFixed(s.digits)}، الخطوط الأفقية المنقطة من فوق لتحت: ${r.grid.map((g) => g.toFixed(s.digits)).join("، ")}. الخط الأبيض = السعر الحالي. أخضر صاعدة، أحمر هابطة.`);
    }
    if (!images.length) return null;
    return { images, legend: lines.join("\n"), thumb: chartSvg(sets[1]![1], `${s.key} 1H`, s.digits) };
  } catch { return null; }
}

/** Live price only (TradingView, Yahoo fallback). */
export async function livePrice(s: MarketSymbol): Promise<number | null> {
  try { const p = (await tvSnapshot([s.tv])).get(s.tv)?.[0]; if (p != null) return p; } catch { /* fallback */ }
  try { return (await chart(s.yahoo, "1m", "1d")).meta.regularMarketPrice ?? null; } catch { return null; }
}
