import { DESTRUCTIVE } from "./agent-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A chainable stand-in for the Supabase client: every read of a table resolves to
// db.rows[table], and every write is recorded so a test can prove it never happened.
const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  writes: [] as { table: string; op: string; payload: unknown }[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const q: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then")
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
              Promise.resolve({ data: db.rows[table] ?? [], error: null }).then(ok, ko);
          return (payload?: unknown) => {
            if (["insert", "update", "upsert", "delete"].includes(String(prop)))
              db.writes.push({ table, op: String(prop), payload });
            return q;
          };
        },
      },
    );
    return q;
  };
  return { supabase: { from, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } };
});
import {
  actionIssue,
  AlreadySaved,
  isClosedUpload,
  loosenedLimits,
  NeedsConfirmation,
  parseAction,
  runAction,
  VERDICT_MSG,
} from "./agent-actions";

describe("agent actions", () => {
  it("accepts valid settings with weekly/monthly targets", () => {
    expect(
      parseAction({
        type: "update_settings",
        summary: "",
        data: '{"weekly_target":500,"monthly_max_loss":"1500"}',
      }),
    ).toEqual({ weekly_target: 500, monthly_max_loss: 1500 });
  });
  it("lets سَنَد set a real IANA time zone, never a typo", () => {
    expect(parseAction({ type: "update_settings", summary: "", data: '{"timezone":"Asia/Dubai"}' })).toEqual({ timezone: "Asia/Dubai" });
    expect(parseAction({ type: "update_settings", summary: "", data: '{"timezone":"Riyadh"}' })).toBeNull();
  });
  it("rejects negative limits and unknown types", () => {
    expect(
      parseAction({ type: "update_settings", summary: "", data: '{"max_daily_loss":-5}' }),
    ).toBeNull();
    expect(parseAction({ type: "delete_all" as never, summary: "", data: "{}" })).toBeNull();
  });
  it("parses the new management actions", () => {
    expect(
      parseAction({
        type: "update_rule",
        summary: "",
        data: '{"title":"لا تداول بعد خسارتين","active":false}',
      }),
    ).toMatchObject({ active: false });
    expect(
      parseAction({
        type: "start_session",
        summary: "",
        data: '{"plan":"ذهب فقط، صفقتين كحد أقصى"}',
      }),
    ).toMatchObject({ plan: "ذهب فقط، صفقتين كحد أقصى" });
    expect(parseAction({ type: "start_cooldown", summary: "", data: '{"minutes":"30"}' })).toEqual({
      minutes: 30,
    });
    expect(parseAction({ type: "mark_notifications_read", summary: "", data: "{}" })).toEqual({});
  });
  it("requires a target for trade edits and deletes", () => {
    expect(parseAction({ type: "update_trade", summary: "", data: '{"notes":"x"}' })).toBeNull();
    expect(parseAction({ type: "delete_trade", summary: "", data: '{"symbol":"XAUUSD"}' })).toEqual(
      { symbol: "XAUUSD" },
    );
  });
  it("never auto-runs deletions", async () => {
    await expect(
      runAction({ type: "delete_rule", summary: "", data: '{"title":"x"}' }, { auto: true }),
    ).rejects.toBeInstanceOf(NeedsConfirmation);
  });
});

describe("loosenedLimits", () => {
  const current = {
    max_daily_loss: 100,
    max_trades_per_day: 3,
    max_risk_per_trade: 0,
    cooldown_minutes: 30,
  };
  it("flags raised or disabled limits and shorter cooldowns", () => {
    expect(loosenedLimits(current, { max_daily_loss: 200 })).toEqual(["max_daily_loss"]);
    expect(loosenedLimits(current, { max_trades_per_day: 0 })).toEqual(["max_trades_per_day"]);
    expect(loosenedLimits(current, { cooldown_minutes: 10 })).toEqual(["cooldown_minutes"]);
  });
  it("lets tightening and targets through", () => {
    expect(
      loosenedLimits(current, {
        max_daily_loss: 50,
        max_risk_per_trade: 20,
        daily_target: 300,
        cooldown_minutes: 60,
      }),
    ).toEqual([]);
    expect(loosenedLimits(null, { max_daily_loss: 100 })).toEqual([]);
  });
});
describe("sanad deletions need approval", () => {
  it("new delete actions never auto-run", () => {
    for (const t of ["remove_trade_image", "delete_violation", "delete_daily_plan", "delete_session", "delete_notifications"] as const)
      expect(DESTRUCTIVE).toContain(t);
  });
});

describe("delete_notifications hides, never deletes", () => {
  beforeEach(() => {
    db.rows = {};
    db.writes = [];
  });
  it("issues an update to dismissed, never a delete", async () => {
    await runAction({ type: "delete_notifications", summary: "", data: "{}" });
    expect(db.writes).toEqual([{ table: "notifications", op: "update", payload: { dismissed: true, read: true } }]);
    expect(db.writes.some((w) => w.op === "delete")).toBe(false);
  });
  it("still waits for a click in auto mode", async () => {
    await expect(runAction({ type: "delete_notifications", summary: "", data: "{}" }, { auto: true })).rejects.toBeInstanceOf(NeedsConfirmation);
    expect(db.writes).toEqual([]);
  });
});

describe("MT5 screenshots never close an open trade by floating P&L", () => {
  it("an open trade with pnl -35 and no exit_price stays open", () => {
    expect(isClosedUpload({ pnl: -35 })).toBe(false);
    expect(isClosedUpload({ status: "open", pnl: -35 })).toBe(false);
    expect(isClosedUpload({ status: "open", exit_price: 1.0812 })).toBe(false);
    expect(isClosedUpload({ status: "closed" })).toBe(true);
    expect(isClosedUpload({ exit_price: 1.0812 })).toBe(true);
    // A garbled status no longer turns into "open" and hides a real exit price.
    expect(parseAction({ type: "create_trade", summary: "", data: '{"direction":"long","status":"مغلقة"}' })).toMatchObject({ status: undefined });
  });

  const openRow = { id: "11111111-1111-4111-8111-111111111111", symbol: "EURUSD", direction: "long", entry_price: 1.085, status: "open", opened_at: new Date().toISOString() };
  beforeEach(() => {
    db.rows = { trades: [openRow] };
    db.writes = [];
  });

  it("a re-upload with floating P&L never closes the open duplicate", async () => {
    const data = JSON.stringify({ symbol: "EURUSD", direction: "long", entry_price: 1.085, status: "open", pnl: -35 });
    await expect(runAction({ type: "create_trade", summary: "", data }, { auto: true })).rejects.toBeInstanceOf(AlreadySaved);
    const noStatus = JSON.stringify({ symbol: "EURUSD", direction: "long", entry_price: 1.085, pnl: -35 });
    await expect(runAction({ type: "create_trade", summary: "", data: noStatus }, { auto: true })).rejects.toBeInstanceOf(AlreadySaved);
    expect(db.writes).toEqual([]);
  });

  it("a History-tab re-upload with an exit price does close it", async () => {
    const data = JSON.stringify({ symbol: "EURUSD", direction: "long", entry_price: 1.085, status: "closed", exit_price: 1.088, pnl: 30 });
    await runAction({ type: "create_trade", summary: "", data }, { auto: true });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ table: "trades", op: "update", payload: { status: "closed", pnl: 30, exit_price: 1.088 } });
  });
});

describe("training example verdicts are never guessed", () => {
  const ex = (verdict: unknown) => ({ type: "add_strategy_example" as const, summary: "", data: JSON.stringify({ verdict, reason: "كسر الهيكل" }) });
  it("maps Arabic and English words", () => {
    expect(parseAction(ex("غلط"))).toMatchObject({ verdict: "bad" });
    expect(parseAction(ex("خطأ"))).toMatchObject({ verdict: "bad" });
    expect(parseAction(ex("صح"))).toMatchObject({ verdict: "good" });
    expect(parseAction(ex("صحيح"))).toMatchObject({ verdict: "good" });
    expect(parseAction(ex(" Good "))).toMatchObject({ verdict: "good" });
    expect(parseAction(ex("bad"))).toMatchObject({ verdict: "bad" });
  });
  it("rejects anything else and asks which one", async () => {
    for (const v of ["Wrong", "", null, undefined, 1]) {
      expect(parseAction(ex(v))).toBeNull();
      expect(actionIssue(ex(v))).toBe(VERDICT_MSG);
    }
    await expect(runAction(ex("Wrong"))).rejects.toThrow(VERDICT_MSG);
  });
  it("keeps the generic note for zod's own errors", () => {
    expect(actionIssue({ type: "add_rule", summary: "", data: "{}" })).toBe("بيانات ناقصة");
    expect(actionIssue({ type: "add_rule", summary: "", data: '{"title":"x"}' })).toBeNull();
  });
});

describe("auto mode never loosens a limit without a click", () => {
  beforeEach(() => {
    db.rows = {};
    db.writes = [];
  });
  // Stored dollars are stale after losses: 2% of today's 10,000 balance is 200, not the 300 on file.
  const settings = {
    user_id: "u1",
    starting_balance: 10_000,
    created_at: "2026-01-01T00:00:00Z",
    max_daily_loss: 300,
    limits_pct: { max_daily_loss: 2 },
    timezone: "Asia/Riyadh",
  };
  it("judges a raise against the limit in force (pct of the live balance), not the stale dollars", async () => {
    db.rows["trading_settings"] = settings as never;
    await expect(
      runAction({ type: "update_settings", summary: "", data: '{"max_daily_loss":250}' }, { auto: true }),
    ).rejects.toBeInstanceOf(NeedsConfirmation);
    expect(db.writes).toEqual([]);
  });
  it("tightening below the limit in force still runs by itself", async () => {
    db.rows["trading_settings"] = settings as never;
    await runAction({ type: "update_settings", summary: "", data: '{"max_daily_loss":150}' }, { auto: true });
    expect(db.writes.some((w) => w.table === "trading_settings" && w.op === "upsert")).toBe(true);
  });
  it("a new time zone moves today's start, so it waits for a click too", async () => {
    db.rows["trading_settings"] = settings as never;
    await expect(
      runAction({ type: "update_settings", summary: "", data: '{"timezone":"Pacific/Kiritimati"}' }, { auto: true }),
    ).rejects.toBeInstanceOf(NeedsConfirmation);
    expect(db.writes).toEqual([]);
  });
  it("raising the daily profit cap is a loosening (it is the anti-greed stop)", () => {
    expect(loosenedLimits({ max_daily_profit: 300 }, { max_daily_profit: 600 })).toEqual(["max_daily_profit"]);
    expect(loosenedLimits({ max_daily_profit: 300 }, { max_daily_profit: 0 })).toEqual(["max_daily_profit"]);
  });
  it("the same zone again, or tightening against the live limit, still runs by itself", () => {
    expect(loosenedLimits({ ...settings, max_daily_loss: 200 }, { timezone: "Asia/Riyadh", max_daily_loss: 150 })).toEqual([]);
  });
});
