import { describe, expect, it } from "vitest";
import type { Trade } from "./queries";
import { avgR, dailyPnl, expectancy, maxDrawdown, periodRange, sideSplit, streaks } from "./perf";

const t = (pnl: number, closed_at: string, extra: Partial<Trade> = {}) =>
  ({ status: "closed", pnl, risk_amount: 50, closed_at, opened_at: closed_at, direction: "buy", ...extra }) as unknown as Trade;

const trades = [t(100, "2026-10-05T08:00:00Z"), t(-50, "2026-10-06T08:00:00Z"), t(-50, "2026-10-07T08:00:00Z"), t(150, "2026-10-08T08:00:00Z", { direction: "sell" })];

describe("perf", () => {
  it("max drawdown is the deepest drop from peak", () => {
    expect(maxDrawdown(trades, 1000)).toEqual({ amount: 100, pct: (100 / 1100) * 100 });
  });
  it("average R = mean(pnl / risk)", () => { expect(avgR(trades)).toBe(0.75); });
  it("expectancy = average pnl per closed trade", () => { expect(expectancy(trades)).toBe(37.5); });
  it("longest win and loss streaks", () => { expect(streaks(trades)).toEqual({ maxWin: 1, maxLoss: 2 }); });
  it("buy vs sell split", () => { expect(sideSplit(trades).sell).toEqual({ count: 1, pnl: 150 }); });
  it("daily pnl groups by local day", () => { expect(dailyPnl(trades, "Asia/Riyadh").get("2026-10-06")?.pnl).toBe(-50); });
  it("week starts Monday in Riyadh time", () => {
    const r = periodRange("week", new Date("2026-10-12T16:00:00Z"), "Asia/Riyadh")!;
    expect(new Date(r.start).toISOString()).toBe("2026-10-11T21:00:00.000Z");
  });
});
