import { describe, expect, it } from "vitest";
import { FarmPrediction, PREDICT_TTL_MS, predictUse, type PredictInput } from "../src/client/game/farm-predict";
import { isRefill, shippedItem, REFILL_WINDOW_MS } from "../src/client/game/farm-fx";
import { getMap } from "../src/shared/maps";
import { farmNow } from "../src/shared/engine/homeclock";
import { cropView, isWaterSource, tillTile } from "../src/shared/engine";
import { Ground, type FarmTile } from "../src/shared/types";

const home = getMap("home");
const now = farmNow(2);
const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;

function input(over: Partial<PredictInput>): PredictInput {
  return { item: "hoe", tile: { x: 24, y: 6 }, farm: new Map(), map: home, objects: [], rock: false, water: 10, now, ...over };
}
const farmWith = (...tiles: FarmTile[]) => new Map(tiles.map((t) => [key(t), t]));

describe("predictUse", () => {
  it("tills grass inside the field with the hoe", () => {
    expect(predictUse(input({}))).toEqual(tillTile(24, 6));
  });

  it("predicts nothing the server would refuse", () => {
    expect(predictUse(input({ tile: { x: 5, y: 20 } }))).toBeNull(); // outside the farm area
    expect(predictUse(input({ rock: true }))).toBeNull();
    expect(predictUse(input({ farm: farmWith(tillTile(24, 6)) }))).toBeNull(); // already tilled
    expect(predictUse(input({ item: "seed_turnip" }))).toBeNull(); // seeds need soil
    expect(predictUse(input({ item: null }))).toBeNull();
  });

  it("plants a seed on empty soil", () => {
    const t = predictUse(input({ item: "seed_turnip", farm: farmWith(tillTile(24, 6)) }));
    expect(t?.crop).toBe("turnip");
    expect(t?.plantedAt).toBe(now);
  });

  it("waters a planted tile once, if the can has water, without touching the store's tile", () => {
    const planted: FarmTile = { ...tillTile(24, 6), crop: "turnip", plantedAt: now };
    const farm = farmWith(planted);
    const t = predictUse(input({ item: "watering_can", farm }))!;
    expect(cropView(t, now).wateredToday).toBe(true);
    expect(cropView(planted, now).wateredToday).toBe(false);
    expect(predictUse(input({ item: "watering_can", farm: farmWith(t) }))).toBeNull();
    expect(predictUse(input({ item: "watering_can", farm, water: 0 }))).toBeNull();
  });
});

describe("FarmPrediction", () => {
  const a = tillTile(1, 1);
  const b = tillTile(2, 1);

  it("lays predictions over the store until the server confirms them", () => {
    const p = new FarmPrediction();
    p.add(a, "r1", 0);
    expect(p.merge([b]).map(key).sort()).toEqual(["1,1", "2,1"]);
    p.confirm([a]);
    expect(p.size).toBe(0);
    expect(p.merge([b])).toEqual([b]);
  });

  it("drops a prediction on its own reject only", () => {
    const p = new FarmPrediction();
    p.add(a, "r1", 0);
    p.add(b, "r2", 0);
    expect(p.reject("r9")).toBe(false);
    expect(p.reject("r1")).toBe(true);
    expect(p.merge([]).map(key)).toEqual(["2,1"]);
  });

  it("expires predictions the server never answered", () => {
    const p = new FarmPrediction();
    p.add(a, "r1", 100);
    expect(p.expire(100 + PREDICT_TTL_MS - 1)).toBe(false);
    expect(p.expire(100 + PREDICT_TTL_MS)).toBe(true);
    expect(p.size).toBe(0);
  });

  it("a prediction replaces the store's copy of the same tile", () => {
    const p = new FarmPrediction();
    const planted = { ...a, crop: "turnip" as const, plantedAt: 5 };
    p.add(planted, "r1", 0);
    expect(p.merge([a])).toEqual([planted]);
  });
});

describe("shippedItem", () => {
  it("finds the line that grew", () => {
    expect(shippedItem([], [{ item: "turnip", qty: 3, coins: 30 }])).toBe("turnip");
    expect(
      shippedItem([{ item: "turnip", qty: 3, coins: 30 }], [{ item: "turnip", qty: 3, coins: 30 }, { item: "pumpkin", qty: 1, coins: 50 }]),
    ).toBe("pumpkin");
  });

  it("is null for the first snapshot, unshipping or no change", () => {
    expect(shippedItem(null, [{ item: "turnip", qty: 3, coins: 30 }])).toBeNull();
    expect(shippedItem([{ item: "turnip", qty: 3, coins: 30 }], [])).toBeNull();
    expect(shippedItem([{ item: "turnip", qty: 3, coins: 30 }], [{ item: "turnip", qty: 3, coins: 30 }])).toBeNull();
  });
});

describe("refill", () => {
  it("needs a recent use on water and more water than before", () => {
    expect(isRefill(1000, 1500, 5, 20)).toBe(true);
    expect(isRefill(null, 1500, 5, 20)).toBe(false);
    expect(isRefill(1000, 1000 + REFILL_WINDOW_MS + 1, 5, 20)).toBe(false);
    expect(isRefill(1000, 1500, 20, 20)).toBe(false);
    expect(isRefill(1000, 1500, null, 20)).toBe(false);
  });

  it("the well and the pond are water sources, the field is not", () => {
    const well = home.props.find((p) => p.type === "well")!;
    expect(isWaterSource(home, well.x, well.y)).toBe(true);
    expect(isWaterSource(home, well.x + well.w - 1, well.y + well.h - 1)).toBe(true);
    const water = home.ground.findIndex((g) => g === Ground.Water);
    expect(water).toBeGreaterThanOrEqual(0);
    expect(isWaterSource(home, water % home.width, Math.floor(water / home.width))).toBe(true);
    expect(isWaterSource(home, 24, 6)).toBe(false);
  });
});
