import { describe, expect, it } from "vitest";
import { calculateRewardToRisk, tradeGateMetrics } from "./trade-gate";
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

describe("tradeGateMetrics", () => {
  it("measures the trade and the room left today", () => {
    const m = tradeGateMetrics({
      settings: baseSettings,
      metrics: { ...baseMetrics, todayPnl: -100, tradesToday: 2, riskUsed: 150 },
      input: { direction: "long", entry_price: 1.08, stop_loss: 1.075, take_profit: 1.095, risk_amount: 50 },
      openTrades: [
        { status: "open", pnl: null, risk_amount: 40, opened_at: "2026-10-14T09:00:00Z", closed_at: null },
        { status: "closed", pnl: -100, risk_amount: 60, opened_at: "2026-10-14T08:00:00Z", closed_at: "2026-10-14T08:30:00Z" },
      ],
      currentBalance: 10000,
    });
    expect(m).toEqual({
      tradeRisk: 50,
      riskPercentOfBalance: 0.5,
      totalOpenRisk: 40,
      remainingDailyRisk: 250,
      remainingTrades: 3,
      remainingLossBeforeStop: 200,
      remainingProfitBeforeTarget: 200,
      rewardToRiskRatio: 3,
    });
  });

  it("an unknown risk stays null, never counted as a safe 0", () => {
    const m = tradeGateMetrics({
      settings: baseSettings,
      metrics: baseMetrics,
      input: { direction: "long", entry_price: 1.08, stop_loss: 1.07, risk_amount: null },
      currentBalance: 10000,
    });
    expect(m.tradeRisk).toBeNull();
    expect(m.riskPercentOfBalance).toBeNull();
  });

  it("a limit left at 0 has no room to report", () => {
    const m = tradeGateMetrics({
      settings: { ...baseSettings, max_daily_risk: 0, max_trades_per_day: 0, max_daily_loss: 0, daily_target: 0 },
      metrics: baseMetrics,
      input: { direction: "long", risk_amount: 50 },
    });
    expect(m).toMatchObject({ remainingDailyRisk: null, remainingTrades: null, remainingLossBeforeStop: null, remainingProfitBeforeTarget: null, riskPercentOfBalance: 0.5 });
  });
});
