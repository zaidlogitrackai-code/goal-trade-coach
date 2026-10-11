import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { loosenedLimits, NeedsConfirmation, parseAction, runAction } from "./agent-actions";

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
