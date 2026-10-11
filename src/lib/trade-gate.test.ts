import { describe, expect, it } from "vitest";
import { calculateRewardToRisk, evaluateTradeGate } from "./trade-gate";
import type { StatusSettings, DayMetrics } from "./trading-status";

const baseSettings: StatusSettings & { starting_balance: number; max_risk_per_trade: number } = {
  starting_balance: 10000,
  daily_target: 200,
  max_daily_profit: 500,
  max_daily_loss: 300,
  max_trades_per_day: 5,
  max_daily_risk: 400,
  max_risk_per_trade: 100,
  max_consecutive_losses: 3,
  trading_paused: false,
};

const baseMetrics: DayMetrics = {
  todayPnl: 0,
  tradesToday: 0,
  tradesRemaining: 5,
  riskUsed: 0,
  riskRemaining: 400,
  lossRemaining: 300,
  consecutiveLosses: 0,
  violationsToday: 0,
  weekPnl: 0,
  monthPnl: 0,
};

describe("calculateRewardToRisk", () => {
  it("computes correct R:R for long trade", () => {
    const rr = calculateRewardToRisk({ direction: "long", entry_price: 100, stop_loss: 90, take_profit: 130 });
    expect(rr).toBe(3); // (130 - 100) / (100 - 90) = 30 / 10 = 3
  });

  it("computes correct R:R for short trade", () => {
    const rr = calculateRewardToRisk({ direction: "short", entry_price: 100, stop_loss: 110, take_profit: 80 });
    expect(rr).toBe(2); // (100 - 80) / (110 - 100) = 20 / 10 = 2
  });

  it("returns null if values are missing or invalid", () => {
    expect(calculateRewardToRisk({ direction: "long", entry_price: 100, stop_loss: null, take_profit: 130 })).toBeNull();
    expect(calculateRewardToRisk({ direction: "long", entry_price: 100, stop_loss: 110, take_profit: 130 })).toBeNull(); // stop loss above entry on long
  });
});

describe("evaluateTradeGate", () => {
  it("allows trade within all limits with valid stop loss", () => {
    const res = evaluateTradeGate({
      settings: baseSettings,
      metrics: baseMetrics,
      input: { symbol: "EURUSD", direction: "long", entry_price: 1.08, stop_loss: 1.075, take_profit: 1.095, risk_amount: 50, strategy_id: "s1" },
      activeSession: { id: "sess-1", started_at: new Date().toISOString() },
      allowedStrategyIds: ["s1"],
    });
    expect(res.allowed).toBe(true);
    expect(res.reasons.length).toBe(0);
    expect(res.canOverride).toBe(true);
    expect(res.metrics.tradeRisk).toBe(50);
  });

  it("blocks trade without stop loss with reason requiring override", () => {
    const res = evaluateTradeGate({
      settings: baseSettings,
      metrics: baseMetrics,
      input: { symbol: "EURUSD", direction: "long", entry_price: 1.08, stop_loss: null, risk_amount: 50 },
    });
    expect(res.allowed).toBe(false);
    expect(res.reasons.some((r) => r.includes("وقف الخسارة"))).toBe(true);
    expect(res.canOverride).toBe(true);
  });

  it("hard blocks trade when trading is manually paused", () => {
    const res = evaluateTradeGate({
      settings: { ...baseSettings, trading_paused: true },
      metrics: baseMetrics,
      input: { symbol: "EURUSD", direction: "long", stop_loss: 1.07, risk_amount: 50 },
    });
    expect(res.allowed).toBe(false);
    expect(res.canOverride).toBe(false);
    expect(res.reasons.some((r) => r.includes("موقوف يدوياً"))).toBe(true);
  });

  it("hard blocks trade when daily loss limit is reached", () => {
    const res = evaluateTradeGate({
      settings: baseSettings,
      metrics: { ...baseMetrics, todayPnl: -350 },
      input: { symbol: "EURUSD", direction: "long", stop_loss: 1.07, risk_amount: 50 },
    });
    expect(res.allowed).toBe(false);
    expect(res.canOverride).toBe(false);
    expect(res.reasons.some((r) => r.includes("الحد الأقصى للخسارة"))).toBe(true);
  });

  it("hard blocks trade when max consecutive losses is reached", () => {
    const res = evaluateTradeGate({
      settings: baseSettings,
      metrics: { ...baseMetrics, consecutiveLosses: 3 },
      input: { symbol: "EURUSD", direction: "long", stop_loss: 1.07, risk_amount: 50 },
    });
    expect(res.allowed).toBe(false);
    expect(res.canOverride).toBe(false);
    expect(res.reasons.some((r) => r.includes("خسائر"))).toBe(true);
  });

  it("hard blocks trade during active cooldown", () => {
    const future = new Date(Date.now() + 20 * 60000).toISOString();
    const res = evaluateTradeGate({
      settings: { ...baseSettings, cooldown_until: future },
      metrics: baseMetrics,
      input: { symbol: "EURUSD", direction: "long", stop_loss: 1.07, risk_amount: 50 },
    });
    expect(res.allowed).toBe(false);
    expect(res.canOverride).toBe(false);
    expect(res.reasons.some((r) => r.includes("تهدئة"))).toBe(true);
  });

  it("blocks trade when single trade risk exceeds limit but allows override", () => {
    const res = evaluateTradeGate({
      settings: baseSettings,
      metrics: baseMetrics,
      input: { symbol: "EURUSD", direction: "long", stop_loss: 1.07, risk_amount: 150 }, // limit is 100
    });
    expect(res.allowed).toBe(false);
    expect(res.canOverride).toBe(true);
    expect(res.reasons.some((r) => r.includes("الحد الأقصى لكل صفقة"))).toBe(true);
  });
});
