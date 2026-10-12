import { describe, expect, it } from "vitest";
import { fitWithin, THUMB_SIDE } from "./image";

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

describe("chat thumbnail size", () => {
  it("caps the stored preview at 240px on the longest side", () => {
    expect(THUMB_SIDE).toBe(240);
    expect(fitWithin(2048, 1152, THUMB_SIDE)).toEqual({ width: 240, height: 135 });
  });
});
