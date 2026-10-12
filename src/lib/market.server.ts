import type { Candle } from "./indicators";
import { summarize } from "./indicators";
import { MARKET_SYMBOLS, type MarketSymbol } from "./market-symbols";

const cache = new Map<string, { at: number; v: unknown }>();
const TTL = 30_000;

async function chart(yahoo: string, interval: string, range: string) {
  const key = `${yahoo}|${interval}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v as { meta: Record<string, number>; candles: Candle[] };
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
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

export async function quotes() {
  return Promise.all(MARKET_SYMBOLS.map(async (s) => {
    try {
      const { meta } = await chart(s.yahoo, "1d", "5d");
      const price = meta.regularMarketPrice, prev = meta.chartPreviousClose ?? meta.previousClose;
      return { key: s.key, label: s.label, digits: s.digits, price, changePct: prev ? ((price - prev) / prev) * 100 : null, time: meta.regularMarketTime * 1000 };
    } catch { return { key: s.key, label: s.label, digits: s.digits, price: null, changePct: null, time: null }; }
  }));
}

async function hourly4(yahoo: string) {
  const { candles } = await chart(yahoo, "60m", "60d");
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += 4) {
    const g = candles.slice(i, i + 4);
    out.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1].c, v: g.reduce((a, x) => a + x.v, 0) });
  }
  return out;
}

/** Short text block of live market data for the analyst prompt. */
export async function marketContext(syms: MarketSymbol[]): Promise<string> {
  const parts = await Promise.all(syms.slice(0, 3).map(async (s) => {
    try {
      const [m15, h1, h4] = await Promise.all([chart(s.yahoo, "15m", "5d"), chart(s.yahoo, "60m", "1mo"), hourly4(s.yahoo)]);
      const t = new Date(m15.meta.regularMarketTime * 1000).toISOString();
      return `### ${s.key} (${s.label}) — السعر الآن ${m15.meta.regularMarketPrice} (وقت ${t})\n4H: ${summarize(h4, s.digits)}\n1H: ${summarize(h1.candles, s.digits)}\n15M: ${summarize(m15.candles, s.digits)}`;
    } catch { return `### ${s.key}: ما قدرت أجيب السعر الحي الآن.`; }
  }));
  return `\n\n## بيانات السوق الحية (مصدر مجاني Yahoo، قد تتأخر دقائق وتختلف قليلًا عن سعر MT5 خاصة الذهب/الفضة/النفط لأنها عقود آجلة)\n${parts.join("\n\n")}\nاستخدم هذه الأرقام أساسًا للدخول وTP1/TP2/SL حتى بدون صورة. اذكر باختصار أن السعر من بيانات حية وأن هادي يتأكد من سعر MT5 قبل الدخول. لو البيانات غير متوفرة اطلب صورة الشارت.`;
}
