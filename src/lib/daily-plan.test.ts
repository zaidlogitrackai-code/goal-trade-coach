import { describe, expect, it } from "vitest";
import { planCheck } from "./daily-plan";

const plan = { target: 200, max_trades: 2, risk_per_trade: 50, max_loss: 100, revised_count: 0 };
const s = { starting_balance: 3000, max_daily_profit: 500, max_risk_per_trade: 50 };

describe("planCheck", () => {
  it("flags a target above 3% of balance as greed", () => {
    expect(planCheck(plan, [], s, null).flags.some((f) => f.includes("3%"))).toBe(true);
  });
  it("does not flag 90 on 3000 (exactly 3%)", () => {
    expect(planCheck({ ...plan, target: 90 }, [], s, null).flags).toEqual([]);
  });
  it("breaks the plan when trades exceed max_trades", () => {
    const tr = [1, 2, 3].map(() => ({ status: "open", pnl: null, risk_amount: 20, opened_at: "" }));
    expect(planCheck({ ...plan, target: 90 }, tr, s, null).kept).toBe(false);
  });
  it("breaks the plan when a trade risks more than the planned stop", () => {
    expect(planCheck({ ...plan, target: 90 }, [{ status: "open", pnl: null, risk_amount: 80, opened_at: "" }], s, null).kept).toBe(false);
  });
  it("flags revising the plan during the day", () => {
    expect(planCheck({ ...plan, target: 90, revised_count: 2 }, [], s, null).flags).toContain("غيّر خطته 2 مرة اليوم");
  });
});
