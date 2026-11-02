// Held tools, server side: which item shows in the hand, validation of the `hold` intent and the
// held item on the entity. The art and renderer side is in fe-held.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, sendMsg, type Rooms } from "./do-harness";
import { heldItemAt, HOTBAR_SIZE, isHoldable } from "../src/shared/held";
import { validateClientMsg } from "../src/shared/validate";
import { starterInventory } from "../src/shared/items";
import { applyHeld } from "../src/worker/game/held";
import { snapshotEntity } from "../src/worker/game/diff";
import type { EntityState, Inventory, Look } from "../src/shared/types";
import { DEFAULT_LOOK } from "../src/shared/look";

const inv = (): Inventory => starterInventory(); // hoe, watering_can, pickaxe, axe, sword_wood, seeds, chair
const player = (over: Partial<EntityState> = {}): EntityState => ({
  id: "p:a",
  kind: "player",
  name: "A",
  sprite: "player_1",
  x: 1,
  y: 1,
  facing: "down",
  moving: false,
  ...over,
});

describe("held item selection", () => {
  it("holds tools and weapons only", () => {
    for (const t of ["hoe", "watering_can", "pickaxe", "pickaxe_iron", "axe", "sword_wood", "sword_copper"]) expect(isHoldable(t), t).toBe(true);
    for (const t of ["seed_turnip", "chair_wood", "turnip", "copper_ore", "nope", "", null, undefined]) expect(isHoldable(t), String(t)).toBe(false);
  });

  it("reads the hotbar slot of the given inventory", () => {
    const i = inv();
    expect(heldItemAt(i, 0)).toBe("hoe");
    expect(heldItemAt(i, 4)).toBe("sword_wood");
    expect(heldItemAt(i, 5)).toBeUndefined(); // seeds aren't drawn in the hand
    expect(heldItemAt(i, 7)).toBeUndefined(); // empty slot
    expect(heldItemAt(i, null)).toBeUndefined();
  });

  it("never reads past the hotbar or a bad index", () => {
    const i = inv();
    i.slots[HOTBAR_SIZE] = { item: "pickaxe_iron", qty: 1 };
    for (const s of [HOTBAR_SIZE, -1, 1.5, NaN, 99]) expect(heldItemAt(i, s), String(s)).toBeUndefined();
  });
});

describe("hold intent validation", () => {
  it("accepts a hotbar slot or null", () => {
    expect(validateClientMsg({ t: "hold", slot: 3 })).toEqual({ t: "hold", slot: 3 });
    expect(validateClientMsg({ t: "hold", slot: null })).toEqual({ t: "hold", slot: null });
  });

  it("drops bag slots, junk and smuggled item ids", () => {
    for (const slot of [HOTBAR_SIZE, -1, 2.5, "0", undefined, {}]) expect(validateClientMsg({ t: "hold", slot }), String(slot)).toBeNull();
    expect(validateClientMsg({ t: "hold", slot: 0, item: "sword_copper" })).toEqual({ t: "hold", slot: 0 });
  });
});

describe("applyHeld (server)", () => {
  it("sets, changes and clears entity.held from the server's inventory", () => {
    const e = player();
    const i = inv();
    expect(applyHeld(e, i, 2)).toBe(true);
    expect(e.held).toBe("pickaxe");
    expect(applyHeld(e, i, 2)).toBe(false); // no change, no diff
    i.slots[2] = null; // sold, moved or given away
    expect(applyHeld(e, i, 2)).toBe(true);
    expect("held" in e).toBe(false);
    expect(applyHeld(e, i, 5)).toBe(false); // seeds: empty hands
  });

  it("is broadcast in the entity snapshot", () => {
    expect(snapshotEntity(player({ held: "axe" })).held).toBe("axe");
    expect("held" in snapshotEntity(player())).toBe(false);
  });
});

describe("hold through a real HomeRoom", () => {
  const T0 = 1_700_000_000_000;
  let r: Rooms;
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    r = createRooms();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only what the owner's bag holds, and follows bag changes", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = r.room("alice") as any;
    await r.ctx("alice").ready;
    const p = room.player;
    const slots = room.save.inventory.slots;
    const axe = slots.findIndex((s: any) => s?.item === "axe");
    await sendMsg(r, "alice", ws, { t: "hold", slot: axe });
    expect(p.entity.held).toBe("axe");
    await sendMsg(r, "alice", ws, { t: "hold", slot: 7 }); // empty slot
    expect(p.entity.held).toBeUndefined();
    await sendMsg(r, "alice", ws, { t: "hold", slot: axe });
    await sendMsg(r, "alice", ws, { t: "moveSlot", from: axe, to: 20 }); // into the bag
    expect(p.entity.held).toBeUndefined();
    await sendMsg(r, "alice", ws, { t: "hold", slot: 20 }); // a bag slot is never held
    expect(p.entity.held).toBeUndefined();
    expect(ws.of("reject")).toEqual([]);
  });
});
