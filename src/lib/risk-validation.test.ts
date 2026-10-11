import { describe, expect, it } from "vitest";
import { validateRiskSettings } from "./risk-validation";

describe("validateRiskSettings", () => {
  it("validates valid risk parameters without errors", () => {
    const res = validateRiskSettings({
      starting_balance: 5000,
      daily_target: 150,
      max_daily_profit: 300,
      max_daily_loss: 200,
      max_trades_per_day: 4,
      max_risk_per_trade: 50,
      max_daily_risk: 150,
      max_consecutive_losses: 2,
      currency: "USD",
    });
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.warnings.length).toBe(0);
  });

  it("detects error when daily target exceeds max daily profit", () => {
    const res = validateRiskSettings({
      daily_target: 400,
      max_daily_profit: 200,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.field === "daily_target")).toBe(true);
  });

  it("warns when risk per trade exceeds max daily risk", () => {
    const res = validateRiskSettings({
      max_risk_per_trade: 200,
      max_daily_risk: 100,
    });
    expect(res.warnings.some((w) => w.field === "max_risk_per_trade")).toBe(true);
  });

  it("detects error when daily loss limit exceeds starting balance", () => {
    const res = validateRiskSettings({
      starting_balance: 500,
      max_daily_loss: 1000,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.field === "max_daily_loss")).toBe(true);
  });

  it("warns for unsupported currencies", () => {
    const res = validateRiskSettings({
      currency: "XYZ",
    });
    expect(res.warnings.some((w) => w.field === "currency")).toBe(true);
  });
});
