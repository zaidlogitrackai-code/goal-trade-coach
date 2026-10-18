import { describe, expect, it } from "vitest";
import { NAV } from "@/components/app-shell";
import { buildJourney } from "./journey";
import { planNav, type NavPath, type NavState } from "./nav-plan";

// The shell looks every planned path up in NAV; a path missing there crashed it once (/knowledge).
const inNav = new Set<string>(NAV.map((n) => n.to));

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

function states(): NavState[] {
  const out: NavState[] = [];
  for (const nextStep of steps)
    for (const blocked of [false, true])
      for (const activeSession of [false, true])
        for (const [trades, closed] of [[0, 0], [2, 1], [10, 6]] as const)
          for (const setup of [0, 1])
            for (const violationsWeek of [0, 3])
              out.push({
                strategies: setup,
                rules: setup,
                trades,
                closed,
                notes: 0,
                activeSession,
                violationsWeek,
                blocked,
                nextStep,
              });
  return out;
}

describe("planNav", () => {
  it("only plans paths the shell can render", () => {
    for (const s of [null, ...states()]) {
      const plan = planNav(s);
      for (const p of [...plan.pinned, ...plan.more, ...plan.mobile]) {
        expect(inNav.has(p), `${p} for ${JSON.stringify(s)}`).toBe(true);
      }
    }
  });
});
