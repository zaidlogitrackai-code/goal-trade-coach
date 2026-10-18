import { describe, expect, it } from "vitest";
import { collapseToasts, deliveryOf, nextDaily, riskAlerts, type WatchTrade } from "./risk-watch";
import { dayKey, wallClock } from "./trading-day";

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
  it("keys use the trader's padded calendar day", () => {
    const at = new Date("2026-03-04T23:30:00+03:00"); // 20:30 UTC
    const t: WatchTrade = { ...closed(-200), opened_at: "2026-03-04T21:00:00+03:00", closed_at: "2026-03-04T22:00:00+03:00" };
    expect(riskAlerts({ ...s, timezone: "Asia/Riyadh" }, [t], at).map((a) => a.key)).toContain("loss_hit:2026-03-04");
  });
  it("weekly and monthly targets fire once per ISO week and month", () => {
    const at = new Date("2026-10-18T22:00:00+03:00"); // Sunday: still week 42
    const t: WatchTrade = { ...closed(300), opened_at: "2026-10-14T10:00:00+03:00", closed_at: "2026-10-14T11:00:00+03:00" };
    const k = riskAlerts({ ...s, daily_target: 0, weekly_target: 200, monthly_target: 200, timezone: "Asia/Riyadh" }, [t], at).map((a) => a.key);
    expect(k).toContain("target_week:2026-W42");
    expect(k).toContain("target_month:2026-10");
  });
});

describe("nextDaily", () => {
  const RIYADH = "Asia/Riyadh";
  const at = new Date("2026-10-12T15:00:00+03:00");
  it("rolls to tomorrow when time passed", () => expect(dayKey(nextDaily("09:00", at, RIYADH), RIYADH)).toBe("2026-10-13"));
  it("today when still ahead", () => {
    const d = nextDaily("16:30", at, RIYADH);
    expect(dayKey(d, RIYADH)).toBe("2026-10-12");
    expect(wallClock(d, RIYADH)).toMatchObject({ hour: 16, minute: 30 });
  });
  it("fires on the trader's clock, not the server's", () => {
    // 20:30 UTC is 23:30 in Riyadh: a 23:45 reminder is 15 minutes away, still today there.
    expect(nextDaily("23:45", new Date("2026-10-12T20:30:00Z"), RIYADH).toISOString()).toBe("2026-10-12T20:45:00.000Z");
  });
  it("a bad time falls back to 09:00", () => expect(wallClock(nextDaily("xx", at, RIYADH), RIYADH).hour).toBe(9));
});

describe("delivery", () => {
  it("loss_80 then loss_hit on the same day are two separate alerts", () => {
    const k80 = riskAlerts(s, [closed(-160)], now).map((a) => a.key);
    const kHit = riskAlerts(s, [closed(-200)], now).map((a) => a.key);
    expect(k80.find((k) => k.startsWith("loss_80"))).toBeTruthy();
    expect(kHit.find((k) => k.startsWith("loss_hit"))).toBeTruthy();
    expect(kHit).not.toContain(k80.find((k) => k.startsWith("loss_80")));
  });
  it("a duplicate dedupe_key means already delivered, anything else failed", () => {
    expect(deliveryOf(null)).toBe("new");
    expect(deliveryOf({ code: "23505" })).toBe("already");
    expect(deliveryOf({ code: "42501" })).toBe("failed");
    expect(deliveryOf({})).toBe("failed");
  });
});

describe("collapseToasts", () => {
  const a = (title: string, level: "danger" | "warning" | "success" | "info") => ({ title, body: `${title} body`, level });
  it("nothing to show", () => expect(collapseToasts([])).toBeNull());
  it("one alert keeps its own body", () => expect(collapseToasts([a("قربت", "warning")])).toEqual(a("قربت", "warning")));
  it("three alerts give one toast with the worst title and the count", () => {
    expect(collapseToasts([a("هدف", "success"), a("وقف", "danger"), a("⏰ تذكير", "info")])).toEqual({ title: "وقف", body: "+2 تنبيهات بالجرس", level: "danger" });
  });
  it("ties keep the first one, and one extra reads singular", () => {
    expect(collapseToasts([a("أول", "warning"), a("ثاني", "warning")])).toEqual({ title: "أول", body: "+1 تنبيه بالجرس", level: "warning" });
  });
});
