import { describe, it, expect } from "vitest";
import { disciplineStreak } from "./streak";

const tz = "UTC";
const sess = (day: string, closed = true, review = "تمام") => ({ started_at: `${day}T08:00:00Z`, ended_at: closed ? `${day}T12:00:00Z` : null, review: closed ? review : null });
// 2026-10-12 is a Monday.
const MON = new Date("2026-10-12T15:00:00Z");

describe("disciplineStreak", () => {
  it("skips Saturday and Sunday", () => {
    const r = disciplineStreak([sess("2026-10-08"), sess("2026-10-09")], [], tz, MON);
    expect(r.current).toBe(2);
  });
  it("a weekday with no session does not break the streak", () => {
    const r = disciplineStreak([sess("2026-10-07"), sess("2026-10-09")], [], tz, MON);
    expect(r.current).toBe(2);
  });
  it("a violation breaks the streak", () => {
    const r = disciplineStreak([sess("2026-10-08"), sess("2026-10-09")], [{ occurred_at: "2026-10-09T10:00:00Z" }], tz, MON);
    expect(r.current).toBe(0);
    expect(r.best).toBe(1);
  });
  it("an unclosed past session breaks the streak", () => {
    const r = disciplineStreak([sess("2026-10-08"), sess("2026-10-09", false)], [], tz, MON);
    expect(r.current).toBe(0);
  });
  it("today's open session does not break it", () => {
    const r = disciplineStreak([sess("2026-10-09"), sess("2026-10-12", false)], [], tz, MON);
    expect(r.current).toBe(1);
  });
  it("today's closed clean session adds one", () => {
    const r = disciplineStreak([sess("2026-10-09"), sess("2026-10-12")], [], tz, MON);
    expect(r.current).toBe(2);
  });
});

import { loginStreak } from "./streak";
describe("loginStreak", () => {
  it("counts consecutive weekday visits, skipping the weekend", () => {
    expect(loginStreak(["2026-10-08", "2026-10-09", "2026-10-12"], [], tz, MON).current).toBe(3);
  });
  it("a missed weekday resets it", () => {
    expect(loginStreak(["2026-10-07", "2026-10-09"], [], tz, MON).current).toBe(1);
  });
  it("today without a visit yet does not reset it", () => {
    expect(loginStreak(["2026-10-08", "2026-10-09"], [], tz, MON).current).toBe(2);
  });
  it("a violation day resets it", () => {
    expect(loginStreak(["2026-10-08", "2026-10-09"], [{ occurred_at: "2026-10-09T10:00:00Z" }], tz, MON).current).toBe(0);
  });
});
