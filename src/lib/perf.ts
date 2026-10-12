import type { Trade } from "./queries";

export type Period = "today" | "week" | "month" | "all";
const DAY = 86_400_000;
const pnl = (t: Trade) => Number(t.pnl) || 0;
const closedAt = (t: Trade) => new Date(t.closed_at ?? t.opened_at);
const closed = (ts: Trade[]) => ts.filter((t) => t.status === "closed").sort((a, b) => +closedAt(a) - +closedAt(b));

/** Local Y-M-D key in the given timezone. */
export function dayKey(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** [start, end) window for a period plus the previous equal window. Week starts Monday. */
export function periodRange(p: Period, now: Date, tz: string): { start: number; end: number; prevStart: number } | null {
  if (p === "all") return null;
  const [y, m, d] = dayKey(now, tz).split("-").map(Number) as [number, number, number];
  const offset = now.getTime() - Date.UTC(y, m - 1, d, ...hms(now, tz));
  const midnight = Date.UTC(y, m - 1, d) + offset;
  if (p === "today") return { start: midnight, end: midnight + DAY, prevStart: midnight - DAY };
  if (p === "week") {
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const s = midnight - dow * DAY;
    return { start: s, end: s + 7 * DAY, prevStart: s - 7 * DAY };
  }
  const s = Date.UTC(y, m - 1, 1) + offset;
  return { start: s, end: Date.UTC(y, m, 1) + offset, prevStart: Date.UTC(y, m - 2, 1) + offset };
}
function hms(d: Date, tz: string): [number, number, number] {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d).split(":").map(Number);
  return [(p[0] ?? 0) % 24, p[1] ?? 0, p[2] ?? 0];
}

export function inRange(ts: Trade[], from: number, to: number) {
  return ts.filter((t) => { const x = +(t.status === "closed" ? closedAt(t) : new Date(t.opened_at)); return x >= from && x < to; });
}

/** Max drawdown from peak of the equity curve (amount and % of peak). */
export function maxDrawdown(ts: Trade[], start: number) {
  let bal = start, peak = start, dd = 0, ddPct = 0;
  for (const t of closed(ts)) {
    bal += pnl(t); peak = Math.max(peak, bal);
    const cur = peak - bal;
    if (cur > dd) { dd = cur; ddPct = peak > 0 ? (cur / peak) * 100 : 0; }
  }
  return { amount: dd, pct: ddPct };
}

/** Average R multiple (pnl / risk) over closed trades that have a risk amount. */
export function avgR(ts: Trade[]) {
  const r = closed(ts).filter((t) => Number(t.risk_amount) > 0).map((t) => pnl(t) / Number(t.risk_amount));
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
}

export function expectancy(ts: Trade[]) {
  const c = closed(ts);
  return c.length ? c.reduce((a, t) => a + pnl(t), 0) / c.length : 0;
}

export function streaks(ts: Trade[]) {
  let w = 0, l = 0, maxW = 0, maxL = 0;
  for (const t of closed(ts)) {
    const v = pnl(t);
    if (v > 0) { w++; l = 0; } else if (v < 0) { l++; w = 0; } else { w = 0; l = 0; }
    maxW = Math.max(maxW, w); maxL = Math.max(maxL, l);
  }
  return { maxWin: maxW, maxLoss: maxL };
}

/** Average holding time in minutes. */
export function avgHold(ts: Trade[]) {
  const c = closed(ts).filter((t) => t.closed_at);
  if (!c.length) return null;
  return c.reduce((a, t) => a + (+new Date(t.closed_at!) - +new Date(t.opened_at)), 0) / c.length / 60_000;
}

export function dailyPnl(ts: Trade[], tz: string) {
  const m = new Map<string, { day: string; pnl: number; count: number }>();
  for (const t of closed(ts)) {
    const k = dayKey(closedAt(t), tz);
    const g = m.get(k) ?? { day: k, pnl: 0, count: 0 };
    g.pnl += pnl(t); g.count++; m.set(k, g);
  }
  return m;
}

const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export function weekdayName(t: Trade, tz: string) {
  const [y, m, d] = dayKey(closedAt(t), tz).split("-").map(Number) as [number, number, number];
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}
export function hourBucket(t: Trade, tz: string) {
  const h = hms(new Date(t.opened_at), tz)[0];
  return `${String(h).padStart(2, "0")}:00`;
}

export function sideSplit(ts: Trade[]) {
  const c = closed(ts);
  const f = (dir: string) => { const x = c.filter((t) => t.direction === dir); return { count: x.length, pnl: x.reduce((a, t) => a + pnl(t), 0) }; };
  return { buy: f("buy"), sell: f("sell") };
}

/** Percent change helper; null when there is no base. */
export function delta(cur: number, prev: number) {
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Per-strategy performance (closed trades) plus count of trades without a strategy. */
export function strategyStats(ts: { strategy_id: string | null; status: string; pnl: unknown; risk_amount: unknown }[], strategies: { id: string; name: string }[]) {
  const rows = strategies.map((s) => {
    const all = ts.filter((t) => t.strategy_id === s.id);
    const c = all.filter((t) => t.status === "closed");
    const p = c.map((t) => Number(t.pnl) || 0);
    const rs = c.filter((t) => Number(t.risk_amount) > 0).map((t) => (Number(t.pnl) || 0) / Number(t.risk_amount));
    return {
      name: s.name, trades: all.length, closed: c.length,
      winRate: c.length ? Math.round((p.filter((x) => x > 0).length / c.length) * 100) : null,
      net: Math.round(p.reduce((a, b) => a + b, 0) * 100) / 100,
      avgR: rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100 : null,
    };
  });
  return { rows, withoutStrategy: ts.filter((t) => !t.strategy_id).length };
}
