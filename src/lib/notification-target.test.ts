import { describe, expect, it } from "vitest";
import { notificationTarget } from "./notification-target";

const ID = "6f1c2a9e-4b7d-4c1a-9a51-0d3e8f7b2c10";

describe("notificationTarget", () => {
  it("sends trade alerts to that exact trade", () => {
    for (const prefix of ["nosl", "longopen"]) {
      expect(notificationTarget("risk", `${prefix}:${ID}`)).toEqual({ to: "/trades", search: { trade: ID }, label: "افتح الصفقة" });
    }
  });

  it("sends every day/week/month risk alert to the dashboard", () => {
    for (const key of ["loss_hit:2026-10-18", "loss_80:2026-10-18", "target_day:2026-10-18", "target_week:2026-W42", "target_month:2026-10", "streak2:2026-10-18", "streak3:2026-10-18", "overtrade:2026-10-18"]) {
      expect(notificationTarget("risk", key).to).toBe("/dashboard");
    }
  });

  it("sends the guardians' morning locks to their own pages", () => {
    expect(notificationTarget("risk", "risk-morning-2026-10-18").to).toBe("/risk");
    expect(notificationTarget("reminder", "discipline-morning-2026-10-18").to).toBe("/discipline");
  });

  it("sends reminders to the risk page where they are listed", () => {
    expect(notificationTarget("reminder", `rem:${ID}:2026-10-18T06:00:00+00:00`).to).toBe("/risk");
  });

  it("sends the morning and evening messages to the session", () => {
    expect(notificationTarget("morning", null).to).toBe("/session");
    expect(notificationTarget("evening", null).to).toBe("/session");
  });

  it("never leaves a row without a destination", () => {
    expect(notificationTarget("something-new", null).to).toBe("/dashboard");
    expect(notificationTarget(null, undefined).to).toBe("/dashboard");
    // A bare prefix with no id is not a trade link.
    expect(notificationTarget("risk", "nosl:").to).toBe("/dashboard");
  });

  it("labels every target in Arabic", () => {
    for (const [kind, key] of [["risk", `nosl:${ID}`], ["risk", "loss_hit:x"], ["reminder", "rem:x"], ["morning", null], ["evening", null], ["risk", "risk-morning-x"], ["reminder", "discipline-morning-x"]] as const) {
      expect(notificationTarget(kind, key).label).toMatch(/^افتح /);
    }
  });
});
