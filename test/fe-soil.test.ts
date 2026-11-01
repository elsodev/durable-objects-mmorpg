import { describe, expect, it } from "vitest";
import {
  SOIL_E,
  SOIL_FRINGE_SHIFT,
  SOIL_N,
  SOIL_NE,
  SOIL_NW,
  SOIL_S,
  SOIL_SE,
  SOIL_SW,
  SOIL_W,
  maskHas,
  planSoil,
  soilMask,
  soilPieces,
  soilShift,
  soilSig,
} from "../src/client/render/soil-autotile";
import { planFarmSoil } from "../src/client/render/farm";
import { farmNow } from "../src/shared/engine/homeclock";
import { waterTile } from "../src/shared/engine";
import type { FarmTile } from "../src/shared/types";

const setOf = (...tiles: [number, number][]) => {
  const s = new Set(tiles.map(([x, y]) => `${x},${y}`));
  return (x: number, y: number) => s.has(`${x},${y}`);
};
const ALL = SOIL_N | SOIL_E | SOIL_S | SOIL_W | SOIL_NE | SOIL_SE | SOIL_SW | SOIL_NW;

describe("soilMask", () => {
  it("is 0 for a lone tile and sets one bit per tilled neighbour", () => {
    expect(soilMask(setOf([5, 5]), 5, 5)).toBe(0);
    expect(soilMask(setOf([5, 4]), 5, 5)).toBe(SOIL_N);
    expect(soilMask(setOf([6, 5]), 5, 5)).toBe(SOIL_E);
    expect(soilMask(setOf([5, 6]), 5, 5)).toBe(SOIL_S);
    expect(soilMask(setOf([4, 5]), 5, 5)).toBe(SOIL_W);
    expect(soilMask(setOf([6, 4], [4, 6]), 5, 5)).toBe(SOIL_NE | SOIL_SW);
  });

  it("is full in the middle of a 3x3 patch", () => {
    const tiles: [number, number][] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) tiles.push([x, y]);
    expect(soilMask(setOf(...tiles), 1, 1)).toBe(ALL);
  });

  it("maskHas reads the bits back by offset", () => {
    expect(maskHas(SOIL_E | SOIL_SW, 1, 0)).toBe(true);
    expect(maskHas(SOIL_E | SOIL_SW, -1, 1)).toBe(true);
    expect(maskHas(SOIL_E | SOIL_SW, 0, -1)).toBe(false);
    expect(maskHas(ALL, 0, 0)).toBe(false);
  });
});

describe("soilPieces", () => {
  it("gives a lone tile the four outer corners", () => {
    expect(soilPieces(0)).toEqual([
      { block: "outer", col: 0, row: 0 },
      { block: "outer", col: 2, row: 0 },
      { block: "outer", col: 0, row: 2 },
      { block: "outer", col: 2, row: 2 },
    ]);
  });

  it("draws no edge inside a patch", () => {
    expect(soilPieces(ALL)).toEqual([null, null, null, null]);
  });

  it("merges the shared edge of two tiles side by side", () => {
    // West tile of a horizontal pair: open on N, S and W only.
    const p = soilPieces(SOIL_E);
    expect(p[0]).toEqual({ block: "outer", col: 0, row: 0 }); // NW corner
    expect(p[1]).toEqual({ block: "outer", col: 1, row: 0 }); // north edge runs on east
    expect(p[3]).toEqual({ block: "outer", col: 1, row: 2 }); // south edge runs on east
  });

  it("notches an inside corner when only the diagonal is missing", () => {
    const p = soilPieces(ALL & ~SOIL_NE);
    expect(p[1]).toEqual({ block: "inner", col: 0, row: 1 });
    expect(p[0]).toBeNull();
  });
});

describe("planSoil", () => {
  it("plans the wet patch only on watered tiles, over watered neighbours", () => {
    const tilled = setOf([0, 0], [1, 0], [2, 0]);
    const watered = setOf([0, 0], [1, 0]);
    const dry = planSoil(tilled, watered, 2, 0);
    expect(dry.wet).toBeNull();
    expect(dry.wetMask).toBeNull();
    const wet = planSoil(tilled, watered, 1, 0);
    expect(wet.mask).toBe(SOIL_E | SOIL_W);
    expect(wet.wetMask).toBe(SOIL_W);
    expect(wet.wet).not.toBeNull();
    expect(soilSig(wet)).not.toBe(soilSig(planSoil(tilled, setOf([1, 0]), 1, 0)));
  });
});

describe("soilShift", () => {
  it("pulls only the outward edge of a piece toward the patch", () => {
    expect(soilShift(null, 0)).toEqual({ x: 0, y: 0 });
    expect(soilShift({ block: "inner", col: 0, row: 0 }, 3)).toEqual({ x: 0, y: 0 });
    expect(soilShift({ block: "outer", col: 0, row: 0 }, 0)).toEqual({ x: SOIL_FRINGE_SHIFT, y: SOIL_FRINGE_SHIFT });
    expect(soilShift({ block: "outer", col: 2, row: 2 }, 3)).toEqual({ x: -SOIL_FRINGE_SHIFT, y: -SOIL_FRINGE_SHIFT });
    expect(soilShift({ block: "outer", col: 1, row: 0 }, 1)).toEqual({ x: 0, y: SOIL_FRINGE_SHIFT });
    expect(soilShift({ block: "outer", col: 2, row: 1 }, 1)).toEqual({ x: -SOIL_FRINGE_SHIFT, y: 0 });
  });

  it("never leaves the piece's 3x3 block", () => {
    // Quadrant origin (half tiles) + shift must stay within 0..3 tiles of the block.
    for (const col of [0, 1, 2])
      for (const row of [0, 1, 2])
        for (const q of [0, 1, 2, 3] as const) {
          const s = soilShift({ block: "outer", col, row }, q);
          const x = col + (q & 1 ? 0.5 : 0) + s.x;
          const y = row + (q & 2 ? 0.5 : 0) + s.y;
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x + 0.5).toBeLessThanOrEqual(3);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y + 0.5).toBeLessThanOrEqual(3);
        }
  });
});

describe("planFarmSoil", () => {
  const tile = (x: number, y: number): FarmTile => ({ x, y, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null });

  it("joins a 3x2 patch and marks only watered crops wet", () => {
    const now = farmNow(3);
    const tiles: FarmTile[] = [];
    for (let y = 6; y <= 7; y++) for (let x = 24; x <= 26; x++) tiles.push(tile(x, y));
    const planted = tiles.find((t) => t.x === 25 && t.y === 7)!;
    planted.crop = "turnip";
    planted.plantedAt = now;
    expect(waterTile(planted, now)).toBe(true);
    const plans = planFarmSoil(tiles, now);
    expect(plans.get("25,6")!.mask).toBe(SOIL_E | SOIL_W | SOIL_S | SOIL_SE | SOIL_SW);
    expect(plans.get("25,7")!.wetMask).toBe(0);
    expect(plans.get("24,7")!.wetMask).toBeNull();
  });
});
