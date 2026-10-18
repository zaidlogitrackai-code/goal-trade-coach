import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEAT_MS, createHeartbeat, RESUME_AFTER_MS, shouldRefreshOnResume, type Beat } from "./heartbeat";

describe("shouldRefreshOnResume", () => {
  it("refreshes after more than 15s away", () => {
    expect(shouldRefreshOnResume(RESUME_AFTER_MS + 1, "2026-10-18", "2026-10-18")).toBe(true);
    expect(shouldRefreshOnResume(60_000, "2026-10-18", "2026-10-18")).toBe(true);
  });

  it("does not refresh a quick glance away", () => {
    expect(shouldRefreshOnResume(3_000, "2026-10-18", "2026-10-18")).toBe(false);
    expect(shouldRefreshOnResume(RESUME_AFTER_MS, "2026-10-18", "2026-10-18")).toBe(false);
  });

  it("always refreshes when his trading day changed", () => {
    expect(shouldRefreshOnResume(2_000, "2026-10-18", "2026-10-19")).toBe(true);
  });
});

describe("createHeartbeat", () => {
  let beats: Beat[];
  let day: string;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T09:00:00Z"));
    beats = [];
    day = "2026-10-18";
  });
  afterEach(() => vi.useRealTimers());

  const start = () => {
    const hb = createHeartbeat({ onBeat: (b) => beats.push(b), today: () => day });
    hb.back();
    return hb;
  };

  it("ticks once per minute while visible", () => {
    start();
    vi.advanceTimersByTime(BEAT_MS - 1);
    expect(beats).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(beats).toEqual(["tick"]);
    vi.advanceTimersByTime(BEAT_MS * 2);
    expect(beats).toEqual(["tick", "tick", "tick"]);
  });

  it("never beats while hidden", () => {
    const hb = start();
    hb.away();
    vi.advanceTimersByTime(BEAT_MS * 5);
    expect(beats).toEqual([]);
  });

  it("beats at once on a real resume, then again a minute later", () => {
    const hb = start();
    hb.away();
    vi.advanceTimersByTime(60_000);
    hb.back();
    expect(beats).toEqual(["resume"]);
    vi.advanceTimersByTime(BEAT_MS - 1);
    expect(beats).toEqual(["resume"]);
    vi.advanceTimersByTime(1);
    expect(beats).toEqual(["resume", "tick"]);
  });

  it("a quick glance away keeps the minute where it was", () => {
    const hb = start();
    vi.advanceTimersByTime(30_000);
    hb.away();
    vi.advanceTimersByTime(5_000);
    hb.back();
    expect(beats).toEqual([]);
    vi.advanceTimersByTime(25_000);
    expect(beats).toEqual(["tick"]);
  });

  it("catches up with a tick when the minute ran out during short absences", () => {
    const hb = start();
    vi.advanceTimersByTime(50_000);
    hb.away();
    vi.advanceTimersByTime(12_000);
    hb.back();
    // 62s since the last beat but only 12s away: the overdue tick, not a resume.
    vi.advanceTimersByTime(0);
    expect(beats).toEqual(["tick"]);
  });

  it("resumes after a short absence that crossed his midnight", () => {
    const hb = start();
    hb.away();
    day = "2026-10-19";
    vi.advanceTimersByTime(3_000);
    hb.back();
    expect(beats).toEqual(["resume"]);
  });

  it("turns the tick that crosses his midnight into a resume", () => {
    start();
    vi.advanceTimersByTime(BEAT_MS);
    day = "2026-10-19";
    vi.advanceTimersByTime(BEAT_MS);
    vi.advanceTimersByTime(BEAT_MS);
    expect(beats).toEqual(["tick", "resume", "tick"]);
  });

  it("back() while already on screen never beats twice", () => {
    const hb = start();
    hb.back();
    hb.back();
    vi.advanceTimersByTime(BEAT_MS);
    expect(beats).toEqual(["tick"]);
  });

  it("stays silent after stop", () => {
    const hb = start();
    hb.stop();
    hb.back();
    vi.advanceTimersByTime(BEAT_MS * 3);
    expect(beats).toEqual([]);
  });
});
