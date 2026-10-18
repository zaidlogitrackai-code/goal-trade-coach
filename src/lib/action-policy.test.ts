import { describe, expect, it } from "vitest";
import { loosenedPlan, loosenedSettings, loosenedTrade, needsApproval, type PolicyContext } from "./action-policy";
import { ACTION_CLASS, ACTION_TYPES, AGENT_MODES, allowedActions, DESTRUCTIVE, isDestructive, screenActions, type ActionType } from "./agent-action-spec";
import { evaluateBreaker } from "./circuit-breaker";
import { anchorBalance, applyPctLimits } from "./effective-limits";
import { evaluatePreTrade, type GateInput } from "./pre-trade-gate";

const ask = (type: ActionType, data: Record<string, unknown>, ctx: PolicyContext = {}) => needsApproval({ type, data }, ctx);
const ALLOWED = { state: "TRADING_ALLOWED", partial: false, preview: false } as const;
const COOLDOWN = { state: "COOLDOWN", partial: false, preview: false } as const;

describe("limits are judged against the ones in force, anchored on the day's start balance", () => {
  it("tightening against stale raw $ → auto", () => {
    // 100$ on file is from a smaller balance; 2% of today's 15,000 start is 300 in force.
    const onFile = { max_daily_loss: 100, limits_pct: { max_daily_loss: 2 }, timezone: "Asia/Riyadh" };
    const limits = applyPctLimits(onFile, anchorBalance({ start_balance: 15_000 }, 14_200));
    expect(limits.max_daily_loss).toBe(300);
    expect(ask("update_settings", { max_daily_loss: 250 }, { limits }).click).toBe(false);
    // Against the stale dollars the same change would have looked like a loosening.
    expect(loosenedSettings(onFile, { max_daily_loss: 250 })).toHaveLength(1);
  });
  it("loosening against effective → click", () => {
    // 300$ on file, but 2% of today's 10,000 start is 200: 250 is looser than what is in force.
    const limits = applyPctLimits({ max_daily_loss: 300, limits_pct: { max_daily_loss: 2 } }, anchorBalance({ start_balance: 10_000 }, 9_800));
    const v = ask("update_settings", { max_daily_loss: 250 }, { limits });
    expect(v).toMatchObject({ class: "STATE", click: true });
    expect(v.reason).toContain("حد الخسارة اليومي");
    // A loss taken during the day doesn't shrink today's limit: 9,800 live still anchors on 10,000.
    expect(ask("update_settings", { max_daily_loss: 199 }, { limits }).click).toBe(false);
  });
  it("raising the profit cap → click, and so does switching it off", () => {
    const limits = { max_daily_profit: 300, daily_target: 100 };
    expect(ask("update_settings", { max_daily_profit: 600 }, { limits }).click).toBe(true);
    expect(ask("update_settings", { max_daily_profit: 0 }, { limits }).click).toBe(true);
    expect(ask("update_settings", { daily_target: 150 }, { limits }).click).toBe(true);
    expect(ask("update_settings", { max_daily_profit: 200, daily_target: 80 }, { limits }).click).toBe(false);
    // Setting a cap for the first time protects more.
    expect(ask("update_settings", { max_daily_profit: 200 }, { limits: {} }).click).toBe(false);
  });
  it("lowering a cooldown → click", () => {
    const limits = { cooldown_minutes: 30, streak_cooldown_hours: 24 };
    expect(ask("update_settings", { cooldown_minutes: 15 }, { limits }).click).toBe(true);
    expect(ask("update_settings", { streak_cooldown_hours: 12 }, { limits }).click).toBe(true);
    expect(ask("update_settings", { cooldown_minutes: 60, streak_cooldown_hours: 48 }, { limits }).click).toBe(false);
    // 0 hours is the breaker's 24h default, so it changes nothing here.
    expect(ask("update_settings", { streak_cooldown_hours: 0 }, { limits }).click).toBe(false);
    expect(ask("update_settings", { streak_cooldown_hours: 0 }, { limits: { streak_cooldown_hours: 48 } }).click).toBe(true);
  });
  it("a bigger starting balance, a new zone or a dropped streak limit wait; nothing on file yet never does", () => {
    const limits = { starting_balance: 10_000, max_consecutive_losses: 2, timezone: "Asia/Riyadh" };
    expect(ask("update_settings", { starting_balance: 12_000 }, { limits }).click).toBe(true);
    expect(ask("update_settings", { starting_balance: 9_000 }, { limits }).click).toBe(false);
    expect(ask("update_settings", { timezone: "Pacific/Kiritimati" }, { limits }).click).toBe(true);
    expect(ask("update_settings", { timezone: "Asia/Riyadh" }, { limits }).click).toBe(false);
    expect(ask("update_settings", { max_consecutive_losses: 0 }, { limits }).reason).toContain("إلغاء الخسائر المتتالية");
    expect(loosenedSettings(null, { max_daily_loss: 500, timezone: "Asia/Dubai" })).toEqual([]);
    // Limits nobody read are never assumed tighter.
    expect(ask("update_settings", { max_daily_loss: 50 }).click).toBe(true);
    expect(ask("set_daily_plan", { target: 50 }).click).toBe(true);
  });
});

describe("today's plan, trades, rules, strategies and capital", () => {
  const plan = { target: 100, max_trades: 2, risk_per_trade: 50, max_loss: 100 };
  it("raising the plan after a trade waits; before the first trade it is still planning", () => {
    expect(ask("set_daily_plan", { target: 200 }, { plan, tradesToday: 1 }).click).toBe(true);
    expect(ask("set_daily_plan", { max_trades: 0 }, { plan, tradesToday: 1 }).click).toBe(true);
    expect(ask("set_daily_plan", { target: 200 }, { plan, tradesToday: 0 }).click).toBe(false);
    expect(ask("set_daily_plan", { risk_per_trade: 40, max_loss: 80 }, { plan, tradesToday: 3 }).click).toBe(false);
    expect(loosenedPlan(null, 2, { target: 500 })).toEqual([]);
    // Unknown count: judged as if he traded.
    expect(loosenedPlan(plan, undefined, { target: 500 })).toHaveLength(1);
  });
  it("a closed trade's result waits; a stop only when it moves away or goes", () => {
    const closed = { status: "closed", pnl: -50, exit_price: 1.095 };
    expect(ask("update_trade", { trade_id: "t", pnl: -20 }, { target: closed }).click).toBe(true);
    expect(ask("update_trade", { trade_id: "t", pnl: -50, notes: "x" }, { target: closed }).click).toBe(false);
    const long = { status: "open", direction: "long", stop_loss: 1.095 };
    expect(loosenedTrade(long, { stop_loss: 1.09 })).toEqual(["توسيع وقف الخسارة"]);
    expect(loosenedTrade(long, { stop_loss: null })).toEqual(["شيل وقف الخسارة"]);
    expect(loosenedTrade(long, { stop_loss: 1.1 })).toEqual([]);
    expect(loosenedTrade({ status: "open", direction: "short", stop_loss: 1.1 }, { stop_loss: 1.105 })).toHaveLength(1);
    // A stop where there was none only protects him.
    expect(ask("update_trade", { trade_id: "t", stop_loss: 1.09 }, { target: { status: "open", direction: "long", stop_loss: null } }).click).toBe(false);
    // A row we couldn't read is judged strictly.
    expect(loosenedTrade(null, { stop_loss: 1.09 })).toHaveLength(1);
  });
  it("switching a rule off or a banned strategy back on waits", () => {
    expect(ask("update_rule", { title: "x", active: false }, { target: { active: true } }).click).toBe(true);
    expect(ask("update_rule", { title: "x", active: false }, { target: { active: false } }).click).toBe(false);
    expect(ask("update_rule", { title: "x", active: true }, { target: { active: false } }).click).toBe(false);
    expect(ask("update_strategy", { name: "x", allowed: true }, { target: { allowed: false } }).click).toBe(true);
    expect(ask("update_strategy", { name: "x", allowed: false }, { target: { allowed: true } }).click).toBe(false);
  });
  it("a set balance or a withdrawal waits, a deposit runs", () => {
    expect(ask("capital_move", { kind: "set_balance", amount: 9_000 }).click).toBe(true);
    expect(ask("capital_move", { kind: "withdrawal", amount: 500 }).click).toBe(true);
    expect(ask("capital_move", { kind: "deposit", amount: 500 }).click).toBe(false);
  });
});

describe("AI-logged trades (owner decision 4)", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const ticket = { symbol: "EURUSD", direction: "long", entry: 1.1, stop: 1.095, lots: 0.1, openedAt: "2026-10-14T09:50:00Z" };
  const trade = { symbol: "EURUSD", direction: "long", entry_price: 1.1, stop_loss: 1.095, position_size: 0.1, status: "open" };
  const allowed = evaluateBreaker({ settings: { max_daily_loss: 200 }, startBalance: 10_000, balance: 10_000, trades: [], tz: "Asia/Riyadh", breakerSince: "2026-01-01T00:00:00Z", limitsAcceptedAt: "2026-01-01T00:00:00Z", now });
  const gate = (over: Partial<GateInput>) =>
    evaluatePreTrade({ intent: "already_placed", ticket, answers: null, breaker: allowed, settings: { max_risk_per_trade: 100 }, plan: { risk_per_trade: 100 }, now, ...over });

  it("an already_placed trade while ALLOWED with null answers → auto", () => {
    expect(allowed.state).toBe("TRADING_ALLOWED");
    const g = gate({});
    // Blank answers make it a review, and a review never holds the card back.
    expect(g.decision).toBe("REVIEW_REQUIRED");
    expect(ask("create_trade", trade, { breaker: allowed, gate: g.decision })).toMatchObject({ class: "JOURNAL", click: false, askReason: false, note: null });
  });
  it("the same trade during COOLDOWN is journaled by itself and flagged; before the entry it waits", () => {
    const v = ask("create_trade", trade, { breaker: COOLDOWN, gate: "NO_GO" });
    // It is in his account already: a waiting card would only hide it from the breaker.
    expect(v).toMatchObject({ click: false, askReason: true });
    expect(v.note).toContain("لا تدخل");
    expect(ask("create_trade", trade, { intent: "pre_entry", breaker: COOLDOWN }).click).toBe(true);
    expect(ask("create_trade", trade, { intent: "pre_entry", breaker: { state: "HALTED", partial: true, preview: false } }).click).toBe(true);
    // Before breaker_since the breaker only warns.
    expect(ask("create_trade", trade, { intent: "pre_entry", breaker: { ...COOLDOWN, preview: true } }).click).toBe(false);
  });
  it("an explicit NO_GO → click before the entry; once placed it is journaled with a reason to give", () => {
    const g = gate({ intent: "pre_entry", answers: { not_revenge: false } });
    expect(g.decision).toBe("NO_GO");
    expect(ask("create_trade", trade, { intent: "pre_entry", breaker: allowed, gate: g.decision }).click).toBe(true);
    expect(ask("create_trade", trade, { breaker: allowed, gate: "NO_GO" })).toMatchObject({ click: false, askReason: true });
    expect(ask("create_trade", trade, { intent: "pre_entry", breaker: allowed, gate: "REVIEW_REQUIRED" }).click).toBe(false);
  });
  it("closed history always runs; a market off his list is said, and waits only before the entry", () => {
    expect(ask("create_trade", { ...trade, status: "closed", pnl: -30 }, { breaker: COOLDOWN, gate: "NO_GO" })).toMatchObject({ click: false, askReason: false });
    const off = ask("create_trade", { ...trade, symbol: "GBPUSD" }, { focusMarkets: ["EURUSD"] });
    expect(off).toMatchObject({ click: false });
    expect(off.note).toContain("برّا سوقك");
    expect(ask("create_trade", { ...trade, symbol: "GBPUSD" }, { intent: "pre_entry", focusMarkets: ["EURUSD"] }).click).toBe(true);
  });
});

describe("action classes", () => {
  it("destructive → always a click", () => {
    expect(DESTRUCTIVE.length).toBeGreaterThan(10);
    for (const t of DESTRUCTIVE) {
      expect(isDestructive(t)).toBe(true);
      expect(ask(t, {}, { breaker: ALLOWED, limits: {} })).toMatchObject({ class: "DESTRUCTIVE", click: true });
    }
  });
  it("everything else runs by itself on a stopped day unless it loosens (owner decision 3)", () => {
    expect(ask("add_violation", { note: "x" }, { breaker: { state: "HALTED", partial: false, preview: false } }).click).toBe(false);
    expect(ask("add_rule", { title: "x" }, { breaker: COOLDOWN }).click).toBe(false);
    expect(ask("start_cooldown", { minutes: 60 }, { breaker: COOLDOWN }).click).toBe(false);
    expect(ask("update_settings", { max_daily_loss: 100 }, { breaker: COOLDOWN, limits: { max_daily_loss: 200 } }).click).toBe(false);
  });
  it("every action has a class, and every mode only names real actions", () => {
    for (const t of ACTION_TYPES) expect(["JOURNAL", "STATE", "DESTRUCTIVE"]).toContain(ACTION_CLASS[t]);
    for (const m of AGENT_MODES) for (const t of allowedActions(m)) expect(ACTION_TYPES).toContain(t);
    expect(allowedActions("setup")).toEqual(["update_settings", "add_strategy", "add_rule", "update_focus"]);
    expect(allowedActions("day")).toEqual([...ACTION_TYPES]);
    expect(allowedActions("analyst").some(isDestructive)).toBe(false);
    expect(allowedActions("analyst")).not.toContain("update_settings");
    expect(allowedActions("manager")).not.toContain("create_trade");
  });
  it("the server keeps only what the mode may run", () => {
    const raw = [
      { type: "save_analysis", summary: "تحليل", data: '{"result":"x"}' },
      { type: "update_settings", summary: "رفع الحد", data: '{"max_daily_loss":900}' },
      { type: "delete_all", summary: "", data: "{}" },
      { type: "create_trade", summary: "صفقة", data: '{"direction":"long"}' },
      "garbage",
    ];
    const r = screenActions(raw, "analyst");
    expect(r.actions.map((a) => a.type)).toEqual(["save_analysis", "create_trade"]);
    expect(r.dropped).toEqual(["update_settings", "delete_all", "?"]);
    expect(screenActions(raw, "day").actions).toHaveLength(3);
    expect(screenActions(null, "day")).toEqual({ actions: [], dropped: [] });
  });
});
