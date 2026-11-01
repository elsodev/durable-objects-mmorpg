import { describe, expect, it } from "vitest";
import {
  cropYield,
  farmingLevel,
  fertilizerGoldBonus,
  harvestRand,
  MAX_HARVEST,
  qualityOdds,
  rockRand,
  rollCount,
  rollHarvest,
  rollQuality,
} from "../src/shared/engine/harvest";
import { rockDrops } from "../src/worker/game/rocks";

/** Returns the given draws in order, then repeats the last. */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[Math.min(i++, v.length - 1)]!;
};

describe("farming level", () => {
  it("grows with crops harvested and caps at 10", () => {
    expect(farmingLevel(0)).toBe(0);
    expect(farmingLevel(4)).toBe(0);
    expect(farmingLevel(5)).toBe(1);
    expect(farmingLevel(20)).toBe(2);
    expect(farmingLevel(500)).toBe(10);
    expect(farmingLevel(1e9)).toBe(10);
    expect(farmingLevel(-3)).toBe(0);
    expect(farmingLevel(Number.NaN)).toBe(0);
  });
});

describe("quality odds", () => {
  it("gold is 0.2·(L/10) + 0.01 and silver twice that, capped at 0.75", () => {
    expect(qualityOdds(0).gold).toBeCloseTo(0.01);
    expect(qualityOdds(0).silver).toBeCloseTo(0.02);
    expect(qualityOdds(5).gold).toBeCloseTo(0.11);
    expect(qualityOdds(10).gold).toBeCloseTo(0.21);
    expect(qualityOdds(10).silver).toBeCloseTo(0.42);
    expect(qualityOdds(99).gold).toBeCloseTo(0.21);
  });
  it("has a fertilizer hook that adds to gold (none yet in the game)", () => {
    expect(fertilizerGoldBonus(0, 10)).toBe(0);
    expect(qualityOdds(10, 3).gold).toBeGreaterThan(qualityOdds(10).gold);
    expect(qualityOdds(10, 3).silver).toBe(0.75);
  });
  it("rolls gold first, then silver, then normal", () => {
    expect(rollQuality(0, seq(0.005))).toBe(2);
    expect(rollQuality(0, seq(0.5, 0.015))).toBe(1);
    expect(rollQuality(0, seq(0.5, 0.5))).toBe(0);
  });
  it("matches the odds over many seeded harvests", () => {
    const n = 20_000;
    let gold = 0;
    let silver = 0;
    for (let i = 0; i < n; i++) {
      const q = rollQuality(10, harvestRand("owner", i, 3, 4));
      if (q === 2) gold++;
      else if (q === 1) silver++;
    }
    expect(gold / n).toBeCloseTo(0.21, 1);
    // Silver is checked only when gold missed.
    expect(silver / n).toBeCloseTo(0.79 * 0.42, 1);
  });
});

describe("yield", () => {
  it("draws a count in [min, max] and extra crops while the roll beats the chance", () => {
    expect(rollCount({ min: 1, max: 1, extra: 0 }, seq(0.99))).toBe(1);
    expect(rollCount({ min: 1, max: 3, extra: 0 }, seq(0.99))).toBe(3);
    expect(rollCount({ min: 1, max: 3, extra: 0 }, seq(0))).toBe(1);
    expect(rollCount({ min: 1, max: 1, extra: 0.5 }, seq(0, 0.1, 0.4, 0.6))).toBe(3);
    // Extra chances are capped, so a count can't run away.
    expect(rollCount({ min: 1, max: 1, extra: 5 }, seq(0))).toBe(MAX_HARVEST);
  });
  it("gives the quality to the first crop only", () => {
    // gold, then count 1 + 2 extras.
    const r = rollHarvest("turnip", 0, seq(0.001, 0, 0.05, 0.05, 0.9));
    expect(r.quality).toBe(2);
    expect(r.count).toBe(3);
    expect(r.items).toEqual([
      { item: "turnip_gold", qty: 1 },
      { item: "turnip", qty: 2 },
    ]);
    // Normal quality stacks into one entry.
    const n = rollHarvest("turnip", 0, seq(0.9, 0.9, 0, 0.05, 0.9));
    expect(n.items).toEqual([{ item: "turnip", qty: 2 }]);
  });
  it("knows each crop's yield, defaulting to one", () => {
    expect(cropYield("strawberry").max).toBe(2);
    expect(cropYield("pumpkin")).toEqual({ min: 1, max: 1, extra: 0 });
    expect(cropYield("nonsense")).toEqual({ min: 1, max: 1, extra: 0 });
  });
});

describe("seeded rolls", () => {
  it("gives the same harvest for the same owner, day and tile", () => {
    for (let day = 1; day < 50; day++) {
      expect(rollHarvest("carrot", 4, harvestRand("u1", day, 7, 9))).toEqual(rollHarvest("carrot", 4, harvestRand("u1", day, 7, 9)));
    }
  });
  it("varies with the owner, the day and the tile", () => {
    const draw = (owner: string, day: number, x: number, y: number) => harvestRand(owner, day, x, y)();
    const base = draw("u1", 3, 7, 9);
    expect(draw("u2", 3, 7, 9)).not.toBe(base);
    expect(draw("u1", 4, 7, 9)).not.toBe(base);
    expect(draw("u1", 3, 8, 9)).not.toBe(base);
    expect(draw("u1", 3, 7, 10)).not.toBe(base);
  });
  it("seeds rock drops by rock and spawn number", () => {
    expect(rockDrops("copper", rockRand("home:u1", "r1", 2))).toEqual(rockDrops("copper", rockRand("home:u1", "r1", 2)));
    const a = rockRand("caves", "r1", 0)();
    expect(rockRand("caves", "r1", 1)()).not.toBe(a);
    expect(rockRand("caves", "r2", 0)()).not.toBe(a);
  });
});

describe("crop yield table", () => {
  it("only names crops that exist, with sane ranges", async () => {
    const { CROP_YIELD } = await import("../src/shared/engine/harvest");
    const { getItem } = await import("../src/shared/items");
    for (const [id, y] of Object.entries(CROP_YIELD)) {
      expect(getItem(id)?.kind, id).toBe("crop");
      expect(y.min).toBeGreaterThanOrEqual(1);
      expect(y.max).toBeGreaterThanOrEqual(y.min);
      expect(y.extra).toBeLessThan(1);
    }
  });
});
