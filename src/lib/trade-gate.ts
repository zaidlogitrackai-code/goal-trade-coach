import type { StatusSettings, DayMetrics, StatusTrade } from "./trading-status";

/**
 * Numbers for one trade on the form: its risk, share of the balance, R:R and the room
 * left today. Pure and measuring only — whether to enter is pre-trade-gate.ts's decision
 * (the threshold warnings that used to live here moved there, next to the breaker).
 */
export interface TradeInput {
  symbol: string;
  direction: "long" | "short" | string;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  position_size?: number | null;
  risk_amount?: number | null;
  strategy_id?: string | null;
  emotion?: string | null;
  notes?: string | null;
  checklist_passed?: boolean;
}

export interface TradeGateMetrics {
  /** null when the risk can't be known (no stop or size): unknown must never read as a safe 0. */
  tradeRisk: number | null;
  riskPercentOfBalance: number | null;
  totalOpenRisk: number;
  remainingDailyRisk: number | null;
  remainingTrades: number | null;
  remainingLossBeforeStop: number | null;
  remainingProfitBeforeTarget: number | null;
  rewardToRiskRatio: number | null;
}

/**
 * Calculates Reward to Risk Ratio without guessing or interpolating missing data.
 */
export function calculateRewardToRisk(input: {
  direction: string;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
}): number | null {
  const { direction, entry_price, stop_loss, take_profit } = input;
  if (
    entry_price == null ||
    stop_loss == null ||
    take_profit == null ||
    !Number.isFinite(entry_price) ||
    !Number.isFinite(stop_loss) ||
    !Number.isFinite(take_profit)
  ) {
    return null;
  }

  if (direction === "long") {
    const riskDistance = entry_price - stop_loss;
    const rewardDistance = take_profit - entry_price;
    if (riskDistance <= 0 || rewardDistance <= 0) return null;
    return Math.round((rewardDistance / riskDistance) * 100) / 100;
  } else if (direction === "short") {
    const riskDistance = stop_loss - entry_price;
    const rewardDistance = entry_price - take_profit;
    if (riskDistance <= 0 || rewardDistance <= 0) return null;
    return Math.round((rewardDistance / riskDistance) * 100) / 100;
  }
  return null;
}

/** The trade's numbers against today's metrics and the open positions. */
export function tradeGateMetrics(options: {
  settings: Pick<StatusSettings, "max_daily_risk" | "max_trades_per_day" | "max_daily_loss" | "daily_target"> & { starting_balance?: number; current_balance?: number };
  metrics: DayMetrics;
  input: Pick<TradeInput, "direction" | "entry_price" | "stop_loss" | "take_profit" | "risk_amount">;
  openTrades?: StatusTrade[];
  currentBalance?: number;
}): TradeGateMetrics {
  const {
    settings,
    metrics,
    input,
    openTrades = [],
    currentBalance = (settings.current_balance ?? settings.starting_balance ?? 1000),
  } = options;

  const riskIn = input.risk_amount == null ? NaN : Number(input.risk_amount);
  const tradeRisk = Number.isFinite(riskIn) ? Math.max(0, riskIn) : null;
  return {
    tradeRisk,
    riskPercentOfBalance: tradeRisk != null && currentBalance > 0 ? Math.round((tradeRisk / currentBalance) * 10000) / 100 : null,
    totalOpenRisk: openTrades.reduce((acc, t) => acc + (t.status === "open" ? (t.risk_amount ?? 0) : 0), 0),
    remainingDailyRisk: settings.max_daily_risk > 0 ? Math.max(0, settings.max_daily_risk - metrics.riskUsed) : null,
    remainingTrades: settings.max_trades_per_day > 0 ? Math.max(0, settings.max_trades_per_day - metrics.tradesToday) : null,
    remainingLossBeforeStop: settings.max_daily_loss > 0 ? Math.max(0, settings.max_daily_loss + Math.min(0, metrics.todayPnl)) : null,
    remainingProfitBeforeTarget: settings.daily_target > 0 ? Math.max(0, settings.daily_target - Math.max(0, metrics.todayPnl)) : null,
    rewardToRiskRatio: calculateRewardToRisk(input),
  };
}
