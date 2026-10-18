import { describe, expect, it } from "vitest";
import {
  EMOTIONS,
  inRevengeWindow,
  isGreed,
  isSensitive,
  REVENGE_MARKER,
  REVENGE_WINDOW_MIN,
  revengeLine,
  SENSITIVE,
} from "./emotions";

describe("emotions", () => {
  it("offers FOMO on the form and treats it as greed and sensitive", () => {
    expect(EMOTIONS).toContain("خوف من الفوات");
    expect(isGreed("خوف من الفوات")).toBe(true);
    expect(isSensitive("خوف من الفوات")).toBe(true);
  });
  it("every greed word is also sensitive; calm ones are neither", () => {
    expect(isSensitive("طمع")).toBe(true);
    expect(isSensitive("خائف")).toBe(true);
    expect(isGreed("خائف")).toBe(false);
    expect(isSensitive("هادئ")).toBe(false);
    expect(isGreed(null)).toBe(false);
  });
  it("matches legacy free-text emotions", () => {
    expect(isGreed("انتقام")).toBe(true);
    expect(isSensitive("FOMO")).toBe(true);
  });
  it("every sensitive form emotion is in the vocabulary or a legacy tag", () => {
    expect(SENSITIVE.filter((e) => !EMOTIONS.includes(e))).toEqual(["انتقام", "FOMO"]);
  });
  it("only the yes answer carries the revenge marker", () => {
    expect(revengeLine(true)).toBe(REVENGE_MARKER);
    expect(revengeLine(false).includes(REVENGE_MARKER)).toBe(false);
  });
});

describe("revenge window", () => {
  it("is never under 30 minutes", () => {
    expect(REVENGE_WINDOW_MIN({ cooldown_minutes: 10 })).toBe(30);
    expect(REVENGE_WINDOW_MIN({ cooldown_minutes: 0 })).toBe(30);
    expect(REVENGE_WINDOW_MIN({ cooldown_minutes: -5 })).toBe(30);
    expect(REVENGE_WINDOW_MIN({ cooldown_minutes: null })).toBe(30);
    expect(REVENGE_WINDOW_MIN({ cooldown_minutes: Number.NaN })).toBe(30);
    expect(REVENGE_WINDOW_MIN(null)).toBe(30);
    expect(REVENGE_WINDOW_MIN()).toBe(30);
  });
  it("follows a longer cooldown", () => {
    expect(REVENGE_WINDOW_MIN({ cooldown_minutes: 45 })).toBe(45);
  });
  it("counts entries from the losing close up to the window's end", () => {
    expect(inRevengeWindow(0, 30)).toBe(true);
    expect(inRevengeWindow(29 * 60_000, 30)).toBe(true);
    expect(inRevengeWindow(30 * 60_000, 30)).toBe(false);
    expect(inRevengeWindow(-60_000, 30)).toBe(false);
  });
});
