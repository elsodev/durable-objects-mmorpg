import { describe, expect, it } from "vitest";
import { FENCE_E, FENCE_N, FENCE_S, FENCE_W, fenceMasks, fenceParts, FENCE_SHEET } from "../src/client/render/fence";

describe("fenceMasks", () => {
  it("joins a U-shaped farm fence: corners, runs and open ends", () => {
    // ###
    // # #
    // # #
    const tiles = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 2, y: 1 },
      { x: 0, y: 2 }, { x: 2, y: 2 },
    ];
    const m = fenceMasks(tiles);
    expect(m.get("0,0")).toBe(FENCE_E | FENCE_S); // top-left corner
    expect(m.get("1,0")).toBe(FENCE_E | FENCE_W); // horizontal run
    expect(m.get("2,0")).toBe(FENCE_W | FENCE_S); // top-right corner
    expect(m.get("0,1")).toBe(FENCE_N | FENCE_S); // vertical run
    expect(m.get("2,2")).toBe(FENCE_N); // open bottom end
  });
  it("floors fractional positions, ignores duplicates and gives a lone fence no neighbours", () => {
    const m = fenceMasks([{ x: 5.5, y: 5.2 }, { x: 5, y: 5 }, { x: 9, y: 9 }]);
    expect(m.size).toBe(2);
    expect(m.get("5,5")).toBe(0);
  });
});

describe("fenceParts", () => {
  it("draws rails only toward neighbours, then the post on top", () => {
    expect(fenceParts(0).map((p) => p.src)).toEqual([[...FENCE_SHEET.post]]);
    const h = fenceParts(FENCE_E | FENCE_W);
    expect(h.map((p) => p.src)).toEqual([[...FENCE_SHEET.railsWest], [...FENCE_SHEET.railsEast], [...FENCE_SHEET.post]]);
    const v = fenceParts(FENCE_N | FENCE_S);
    expect(v.map((p) => p.src)).toEqual([[...FENCE_SHEET.postSouth], [...FENCE_SHEET.railSouth]]);
    expect(v.some((p) => p.src === FENCE_SHEET.railsWest)).toBe(false);
  });
  it("every piece fits the 160x128 sheet", () => {
    for (let m = 0; m < 16; m++) for (const p of fenceParts(m)) {
      expect(p.src[0] + p.src[2]).toBeLessThanOrEqual(160);
      expect(p.src[1] + p.src[3]).toBeLessThanOrEqual(128);
    }
  });
});
