import { describe, expect, it } from "vitest";
import { rasterize, rasterToPng, yOf } from "./chart-render";

const candles = [
  { t: 1, o: 10, h: 12, l: 9, c: 11, v: 0 },
  { t: 2, o: 11, h: 20, l: 10, c: 19, v: 0 },
  { t: 3, o: 19, h: 19.5, l: 5, c: 6, v: 0 },
];

describe("chart render", () => {
  it("puts the highest high at the top and the lowest low at the bottom", () => {
    expect(yOf(20, 20, 5, 100)).toBe(6);
    expect(yOf(5, 20, 5, 100)).toBe(93);
  });
  it("uses the real high/low of the candles as the chart range", () => {
    const r = rasterize(candles, 60, 50);
    expect(r.hi).toBe(20);
    expect(r.lo).toBe(5);
  });
  it("produces a PNG data URL", async () => {
    const url = await rasterToPng(rasterize(candles, 60, 50));
    expect(url.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
  });
});
