import { describe, expect, it } from "vitest";
import { buildCollision, dropSpot, setBlocked, takeForDrop, DROP_AHEAD } from "../src/shared/engine";
import { GroundItems } from "../src/worker/game/groundItems";
import { validateClientMsg } from "../src/shared/validate";
import { menuPosition, slotMenuChoices } from "../src/client/ui/slot-menu-logic";
import type { Inventory } from "../src/shared/types";

const bag = (): Inventory => ({ coins: 0, slots: [{ item: "turnip", qty: 5 }, { item: "hoe", qty: 1 }, null] });

describe("dropping from the bag", () => {
  it("takes one, some or the whole stack", () => {
    const inv = bag();
    expect(takeForDrop(inv, 0, 1)).toEqual({ item: "turnip", qty: 1 });
    expect(inv.slots[0]!.qty).toBe(4);
    expect(takeForDrop(inv, 0)).toEqual({ item: "turnip", qty: 4 });
    expect(inv.slots[0]).toBeNull();
    expect(takeForDrop(inv, 1)).toEqual({ item: "hoe", qty: 1 });
  });

  it("refuses empty slots and too many, leaving the bag alone", () => {
    const inv = bag();
    expect(takeForDrop(inv, 2)).toBeNull();
    expect(takeForDrop(inv, 0, 9)).toBeNull();
    expect(takeForDrop(inv, 0, 0)).toBeNull();
    expect(inv).toEqual(bag());
  });

  it("lands in front of you, or at your feet against a wall", () => {
    const map = { width: 10, height: 10, ground: new Array(100).fill(1), props: [], exits: [], spawns: {} } as never;
    const grid = buildCollision(map);
    expect(dropSpot(grid, { x: 5.5, y: 5.5 }, "right")).toEqual({ x: 5.5 + DROP_AHEAD, y: 5.5 });
    setBlocked(grid, 5, 4, 1, 1, true);
    expect(dropSpot(grid, { x: 5.5, y: 4.9 }, "up")).toEqual({ x: 5.5, y: 4.9 });
  });

  it("validates the message", () => {
    expect(validateClientMsg({ t: "dropItem", slot: 3 })).toEqual({ t: "dropItem", slot: 3 });
    expect(validateClientMsg({ t: "dropItem", slot: 3, qty: 2 })).toEqual({ t: "dropItem", slot: 3, qty: 2 });
    expect(validateClientMsg({ t: "dropItem", slot: -1 })).toBeNull();
    expect(validateClientMsg({ t: "dropItem", slot: 1, qty: 0 })).toBeNull();
  });
});

describe("a dropped item on the ground", () => {
  it("waits until its owner steps away before it can be picked up again", () => {
    const g = new GroundItems();
    const item = g.discard("u1", "turnip", 3, { x: 5, y: 5 }, 0)!;
    expect(g.ownedNear("u1", { x: 5, y: 5 })).toEqual([]);
    expect(g.ownedNear("u1", { x: 5.5, y: 5 })).toEqual([]);
    g.ownedNear("u1", { x: 7, y: 5 }); // stepped away
    expect(g.ownedNear("u1", { x: 5.2, y: 5 }).map((x) => x.id)).toEqual([item.id]);
  });

  it("is private to its owner and expires", () => {
    const g = new GroundItems();
    g.discard("u1", "turnip", 1, { x: 1, y: 1 }, 0);
    expect(g.visibleTo("u2")).toEqual([]);
    expect(g.visibleTo("u1")).toHaveLength(1);
    expect(g.expire(10 * 60_000)).toHaveLength(1);
  });

  it("keeps waiting after a save and load", () => {
    const g = new GroundItems();
    g.discard("u1", "turnip", 1, { x: 1, y: 1 }, 0);
    const h = new GroundItems();
    h.load(JSON.parse(JSON.stringify(g.record())), 1);
    expect(h.ownedNear("u1", { x: 1, y: 1 })).toEqual([]);
  });
});

describe("slot menu", () => {
  it("offers Drop for one, Drop 1 / Drop all for a stack", () => {
    expect(slotMenuChoices(1)).toEqual([{ label: "Drop", qty: null }]);
    expect(slotMenuChoices(7)).toEqual([
      { label: "Drop 1", qty: 1 },
      { label: "Drop all (7)", qty: null },
    ]);
  });
  it("stays on screen", () => {
    expect(menuPosition(790, 590, 120, 80, 800, 600)).toEqual({ x: 676, y: 516 });
    expect(menuPosition(-5, -5, 120, 80, 800, 600)).toEqual({ x: 4, y: 4 });
  });
});
