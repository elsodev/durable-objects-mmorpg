import { describe, expect, it } from "vitest";
import { clampQty, donatePlan, maxAffordable, progress, sellRows } from "../src/client/ui/dialogs-logic";
import { getItem } from "../src/shared/items";
import type { Inventory } from "../src/shared/types";

describe("dialogs helpers", () => {
  it("clamps quantities to 1..max", () => {
    expect(clampQty(0, 10)).toBe(1);
    expect(clampQty(15, 10)).toBe(10);
    expect(clampQty(3.7, 10)).toBe(3);
    expect(clampQty(NaN, 10)).toBe(1);
    expect(clampQty(5, 0)).toBe(1);
  });

  it("computes how many the player can afford", () => {
    expect(maxAffordable(10, 35)).toBe(3);
    expect(maxAffordable(10, 5)).toBe(0);
    expect(maxAffordable(1, 1000)).toBe(99);
    expect(maxAffordable(0, 0)).toBe(99);
  });

  it("lists only slots the NPC buys with a sell price", () => {
    const sellable = getItem("turnip");
    expect(sellable && sellable.sell > 0).toBe(true);
    const inv: Inventory = {
      coins: 0,
      slots: [
        { item: "hoe", qty: 1 },
        { item: "turnip", qty: 4 },
        { item: "turnip", qty: 0 },
        { item: "not_an_item", qty: 2 },
      ],
    };
    const rows = sellRows(inv, ["turnip", "not_an_item"]);
    expect(rows).toEqual([{ slot: 1, item: "turnip", qty: 4, price: sellable!.sell }]);
  });

  it("plans donations from the fullest slot, capped at what is still needed", () => {
    const inv: Inventory = {
      coins: 0,
      slots: [
        { item: "ore_copper", qty: 2 },
        { item: "wood", qty: 1 },
        { item: "ore_copper", qty: 9 },
      ],
    };
    expect(donatePlan({ item: "ore_copper", qty: 10, have: 4 }, inv)).toEqual({ slot: 2, qty: 6 });
    expect(donatePlan({ item: "ore_copper", qty: 30, have: 0 }, inv)).toEqual({ slot: 2, qty: 9 });
    expect(donatePlan({ item: "ore_copper", qty: 5, have: 5 }, inv)).toBeNull();
    expect(donatePlan({ item: "gem_ruby", qty: 5, have: 0 }, inv)).toBeNull();
  });

  it("clamps progress to 0..1", () => {
    expect(progress(5, 10)).toBe(0.5);
    expect(progress(15, 10)).toBe(1);
    expect(progress(0, 0)).toBe(1);
  });
});
