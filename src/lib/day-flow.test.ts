import { describe, it, expect } from "vitest";
import { currentStep, type FlowInput } from "./day-flow";

const base: FlowInput = { hasGoals: true, status: "ready", hasActiveSession: false, sessionEndedToday: false, openTradesWithoutStop: 0 };

describe("currentStep", () => {
  it("no goals → step 1", () => expect(currentStep({ ...base, hasGoals: false }).step).toBe(1));
  it("no session → step 2", () => expect(currentStep(base).step).toBe(2));
  it("active session → step 3", () => expect(currentStep({ ...base, hasActiveSession: true }).step).toBe(3));
  it("loss limit in session → step 4 danger", () => {
    const r = currentStep({ ...base, hasActiveSession: true, status: "loss_limit" });
    expect(r.step).toBe(4);
    expect(r.danger).toBe(true);
  });
  it("target hit → step 4", () => expect(currentStep({ ...base, hasActiveSession: true, status: "target_hit" }).step).toBe(4));
  it("session closed today → step 5", () => expect(currentStep({ ...base, sessionEndedToday: true }).step).toBe(5));
});
