import { describe, expect, it } from "vitest";
import { EMOTIONS, isGreed, isSensitive, REVENGE_MARKER, revengeLine, SENSITIVE } from "./emotions";

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
