import { describe, expect, it } from "vitest";
import { sortBag } from "../src/shared/engine";
import { validateClientMsg } from "../src/shared/validate";
import type { Inventory } from "../src/shared/types";

const s = (item: string, qty = 1, quality?: number) => ({ item, qty, ...(quality ? { quality } : {}) });

describe("sorting the bag", () => {
  it("keeps the hotbar and orders the rest by type, then name", () => {
    const hotbar = [s("hoe"), s("watering_can"), null, s("turnip", 3), null, null, null, s("chair_wood")];
    const inv: Inventory = { coins: 0, slots: [...hotbar, s("ore_copper", 4), null, s("chair_wood"), s("seed_turnip", 5), s("turnip", 2), s("pickaxe"), null] };
    expect(sortBag(inv)).toBe(true);
    expect(inv.slots.slice(0, 8)).toEqual(hotbar);
    expect(inv.slots.slice(8, 14).map((x) => x?.item)).toEqual(["pickaxe", "seed_turnip", "turnip", "ore_copper", "chair_wood", undefined]);
    expect(inv.slots).toHaveLength(24);
  });

  it("merges split stacks and keeps qualities apart", () => {
    const inv: Inventory = { coins: 0, slots: [null, null, null, null, null, null, null, null, s("turnip", 2), s("turnip", 3), s("turnip", 1, 2)] };
    sortBag(inv);
    expect(inv.slots.slice(8, 11)).toEqual([s("turnip", 5), s("turnip", 1, 2), null]);
  });

  it("reports no change when already sorted", () => {
    const inv: Inventory = { coins: 0, slots: [null, null, null, null, null, null, null, null, s("hoe"), s("turnip", 2)] };
    sortBag(inv);
    expect(sortBag(inv)).toBe(false);
  });

  it("validates the message", () => {
    expect(validateClientMsg({ t: "sortBag" })).toEqual({ t: "sortBag" });
  });
});
