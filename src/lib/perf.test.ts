import { describe, expect, it } from "vitest";
import type { Trade } from "./queries";
import { avgR, dailyPnl, expectancy, maxDrawdown, periodRange, sideSplit, streaks } from "./perf";

const t = (pnl: number, closed_at: string, extra: Partial<Trade> = {}) =>
  ({ status: "closed", pnl, risk_amount: 50, closed_at, opened_at: closed_at, direction: "long", ...extra }) as unknown as Trade;

const trades = [t(100, "2026-10-05T08:00:00Z"), t(-50, "2026-10-06T08:00:00Z"), t(-50, "2026-10-07T08:00:00Z"), t(150, "2026-10-08T08:00:00Z", { direction: "short" })];

describe("perf", () => {
  it("max drawdown is the deepest drop from peak", () => {
    expect(maxDrawdown(trades, 1000)).toEqual({ amount: 100, pct: (100 / 1100) * 100 });
  });
  it("average R = mean(pnl / risk)", () => { expect(avgR(trades)).toBe(0.75); });
  it("expectancy = average pnl per closed trade", () => { expect(expectancy(trades)).toBe(37.5); });
  it("longest win and loss streaks", () => { expect(streaks(trades)).toEqual({ maxWin: 1, maxLoss: 2 }); });
  it("long vs short split uses the DB direction values", () => {
    expect(sideSplit(trades)).toEqual({ long: { count: 3, pnl: 0 }, short: { count: 1, pnl: 150 } });
  });
  it("long/short split counts both sides, never zeroes one out", () => {
    const s = sideSplit([t(80, "2026-10-05T08:00:00Z"), t(-30, "2026-10-06T08:00:00Z", { direction: "short" }), { ...t(500, "2026-10-07T08:00:00Z"), status: "open" } as Trade]);
    expect(s.long).toEqual({ count: 1, pnl: 80 });
    expect(s.short).toEqual({ count: 1, pnl: -30 });
  });
  it("daily pnl groups by local day", () => { expect(dailyPnl(trades, "Asia/Riyadh").get("2026-10-06")?.pnl).toBe(-50); });
  it("week starts Monday in Riyadh time", () => {
    const r = periodRange("week", new Date("2026-10-12T16:00:00Z"), "Asia/Riyadh")!;
    expect(new Date(r.start).toISOString()).toBe("2026-10-11T21:00:00.000Z");
  });
});

import { strategyStats } from "./perf";
describe("strategyStats", () => {
  it("counts trades, win rate, net and R per strategy", () => {
    const ts = [
      { strategy_id: "a", status: "closed", pnl: 100, risk_amount: 50 },
      { strategy_id: "a", status: "closed", pnl: -50, risk_amount: 50 },
      { strategy_id: "a", status: "open", pnl: null, risk_amount: 50 },
      { strategy_id: null, status: "open", pnl: null, risk_amount: 20 },
    ];
    const r = strategyStats(ts, [{ id: "a", name: "اختراق" }]);
    expect(r.rows[0]).toEqual({ name: "اختراق", trades: 3, closed: 2, winRate: 50, net: 50, avgR: 0.5 });
    expect(r.withoutStrategy).toBe(1);
  });
});
