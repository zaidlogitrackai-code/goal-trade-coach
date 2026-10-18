import { describe, expect, it } from "vitest";
import { anchorBalance, applyPctLimits, pctFromDollars } from "./effective-limits";

describe("limits follow balance", () => {
  it("1% daily risk of 59,998 = 599.98", () => {
    expect(applyPctLimits({ max_daily_risk: 30, limits_pct: { max_daily_risk: 1 } }, 59998).max_daily_risk).toBe(599.98);
  });
  it("keeps fixed dollars without pct", () => {
    expect(applyPctLimits({ max_daily_risk: 30, limits_pct: null }, 59998).max_daily_risk).toBe(30);
  });
  it("saving $600 at 60,000 stores 1%", () => {
    expect(pctFromDollars({ max_daily_risk: 600 }, 60000, null)).toEqual({ max_daily_risk: 1 });
  });
});

describe("anchorBalance", () => {
  it("the day's start balance anchors the % limits", () => {
    expect(anchorBalance({ start_balance: 10000 }, 9850)).toBe(10000);
  });
  it("falls back to the live balance until the day is snapshotted", () => {
    expect(anchorBalance(null, 9850)).toBe(9850);
    expect(anchorBalance({ start_balance: null }, 9850)).toBe(9850);
    expect(anchorBalance({ start_balance: 0 }, 9850)).toBe(9850);
  });
  it("2% of the anchor stays 200 after a losing trade", () => {
    const s = { max_daily_loss: 0, limits_pct: { max_daily_loss: 2 } };
    expect(applyPctLimits(s, anchorBalance({ start_balance: 10000 }, 9850)).max_daily_loss).toBe(200);
  });
});

import { effectiveDailyTarget } from "./daily-plan";
describe("effectiveDailyTarget", () => {
  it("uses the plan target Hadi chose today", () => { expect(effectiveDailyTarget(500, 1800)).toBe(500); });
  it("falls back to settings when no plan target", () => { expect(effectiveDailyTarget(null, 1800)).toBe(1800); });
});
