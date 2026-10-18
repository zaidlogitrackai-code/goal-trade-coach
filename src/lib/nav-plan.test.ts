import { describe, expect, it } from "vitest";
import { pipelineState, type PipelineRows } from "./day-pipeline";
import { buildJourney } from "./journey";
import { planNav } from "./nav-plan";
import { MORE, navEntry, type NavPath } from "./nav-registry";

const at = (hhmm: string) => `2026-10-14T${hhmm}:00+03:00`;
const BASE: PipelineRows = {
  settings: { timezone: "Asia/Riyadh", current_balance: 10_000, max_daily_loss: 200, max_consecutive_losses: 2, streak_cooldown_hours: 24, breaker_since: at("00:00") },
  trades: [],
  plan: null,
  sessions: [],
  focus: null,
  strategies: 0,
  rules: 0,
  now: new Date(at("15:00")),
};
let entry = 1.1; // distinct, or two closes read as a duplicate (PARTIAL)
const trade = (id: string, pnl: number | null, closedAt: string | null, stop: number | null = 1) => ({
  id, symbol: "EURUSD", direction: "long", entry_price: (entry += 0.01), exit_price: closedAt ? 1.0 : null, status: closedAt ? "closed" : "open",
  pnl, opened_at: at("10:00"), closed_at: closedAt, stop_loss: stop,
});
const journeyOf = (over: Partial<PipelineRows>) => buildJourney(pipelineState({ ...BASE, ...over }));
const ready = { focus: { markets: ["EURUSD"], goal: "200$" }, strategies: 1, rules: 1 };
const fresh = journeyOf({});
const blockedDay = journeyOf({ ...ready, sessions: [{ started_at: at("09:00"), ended_at: null }], trades: [trade("l", -200, at("11:00")), trade("o", null, null, null)] });
const cooldown = journeyOf({ ...ready, trades: [trade("a", -20, at("11:00")), trade("b", -20, at("12:00"))] });
const tos = (j: typeof fresh) => [...j.steps.map((s) => s.to), ...j.pipeline.blockers.map((b) => b.cta.to)];
/** Every page a journey step can send the trader to, plus no step at all. */
const steps: (NavPath | null)[] = [
  null,
  ...new Set([fresh, blockedDay, cooldown].flatMap(tos)),
];
const inMore = new Set<string>(MORE.flatMap((g) => g.items.map((n) => n.path)));

describe("planNav", () => {
  it("the fixtures reach the gate's stops", () => {
    expect(blockedDay.current?.key).toBe("gate");
    expect(cooldown.pipeline.blockers[0]?.cta.to).toBe("/analyst");
  });
  it("only marks pages the phone can reach, and dots the «المزيد» button for sheet pages", () => {
    for (const nextStep of steps) {
      const plan = planNav({ nextStep });
      if (plan.next == null) continue;
      expect(navEntry(plan.next), plan.next).not.toBeNull();
      expect(plan.inMore, plan.next).toBe(inMore.has(plan.next));
    }
  });
  it("marks nothing while loading, or when the step is home itself", () => {
    expect(planNav(null)).toEqual({ next: null, inMore: false });
    expect(planNav({ nextStep: "/dashboard" })).toEqual({ next: null, inMore: false });
  });
  it("marks a tab in place and a sheet page through the sheet's button", () => {
    expect(planNav({ nextStep: "/session" })).toEqual({ next: "/session", inMore: false });
    expect(planNav({ nextStep: "/rules" })).toEqual({ next: "/rules", inMore: true });
  });
});
