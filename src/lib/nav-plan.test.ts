import { describe, expect, it } from "vitest";
import { buildJourney } from "./journey";
import { planNav } from "./nav-plan";
import { MORE, navEntry, type NavPath } from "./nav-registry";

const fresh = buildJourney({
  focusReady: false,
  strategies: 0,
  rules: 0,
  sessionToday: null,
  tradesToday: 0,
  blocked: false,
});
const blockedDay = buildJourney({
  focusReady: true,
  strategies: 1,
  rules: 1,
  sessionToday: { active: true, ended: false },
  tradesToday: 0,
  blocked: true,
});
/** Every page a journey step can send the trader to, plus no step at all. */
const steps: (NavPath | null)[] = [
  null,
  ...new Set([...fresh.steps, ...blockedDay.steps].map((s) => s.to)),
];
const inMore = new Set<string>(MORE.flatMap((g) => g.items.map((n) => n.path)));

describe("planNav", () => {
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
