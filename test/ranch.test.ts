import { describe, expect, it } from "vitest";
import {
  BARN_CAPACITY,
  BARN_ID,
  BARN_PRICE,
  BARN_SIZE,
  BARN_SPOT,
  buyBarn,
  buyChickens,
  CHICKEN_PRICE,
  collectEgg,
  layEggs,
  townhallOffers,
} from "../src/shared/ranch";
import { emptyAnimals, MAX_EGGS } from "../src/shared/animals";
import { getMap } from "../src/shared/maps";
import { buildCollision, canPlace, canStand, pointInRect } from "../src/shared/engine";
import { ensureBarn, eggSpots, eggViews, yardAnimals } from "../src/worker/home/ranch";
import { townhallBuy, townhallSell } from "../src/worker/game/townhall";
import { binPayout, shipSlot } from "../src/worker/game/shipping";
import type { Inventory } from "../src/shared/types";

const rich = (coins = 10_000): Inventory => ({ coins, slots: [] });

describe("barn", () => {
  it("is sold once at the town hall, then hens are offered instead", () => {
    const s = emptyAnimals();
    expect(townhallOffers(s).map((o) => o.item)).toEqual(["barn", "pet_treat"]);
    const poor = rich(BARN_PRICE - 1);
    expect(buyBarn(s, poor)).toMatchObject({ ok: false });
    expect(s.barn).toBe(false);
    const inv = rich(BARN_PRICE);
    expect(buyBarn(s, inv).ok).toBe(true);
    expect(inv.coins).toBe(0);
    expect(buyBarn(s, rich()).ok).toBe(false);
    expect(townhallOffers(s).map((o) => o.item)).toEqual(["chicken", "pet_treat"]);
    expect(townhallBuy(emptyAnimals(), rich(), "barn", 2)).toMatchObject({ ok: false });
  });

  it("its fixed lot is a valid outdoor spot on the home map, clear of trees, rocks, paths and exits", () => {
    const home = getMap("home");
    expect(canPlace(home, [], [], "barn", BARN_SPOT.x, BARN_SPOT.y, 0)).toEqual({ ok: true });
    const lot = { ...BARN_SPOT, ...BARN_SIZE };
    for (const p of home.props) expect(pointInRect(lot, p.x, p.y), p.id).toBe(false);
    for (const r of home.rocks ?? []) expect(pointInRect(lot, r.x, r.y)).toBe(false);
  });

  it("is built on the lot for an existing save, handing back what stood there", () => {
    const s = emptyAnimals();
    s.barn = true;
    const objects = { home: [{ id: "o1", item: "chair_wood", x: BARN_SPOT.x + 1, y: BARN_SPOT.y, rotation: 0 as const }, { id: "o2", item: "chair_wood", x: 1, y: 1, rotation: 0 as const }], home_in: [] };
    const farm = [
      { x: BARN_SPOT.x, y: BARN_SPOT.y + 1, crop: "turnip", plantedAt: 0, wateredDays: 0 },
      { x: 2, y: 2 },
    ] as never[];
    const built = ensureBarn(s, objects, farm)!;
    expect(built.returned.sort()).toEqual(["chair_wood", "seed_turnip"]);
    expect(built.farm).toHaveLength(1);
    expect(objects.home.map((o) => o.id).sort()).toEqual([BARN_ID, "o2"]);
    expect(ensureBarn(s, objects, built.farm)).toBeNull();
    expect(ensureBarn(emptyAnimals(), { home: [], home_in: [] }, [])).toBeNull();
  });
});

describe("hens", () => {
  it("need a barn and fit BARN_CAPACITY", () => {
    const s = emptyAnimals();
    expect(buyChickens(s, rich(), 1)).toMatchObject({ ok: false });
    s.barn = true;
    expect(buyChickens(s, rich(), BARN_CAPACITY + 1)).toMatchObject({ ok: false });
    const inv = rich(CHICKEN_PRICE * 3);
    expect(buyChickens(s, inv, 3).ok).toBe(true);
    expect(inv.coins).toBe(0);
    expect(buyChickens(s, rich(CHICKEN_PRICE - 1), 1)).toMatchObject({ ok: false, reason: "Not enough coins." });
    expect(buyChickens(s, rich(), 1).ok).toBe(true);
    expect(s.chickens).toHaveLength(BARN_CAPACITY);
    expect(buyChickens(s, rich(), 1)).toMatchObject({ ok: false });
    expect(townhallOffers(s).map((o) => o.item)).toEqual(["pet_treat"]);
    expect(new Set(s.chickens.map((c) => c.id)).size).toBe(BARN_CAPACITY);
    // hens wander the yard only once the barn stands
    expect(yardAnimals(s, false)).toHaveLength(0);
    expect(yardAnimals(s, true)).toHaveLength(BARN_CAPACITY);
  });

  it("settle on their first day and lay one egg each later home day, once per day", () => {
    const s = emptyAnimals();
    s.barn = true;
    buyChickens(s, rich(), 2);
    const spots = [{ x: 7.5, y: 18.5 }, { x: 8.5, y: 18.5 }, { x: 9.5, y: 18.5 }];
    expect(layEggs(s, 5, spots)).toEqual([]);
    expect(s.chickens.every((c) => c.day === 5)).toBe(true);
    expect(layEggs(s, 5, spots)).toEqual([]);
    const day6 = layEggs(s, 6, spots);
    expect(day6).toHaveLength(2);
    expect(new Set(day6.map((e) => `${e.x},${e.y}`)).size).toBe(2);
    expect(layEggs(s, 6, spots)).toEqual([]);
    expect(layEggs(s, 8, spots)).toHaveLength(1); // only one spot left free
    expect(s.eggs).toHaveLength(3);
  });

  it("stop laying at MAX_EGGS", () => {
    const s = emptyAnimals();
    s.barn = true;
    buyChickens(s, rich(), 4);
    const spots = Array.from({ length: 40 }, (_, i) => ({ x: i + 0.5, y: 0.5 }));
    layEggs(s, 1, spots);
    for (let d = 2; d < 20; d++) layEggs(s, d, spots);
    expect(s.eggs.length).toBe(MAX_EGGS);
  });

  it("eggs are picked by the owner and sold at the town hall or shipped", () => {
    const s = emptyAnimals();
    s.eggs.push({ id: "egg_1", x: 7.5, y: 18.5 });
    expect(eggViews(s, true)[0]).toMatchObject({ id: "egg_1", item: "egg", forage: true });
    expect(eggViews(s, false)[0]!.forage).toBeUndefined();
    const inv: Inventory = { coins: 0, slots: [] };
    expect(collectEgg(s, inv, "egg_1")).toBe("ok");
    expect(collectEgg(s, inv, "egg_1")).toBe("gone");
    expect(inv.slots[0]).toEqual({ item: "egg", qty: 1 });
    expect(townhallSell(inv, 0, 1)).toMatchObject({ ok: true });
    expect(inv.coins).toBe(35);
    const bag: Inventory = { coins: 0, slots: [{ item: "egg", qty: 3 }] };
    const bin: { item: string; qty: number }[] = [];
    expect(shipSlot(bag, bin, 0).ok).toBe(true);
    expect(binPayout(bin).total).toBe(105);
  });

  it("lay only on standable tiles in front of the barn", () => {
    const home = getMap("home");
    const grid = buildCollision(home, { objects: [{ id: BARN_ID, item: "barn", x: BARN_SPOT.x, y: BARN_SPOT.y, rotation: 0 }] });
    const spots = eggSpots(grid);
    expect(spots.length).toBeGreaterThanOrEqual(4);
    for (const p of spots) {
      expect(canStand(grid, p.x, p.y)).toBe(true);
      expect(p.y).toBeGreaterThan(BARN_SPOT.y + BARN_SIZE.h);
    }
  });
});
