import { describe, expect, it } from "vitest";
import { computeDayMetrics, computeStatus, countConsecutiveLosses, type StatusSettings, type StatusTrade } from "./trading-status";

const now = new Date("2026-10-11T12:00:00");
const base: StatusSettings = {
  daily_target: 200,
  max_daily_profit: 500,
  max_daily_loss: 300,
  max_trades_per_day: 5,
  max_daily_risk: 400,
  max_consecutive_losses: 3,
  trading_paused: false,
};
const closed = (pnl: number, h: number, risk = 50): StatusTrade => ({
  status: "closed",
  pnl,
  risk_amount: risk,
  opened_at: `2026-10-11T0${h}:00:00`,
  closed_at: `2026-10-11T0${h}:30:00`,
});
const status = (trades: StatusTrade[], s = base, v = 0) => computeStatus(s, computeDayMetrics(s, trades, v, now));

describe("trading status", () => {
  it("is ready with no trades", () => expect(status([])).toBe("ready"));
  it("stops when paused", () => expect(status([], { ...base, trading_paused: true })).toBe("stopped"));
  it("hits loss limit at -300", () => expect(status([closed(-300, 1)])).toBe("loss_limit"));
  it("target hit at +200", () => expect(status([closed(200, 1)])).toBe("target_hit"));
  it("stops at max profit 500", () => expect(status([closed(500, 1)])).toBe("stopped"));
  it("stops after 5 trades", () => expect(status([1, 2, 3, 4, 5].map((h) => closed(1, h, 10)))).toBe("stopped"));
  it("stops after 3 consecutive losses", () => expect(status([closed(-10, 1), closed(-10, 2), closed(-10, 3)])).toBe("stopped"));
  it("rules broken with a violation", () => expect(status([], base, 1)).toBe("rules_broken"));
  it("high risk at 70% of loss limit", () => expect(status([closed(-210, 1)])).toBe("high_risk"));
  it("caution at 40% of loss limit", () => expect(status([closed(-120, 1)])).toBe("caution"));
  it("counts streak from latest", () =>
    expect(countConsecutiveLosses([closed(-1, 1), closed(5, 2), closed(-1, 3), closed(-2, 4)])).toBe(2));
});

import { describe as d2, it as i2, expect as e2 } from "vitest";
import { computeStatus as cs } from "./trading-status";
d2("cooldown", () => {
  const base = { daily_target: 0, max_daily_profit: 0, max_daily_loss: 0, max_trades_per_day: 0, max_daily_risk: 0, max_consecutive_losses: 0, trading_paused: false };
  const m = { todayPnl: 0, tradesToday: 0, consecutiveLosses: 0, violationsToday: 0, riskUsed: 0 } as never;
  const now = new Date("2026-01-01T10:00:00Z");
  i2("active cooldown stops trading", () => { e2(cs({ ...base, cooldown_until: "2026-01-01T10:30:00Z" }, m, now)).toBe("stopped"); });
  i2("expired cooldown allows trading", () => { e2(cs({ ...base, cooldown_until: "2026-01-01T09:00:00Z" }, m, now)).toBe("ready"); });
});
