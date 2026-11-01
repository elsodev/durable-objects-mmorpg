import { describe, expect, it } from "vitest";
import { addItem, canAdd, countItem, removeFromSlot, removeItem } from "../src/shared/engine";
import { ITEMS, MAX_SLOTS, getItem, starterInventory } from "../src/shared/items";
import type { Inventory } from "../src/shared/types";

const empty = (): Inventory => ({ coins: 0, slots: [] });

describe("item catalog", () => {
  it("has every required item with icon = id", () => {
    const ids = [
      "hoe", "watering_can", "pickaxe", "pickaxe_iron", "sword_wood", "sword_copper",
      "seed_turnip", "turnip", "seed_carrot", "carrot", "seed_pumpkin", "pumpkin", "seed_strawberry", "strawberry",
      "stone", "ore_copper", "ore_iron", "gem_crystal", "wood", "slime_gel", "bat_wing", "crab_shell",
      "herb_mint", "mushroom", "fish_trout",
      "chair_wood", "table_wood", "bed_simple", "rug", "lamp", "fence", "scarecrow", "flower_pot",
    ];
    for (const id of ids) {
      const d = getItem(id);
      expect(d, id).toBeDefined();
      expect(d!.id).toBe(id);
      expect(d!.icon).toBe(id);
    }
  });

  it("seeds grow the right crops in the right number of days", () => {
    expect(ITEMS.seed_turnip.grows).toEqual({ crop: "turnip", days: 2 });
    expect(ITEMS.seed_carrot.grows).toEqual({ crop: "carrot", days: 3 });
    expect(ITEMS.seed_strawberry.grows).toEqual({ crop: "strawberry", days: 4, regrow: 3 });
    expect(ITEMS.seed_pumpkin.grows).toEqual({ crop: "pumpkin", days: 5 });
  });

  it("tools stack 1, furniture <= 10, others 99; furniture has footprint + placeOn", () => {
    for (const d of Object.values(ITEMS)) {
      if (d.kind === "tool") expect(d.stack).toBe(1);
      else if (d.kind === "furniture") {
        expect(d.stack).toBeLessThanOrEqual(10);
        expect(d.footprint).toBeDefined();
        expect(d.placeOn).toBeDefined();
      } else expect(d.stack).toBe(99);
    }
    expect(ITEMS.table_wood.footprint).toEqual({ w: 2, h: 1 });
    expect(ITEMS.bed_simple.footprint).toEqual({ w: 1, h: 2 });
    expect(ITEMS.rug.walkable).toBe(true);
    expect(ITEMS.fence.placeOn).toBe("outdoor");
    expect(ITEMS.scarecrow.placeOn).toBe("outdoor");
  });

  it("starter inventory", () => {
    const inv = starterInventory();
    expect(inv.coins).toBe(50);
    expect(countItem(inv, "seed_turnip")).toBe(10);
    for (const id of ["hoe", "watering_can", "pickaxe", "sword_wood", "chair_wood"]) expect(countItem(inv, id)).toBe(1);
    expect(starterInventory()).not.toBe(inv); // fresh object each time
  });
});

describe("addItem", () => {
  it("stacks into existing slots first", () => {
    const inv = empty();
    expect(addItem(inv, "turnip", 5)).toBe(true);
    expect(addItem(inv, "turnip", 3)).toBe(true);
    expect(inv.slots).toEqual([{ item: "turnip", qty: 8 }]);
  });

  it("spills over into new slots at the stack limit", () => {
    const inv = empty();
    expect(addItem(inv, "stone", 150)).toBe(true);
    expect(inv.slots).toEqual([
      { item: "stone", qty: 99 },
      { item: "stone", qty: 51 },
    ]);
  });

  it("tools do not stack", () => {
    const inv = empty();
    addItem(inv, "hoe", 1);
    addItem(inv, "hoe", 1);
    expect(inv.slots.length).toBe(2);
  });

  it("fails without changes when the inventory is full", () => {
    const inv = empty();
    for (let i = 0; i < MAX_SLOTS; i++) addItem(inv, "hoe", 1);
    const before = JSON.stringify(inv);
    expect(addItem(inv, "turnip", 1)).toBe(false);
    expect(JSON.stringify(inv)).toBe(before);
  });

  it("partial fit is rejected atomically", () => {
    const inv = empty();
    for (let i = 0; i < MAX_SLOTS - 1; i++) addItem(inv, "hoe", 1);
    addItem(inv, "stone", 90);
    const before = JSON.stringify(inv);
    expect(addItem(inv, "stone", 20)).toBe(false); // 9 fit, 11 don't
    expect(JSON.stringify(inv)).toBe(before);
    expect(addItem(inv, "stone", 9)).toBe(true);
    expect(countItem(inv, "stone")).toBe(99);
  });

  it("can still stack when slots are all used", () => {
    const inv = empty();
    for (let i = 0; i < MAX_SLOTS - 1; i++) addItem(inv, "hoe", 1);
    addItem(inv, "turnip", 1);
    expect(addItem(inv, "turnip", 5)).toBe(true);
  });

  it("rejects unknown items and bad quantities", () => {
    const inv = empty();
    expect(addItem(inv, "nope", 1)).toBe(false);
    expect(addItem(inv, "turnip", 0)).toBe(false);
    expect(addItem(inv, "turnip", -2)).toBe(false);
    expect(addItem(inv, "turnip", 1.5)).toBe(false);
    expect(inv.slots).toEqual([]);
  });

  it("coins pseudo-item", () => {
    const inv = empty();
    expect(addItem(inv, "coins", 30)).toBe(true);
    expect(inv.coins).toBe(30);
    expect(countItem(inv, "coins")).toBe(30);
    expect(removeItem(inv, "coins", 31)).toBe(false);
    expect(removeItem(inv, "coins", 30)).toBe(true);
    expect(inv.coins).toBe(0);
  });

  it("canAdd does not mutate", () => {
    const inv = empty();
    expect(canAdd(inv, "turnip", 5)).toBe(true);
    expect(inv.slots).toEqual([]);
  });
});

describe("remove", () => {
  it("removeFromSlot reduces and removes empty slots", () => {
    const inv: Inventory = { coins: 0, slots: [{ item: "turnip", qty: 3 }, { item: "stone", qty: 1 }] };
    expect(removeFromSlot(inv, 0, 2)).toBe(true);
    expect(inv.slots[0]).toEqual({ item: "turnip", qty: 1 });
    expect(removeFromSlot(inv, 0, 1)).toBe(true);
    expect(inv.slots).toEqual([{ item: "stone", qty: 1 }]);
  });

  it("removeFromSlot fails unchanged on bad slot / too many", () => {
    const inv: Inventory = { coins: 0, slots: [{ item: "turnip", qty: 3 }] };
    expect(removeFromSlot(inv, 0, 4)).toBe(false);
    expect(removeFromSlot(inv, 5, 1)).toBe(false);
    expect(removeFromSlot(inv, -1, 1)).toBe(false);
    expect(removeFromSlot(inv, 0, 0)).toBe(false);
    expect(inv.slots).toEqual([{ item: "turnip", qty: 3 }]);
  });

  it("removeItem takes across slots, leaving others intact", () => {
    const inv: Inventory = {
      coins: 0,
      slots: [
        { item: "stone", qty: 99 },
        { item: "hoe", qty: 1 },
        { item: "stone", qty: 10 },
      ],
    };
    expect(countItem(inv, "stone")).toBe(109);
    expect(removeItem(inv, "stone", 50)).toBe(true);
    expect(countItem(inv, "stone")).toBe(59);
    expect(inv.slots).toEqual([
      { item: "stone", qty: 59 },
      { item: "hoe", qty: 1 },
    ]);
  });

  it("removeItem fails unchanged when not enough", () => {
    const inv: Inventory = { coins: 0, slots: [{ item: "stone", qty: 5 }] };
    expect(removeItem(inv, "stone", 6)).toBe(false);
    expect(removeItem(inv, "turnip", 1)).toBe(false);
    expect(inv.slots).toEqual([{ item: "stone", qty: 5 }]);
  });
});
