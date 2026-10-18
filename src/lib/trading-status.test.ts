import { describe, expect, it } from "vitest";
import { computeDayMetrics, computeStatus, countConsecutiveLosses, protectProfit, type StatusSettings, type StatusTrade } from "./trading-status";

const now = new Date("2026-10-11T12:00:00+03:00");
const base: StatusSettings = {
  daily_target: 200,
  max_daily_profit: 500,
  max_daily_loss: 300,
  max_trades_per_day: 5,
  max_daily_risk: 400,
  max_consecutive_losses: 3,
  trading_paused: false,
  timezone: "Asia/Riyadh",
};
const closed = (pnl: number, h: number, risk = 50): StatusTrade => ({
  status: "closed",
  pnl,
  risk_amount: risk,
  opened_at: `2026-10-11T0${h}:00:00+03:00`,
  closed_at: `2026-10-11T0${h}:30:00+03:00`,
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

describe("weekly & monthly limits", () => {
  const now = new Date("2026-10-14T12:00:00+03:00"); // Wednesday
  const base = { daily_target: 0, max_daily_profit: 0, max_daily_loss: 0, max_trades_per_day: 0, max_daily_risk: 0, max_consecutive_losses: 0, trading_paused: false, timezone: "Asia/Riyadh" };
  const tr = (pnl: number, at: string) => ({ status: "closed", pnl, risk_amount: 0, opened_at: at, closed_at: at });
  const trades = [tr(-300, "2026-10-12T10:00:00+03:00"), tr(-250, "2026-10-13T10:00:00+03:00"), tr(400, "2026-10-02T10:00:00+03:00")];
  it("stops at the weekly max loss", () => {
    const s = { ...base, weekly_max_loss: 500 };
    expect(computeStatus(s, computeDayMetrics(s, trades, 0, now), now)).toBe("loss_limit");
  });
  it("monthly target hit when month PnL reaches it", () => {
    const s = { ...base, monthly_target: 300 };
    const t2 = [tr(350, "2026-10-02T10:00:00+03:00")];
    expect(computeStatus(s, computeDayMetrics(s, t2, 0, now), now)).toBe("target_hit");
  });
  it("week pnl ignores last week's trades", () => {
    expect(computeDayMetrics(base, trades, 0, now).weekPnl).toBe(-550);
  });
  it("the week starts Monday: Sunday's trade belongs to last week", () => {
    const sunday = tr(-100, "2026-10-11T15:00:00+03:00");
    expect(computeDayMetrics(base, [...trades, sunday], 0, now).weekPnl).toBe(-550);
  });
});

describe("today follows the trader's time zone", () => {
  const s = { daily_target: 0, max_daily_profit: 0, max_daily_loss: 0, max_trades_per_day: 0, max_daily_risk: 0, max_consecutive_losses: 0, trading_paused: false, timezone: "Asia/Riyadh" };
  const at = (iso: string) => ({ status: "closed", pnl: -50, risk_amount: 10, opened_at: iso, closed_at: iso });
  const now = new Date("2026-10-18T09:00:00+03:00");
  it("00:30 Riyadh (21:30 UTC the day before) counts as today", () => {
    expect(computeDayMetrics(s, [at("2026-10-17T21:30:00Z")], 0, now)).toMatchObject({ tradesToday: 1, todayPnl: -50 });
  });
  it("23:30 Riyadh yesterday does not", () => {
    expect(computeDayMetrics(s, [at("2026-10-17T20:30:00Z")], 0, now).tradesToday).toBe(0);
  });
});

describe("protect profit", () => {
  const limits = { max_trades_per_day: 5, max_daily_profit: 500 };
  it("nothing reached → null", () => expect(protectProfit({ tradesToday: 4, todayPnl: 499 }, limits)).toBeNull());
  it("max trades reached", () =>
    expect(protectProfit({ tradesToday: 5, todayPnl: 0 }, limits)).toEqual({ maxTrades: true, profitCap: false, text: "وصلت حدّ صفقاتك اليوم" }));
  it("profit cap reached", () =>
    expect(protectProfit({ tradesToday: 1, todayPnl: 500 }, limits)).toMatchObject({ profitCap: true, text: "وصلت حدّ ربحك اليوم" }));
  it("both", () => expect(protectProfit({ tradesToday: 6, todayPnl: 600 }, limits)?.text).toBe("وصلت حدّ ربحك وصفقاتك اليوم"));
  it("0 means off", () => expect(protectProfit({ tradesToday: 50, todayPnl: 5000 }, { max_trades_per_day: 0, max_daily_profit: 0 })).toBeNull());
});
