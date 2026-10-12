import { describe, expect, it } from "vitest";
import { detectSymbols } from "./market-symbols";
import { approxPoc, ema } from "./indicators";

describe("market", () => {
  it("detects gold in Arabic", () => expect(detectSymbols("حلل الذهب").map((s) => s.key)).toEqual(["XAUUSD"]));
  it("detects aliases", () => expect(detectSymbols("NAS100 and WTI").map((s) => s.key)).toEqual(["US100", "USOIL"]));
  it("ignores unrelated text", () => expect(detectSymbols("BTC")).toEqual([]));
  it("ema of constant is constant", () => expect(ema(new Array(30).fill(5), 20)).toBe(5));
  it("poc null without volume", () => expect(approxPoc([{ t: 0, o: 1, h: 2, l: 1, c: 1.5, v: 0 }])).toBeNull());
});
