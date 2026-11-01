import { describe, expect, it } from "vitest";
import { CROP_DEATH_DAYS, farmNow, plantTile, rollFarmDay, tillTile, waterTile } from "../src/shared/engine";
import type { FarmTile } from "../src/shared/types";
import { predictUse } from "../src/client/game/farm-predict";
import { cropRect } from "../src/client/art/slice";
import { cropJitter, farmSig } from "../src/client/render/farm";
import { makeMap } from "./engine-fixtures";

// Client side of wilting: prediction, the render signature and the catalog frames all follow
// the shared engine, so the owner, their prediction and visitors see the same plant.

function planted(seed: string, day: number): FarmTile {
  const t = tillTile(3, 3);
  expect(plantTile(t, seed, farmNow(day))).toBe(true);
  return t;
}

const endDay = (t: FarmTile, day: number) => rollFarmDay([t], [], day, () => 0.99);

function dead(): FarmTile {
  const t = planted("seed_pumpkin", 0);
  waterTile(t, farmNow(0));
  for (let d = 0; d <= CROP_DEATH_DAYS; d++) endDay(t, d);
  expect(t.dead).toBe(true);
  return t;
}

describe("dead crop prediction", () => {
  it("client prediction clears it the same way", () => {
    const t = dead();
    const farm = new Map([["3,3", t]]);
    const next = predictUse({
      item: "hoe",
      tile: { x: 3, y: 3 },
      farm,
      map: makeMap(["........", "........", "........", "........"]),
      objects: [],
      rock: false,
      water: 5,
      now: farmNow(10),
    });
    expect(next).toEqual({ ...tillTile(3, 3), dryDays: 0 });
    expect(t.dead).toBe(true); // the store's tile is untouched
  });

});

describe("one look everywhere", () => {
  it("the render signature changes when a crop wilts, is watered and dies", () => {
    const t = planted("seed_carrot", 0);
    waterTile(t, farmNow(0));
    endDay(t, 0);
    endDay(t, 1);
    const wilted = farmSig(t, farmNow(2));
    const watered = farmSig({ ...t, lastWateredDay: 2, wateredDays: t.wateredDays + 1 }, farmNow(2));
    const deadSig = farmSig({ ...t, dead: true }, farmNow(2));
    expect(new Set([wilted, watered, deadSig]).size).toBe(3);
    expect(wilted).toContain("wilted");
    expect(deadSig).toContain("dead");
  });

  it("cropRect picks wilted and dead frames, and ready art for a ripe crop", () => {
    const e = {
      file: "x.png",
      stages: [
        [0, 0, 32, 64],
        [32, 0, 32, 64],
        [64, 0, 32, 64],
        [96, 0, 32, 64],
      ] as [number, number, number, number][],
      wilted: [
        [128, 0, 32, 64],
        [160, 0, 32, 64],
        [192, 0, 32, 64],
      ] as [number, number, number, number][],
      dead: [224, 0, 32, 64] as [number, number, number, number],
    };
    expect(cropRect(e, 1)).toEqual([32, 0, 32, 64]);
    expect(cropRect(e, 1, "wilted")).toEqual([160, 0, 32, 64]);
    expect(cropRect(e, 3, "wilted")).toEqual([96, 0, 32, 64]);
    expect(cropRect(e, 2, "dead")).toEqual([224, 0, 32, 64]);
    // A sheet without wilted frames falls back to its stage art.
    expect(cropRect({ file: "y.png", stages: e.stages }, 0, "wilted")).toEqual([0, 0, 32, 64]);
  });
});

describe("cropJitter", () => {
  it("is stable per tile, small, and varies across a row", () => {
    const row = Array.from({ length: 12 }, (_, x) => cropJitter(x, 5));
    expect(cropJitter(3, 5)).toEqual(row[3]);
    for (const j of row) {
      expect(Math.abs(j.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(j.dy)).toBeLessThanOrEqual(1);
    }
    expect(new Set(row.map((j) => j.flip)).size).toBe(2);
    expect(new Set(row.map((j) => j.dx)).size).toBeGreaterThan(1);
  });
});
