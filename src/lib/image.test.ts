import { describe, expect, it } from "vitest";
import { fitWithin } from "./image";

describe("fitWithin", () => {
  it("keeps small images as they are", () => {
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
  it("downscales wide screenshots by the longest side", () => {
    expect(fitWithin(3840, 2160)).toEqual({ width: 2048, height: 1152 });
  });
  it("downscales tall images", () => {
    expect(fitWithin(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 });
  });
  it("handles invalid sizes", () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
  });
});
