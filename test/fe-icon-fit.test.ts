import { describe, expect, it } from "vitest";
import { fitIcon, opaqueBox } from "../src/client/art/icon-fit";

function rgba(w: number, h: number, opaque: [number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) d[(y * w + x) * 4 + 3] = 255;
  return d;
}

describe("opaqueBox", () => {
  it("finds the bounding box of visible pixels", () => {
    expect(opaqueBox(rgba(32, 32, [[10, 12], [21, 20]]), 32, 32)).toEqual({ x: 10, y: 12, w: 12, h: 9 });
  });
  it("ignores nearly transparent pixels and empty cells", () => {
    const d = rgba(8, 8, []);
    d[3] = 4;
    expect(opaqueBox(d, 8, 8)).toBeNull();
  });
});

describe("fitIcon", () => {
  it("doubles a small seed pile so it fills the 32 px slot", () => {
    expect(fitIcon({ w: 12, h: 9 })).toEqual({ scale: 2, x: 4, y: 7, w: 24, h: 18 });
  });
  it("keeps a full-size sprite at 1x and never exceeds the cell", () => {
    expect(fitIcon({ w: 32, h: 30 })).toEqual({ scale: 1, x: 0, y: 1, w: 32, h: 30 });
  });
  it("uses whole-number scales only", () => {
    for (let n = 1; n <= 32; n++) {
      const f = fitIcon({ w: n, h: n });
      expect(Number.isInteger(f.scale)).toBe(true);
      expect(f.w).toBeLessThanOrEqual(32);
    }
  });
});
