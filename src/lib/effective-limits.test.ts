import { describe, expect, it } from "vitest";
import { applyPctLimits, pctFromDollars } from "./effective-limits";

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
