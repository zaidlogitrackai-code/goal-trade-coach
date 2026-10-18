import { describe, expect, it } from "vitest";
import { normalizeCurrency, parseClock, validateRiskSettings, type RiskSettingsInput } from "./risk-validation";

const ok: RiskSettingsInput = {
  starting_balance: 5000,
  daily_target: 150,
  max_daily_profit: 300,
  max_daily_loss: 200,
  max_trades_per_day: 4,
  max_risk_per_trade: 50,
  max_daily_risk: 150,
  max_consecutive_losses: 2,
  weekly_target: 400,
  weekly_max_loss: 400,
  monthly_target: 1200,
  monthly_max_loss: 800,
  session_start: "09:00",
  session_end: "17:00",
  currency: "USD",
};
const errorFields = (s: RiskSettingsInput) => validateRiskSettings(s).errors.map((e) => e.field);

describe("validateRiskSettings", () => {
  it("validates valid risk parameters without errors", () => {
    const res = validateRiskSettings(ok);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.notes).toEqual([]);
  });

  it("detects error when daily target exceeds max daily profit", () => {
    const res = validateRiskSettings({ daily_target: 400, max_daily_profit: 200 });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.field === "daily_target")).toBe(true);
  });

  it("warns when risk per trade exceeds max daily risk", () => {
    const res = validateRiskSettings({ max_risk_per_trade: 200, max_daily_risk: 100 });
    expect(res.warnings.some((w) => w.field === "max_risk_per_trade")).toBe(true);
  });

  it("detects error when a loss limit or the risk per trade exceeds the balance", () => {
    expect(errorFields({ starting_balance: 500, max_daily_loss: 1000 })).toContain("max_daily_loss");
    expect(errorFields({ starting_balance: 500, monthly_max_loss: 1000 })).toContain("monthly_max_loss");
    expect(errorFields({ starting_balance: 500, max_risk_per_trade: 600 })).toContain("max_risk_per_trade");
  });

  it("books USDT as USD with a note, never an error", () => {
    const res = validateRiskSettings({ currency: "usdt" });
    expect(res.valid).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0]).toContain("USD");
    expect(normalizeCurrency(" usdt ")).toMatchObject({ code: "USD" });
    expect(normalizeCurrency("sar")).toEqual({ code: "SAR", note: null });
    expect(normalizeCurrency("دولار")).toEqual({ code: "USD", note: null });
  });

  it("rejects a currency that is not an ISO-4217 code", () => {
    expect(errorFields({ currency: "XYZ" })).toEqual(["currency"]);
    expect(normalizeCurrency("XYZ").code).toBeNull();
  });

  it("weekly below daily is an error, and so is monthly below weekly or daily", () => {
    expect(errorFields({ ...ok, weekly_max_loss: 150 })).toEqual(["weekly_max_loss"]);
    expect(errorFields({ ...ok, monthly_max_loss: 300 })).toEqual(["monthly_max_loss"]);
    // With the weekly limit off, the month is still compared with the day.
    expect(errorFields({ ...ok, weekly_max_loss: 0, monthly_max_loss: 100 })).toEqual(["monthly_max_loss"]);
    // Equal is fine: the same cap for the day and the week.
    expect(errorFields({ ...ok, weekly_max_loss: 200 })).toEqual([]);
  });

  it("only warns when a longer target is below a shorter one", () => {
    const res = validateRiskSettings({ ...ok, weekly_target: 100 });
    expect(res.valid).toBe(true);
    expect(res.warnings.map((w) => w.field)).toEqual(["weekly_target"]);
  });

  it("the streak and the trade count must be whole numbers", () => {
    expect(errorFields({ max_consecutive_losses: 2.5 })).toEqual(["max_consecutive_losses"]);
    expect(errorFields({ max_trades_per_day: 1.5 })).toEqual(["max_trades_per_day"]);
    expect(errorFields({ max_consecutive_losses: -1 })).toEqual(["max_consecutive_losses"]);
  });

  it("ignores null and '' keys: not given is not 0 and not an error", () => {
    const res = validateRiskSettings({
      max_daily_loss: null,
      weekly_max_loss: "" as unknown as number,
      monthly_max_loss: "  " as unknown as number,
      currency: "",
      session_start: null,
      session_end: "",
    });
    expect(res).toMatchObject({ valid: true, errors: [], warnings: [] });
  });

  it("rejects a value that is not a number", () => {
    expect(errorFields({ max_daily_loss: Number.NaN })).toEqual(["max_daily_loss"]);
    expect(errorFields({ max_daily_loss: "abc" as unknown as number })).toEqual(["max_daily_loss"]);
  });

  it("validates session hours", () => {
    expect(errorFields({ session_start: "09:00", session_end: null })).toEqual(["session_end"]);
    expect(errorFields({ session_start: "25:00", session_end: "17:00" })).toEqual(["session_start"]);
    expect(errorFields({ session_start: "09:00", session_end: "9:00:00" })).toEqual(["session_end"]);
    // The database hands back seconds.
    expect(errorFields({ session_start: "09:00:00", session_end: "17:30" })).toEqual([]);
    // Start after end is a session over midnight: the gate supports it, so only a note-like warning.
    const night = validateRiskSettings({ session_start: "22:00", session_end: "02:00" });
    expect(night.valid).toBe(true);
    expect(night.warnings.map((w) => w.field)).toEqual(["session_end"]);
  });
});

describe("parseClock", () => {
  it("pads and trims to HH:MM", () => {
    expect(parseClock("9:05")).toBe("09:05");
    expect(parseClock("17:30:00")).toBe("17:30");
    expect(parseClock("٠٩:٣٠")).toBe("09:30");
  });
  it("refuses anything that isn't a clock time", () => {
    for (const s of ["24:00", "9", "09:60", "nine", "", null]) expect(parseClock(s)).toBeNull();
  });
});
