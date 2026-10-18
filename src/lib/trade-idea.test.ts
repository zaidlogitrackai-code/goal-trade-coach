import { describe, expect, it } from "vitest";
import { checkLevels, expectedPnlSign, lotForRisk, riskUsd, withinRiskLimit } from "./trade-idea";

describe("checkLevels", () => {
  it("accepts a valid long and computes R per target", () => {
    const r = checkLevels({ direction: "long", entry: 2385.4, stop: 2380.4, targets: [2395.4, 2400.4] });
    expect(r.ok).toBe(true);
    expect(r.rr).toEqual([2, 3]);
  });
  it("rejects a long with the stop above entry", () => {
    expect(checkLevels({ direction: "long", entry: 100, stop: 101, targets: [105] }).ok).toBe(false);
  });
  it("rejects a short with target above entry", () => {
    expect(checkLevels({ direction: "short", entry: 93.134, stop: 94.2, targets: [95] }).ok).toBe(false);
  });
});

describe("riskUsd", () => {
  it("gold: 0.10 lot with a 5.00 stop risks 50 USD", () => {
    expect(riskUsd("XAUUSD", 2385.4, 2380.4, 0.1)).toBe(50);
  });
  it("oil: 0.10 lot with a 1.00 stop risks 100 USD", () => {
    expect(riskUsd("USOIL", 93, 94, 0.1)).toBe(100);
  });
  it("EURUSD: 1 lot with 10 pips risks 100 USD", () => {
    expect(riskUsd("EURUSD", 1.1, 1.099, 1)).toBe(100);
  });
  it("EURUSD: 1 lot with a 50-pip stop risks 500 USD, not the raw price distance", () => {
    expect(riskUsd("EURUSD", 1.085, 1.08, 1)).toBe(500);
  });
  it("gold: 0.1 lot with a 10.00 stop risks 100 USD", () => {
    expect(riskUsd("XAUUSD", 2350, 2340, 0.1)).toBe(100);
  });
  it("lot sizing keeps gold within a 30 USD limit", () => {
    expect(lotForRisk("XAUUSD", 2385.4, 2380.4, 30)).toBe(0.06);
  });
});

describe("withinRiskLimit", () => {
  it("passes only a computed risk at or under a positive limit", () => {
    expect(withinRiskLimit(500, 500)).toBe(true);
    expect(withinRiskLimit(501, 500)).toBe(false);
  });
  it("never passes without a computed risk or without a limit", () => {
    expect(withinRiskLimit(null, 500)).toBe(false);
    expect(withinRiskLimit(0, 500)).toBe(false);
    expect(withinRiskLimit(50, 0)).toBe(false);
    expect(withinRiskLimit(50, null)).toBe(false);
  });
});

describe("expectedPnlSign", () => {
  it("long: exit above entry is a profit, below is a loss", () => {
    expect(expectedPnlSign("long", 1.085, 1.09)).toBe(1);
    expect(expectedPnlSign("long", 2350, 2340)).toBe(-1);
  });
  it("short: exit below entry is a profit, above is a loss", () => {
    expect(expectedPnlSign("short", 2350, 2340)).toBe(1);
    expect(expectedPnlSign("short", 1.085, 1.09)).toBe(-1);
  });
  it("flat at the entry price", () => {
    expect(expectedPnlSign("long", 100, 100)).toBe(0);
    expect(expectedPnlSign("short", 100, 100)).toBe(0);
  });
  it("unknown without both prices or a direction", () => {
    expect(expectedPnlSign("long", null, 1.09)).toBeNull();
    expect(expectedPnlSign("long", 1.085, null)).toBeNull();
    expect(expectedPnlSign("long", 0, 1.09)).toBeNull();
    expect(expectedPnlSign("sideways", 1.085, 1.09)).toBeNull();
  });
});
