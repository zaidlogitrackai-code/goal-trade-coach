import { describe, expect, it } from "vitest";
import {
  calcTradeRisk,
  hasBlockingIssues,
  validateRiskLimits,
  type RiskSettingsRow,
} from "./risk-limits";

const ok: RiskSettingsRow = {
  starting_balance: 10000,
  daily_target: 200,
  max_daily_profit: 500,
  max_daily_loss: 300,
  max_trades_per_day: 5,
  max_risk_per_trade: 100,
  max_daily_risk: 300,
  max_consecutive_losses: 3,
  weekly_target: 0,
  weekly_max_loss: 900,
  monthly_target: 0,
  monthly_max_loss: 2000,
  session_start: "09:00",
  session_end: "17:00",
  currency: "USD",
};
const fields = (s: RiskSettingsRow, sev = "error") =>
  validateRiskLimits(s)
    .filter((i) => i.severity === sev)
    .map((i) => i.field);

describe("validateRiskLimits", () => {
  it("accepts a consistent configuration", () =>
    expect(hasBlockingIssues(validateRiskLimits(ok))).toBe(false));
  it("rejects a daily target above the profit stop", () =>
    expect(fields({ ...ok, daily_target: 600 })).toContain("daily_target"));
  it("rejects risk per trade above daily risk", () =>
    expect(fields({ ...ok, max_risk_per_trade: 400 })).toContain("max_risk_per_trade"));
  it("rejects a loss limit larger than the balance", () =>
    expect(fields({ ...ok, max_daily_loss: 20000 })).toContain("max_daily_loss"));
  it("rejects negative trade count", () =>
    expect(fields({ ...ok, max_trades_per_day: -1 })).toContain("max_trades_per_day"));
  it("rejects fractional trade count", () =>
    expect(fields({ ...ok, max_trades_per_day: 2.5 })).toContain("max_trades_per_day"));
  it("warns (not blocks) when trade count is disabled", () => {
    expect(fields({ ...ok, max_trades_per_day: 0 })).not.toContain("max_trades_per_day");
    expect(fields({ ...ok, max_trades_per_day: 0 }, "warning")).toContain("max_trades_per_day");
  });
  it("rejects only one session time", () =>
    expect(fields({ ...ok, session_end: "" })).toContain("session_end"));
  it("rejects identical start and end", () =>
    expect(fields({ ...ok, session_end: "09:00:00" })).toContain("session_end"));
  it("rejects malformed time", () =>
    expect(fields({ ...ok, session_start: "25:00" })).toContain("session_start"));
  it("rejects unsupported currency", () =>
    expect(fields({ ...ok, currency: "XYZ" })).toContain("currency"));
});

describe("calcTradeRisk", () => {
  it("computes loss, profit, R:R and share of balance", () => {
    const r = calcTradeRisk(
      { direction: "long", entry: 100, stop: 98, target: 106, size: 10 },
      1000,
    );
    expect(r).toMatchObject({
      potentialLoss: 20,
      potentialProfit: 60,
      rr: 3,
      risk: 20,
      riskSource: "prices",
    });
    expect(r.riskOfBalance).toBeCloseTo(0.02);
  });
  it("works for shorts", () => {
    const r = calcTradeRisk({ direction: "short", entry: 100, stop: 101, target: 97, size: 5 }, 0);
    expect(r).toMatchObject({ potentialLoss: 5, potentialProfit: 15, rr: 3, riskOfBalance: null });
  });
  it("gives R:R without size but no money amounts", () => {
    const r = calcTradeRisk({ direction: "long", entry: 100, stop: 99, target: 102 }, 1000);
    expect(r).toMatchObject({ potentialLoss: null, potentialProfit: null, rr: 2, risk: null });
  });
  it("falls back to typed risk", () =>
    expect(calcTradeRisk({ direction: "long", riskInput: 40 }, 1000).risk).toBe(40));
  it("uses the larger of typed and price risk", () => {
    const r = calcTradeRisk(
      { direction: "long", entry: 100, stop: 99, size: 10, riskInput: 30 },
      1000,
    );
    expect(r.risk).toBe(30);
    expect(r.notes.length).toBe(1);
  });
  it("flags a stop on the wrong side and does not compute loss", () => {
    const r = calcTradeRisk({ direction: "long", entry: 100, stop: 101, size: 1 }, 1000);
    expect(r.problems.length).toBe(1);
    expect(r.potentialLoss).toBeNull();
  });
  it("returns nothing when data is insufficient", () => {
    expect(calcTradeRisk({ direction: "long" }, 1000)).toMatchObject({
      risk: null,
      rr: null,
      riskOfBalance: null,
    });
  });
});
