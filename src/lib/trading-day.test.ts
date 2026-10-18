import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDays, dayKey, dayStart, fromWallInput, isoWeekKey, isWeekendDay, monthKey, monthStart, nextTradingDayStart,
  safeTz, toWallInput, wallClock, weekStart, zonedMidnight, zonedTime, zoneList,
} from "./trading-day";

const RIYADH = "Asia/Riyadh";

describe("trading day", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-17T22:30:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("22:30 UTC is already the next day in Riyadh", () => {
    expect(dayKey(new Date(), RIYADH)).toBe("2026-10-18");
    expect(dayKey(new Date(), "UTC")).toBe("2026-10-17");
  });

  it("today starts at Riyadh midnight, not the server's", () => {
    expect(dayStart(new Date(), RIYADH).toISOString()).toBe("2026-10-17T21:00:00.000Z");
  });

  it("Friday 23:59 belongs to the week that started that Monday", () => {
    const fri = new Date("2026-10-16T23:59:00+03:00");
    expect(weekStart(fri, RIYADH).toISOString()).toBe("2026-10-11T21:00:00.000Z"); // Mon 12 Oct 00:00 Riyadh
  });

  it("Sunday is the last day of the week, Monday opens a new one", () => {
    expect(dayKey(weekStart(new Date("2026-10-18T12:00:00+03:00"), RIYADH), RIYADH)).toBe("2026-10-12");
    expect(dayKey(weekStart(new Date("2026-10-19T00:00:00+03:00"), RIYADH), RIYADH)).toBe("2026-10-19");
  });

  it("month starts on the 1st in the zone", () => {
    expect(monthStart(new Date("2026-10-31T22:00:00Z"), RIYADH).toISOString()).toBe("2026-10-31T21:00:00.000Z"); // already 1 Nov there
  });

  it("an invalid or empty zone falls back to Riyadh", () => {
    expect(safeTz("Mars/Olympus")).toBe(RIYADH);
    expect(safeTz("")).toBe(RIYADH);
    expect(safeTz(null)).toBe(RIYADH);
    expect(safeTz("Europe/London")).toBe("Europe/London");
    expect(dayKey(new Date(), "Mars/Olympus")).toBe("2026-10-18");
  });

  it("midnight is DST-safe", () => {
    // London switches back from BST on 25 Oct 2026: that day still starts at 00:00 BST (23:00Z).
    expect(zonedMidnight("2026-10-25", "Europe/London").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(zonedMidnight("2026-10-26", "Europe/London").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    // Santiago skips 00:00 on 6 Sep 2026: the day starts at 01:00 local.
    const sep6 = zonedMidnight("2026-09-06", "America/Santiago");
    expect(dayKey(sep6, "America/Santiago")).toBe("2026-09-06");
    expect(wallClock(sep6, "America/Santiago").hour).toBe(1);
  });

  it("zone picker lists every zone plus the saved one, never an invalid one", () => {
    const z = zoneList("Asia/Calcutta", "Mars/Olympus", null);
    expect(z).toContain("Asia/Riyadh");
    expect(z).toContain("Europe/London");
    expect(z).toContain("Asia/Calcutta");
    expect(z).not.toContain("Mars/Olympus");
    expect(new Set(z).size).toBe(z.length);
  });

  it("the next trading day after Friday evening is Monday 00:00", () => {
    const friEvening = new Date("2026-10-16T21:30:00+03:00");
    expect(nextTradingDayStart(friEvening, RIYADH).toISOString()).toBe("2026-10-18T21:00:00.000Z"); // Mon 19 Oct 00:00 Riyadh
    expect(nextTradingDayStart(new Date("2026-10-17T10:00:00+03:00"), RIYADH).toISOString()).toBe("2026-10-18T21:00:00.000Z"); // Saturday
    expect(dayKey(nextTradingDayStart(new Date("2026-10-13T23:59:00+03:00"), RIYADH), RIYADH)).toBe("2026-10-14"); // Tue → Wed
  });

  it("the next trading day is taken on the trader's clock, not UTC", () => {
    // 21:30Z Friday is already Saturday 00:30 in Riyadh: still Monday next.
    expect(dayKey(nextTradingDayStart(new Date("2026-10-16T21:30:00Z"), RIYADH), RIYADH)).toBe("2026-10-19");
    // 21:30Z Thursday is Friday 00:30 in Riyadh: the next trading day is Monday, not Friday.
    expect(dayKey(nextTradingDayStart(new Date("2026-10-15T21:30:00Z"), RIYADH), RIYADH)).toBe("2026-10-19");
  });

  it("weekends are Saturday and Sunday", () => {
    expect(isWeekendDay("2026-10-17")).toBe(true);
    expect(isWeekendDay("2026-10-18")).toBe(true);
    expect(isWeekendDay("2026-10-16")).toBe(false);
  });

  it("ISO week and month keys follow the trader's day", () => {
    expect(isoWeekKey(new Date(), RIYADH)).toBe("2026-W42"); // Sun 18 Oct closes week 42
    expect(isoWeekKey(new Date("2026-10-19T00:00:00+03:00"), RIYADH)).toBe("2026-W43");
    expect(isoWeekKey(new Date("2027-01-01T12:00:00+03:00"), RIYADH)).toBe("2026-W53"); // Friday 1 Jan: still 2026's last week
    expect(isoWeekKey(new Date("2026-01-01T12:00:00+03:00"), RIYADH)).toBe("2026-W01");
    expect(monthKey(new Date("2026-10-31T22:00:00Z"), RIYADH)).toBe("2026-11");
    expect(monthKey(new Date("2026-10-31T22:00:00Z"), "UTC")).toBe("2026-10");
  });

  it("wall-clock times resolve in the zone, DST included", () => {
    expect(zonedTime("2026-10-18", 9, 30, RIYADH).toISOString()).toBe("2026-10-18T06:30:00.000Z");
    // London on 25 Oct 2026: 09:00 is already GMT again.
    expect(zonedTime("2026-10-25", 9, 0, "Europe/London").toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(zonedTime("2026-10-24", 9, 0, "Europe/London").toISOString()).toBe("2026-10-24T08:00:00.000Z");
  });

  it("datetime-local values round-trip on the trader's clock", () => {
    const at = new Date("2026-10-17T22:30:00Z");
    expect(toWallInput(at, RIYADH)).toBe("2026-10-18T01:30");
    expect(fromWallInput("2026-10-18T01:30", RIYADH)?.toISOString()).toBe("2026-10-17T22:30:00.000Z");
    expect(fromWallInput("", RIYADH)).toBeNull();
    expect(fromWallInput("bad", RIYADH)).toBeNull();
  });

  it("adds calendar days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("a cleared date input gives an invalid date instead of crashing", () => {
    expect(Number.isNaN(zonedMidnight(addDays("", 1), RIYADH).getTime())).toBe(true);
  });
});
