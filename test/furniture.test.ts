// Home goods: the furniture stall's stock, rare pieces (monster drops and villager gifts) and the
// fridge's storage engine.
import { describe, expect, it } from "vitest";
import { FURNITURE_SHOP, FRIDGE_STORAGE, HOME_GOODS, RARE_FURNITURE, RARE_GIFTS, RARE_MONSTER_FURNITURE, isCaveZone, rareGiftAt } from "../src/shared/furnitureItems";
import { getItem, isBedItem } from "../src/shared/items";
import { rollMonsterDrops, rollRareFurniture } from "../src/shared/engine";
import { emptyStorage, isStorageEmpty, putIntoStorage, roomIn, sanitizeStorage, storageAccepts, takeFromStorage } from "../src/shared/engine/storage";
import { buyFrom, STALL_SHOPS, stallShop } from "../src/worker/game/shop";
import { NPCS } from "../src/worker/npc/catalog";
import { NPC_IDS } from "../src/worker/npc/bible";
import { maxPoints } from "../src/shared/hearts";
import { bondTalk } from "../src/worker/game/bonds";
import { GIFT_TABLES } from "../src/worker/npc/giftTables";
import { boxFor, containerEmpty, orphanedItems, sanitizeContainers } from "../src/worker/home/containers";
import type { Inventory, PlacedObject } from "../src/shared/types";
import { buildVillage } from "../src/shared/maps/village";

const T0 = Date.UTC(2026, 10, 1, 9);
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe("furniture stall", () => {
  const stall = STALL_SHOPS.stall_goods!;

  it("sells every shop piece at its item price, and nothing rare", () => {
    const sold = stall.shop.sells.map((o) => o.item);
    expect(sold).toEqual([...FURNITURE_SHOP]);
    expect(sold.length).toBeGreaterThanOrEqual(30);
    for (const o of stall.shop.sells) {
      const def = getItem(o.item)!;
      expect(def.kind).toBe("furniture");
      expect(o.price).toBe(def.buy);
      expect(def.sell).toBe(Math.floor(def.buy! / 2));
      expect(RARE_FURNITURE).not.toContain(o.item);
    }
    // Modern pieces are on the shelf too.
    for (const id of ["fridge", "tv", "computer_desk", "game_console", "monitor_stand", "oven", "washer", "speaker"]) expect(sold).toContain(id);
    expect(stall.shop.buys).toEqual([]);
  });

  it("is the labelled east stall on the village square", () => {
    const prop = buildVillage().props.find((p) => p.id === "stall_goods");
    expect(prop?.type).toBe("market_stall");
    expect(prop?.label).toBe("Furniture");
  });

  it("resolves only known stall ids", () => {
    expect(stallShop("stall:stall_goods")?.name).toBe("Furniture Stall");
    expect(stallShop("stall:stall_seeds")).toBeNull();
    expect(stallShop("stall:__proto__")).toBeNull();
    expect(stallShop("n:fenwick")).toBeNull();
  });

  it("buys go through the shared all-or-nothing trade", () => {
    const inv: Inventory = { coins: 500, slots: [] };
    expect(buyFrom(inv, stall.shop, "fridge", 1)).toMatchObject({ ok: true });
    expect(inv.coins).toBe(50);
    expect(inv.slots[0]).toEqual({ item: "fridge", qty: 1 });
    expect(buyFrom(inv, stall.shop, "tv", 1)).toEqual({ ok: false, reason: "Not enough coins." });
    expect(buyFrom({ coins: 1e6, slots: [] }, stall.shop, "throne_gold", 1)).toEqual({ ok: false, reason: "They don't sell that." });
  });

  it("is something Fenwick knows to mention", () => {
    expect(NPCS.fenwick!.knowledge.join(" ")).toMatch(/Furniture Stall/);
  });
});

describe("home goods data", () => {
  it("every piece has a footprint, a place and a sane stack", () => {
    for (const d of HOME_GOODS) {
      expect(d.kind).toBe("furniture");
      expect(d.footprint!.w).toBeGreaterThan(0);
      expect(["floor", "wall"]).toContain(d.placeOn);
      if (d.placeOn === "wall") expect(d.walkable).toBe(true);
      expect(d.stack).toBeLessThanOrEqual(10);
    }
    expect(new Set(HOME_GOODS.map((d) => d.id)).size).toBe(HOME_GOODS.length);
  });

  it("rare pieces are never sold and are rare drops", () => {
    expect(RARE_FURNITURE.length).toBeGreaterThanOrEqual(6);
    for (const id of RARE_FURNITURE) {
      const d = getItem(id)!;
      expect(d.buy).toBeUndefined();
      expect(d.rarity).toBe("rare");
      expect(d.sell).toBeGreaterThan(0);
    }
  });

  it("the quilt beds can be slept in", () => {
    expect(isBedItem("bed_simple")).toBe(true);
    expect(isBedItem("bed_blue")).toBe(true);
    expect(isBedItem("sofa")).toBe(false);
  });
});

describe("rare monster drops", () => {
  it("only cave monsters roll them, at a small chance", () => {
    expect(isCaveZone("caves")).toBe(true);
    expect(isCaveZone("caves_2_left")).toBe(true);
    expect(isCaveZone("riverside")).toBe(false);
    expect(rollRareFurniture("riverside", "slime", () => 0)).toBeNull();
    expect(rollRareFurniture("caves", "slime", () => 0)).toBe("slime_statue");
    expect(rollRareFurniture("caves", "bat", () => 0)).toBe("crystal_lamp");
    expect(rollRareFurniture("caves", "rock_crab", () => 0)).toBe("geode");
    // Just above the chance: nothing.
    expect(rollRareFurniture("caves", "slime", () => RARE_MONSTER_FURNITURE.slime!.chance + 1e-9)).toBeNull();
    for (const r of Object.values(RARE_MONSTER_FURNITURE)) {
      expect(r.chance).toBeLessThan(0.01);
      expect(RARE_FURNITURE).toContain(r.item);
    }
  });

  it("scales with DROP_RATE_RARE and can be switched off", () => {
    const c = RARE_MONSTER_FURNITURE.bat!.chance;
    expect(rollRareFurniture("caves", "bat", () => c * 1.5, { global: 1, rare: 2 })).toBe("crystal_lamp");
    expect(rollRareFurniture("caves", "bat", () => 0, { global: 1, rare: 0 })).toBeNull();
  });

  it("joins a kill's loot in the caves (fixed rand)", () => {
    // rand 0 makes every roll succeed: the rare piece is in the list once.
    const loot = rollMonsterDrops("slime", () => 0, "caves");
    expect(loot.filter((d) => d.item === "slime_statue")).toEqual([{ item: "slime_statue", qty: 1 }]);
    expect(rollMonsterDrops("slime", () => 0, "riverside").some((d) => d.item === "slime_statue")).toBe(false);
    // rand 0.999: nothing rare.
    expect(rollMonsterDrops("bat", () => 0.999, "caves").some((d) => d.item === "crystal_lamp")).toBe(false);
  });
});

describe("rare villager gifts", () => {
  it("names a rare piece per listed villager at 8 or 10 hearts", () => {
    for (const [npc, g] of Object.entries(RARE_GIFTS)) {
      expect((NPC_IDS as readonly string[]).includes(npc)).toBe(true);
      expect(RARE_FURNITURE).toContain(g.item);
      expect([8, 10]).toContain(g.hearts);
      // Ordinary milestone tables never hand out rare pieces.
      expect(GIFT_TABLES[npc as keyof typeof GIFT_TABLES]).not.toContain(g.item);
    }
    expect(rareGiftAt("pip", 8)).toBe("arcade_cabinet");
    expect(rareGiftAt("pip", 6)).toBeNull();
    expect(rareGiftAt("odette", 10)).toBeNull();
    expect(rareGiftAt("__proto__", 8)).toBeNull();
  });

  it("is handed over once when the milestone is reached", () => {
    const bonds = {};
    const inv: Inventory = { coins: 0, slots: [] };
    // rand 0.999: no ordinary gift or seed, so only the rare piece can come.
    const never = () => 0.999;
    bondTalk(bonds, "marlo", inv, T0, never);
    const b = (bonds as Record<string, { pts: number; given: string[] }>).marlo!;
    b.pts = maxPoints("marlo") - 1;
    const out = bondTalk(bonds, "marlo", inv, T0 + 60_000 * 60, never)!;
    expect(out.delivered).toContain("aquarium");
    expect(inv.slots.filter((s) => s?.item === "aquarium")).toHaveLength(1);
    expect(b.given).toContain("aquarium");
    // Talking again pays nothing more.
    const again = bondTalk(bonds, "marlo", inv, T0 + 2 * 60_000 * 60, never)!;
    expect(again.delivered).not.toContain("aquarium");
  });
});

describe("storage engine (fridge)", () => {
  const spec = FRIDGE_STORAGE;
  const bag = (): Inventory => ({
    coins: 0,
    slots: [
      { item: "hoe", qty: 1 },
      { item: "turnip", qty: 30 },
      { item: "turnip", qty: 5, quality: 2 },
      { item: "stone", qty: 10 },
      { item: "fish_trout", qty: 3 },
    ],
  });

  it("takes food only", () => {
    expect(storageAccepts(spec, "turnip")).toBe(true);
    expect(storageAccepts(spec, "turnip_gold")).toBe(true);
    expect(storageAccepts(spec, "fish_trout")).toBe(true);
    expect(storageAccepts(spec, "mushroom")).toBe(true);
    expect(storageAccepts(spec, "stone")).toBe(false);
    expect(storageAccepts(spec, "hoe")).toBe(false);
    expect(storageAccepts(spec, "seed_turnip")).toBe(false);
    expect(storageAccepts({ slots: 4, accepts: "any" }, "stone")).toBe(true);
    expect(storageAccepts({ slots: 4, accepts: "any" }, "hoe")).toBe(false);
  });

  it("moves a stack in and back out, keeping quality apart", () => {
    const inv = bag();
    const box = emptyStorage(spec);
    expect(putIntoStorage(inv, box, spec, 1)).toEqual({ ok: true, moved: 30, item: "turnip" });
    expect(inv.slots[1]).toBeNull();
    expect(putIntoStorage(inv, box, spec, 2, 2)).toEqual({ ok: true, moved: 2, item: "turnip" });
    expect(box[0]).toEqual({ item: "turnip", qty: 30 });
    expect(box[1]).toEqual({ item: "turnip", qty: 2, quality: 2 });
    expect(inv.slots[2]).toEqual({ item: "turnip", qty: 3, quality: 2 });
    expect(takeFromStorage(inv, box, 0, 10)).toEqual({ ok: true, moved: 10, item: "turnip" });
    expect(box[0]!.qty).toBe(20);
    expect(takeFromStorage(inv, box, 1)).toMatchObject({ ok: true, moved: 2 });
    expect(box[1]).toBeNull();
    expect(inv.slots[2]).toEqual({ item: "turnip", qty: 5, quality: 2 });
  });

  it("validates slots, amounts and what goes in", () => {
    const inv = bag();
    const box = emptyStorage(spec);
    expect(putIntoStorage(inv, box, spec, 3)).toEqual({ ok: false, reason: "Only food keeps in here." });
    expect(putIntoStorage(inv, box, spec, 0)).toMatchObject({ ok: false });
    expect(putIntoStorage(inv, box, spec, 9)).toEqual({ ok: false, reason: "Nothing in that slot." });
    expect(putIntoStorage(inv, box, spec, -1)).toEqual({ ok: false, reason: "Invalid slot." });
    expect(putIntoStorage(inv, box, spec, 1.5)).toEqual({ ok: false, reason: "Invalid slot." });
    expect(putIntoStorage(inv, box, spec, 1, 0)).toEqual({ ok: false, reason: "Invalid amount." });
    expect(putIntoStorage(inv, box, spec, 1, 2.5)).toEqual({ ok: false, reason: "Invalid amount." });
    // More than the stack holds: just the stack.
    expect(putIntoStorage(inv, box, spec, 4, 50)).toEqual({ ok: true, moved: 3, item: "fish_trout" });
    expect(takeFromStorage(inv, box, 5)).toEqual({ ok: false, reason: "That shelf is empty." });
    expect(takeFromStorage(inv, box, 12)).toEqual({ ok: false, reason: "Invalid slot." });
    expect(takeFromStorage(inv, box, 0, -3)).toEqual({ ok: false, reason: "Invalid amount." });
  });

  it("moves only what fits, both ways", () => {
    const inv: Inventory = { coins: 0, slots: [{ item: "carrot", qty: 99 }] };
    const box = emptyStorage({ slots: 1, accepts: "food" });
    box[0] = { item: "carrot", qty: 90 };
    expect(roomIn(box, "carrot")).toBe(9);
    expect(putIntoStorage(inv, box, { slots: 1, accepts: "food" }, 0)).toEqual({ ok: true, moved: 9, item: "carrot" });
    expect(inv.slots[0]).toEqual({ item: "carrot", qty: 90 });
    expect(putIntoStorage(inv, box, { slots: 1, accepts: "food" }, 0)).toEqual({ ok: false, reason: "It's full." });
    const full: Inventory = { coins: 0, slots: Array.from({ length: 24 }, () => ({ item: "stone", qty: 99 })) };
    expect(takeFromStorage(full, box, 0)).toEqual({ ok: false, reason: "Your bag is full." });
    expect(box[0]!.qty).toBe(99);
  });

  it("sanitizes saved contents", () => {
    const got = sanitizeStorage(
      [{ item: "turnip", qty: 500 }, { item: "stone", qty: 3 }, { item: "nope", qty: 1 }, { item: "carrot", qty: 2, quality: 7 }, "x", null],
      spec,
    );
    expect(got).toHaveLength(spec.slots);
    expect(got[0]).toEqual({ item: "turnip", qty: 99 });
    expect(got[1]).toBeNull();
    expect(got[2]).toBeNull();
    expect(got[3]).toEqual({ item: "carrot", qty: 2 });
    expect(isStorageEmpty(sanitizeStorage(undefined, spec))).toBe(true);
  });

  it("keeps containers only for placed storage pieces", () => {
    const objects: PlacedObject[] = [
      { id: "o1", item: "fridge", x: 2, y: 4, rotation: 0 },
      { id: "o2", item: "sofa", x: 4, y: 4, rotation: 0 },
    ];
    const raw = { o1: [{ item: "turnip", qty: 4 }], o2: [{ item: "turnip", qty: 4 }], gone: [{ item: "carrot", qty: 2 }] };
    const c = sanitizeContainers(raw, objects);
    expect(Object.keys(c)).toEqual(["o1"]);
    expect(containerEmpty(c, "o1")).toBe(false);
    expect(containerEmpty(c, "o9")).toBe(true);
    expect(boxFor(c, objects[1]!)).toBeNull();
    expect(boxFor(c, objects[0]!)![0]).toEqual({ item: "turnip", qty: 4 });
    expect(orphanedItems(raw, objects)).toEqual([{ item: "turnip", qty: 4 }, { item: "carrot", qty: 2 }]);
  });
});

// Keep the seeded tables honest: a fixed sequence gives a fixed answer.
describe("fixed rand", () => {
  it("is deterministic", () => {
    const r = seq(0.001, 0.9);
    expect(rollRareFurniture("caves", "rock_crab", r)).toBe("geode");
    expect(rollRareFurniture("caves", "rock_crab", r)).toBeNull();
  });
});
