import { describe, expect, it } from "vitest";
import { fitWithin, MAX_SIDE, targetSize, THUMB_SIDE } from "./image";

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

describe("targetSize", () => {
  it("decodes a 48MP iPhone photo at a reduced size with the same aspect ratio", () => {
    const t = targetSize(8064, 6048, 1600);
    expect(t).toEqual({ width: 1600, height: 1200 });
    expect(t.width / t.height).toBeCloseTo(8064 / 6048, 5);
  });
  it("portrait photos fit by their height", () => {
    expect(targetSize(6048, 8064)).toEqual({ width: 1536, height: MAX_SIDE });
  });
  it("never upscales a small screenshot", () => {
    expect(targetSize(1170, 2532, 4000)).toEqual({ width: 1170, height: 2532 });
  });
  it("a hair-thin panorama still gets a 1px side", () => {
    expect(targetSize(40000, 2)).toEqual({ width: MAX_SIDE, height: 1 });
  });
  it("an image without a size is not decodable", () => {
    expect(targetSize(0, 0)).toEqual({ width: 0, height: 0 });
    expect(targetSize(Number.NaN, 10)).toEqual({ width: 0, height: 0 });
  });
});
