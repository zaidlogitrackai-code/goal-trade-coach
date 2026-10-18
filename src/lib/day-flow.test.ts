import { describe, it, expect } from "vitest";
import { currentStep } from "./day-flow";
import { pipelineState, type PipelineRows } from "./day-pipeline";

// The old five-step bar is only an adapter now: each case checks where a pipeline step lands on it.
const NOW = new Date("2026-10-14T15:00:00+03:00"); // Wednesday, Asia/Riyadh
const at = (hhmm: string) => `2026-10-14T${hhmm}:00+03:00`;
const ROWS: PipelineRows = {
  settings: {
    timezone: "Asia/Riyadh", currency: "USD", current_balance: 10_000,
    max_daily_loss: 200, weekly_max_loss: 0, monthly_max_loss: 0, limits_pct: null,
    max_consecutive_losses: 2, streak_cooldown_hours: 24, trading_paused: false, cooldown_until: null,
    breaker_since: "2026-10-01T00:00:00+03:00", limits_accepted_at: "2026-10-01T00:00:00+03:00",
    max_trades_per_day: 3, max_daily_profit: 0,
  },
  trades: [],
  plan: { no_trading: false, start_balance: 10_000 },
  sessions: [{ started_at: at("09:00"), ended_at: null }],
  focus: { markets: ["XAUUSD"], goal: "200$ بالأسبوع" },
  strategies: 1,
  rules: 1,
  now: NOW,
};
const flow = (over: Partial<PipelineRows> = {}) => currentStep(pipelineState({ ...ROWS, ...over }));
// A distinct entry each: the same symbol, side and entry reads as a duplicate (PARTIAL).
let entry = 1.1;
const closed = (id: string, pnl: number, hhmm: string) => ({
  id, symbol: "EURUSD", direction: "long", entry_price: (entry += 0.01), exit_price: 1.2, status: "closed", pnl,
  opened_at: at("08:00"), closed_at: at(hhmm), created_at: at("08:00"), stop_loss: 1,
});

describe("currentStep (adapter over the day pipeline)", () => {
  it("setup missing → step 1, the coach interview first", () => {
    const r = flow({ focus: null });
    expect(r).toMatchObject({ step: 1, to: "/coach", interview: true });
    expect(flow({ strategies: 0 })).toMatchObject({ step: 1, to: "/strategies" });
    expect(flow({ strategies: 0 }).interview).toBeUndefined();
  });
  it("no plan → step 2", () => expect(flow({ plan: null })).toMatchObject({ step: 2, to: "/session" }));
  it("a ready day → step 3, «صفقة جديدة»", () => expect(flow()).toMatchObject({ step: 3, action: "صفقة جديدة", to: "/new-trade" }));
  it("daily loss reached → step 4 danger", () => {
    const r = flow({ trades: [closed("a", -200, "12:00")] });
    expect(r.step).toBe(4);
    expect(r.danger).toBe(true);
  });
  it("max trades reached → step 4, close the day", () => {
    const r = flow({ trades: [closed("a", 20, "10:00"), closed("b", 20, "11:00"), closed("c", 20, "12:00")] });
    expect(r).toMatchObject({ step: 4, action: "سكّر يومك", to: "/session" });
    expect(r.danger).toBeUndefined();
  });
  it("session closed today → step 5", () => expect(flow({ sessions: [{ started_at: at("09:00"), ended_at: at("14:00") }] }).step).toBe(5));
});
