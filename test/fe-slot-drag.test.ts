import { describe, expect, it } from "vitest";
import { dragStarted, planMove, splitQty } from "../src/client/ui/slot-drag-logic";
import type { Inventory } from "../src/shared/types";

const bag = (): Inventory => {
  const slots: Inventory["slots"] = Array.from({ length: 24 }, () => null);
  slots[0] = { item: "hoe", qty: 1 };
  slots[1] = { item: "turnip", qty: 7 };
  slots[2] = { item: "turnip", qty: 5 };
  return { coins: 3, slots };
};

describe("slot drag logic", () => {
  it("a short press is a click, a longer move is a drag", () => {
    expect(dragStarted(2, 3)).toBe(false);
    expect(dragStarted(6, 0)).toBe(true);
  });

  it("plans a move onto an empty hotbar slot without touching the original", () => {
    const inv = bag();
    const plan = planMove(inv, 0, 7)!;
    expect(plan.msg).toEqual({ t: "moveSlot", from: 0, to: 7 });
    expect(plan.result).toBe("move");
    expect(plan.next.slots[7]).toEqual({ item: "hoe", qty: 1 });
    expect(plan.next.slots[0]).toBeNull();
    expect(inv.slots[0]).toEqual({ item: "hoe", qty: 1 });
  });

  it("swaps and merges", () => {
    expect(planMove(bag(), 0, 1)!.result).toBe("swap");
    const merge = planMove(bag(), 2, 1)!;
    expect(merge.result).toBe("merge");
    expect(merge.next.slots[1]).toEqual({ item: "turnip", qty: 12 });
  });

  it("shift-drag splits half (rounded up)", () => {
    expect(splitQty(7)).toBe(4);
    expect(splitQty(1)).toBeNull();
    const plan = planMove(bag(), 1, 9, true)!;
    expect(plan.msg).toEqual({ t: "moveSlot", from: 1, to: 9, qty: 4 });
    expect(plan.next.slots[1]).toEqual({ item: "turnip", qty: 3 });
    expect(planMove(bag(), 0, 9, true)).toBeNull(); // one hoe can't split
    expect(planMove(bag(), 1, 0, true)).toBeNull(); // a half stack can't swap
  });

  it("nothing to plan from an empty slot, onto itself, or without a bag", () => {
    expect(planMove(bag(), 5, 6)).toBeNull();
    expect(planMove(bag(), 1, 1)).toBeNull();
    expect(planMove(null, 0, 1)).toBeNull();
  });
});
