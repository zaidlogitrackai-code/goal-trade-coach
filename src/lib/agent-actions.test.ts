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
import { actionIssue, DESTRUCTIVE, isClosedUpload, parseAction, screenActions, VERDICT_MSG } from "./agent-action-spec";
import { AlreadySaved, NeedsConfirmation, runAction } from "./agent-actions";

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
  it("drops null and '' keys instead of turning them into 0 (a limit switched off)", () => {
    expect(
      parseAction({
        type: "update_settings",
        summary: "",
        data: '{"max_daily_loss":null,"weekly_max_loss":"","monthly_max_loss":" ","daily_target":100}',
      }),
    ).toEqual({ daily_target: 100 });
  });
  it("takes only an ISO currency, booking USDT as USD", () => {
    const cur = (c: string) => parseAction({ type: "update_settings", summary: "", data: JSON.stringify({ currency: c }) });
    expect(cur("usdt")).toEqual({ currency: "USD" });
    expect(cur("SAR")).toEqual({ currency: "SAR" });
    expect(cur("XYZ")).toBeNull();
    expect(actionIssue({ type: "update_settings", summary: "", data: '{"currency":"XYZ"}' })).toContain("ISO");
  });
  it("sets session hours as HH:MM and refuses a broken time", () => {
    expect(
      parseAction({ type: "update_settings", summary: "", data: '{"session_start":"9:00","session_end":"17:30:00"}' }),
    ).toEqual({ session_start: "09:00", session_end: "17:30" });
    expect(parseAction({ type: "update_settings", summary: "", data: '{"session_start":"25:00"}' })).toBeNull();
    expect(actionIssue({ type: "update_settings", summary: "", data: '{"session_end":"late"}' })).toContain("17:00");
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

describe("an unknown action type is rejected", () => {
  beforeEach(() => {
    db.rows = {};
    db.writes = [];
  });
  const unknown = { type: "drop_tables" as never, summary: "", data: "{}" };
  it("is never parsed, says why, and never writes", async () => {
    expect(parseAction(unknown)).toBeNull();
    expect(actionIssue(unknown)).toBe("إجراء غير معروف");
    // A plain failure, not a card waiting for a click.
    const run = runAction(unknown, { auto: true });
    await expect(run).rejects.toThrow("إجراء غير معروف");
    await expect(run).rejects.not.toBeInstanceOf(NeedsConfirmation);
    expect(db.writes).toEqual([]);
  });
  it("is dropped on the server before it is saved", () => {
    expect(screenActions([unknown], "day").actions).toEqual([]);
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

  it("an open trade outside his markets is still journaled, with a note (owner decision 4)", async () => {
    db.rows["knowledge_notes"] = [{ id: "f1", content: JSON.stringify({ markets: ["XAUUSD"] }) }];
    const data = JSON.stringify({ symbol: "GBPUSD", direction: "short", entry_price: 1.27, stop_loss: 1.275, position_size: 0.1, status: "open" });
    const r = await runAction({ type: "create_trade", summary: "", data }, { auto: true });
    expect(r.note).toContain("برّا سوقك");
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ table: "trades", op: "insert", payload: { symbol: "GBPUSD", risk_amount: 50 } });
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
  it("the same zone again, or tightening against the live limit, still runs by itself", async () => {
    db.rows["trading_settings"] = settings as never;
    await runAction({ type: "update_settings", summary: "", data: '{"timezone":"Asia/Riyadh","max_daily_loss":150}' }, { auto: true });
    expect(db.writes.some((w) => w.table === "trading_settings" && w.op === "upsert")).toBe(true);
  });
  it("today's start balance anchors the limit, so a loss today can't make a raise look like tightening", async () => {
    // Start of day 10,000 → 200 in force; the live balance has fallen to 8,000 (→ 160).
    db.rows["trading_settings"] = settings as never;
    db.rows["daily_plans"] = { start_balance: 10_000 } as never;
    db.rows["trades"] = [{ status: "closed", pnl: -2000, opened_at: "2026-02-01T09:00:00Z", closed_at: "2026-02-01T10:00:00Z" }];
    await runAction({ type: "update_settings", summary: "", data: '{"max_daily_loss":180}' }, { auto: true });
    expect(db.writes.some((w) => w.table === "trading_settings" && w.op === "upsert")).toBe(true);
  });
});

describe("update_settings goes through the one validator", () => {
  beforeEach(() => {
    db.rows = {};
    db.writes = [];
  });
  const row = { user_id: "u1", starting_balance: 10_000, created_at: "2026-01-01T00:00:00Z", max_daily_loss: 300, currency: "USD", timezone: "Asia/Riyadh" };
  it("refuses a weekly loss limit below the daily one", async () => {
    db.rows["trading_settings"] = row as never;
    await expect(runAction({ type: "update_settings", summary: "", data: '{"weekly_max_loss":100}' })).rejects.toThrow("حد الخسارة الأسبوعي");
    expect(db.writes).toEqual([]);
  });
  it("an old conflict on file doesn't block an unrelated change", async () => {
    db.rows["trading_settings"] = { ...row, weekly_max_loss: 100 } as never;
    await runAction({ type: "update_settings", summary: "", data: '{"daily_target":50}' });
    expect(db.writes.some((w) => w.table === "trading_settings" && w.op === "upsert")).toBe(true);
  });
  it("refuses only one session end", async () => {
    db.rows["trading_settings"] = row as never;
    await expect(runAction({ type: "update_settings", summary: "", data: '{"session_start":"09:00"}' })).rejects.toThrow("الجلسة");
    expect(db.writes).toEqual([]);
  });
});
