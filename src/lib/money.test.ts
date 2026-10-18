import { describe, expect, it } from "vitest";
import { fmtMoney } from "./money";

describe("fmtMoney", () => {
  it("formats an ISO currency", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50");
    expect(fmtMoney(-50, "USD")).toBe("-$50.00");
    expect(fmtMoney(10, "sar")).toContain("SAR");
  });

  it("a non-ISO currency doesn't throw: it falls back to the number and the code", () => {
    expect(() => fmtMoney(1234.5, "USDT")).not.toThrow();
    expect(fmtMoney(1234.5, "USDT")).toBe("1,234.5 USDT");
    expect(fmtMoney(5, "دولار")).toBe("5 دولار");
  });

  it("an empty currency is USD, and a missing amount is a dash", () => {
    expect(fmtMoney(5, "")).toBe("$5.00");
    expect(fmtMoney(5, null)).toBe("$5.00");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(Number.NaN)).toBe("—");
    expect(fmtMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("trim drops .00 on whole amounts only, float noise included", () => {
    expect(fmtMoney(300, "USD", { trim: true })).toBe("$300");
    expect(fmtMoney(29.9999999, "USD", { trim: true })).toBe("$30");
    expect(fmtMoney(12.5, "USD", { trim: true })).toBe("$12.50");
    expect(fmtMoney(300, "USDT", { trim: true })).toBe("300 USDT");
  });
});
