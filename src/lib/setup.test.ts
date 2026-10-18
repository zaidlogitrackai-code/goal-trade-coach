import { describe, expect, it } from "vitest";
import { setupComplete, setupMissing, STRATEGY_TEMPLATE_NAME } from "./setup";

const settings = { starting_balance: 10000, timezone: "Asia/Riyadh", limits_accepted_at: "2026-10-18T08:00:00Z" };
const strat = { name: "كسر الترند", allowed: true, entry_conditions: "كسر خط الترند مع إغلاق شمعة", exit_conditions: "ستوب تحت آخر قاع" };
const base = { settings, strategies: [strat], rules: [{ active: true }] };

describe("setupComplete", () => {
  it("passes with balance, limits, a written strategy, a rule and a timezone; session hours are optional", () => {
    expect(setupComplete(base)).toBe(true);
  });
  it("a strategy needs entry_conditions and a stop rule", () => {
    expect(setupComplete({ ...base, strategies: [{ ...strat, entry_conditions: "" }] })).toBe(false);
    expect(setupComplete({ ...base, strategies: [{ ...strat, exit_conditions: "أطلع عند الهدف" }] })).toBe(false);
  });
  it("the template does not count", () => {
    expect(setupMissing({ ...base, strategies: [{ ...strat, name: STRATEGY_TEMPLATE_NAME }] })).toEqual(["استراتيجية فيها شروط دخول وقاعدة ستوب"]);
  });
  it("needs a balance, limits, an active rule and a valid timezone", () => {
    expect(setupMissing({ settings: { starting_balance: 0, timezone: "Nowhere/X" }, strategies: [], rules: [{ active: false }] })).toHaveLength(5);
  });
});
