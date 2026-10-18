import { describe, expect, it } from "vitest";
import { numOrNull, parseDecimal } from "./num";

describe("parseDecimal", () => {
  it("reads Arabic-Indic digits with the Arabic decimal separator", () => {
    expect(parseDecimal("١٫٠٨")).toEqual({ value: 1.08, invalid: false });
  });
  it("treats a comma as the decimal point", () => {
    expect(parseDecimal("1,5")).toEqual({ value: 1.5, invalid: false });
  });
  it("reads whole Arabic-Indic numbers", () => {
    expect(parseDecimal("٢٣٥٠")).toEqual({ value: 2350, invalid: false });
  });
  it("reads Persian digits", () => {
    expect(parseDecimal("۰٫۵")).toEqual({ value: 0.5, invalid: false });
  });
  it("flags text that isn't a number", () => {
    expect(parseDecimal("abc")).toEqual({ value: null, invalid: true });
    expect(parseDecimal("1.2.3")).toEqual({ value: null, invalid: true });
    expect(parseDecimal("-")).toEqual({ value: null, invalid: true });
  });
  it("returns null without an error for an empty field", () => {
    expect(parseDecimal("")).toEqual({ value: null, invalid: false });
    expect(parseDecimal("  ")).toEqual({ value: null, invalid: false });
    expect(parseDecimal(null)).toEqual({ value: null, invalid: false });
  });
  it("keeps signs and ignores bidi marks and spaces", () => {
    expect(parseDecimal("-25")).toEqual({ value: -25, invalid: false });
    expect(parseDecimal("‎1.0850 ")).toEqual({ value: 1.085, invalid: false });
    expect(parseDecimal(".5").value).toBe(0.5);
  });
  it("numOrNull drops invalid input", () => {
    expect(numOrNull("abc")).toBeNull();
    expect(numOrNull("٣")).toBe(3);
  });
});
