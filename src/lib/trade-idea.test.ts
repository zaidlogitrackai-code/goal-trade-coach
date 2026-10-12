import { describe, expect, it } from "vitest";
import { checkLevels, lotForRisk, riskUsd } from "./trade-idea";

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
  it("lot sizing keeps gold within a 30 USD limit", () => {
    expect(lotForRisk("XAUUSD", 2385.4, 2380.4, 30)).toBe(0.06);
  });
});
