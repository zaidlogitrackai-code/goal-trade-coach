import { describe, expect, it } from "vitest";
import {
  breakerCopy, breakerForPrompt, evaluateBreaker, releaseLabel,
  type BreakerInput, type BreakerSettings, type BreakerTrade, type LatchedBreak, type PartialEvent,
} from "./circuit-breaker";
import { protectProfit } from "./trading-status";
import type { Database } from "@/integrations/supabase/types";

// The engine takes the rows exactly as Supabase returns them (fails tsc if a column changes).
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export const rowsFit = (t: Row<"trades">, e: Row<"trade_events">, c: Row<"circuit_breaks">, s: Row<"trading_settings">) =>
  [t, e, c, s] satisfies [BreakerTrade, PartialEvent, LatchedBreak, BreakerSettings];

const TZ = "Asia/Riyadh";
const SINCE = "2026-10-01T00:00:00+03:00";
// 2% / 5% / 8% of a 10,000 start balance = 200 / 500 / 800; two losses → 24h.
const OWN: BreakerSettings = {
  max_daily_loss: 0, weekly_max_loss: 0, monthly_max_loss: 0,
  limits_pct: { max_daily_loss: 2, weekly_max_loss: 5, monthly_max_loss: 8 },
  max_consecutive_losses: 2, streak_cooldown_hours: 24, trading_paused: false, cooldown_until: null,
};
const NONE: BreakerSettings = {
  max_daily_loss: 0, weekly_max_loss: 0, monthly_max_loss: 0, limits_pct: null,
  max_consecutive_losses: 0, streak_cooldown_hours: 24, trading_paused: false, cooldown_until: null,
};

let seq = 0;
/** A close written when it happened, at a distinct entry price (no accidental duplicates). */
function close(pnl: number | null, at: string, extra: Partial<BreakerTrade> = {}): BreakerTrade {
  seq++;
  return {
    id: `t${seq}`, symbol: "EURUSD", direction: "long", entry_price: 1 + seq / 100, exit_price: null,
    status: "closed", pnl, opened_at: new Date(Date.parse(at) - 10 * 60_000).toISOString(), closed_at: at, created_at: at,
    ...extra,
  };
}
const run = (now: string, over: Partial<BreakerInput> = {}) =>
  evaluateBreaker({
    settings: OWN, startBalance: 10_000, balance: 10_000, trades: [],
    limitsAcceptedAt: SINCE, breakerSince: SINCE, pausedUntil: null, tz: TZ, now: new Date(now), ...over,
  });
const rules = (r: ReturnType<typeof run>) => r.triggers.map((x) => x.rule);

const WED = "2026-10-14T15:00:00+03:00";
const MONDAY_19 = "2026-10-18T21:00:00.000Z"; // Mon 19 Oct 00:00 Riyadh

describe("loss limits and release times", () => {
  it("daily −2% on Friday 23:59 → HALTED until Monday 00:00", () => {
    const r = run("2026-10-16T23:59:00+03:00", { trades: [close(-200, "2026-10-16T23:30:00+03:00")] });
    expect(r.state).toBe("HALTED");
    expect(rules(r)).toEqual(["max_daily_loss"]);
    expect(r.triggers[0]).toMatchObject({ threshold: 200, observed: 200, periodKey: "2026-10-16", latched: false });
    expect(r.releaseAt?.toISOString()).toBe(MONDAY_19);
    expect(releaseLabel(r.releaseAt!, TZ)).toBe("الاثنين 19/10 00:00");
  });

  it("a weekly halt lasts until next Monday", () => {
    const settings = { ...OWN, max_daily_loss: 1000, limits_pct: { weekly_max_loss: 5, monthly_max_loss: 8 } };
    const r = run(WED, { settings, trades: [close(-500, "2026-10-14T10:00:00+03:00")] });
    expect(rules(r)).toEqual(["weekly_drawdown_halt"]);
    expect(r.triggers[0]!.periodKey).toBe("2026-W42");
    expect(r.releaseAt?.toISOString()).toBe(MONDAY_19);
  });

  it("a monthly halt lasts until the first weekday of next month", () => {
    const settings = { ...OWN, max_daily_loss: 1000, weekly_max_loss: 1000, limits_pct: { monthly_max_loss: 8 } };
    const trades = [
      close(-500, "2026-10-05T10:00:00+03:00"),
      close(100, "2026-10-06T10:00:00+03:00"),
      close(-400, "2026-10-27T10:00:00+03:00"),
    ];
    const r = run("2026-10-28T12:00:00+03:00", { settings, trades });
    expect(r.pnl.month).toBe(-800);
    expect(rules(r)).toEqual(["monthly_drawdown_halt"]);
    expect(r.triggers[0]!.periodKey).toBe("2026-10");
    // 1 Nov 2026 is a Sunday: Monday 2 Nov 00:00 Riyadh.
    expect(r.releaseAt?.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    // Across the year end: 1 Jan 2027 is a Friday.
    const dec = run("2026-12-15T12:00:00+03:00", { settings, trades: [close(-800, "2026-12-14T10:00:00+03:00")] });
    expect(dec.releaseAt?.toISOString()).toBe("2026-12-31T21:00:00.000Z");
  });

  it("intraday losses don't move the threshold: the start balance anchors it", () => {
    const trades = [close(-150, "2026-10-14T10:00:00+03:00")];
    const r = run(WED, { startBalance: 10_000, balance: 9_850, trades });
    expect(r.anchor).toBe(10_000);
    expect(r.limits[0]).toMatchObject({ rule: "max_daily_loss", threshold: 200, remaining: 50, source: "own", binding: true });
    expect(r.state).toBe("TRADING_ALLOWED");
    // No snapshot yet: the live balance is the anchor.
    expect(run(WED, { startBalance: null, balance: 9_850, trades }).limits[0]!.threshold).toBe(197);
  });

  it("today's plan can only make the daily limit stricter", () => {
    const trades = [close(-150, "2026-10-14T10:00:00+03:00")];
    expect(run(WED, { trades, planMaxLoss: 150 }).triggers[0]).toMatchObject({ rule: "max_daily_loss", threshold: 150 });
    expect(run(WED, { trades, planMaxLoss: 900 }).state).toBe("TRADING_ALLOWED");
  });
});

describe("losing streak", () => {
  it("2 losses at 23:50 → COOLDOWN for 24h from the last loss, not until midnight", () => {
    const last = close(-50, "2026-10-14T23:50:00+03:00");
    const trades = [close(-50, "2026-10-14T23:40:00+03:00"), last];
    const r = run("2026-10-14T23:55:00+03:00", { trades });
    expect(r.state).toBe("COOLDOWN");
    expect(r.triggers[0]).toMatchObject({ rule: "losing_streak_cooldown", periodKey: last.id, threshold: 2, observed: 2 });
    expect(r.releaseAt?.toISOString()).toBe("2026-10-15T20:50:00.000Z");
    expect(run("2026-10-15T23:00:00+03:00", { trades }).state).toBe("COOLDOWN");
    expect(run("2026-10-15T23:51:00+03:00", { trades }).state).toBe("TRADING_ALLOWED");
  });

  it("break-even breaks the streak", () => {
    const trades = [
      close(-50, "2026-10-14T10:00:00+03:00"),
      close(0, "2026-10-14T11:00:00+03:00"),
      close(-50, "2026-10-14T12:00:00+03:00"),
    ];
    const r = run(WED, { trades });
    expect(r.streak.losses).toBe(1);
    expect(r.state).toBe("TRADING_ALLOWED");
  });

  it("a close in the future is ignored by the streak and flagged", () => {
    const trades = [
      close(-50, "2026-10-14T14:00:00+03:00"),
      close(-50, "2026-10-15T10:00:00+03:00", { created_at: "2026-10-14T14:30:00+03:00" }),
    ];
    const r = run(WED, { trades });
    expect(r.streak.losses).toBe(1);
    expect(rules(r)).toEqual(["incomplete_data"]);
    expect(r.issues).toEqual([{ kind: "bad_close_time", tradeId: trades[1]!.id, symbol: "EURUSD", blocking: true }]);
  });
});

describe("partial closes", () => {
  const open: BreakerTrade = { id: "o1", symbol: "XAUUSD", direction: "short", entry_price: 2350, status: "open", pnl: null, opened_at: "2026-10-14T09:00:00+03:00", closed_at: null };

  it("a partial-close realized loss counts toward the daily limit", () => {
    const r = run(WED, {
      trades: [open, close(-100, "2026-10-14T12:00:00+03:00")],
      partialEvents: [{ trade_id: "o1", kind: "partial_close", realized_pnl: -120, at: "2026-10-14T11:00:00+03:00" }],
    });
    expect(r.pnl.day).toBe(-220);
    expect(rules(r)).toEqual(["max_daily_loss"]);
  });

  it("a trim is booked on its own day and never counted twice", () => {
    const t = close(-150, "2026-10-14T12:00:00+03:00", { id: "x1" });
    const sameDay = run(WED, { trades: [t], partialEvents: [{ trade_id: "x1", realized_pnl: -50, at: "2026-10-14T11:00:00+03:00" }] });
    expect(sameDay.pnl.day).toBe(-150);
    const dayBefore = run(WED, { trades: [t], partialEvents: [{ trade_id: "x1", realized_pnl: -120, at: "2026-10-13T11:00:00+03:00" }] });
    expect(dayBefore.pnl).toMatchObject({ day: -30, week: -150 });
  });

  it("a trim without an amount after switch-on is incomplete data", () => {
    const r = run(WED, { trades: [open], partialEvents: [{ trade_id: "o1", realized_pnl: null, at: "2026-10-14T11:00:00+03:00" }] });
    expect(r.partial).toBe(true);
    expect(r.issues[0]).toMatchObject({ kind: "bad_trim", tradeId: "o1", symbol: "XAUUSD" });
  });
});

describe("incomplete data", () => {
  it("a duplicate pair is counted once and gives PARTIAL → HALTED", () => {
    const a = close(-150, "2026-10-14T10:00:00+03:00", { entry_price: 1.085, exit_price: 1.0835 });
    const b = { ...a, id: "dup", created_at: "2026-10-14T10:05:00+03:00" };
    const r = run(WED, { trades: [a, b] });
    expect(r.state).toBe("HALTED");
    expect(r.partial).toBe(true);
    expect(r.pnl.day).toBe(-150);
    expect(r.streak.losses).toBe(1);
    expect(rules(r)).toEqual(["incomplete_data"]);
    expect(r.issues).toEqual([{ kind: "duplicate", tradeId: "dup", symbol: "EURUSD", blocking: true }]);
    expect(r.releaseAt).toBeNull();
  });

  it("the later-written row is the copy, even when it claims an earlier open", () => {
    const a = close(-150, "2026-10-14T10:00:00+03:00", { entry_price: 1.085 });
    const b = { ...a, id: "reupload", opened_at: "2026-10-14T09:00:00+03:00", created_at: "2026-10-14T12:00:00+03:00" };
    const c = { ...a, id: "third", created_at: "2026-10-14T13:00:00+03:00" };
    const r = run(WED, { trades: [b, a, c] });
    expect(r.issues.map((i) => i.tradeId).sort()).toEqual(["reupload", "third"]);
    expect(r.pnl.day).toBe(-150);
  });

  it("the same entry with a different result is not a duplicate", () => {
    const a = close(-150, "2026-10-14T10:00:00+03:00", { entry_price: 1.085 });
    const b = close(40, "2026-10-14T11:00:00+03:00", { entry_price: 1.085 });
    expect(run(WED, { trades: [a, b] }).partial).toBe(false);
  });

  it("a null pnl after switch-on blocks; the same row before it only warns", () => {
    const after = run(WED, { trades: [close(null, "2026-10-14T10:00:00+03:00")] });
    expect(after.state).toBe("HALTED");
    expect(after.issues[0]).toMatchObject({ kind: "null_pnl", blocking: true });

    const before = run(WED, { trades: [close(null, "2026-09-20T10:00:00+03:00")] });
    expect(before.state).toBe("TRADING_ALLOWED");
    expect(before.partial).toBe(false);
    expect(before.issues[0]).toMatchObject({ kind: "null_pnl", blocking: false });
    expect(before.warnings.map((w) => w.kind)).toEqual(["old_data"]);
  });

  it("dropped ledger entries block unless they are dated before switch-on", () => {
    const dropped = (at: string | null) => run(WED, { ledgerIssues: { dropped: [{ id: "x", at }], corrupt: false } });
    expect(dropped("2026-10-05T09:00:00Z").partial).toBe(true);
    expect(dropped(null).partial).toBe(true);
    expect(dropped("2026-09-05T09:00:00Z").partial).toBe(false);
    expect(run(WED, { ledgerIssues: { dropped: [], corrupt: true } }).state).toBe("HALTED");
  });

  it("breakerSince null is a preview: problems only warn", () => {
    const r = run(WED, { breakerSince: null, trades: [close(null, "2026-10-14T10:00:00+03:00")], ledgerIssues: { dropped: [], corrupt: true } });
    expect(r.preview).toBe(true);
    expect(r.partial).toBe(false);
    expect(r.state).toBe("TRADING_ALLOWED");
    expect(breakerForPrompt(r)).toContain("معاينة");
  });
});

describe("survival defaults", () => {
  const loss = [close(-300, "2026-10-14T10:00:00+03:00")];

  it("defaults-only → ALLOWED with a warning until accepted", () => {
    const r = run(WED, { settings: NONE, limitsAcceptedAt: null, trades: loss });
    expect(r.state).toBe("TRADING_ALLOWED");
    expect(r.limits[0]).toMatchObject({ rule: "max_daily_loss", threshold: 200, source: "default", binding: false });
    expect(r.warnings[0]).toMatchObject({ kind: "limits_not_active" });
    expect(r.warnings.some((w) => w.kind === "default_would_trigger" && w.rule === "max_daily_loss")).toBe(true);
    expect(breakerCopy(r).chip).toBe("التداول مسموح");
    expect(breakerCopy(r).tone).toBe("warning");

    expect(run(WED, { settings: NONE, limitsAcceptedAt: SINCE, trades: loss }).state).toBe("HALTED");
  });

  it("a limit he set binds before the defaults are accepted, and is never replaced", () => {
    const r = run(WED, { settings: { ...NONE, max_daily_loss: 250 }, limitsAcceptedAt: null, trades: loss });
    expect(r.triggers[0]).toMatchObject({ rule: "max_daily_loss", threshold: 250 });
    expect(r.limits.find((l) => l.rule === "weekly_drawdown_halt")).toMatchObject({ source: "default", binding: false });
  });
});

describe("manual pause and cooldown", () => {
  const paused = { ...OWN, trading_paused: true };

  it("paused_until in the past → ALLOWED", () => {
    expect(run(WED, { settings: paused, pausedUntil: "2026-10-14T00:00:00+03:00" }).state).toBe("TRADING_ALLOWED");
  });

  it("paused for today → HALTED until the next day start", () => {
    const r = run(WED, { settings: paused, pausedUntil: "2026-10-15T00:00:00+03:00" });
    expect(rules(r)).toEqual(["manual_pause"]);
    expect(r.releaseAt?.toISOString()).toBe("2026-10-14T21:00:00.000Z");
  });

  it("no end is an explicit «لين أرجّعه», flagged for a daily reminder", () => {
    const r = run(WED, { settings: paused, pausedUntil: null });
    expect(r.triggers[0]).toMatchObject({ rule: "manual_pause", indefinite: true, releaseAt: null });
    expect(breakerCopy(r).release).toBe("لين ترجّعه بنفسك");
  });

  it("a manual cooldown is COOLDOWN until it ends", () => {
    const r = run(WED, { settings: { ...OWN, cooldown_until: "2026-10-14T16:00:00+03:00" } });
    expect(r.state).toBe("COOLDOWN");
    expect(rules(r)).toEqual(["manual_cooldown"]);
  });
});

describe("state", () => {
  it("the strictest state wins and every triggered rule is kept", () => {
    const trades = [close(-100, "2026-10-14T10:00:00+03:00"), close(-100, "2026-10-14T11:00:00+03:00")];
    const r = run(WED, { trades });
    expect(r.state).toBe("HALTED");
    expect(rules(r)).toEqual(["max_daily_loss", "losing_streak_cooldown"]);
    // Trading is back only when both have ended: the cooldown outlasts tonight's midnight.
    expect(r.releaseAt?.toISOString()).toBe("2026-10-15T08:00:00.000Z");
  });

  it("reaching max trades is not a breaker state (it's the protect-profit warning)", () => {
    const settings = { ...OWN, max_trades_per_day: 3, max_daily_profit: 0 };
    const trades = [10, 11, 12].map((h) => close(10, `2026-10-14T${h}:00:00+03:00`));
    expect(run(WED, { settings, trades }).state).toBe("TRADING_ALLOWED");
    expect(protectProfit({ tradesToday: 3, todayPnl: 30 }, settings)).toMatchObject({ maxTrades: true, profitCap: false });
  });
});

describe("latched halts", () => {
  const row = {
    rule: "max_daily_loss", state: "HALTED", period_key: "2026-10-16", threshold: 200, observed: 200,
    active_until: MONDAY_19, released_at: null,
  };

  it("a latched row survives a pnl edit", () => {
    const edited = [close(50, "2026-10-16T10:00:00+03:00")];
    const r = run("2026-10-16T15:00:00+03:00", { trades: edited, latched: [row] });
    expect(r.state).toBe("HALTED");
    expect(r.triggers[0]).toMatchObject({ rule: "max_daily_loss", latched: true });
    expect(r.releaseAt?.toISOString()).toBe(MONDAY_19);
    // Still held over the weekend, when the day's own P&L has reset.
    expect(run("2026-10-17T12:00:00+03:00", { trades: edited, latched: [row] }).state).toBe("HALTED");
  });

  it("a released or expired row no longer blocks", () => {
    expect(run("2026-10-16T15:00:00+03:00", { latched: [{ ...row, released_at: "2026-10-16T14:00:00+03:00" }] }).state).toBe("TRADING_ALLOWED");
    expect(run("2026-10-19T09:00:00+03:00", { latched: [row] }).state).toBe("TRADING_ALLOWED");
  });

  it("a computed trigger and its latched row are one rule", () => {
    const r = run("2026-10-16T15:00:00+03:00", { trades: [close(-200, "2026-10-16T10:00:00+03:00")], latched: [row] });
    expect(rules(r)).toEqual(["max_daily_loss"]);
    expect(r.triggers[0]!.latched).toBe(true);
  });
});

describe("copy and prompt", () => {
  it("quotes the room left before each limit", () => {
    const r = run(WED, { trades: [close(-80, "2026-10-14T10:00:00+03:00")] });
    const p = breakerForPrompt(r);
    expect(p).toContain("قاطع الحماية: التداول مسموح");
    expect(p).toContain("باقي لك 120$ (1.2%) قبل إيقاف اليوم");
    expect(p).toContain("باقي لك 420$ (4.2%) قبل إيقاف الأسبوع");
    expect(breakerCopy(r)).toMatchObject({ chip: "التداول مسموح", tone: "success", reason: "باقي لك 120$ (1.2%) قبل إيقاف اليوم", release: null });
    expect(breakerForPrompt(r, "SAR")).toContain("باقي لك 120 SAR (1.2%) قبل إيقاف اليوم");
  });

  it("a halt names the reason and the release weekday, date and time", () => {
    const r = run("2026-10-16T23:59:00+03:00", { trades: [close(-200, "2026-10-16T23:30:00+03:00")] });
    const c = breakerCopy(r);
    expect(c).toMatchObject({ chip: "التداول موقوف", tone: "destructive", release: "يرجع التداول الاثنين 19/10 00:00" });
    expect(c.reason).toContain("خسارة اليوم 200$ وصلت حدّك 200$");
    expect(breakerForPrompt(r)).toContain("يرجع التداول: الاثنين 19/10 00:00");
  });

  it("cooldown and broken data read differently", () => {
    const streak = run("2026-10-14T23:55:00+03:00", {
      trades: [close(-50, "2026-10-14T23:40:00+03:00"), close(-50, "2026-10-14T23:50:00+03:00")],
    });
    expect(breakerCopy(streak)).toMatchObject({ chip: "تهدئة", tone: "warning", release: "يرجع التداول الخميس 15/10 23:50" });
    expect(breakerCopy(streak).reason).toMatch(/^خسارتين ورا بعض/);

    const broken = run(WED, { trades: [close(null, "2026-10-14T10:00:00+03:00")] });
    expect(breakerCopy(broken)).toMatchObject({ chip: "بيانات ناقصة", tone: "destructive", release: "لين تصلّح البيانات" });
  });
});
