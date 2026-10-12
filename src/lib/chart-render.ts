// Pure chart drawing from candles: a PNG the vision model can read and a tiny SVG preview.
import type { Candle } from "./indicators";

export type Raster = { w: number; h: number; px: Uint8Array; hi: number; lo: number; grid: number[] };

const PAD = 6;
/** Palette indices: 0 bg, 1 grid, 2 bullish, 3 bearish, 4 last-price line. */
const PALETTE = [10, 10, 10, 60, 60, 60, 16, 185, 129, 239, 68, 68, 230, 230, 230];

/** Price -> pixel row (highest high at the top, lowest low at the bottom). */
export function yOf(p: number, hi: number, lo: number, h: number): number {
  const span = hi - lo || 1;
  return Math.round(PAD + ((hi - p) / span) * (h - 1 - 2 * PAD));
}

export function rasterize(candles: Candle[], w = 720, h = 380, gridLines = 6): Raster {
  const c = candles.slice(-Math.floor(w / 6));
  const hi = Math.max(...c.map((x) => x.h));
  const lo = Math.min(...c.map((x) => x.l));
  const px = new Uint8Array(w * h);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && x < w && y >= 0 && y < h) px[y * w + x] = v; };
  const grid: number[] = [];
  for (let i = 0; i <= gridLines; i++) {
    const p = hi - ((hi - lo) * i) / gridLines;
    grid.push(p);
    const y = yOf(p, hi, lo, h);
    for (let x = 0; x < w; x += 3) set(x, y, 1);
  }
  const step = w / Math.max(c.length, 1);
  const bw = Math.max(1, Math.floor(step * 0.7));
  c.forEach((k, i) => {
    const col = k.c >= k.o ? 2 : 3;
    const x0 = Math.floor(i * step);
    const mid = x0 + Math.floor(bw / 2);
    for (let y = yOf(k.h, hi, lo, h); y <= yOf(k.l, hi, lo, h); y++) set(mid, y, col);
    const top = yOf(Math.max(k.o, k.c), hi, lo, h), bot = yOf(Math.min(k.o, k.c), hi, lo, h);
    for (let y = top; y <= bot; y++) for (let x = x0; x < x0 + bw; x++) set(x, y, col);
  });
  const last = c[c.length - 1];
  if (last) { const y = yOf(last.c, hi, lo, h); for (let x = 0; x < w; x += 2) if (px[y * w + x] === 0 || px[y * w + x] === 1) set(x, y, 4); }
  return { w, h, px, hi, lo, grid };
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function deflate(b: Uint8Array) {
  const s = new Blob([b]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Indexed-colour PNG, as a data URL. */
export async function rasterToPng(r: Raster): Promise<string> {
  const raw = new Uint8Array((r.w + 1) * r.h);
  for (let y = 0; y < r.h; y++) raw.set(r.px.subarray(y * r.w, (y + 1) * r.w), y * (r.w + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.w); dv.setUint32(4, r.h); ihdr[8] = 8; ihdr[9] = 3;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("PLTE", new Uint8Array(PALETTE)), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  let s = ""; for (let i = 0; i < all.length; i += 0x8000) s += String.fromCharCode(...all.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

/** Small SVG preview for the chat (data URL). */
export function chartSvg(candles: Candle[], title: string, digits: number, w = 360, h = 180): string {
  const c = candles.slice(-60);
  const hi = Math.max(...c.map((x) => x.h)), lo = Math.min(...c.map((x) => x.l));
  const step = w / Math.max(c.length, 1), bw = Math.max(1, step * 0.7);
  const body = c.map((k, i) => {
    const col = k.c >= k.o ? "#10b981" : "#ef4444";
    const x = i * step, mid = x + bw / 2;
    const top = yOf(Math.max(k.o, k.c), hi, lo, h), bot = yOf(Math.min(k.o, k.c), hi, lo, h);
    return `<line x1="${mid.toFixed(1)}" x2="${mid.toFixed(1)}" y1="${yOf(k.h, hi, lo, h)}" y2="${yOf(k.l, hi, lo, h)}" stroke="${col}"/><rect x="${x.toFixed(1)}" y="${top}" width="${bw.toFixed(1)}" height="${Math.max(1, bot - top)}" fill="${col}"/>`;
  }).join("");
  const last = c[c.length - 1]?.c ?? 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#0a0a0a"/>${body}<line x1="0" x2="${w}" y1="${yOf(last, hi, lo, h)}" y2="${yOf(last, hi, lo, h)}" stroke="#e6e6e6" stroke-dasharray="3 3"/><text x="6" y="14" fill="#e6e6e6" font-size="11" font-family="sans-serif">${title} ${last.toFixed(digits)}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
