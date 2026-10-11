import { describe, expect, it } from "vitest";
import { evaluateTradeGate, overrideNote, type GateInput, type GateSettings } from "./trade-gate";
import type { StatusTrade } from "./trading-status";

const now = new Date("2026-10-11T12:00:00");
const settings: GateSettings = {
  starting_balance: 10000,
  daily_target: 200,
  max_daily_profit: 500,
  max_daily_loss: 300,
  max_trades_per_day: 5,
  max_risk_per_trade: 100,
  max_daily_risk: 250,
  max_consecutive_losses: 3,
  trading_paused: false,
};
const goodDraft = {
  direction: "long",
  entry: 100,
  stop: 99,
  target: 103,
  size: 50,
  strategyId: "s1",
};
const closed = (pnl: number, h: number, risk = 10): StatusTrade => ({
  status: "closed",
  pnl,
  risk_amount: risk,
  opened_at: `2026-10-11T0${h}:00:00`,
  closed_at: `2026-10-11T0${h}:30:00`,
});
const gate = (over: Partial<GateInput> = {}) =>
  evaluateTradeGate({
    settings,
    trades: [],
    violationsToday: 0,
    hasActiveSession: true,
    draft: goodDraft,
    now,
    ...over,
  });
const codes = (r: ReturnType<typeof gate>) => r.reasons.map((x) => x.code);

describe("trade gate", () => {
  it("1. accepts a trade inside every limit", () => {
    const r = gate();
    expect(r.allowed).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.calc.risk).toBe(50);
    expect(r.calc.rr).toBe(3);
  });

  it("2. a trade without a stop loss needs a written exception", () => {
    const r = gate({ draft: { ...goodDraft, stop: null, riskInput: 40 } });
    expect(r.allowed).toBe(false);
    expect(codes(r)).toContain("no_stop_loss");
    expect(r.canOverride).toBe(true);
  });

  it("3. exceeding the daily risk blocks the trade", () => {
    const r = gate({ trades: [closed(5, 1, 120), closed(5, 2, 100)] });
    expect(codes(r)).toContain("daily_risk_exceeded");
    expect(r.canOverride).toBe(false);
  });

  it("4. reaching the daily loss limit stops trading", () => {
    const r = gate({ trades: [closed(-300, 1)] });
    expect(codes(r)).toContain("daily_loss_limit");
    expect(r.canOverride).toBe(false);
  });

  it("5. reaching the profit stop stops trading", () => {
    const r = gate({ trades: [closed(500, 1)] });
    expect(codes(r)).toContain("profit_stop");
    expect(r.allowed).toBe(false);
  });

  it("6. three consecutive losses today block and point to a cooldown", () => {
    const r = gate({ trades: [closed(-10, 1), closed(-10, 2), closed(-10, 3)] });
    expect(codes(r)).toContain("consecutive_losses");
    expect(r.nextAction).toContain("تهدئة");
  });

  it("6b. yesterday's losing streak does not block today forever", () => {
    const y = (h: number): StatusTrade => ({
      status: "closed",
      pnl: -10,
      risk_amount: 10,
      opened_at: `2026-10-10T0${h}:00:00`,
      closed_at: `2026-10-10T0${h}:30:00`,
    });
    expect(codes(gate({ trades: [y(1), y(2), y(3)] }))).not.toContain("consecutive_losses");
  });

  it("7. no trade can be recorded during a cooldown", () => {
    const r = gate({ settings: { ...settings, cooldown_until: "2026-10-11T12:30:00" } });
    expect(codes(r)).toContain("cooldown");
    expect(r.canOverride).toBe(false);
  });

  it("manual pause is a hard block", () => {
    const r = gate({ settings: { ...settings, trading_paused: true } });
    expect(codes(r)).toEqual(["paused"]);
    expect(r.canOverride).toBe(false);
  });

  it("max trades reached is a hard block", () => {
    const trades = [1, 2, 3, 4, 5].map((h) => closed(1, h, 1));
    expect(codes(gate({ trades }))).toContain("max_trades");
  });

  it("missing session and strategy are soft reasons", () => {
    const r = gate({ hasActiveSession: false, draft: { ...goodDraft, strategyId: null } });
    expect(codes(r)).toEqual(["no_session", "no_strategy"]);
    expect(r.canOverride).toBe(true);
  });

  it("risk above per-trade limit is soft, with the amounts in the message", () => {
    const r = gate({ draft: { ...goodDraft, size: 150 } }); // 1 * 150 = 150 > 100
    const reason = r.reasons.find((x) => x.code === "risk_per_trade_exceeded");
    expect(reason?.hard).toBe(false);
    expect(reason?.message).toContain("150");
  });

  it("a stop on the wrong side is a hard price error", () => {
    const r = gate({ draft: { ...goodDraft, stop: 101 } });
    expect(codes(r)).toContain("invalid_prices");
    expect(r.canOverride).toBe(false);
  });

  it("does not guess the risk when inputs are missing", () => {
    const r = gate({ draft: { direction: "long", strategyId: "s1", stop: 99 } });
    expect(r.calc.risk).toBeNull();
    expect(codes(r)).toContain("risk_unknown");
  });

  it("8. changed limits are reflected immediately (same inputs, new settings)", () => {
    expect(gate().allowed).toBe(true);
    expect(
      codes(gate({ settings: { ...settings, max_daily_risk: 40, max_risk_per_trade: 40 } })),
    ).toContain("daily_risk_exceeded");
  });

  it("override note keeps every reason and the user's text", () => {
    const r = gate({ hasActiveSession: false });
    const note = overrideNote(r.reasons, "  دخلت لأن الخبر واضح  ");
    expect(note).toContain("لا توجد جلسة");
    expect(note).toContain("دخلت لأن الخبر واضح");
  });
});
