import { describe, expect, it } from "vitest";
import { detectSymbols } from "./market-symbols";

const keys = (text: string) => detectSymbols(text).map((s) => s.key);

describe("detectSymbols", () => {
  it("finds symbols in the order mentioned", () => {
    expect(keys("حلل الفضة والذهب")).toEqual(["XAGUSD", "XAUUSD"]);
    expect(keys("حلل EURUSD")).toEqual(["EURUSD"]);
    expect(keys("NAS100 now")).toEqual(["US100"]);
  });

  it("never reads the yen out of everyday words", () => {
    for (const t of ["وين الـ POC", "الحين", "بين 2400", "تعطيني", "يمين", "انتظر لين يكسر", "الين يوصل 2400"])
      expect(keys(t), t).toEqual([]);
    expect(keys("وين الـ POC على الذهب الحين؟")).toEqual(["XAUUSD"]);
  });

  it("accepts the article and attached prefixes", () => {
    for (const t of ["بالذهب", "الذهب", "والذهب", "للذهب", "ذهب"]) expect(keys(t), t).toEqual(["XAUUSD"]);
    expect(keys("شو رأيك بالنفط")).toEqual(["USOIL"]);
    expect(keys("الإسترليني")).toEqual(["GBPUSD"]);
  });

  it("matches Arabic aliases only as whole words", () => {
    expect(keys("الذهبية")).toEqual([]);
    expect(keys("داوم على خطتك")).toEqual([]);
  });

  it("forgives the way the phone types", () => {
    expect(keys("الفضه")).toEqual(["XAGUSD"]);
    expect(keys("الذهـب")).toEqual(["XAUUSD"]);
  });

  it("still finds the yen when named as a pair", () => {
    expect(keys("حلل الين الياباني")).toEqual(["USDJPY"]);
    expect(keys("الدولار ين")).toEqual(["USDJPY"]);
    expect(keys("USDJPY")).toEqual(["USDJPY"]);
  });
});
