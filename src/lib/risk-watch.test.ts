import { describe, expect, it } from "vitest";
import { nextDaily, riskAlerts, type WatchTrade } from "./risk-watch";

const now = new Date(2026, 9, 12, 15, 0);
const s = { daily_target: 100, max_daily_profit: 0, max_daily_loss: 200, max_trades_per_day: 5, max_daily_risk: 0, max_consecutive_losses: 0, trading_paused: false };
const closed = (pnl: number, min = 0): WatchTrade => ({ id: `c${pnl}${min}`, symbol: "XAUUSD", stop_loss: 1, status: "closed", pnl, risk_amount: 0, opened_at: new Date(2026, 9, 12, 10, min).toISOString(), closed_at: new Date(2026, 9, 12, 11, min).toISOString() });
const keys = (t: WatchTrade[]) => riskAlerts(s, t, now).map((a) => a.key.split(":")[0]);

describe("riskAlerts", () => {
  it("warns at 80% of the daily loss limit", () => expect(keys([closed(-160)])).toContain("loss_80"));
  it("says stop at the daily loss limit", () => expect(keys([closed(-200)])).toContain("loss_hit"));
  it("says don't be greedy at the daily target", () => expect(keys([closed(100)])).toContain("target_day"));
  it("flags two losses in a row", () => expect(keys([closed(-10, 1), closed(-10, 2)])).toContain("streak2"));
  it("flags an open trade without a stop loss", () => {
    const t: WatchTrade = { id: "o", symbol: "EURUSD", stop_loss: null, status: "open", pnl: null, risk_amount: 0, opened_at: now.toISOString(), closed_at: null };
    expect(keys([t])).toContain("nosl");
  });
  it("nothing when calm", () => expect(keys([closed(20)])).toEqual([]));
});

describe("nextDaily", () => {
  it("rolls to tomorrow when time passed", () => expect(nextDaily("09:00", now).getDate()).toBe(13));
  it("today when still ahead", () => expect(nextDaily("16:30", now).getHours()).toBe(16));
});
