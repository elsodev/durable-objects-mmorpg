// House edit mode on a real HomeRoom: moveObjects moves a group all or nothing, pickupObjects
// takes several pieces back all or nothing, the bed and a full fridge stay, and visitors can't.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, sendMsg, type FakeWs, type Rooms } from "./do-harness";
import { HOME_OUT } from "../src/worker/home/submaps";
import { BED_ID } from "../src/worker/home/migrate";
import { addAllOrNothing, pickupRefusal, WARDROBE_ID } from "../src/worker/home/arrange";
import { MAX_ARRANGE } from "../src/shared/engine";
import type { Inventory, PlacedObject } from "../src/shared/types";

const T0 = 1_700_000_000_000;
const door = HOME_OUT.exits.find((e) => e.map === "home_in")!;

let r: Rooms;
let room: any;
beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  r = createRooms();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Alice inside her house, standing by the door, with two chairs and a table placed. */
async function furnished(): Promise<FakeWs> {
  const ws = await connectOwner(r, "alice", "Alice");
  room = r.room("alice") as any;
  room.player.entity.x = door.x + 0.5;
  room.player.entity.y = door.y + 0.5;
  await room.startTick();
  vi.advanceTimersByTime(150);
  expect(ws.last("welcome").homeMap).toBe("home_in");
  room.objects.home_in.push(
    { id: "c1", item: "chair_wood", x: 5, y: 5, rotation: 0 },
    { id: "c2", item: "chair_wood", x: 6, y: 5, rotation: 0 },
    { id: "t1", item: "table_wood", x: 8, y: 5, rotation: 0 },
  );
  room.rebuildGrid();
  return ws;
}

const at = (id: string): PlacedObject => room.objects.home_in.find((o: PlacedObject) => o.id === id);
const send = async (ws: FakeWs, msg: unknown) => {
  await sendMsg(r, "alice", ws, msg);
  vi.advanceTimersByTime(250);
};

describe("HomeRoom moveObjects", () => {
  it("moves a group together and tells the room once", async () => {
    const ws = await furnished();
    ws.sent = [];
    await send(ws, { t: "moveObjects", moves: [{ id: "c1", x: 6, y: 5, rotation: 0 }, { id: "c2", x: 7, y: 5, rotation: 1 }], req: "r1" });
    expect(at("c1")).toMatchObject({ x: 6, y: 5 });
    expect(at("c2")).toMatchObject({ x: 7, y: 5, rotation: 1 });
    expect(ws.of("objects")).toHaveLength(1);
    expect(ws.last("objects").upd.map((o: PlacedObject) => o.id).sort()).toEqual(["c1", "c2"]);
    expect(ws.of("reject")).toHaveLength(0);
  });

  it("moves nothing when one piece doesn't fit", async () => {
    const ws = await furnished();
    await send(ws, { t: "moveObjects", moves: [{ id: "c1", x: 4, y: 7, rotation: 0 }, { id: "c2", x: 8, y: 5, rotation: 0 }], req: "r2" });
    expect(ws.last("reject")).toMatchObject({ action: "moveObjects", reason: "Overlaps other furniture.", req: "r2" });
    expect(at("c1")).toMatchObject({ x: 5, y: 5 });
    expect(at("c2")).toMatchObject({ x: 6, y: 5 });
  });

  it("refuses turns a piece has no art for, and pieces not in this room", async () => {
    const ws = await furnished();
    await send(ws, { t: "moveObjects", moves: [{ id: "t1", x: 8, y: 5, rotation: 2 }, { id: "c1", x: 5, y: 6, rotation: 0 }] });
    expect(ws.last("reject").reason).toBe("It doesn't turn that way.");
    expect(at("c1")).toMatchObject({ x: 5, y: 5 });
    await send(ws, { t: "moveObjects", moves: [{ id: "nope", x: 5, y: 7, rotation: 0 }] });
    expect(ws.last("reject").reason).toBe("That isn't here any more.");
  });

  it("drops frames over the cap before the room sees them", async () => {
    const ws = await furnished();
    ws.sent = [];
    const moves = Array.from({ length: MAX_ARRANGE + 1 }, (_, i) => ({ id: `x${i}`, x: 1, y: 1, rotation: 0 }));
    await send(ws, { t: "moveObjects", moves });
    expect(ws.of("objects")).toHaveLength(0);
  });
});

describe("HomeRoom pickupObjects", () => {
  it("takes several pieces back into the bag at once", async () => {
    const ws = await furnished();
    await send(ws, { t: "pickupObjects", ids: ["c1", "t1"] });
    expect(room.objects.home_in.map((o: PlacedObject) => o.id)).not.toContain("c1");
    expect(room.objects.home_in.map((o: PlacedObject) => o.id)).not.toContain("t1");
    const bag = room.save.inventory.slots.filter(Boolean).map((s: any) => s.item);
    expect(bag).toEqual(expect.arrayContaining(["chair_wood", "table_wood"]));
    expect(ws.last("objects").del.sort()).toEqual(["c1", "t1"]);
  });

  it("keeps everything when one piece must stay (the bed)", async () => {
    const ws = await furnished();
    expect(room.objects.home_in.some((o: PlacedObject) => o.id === BED_ID)).toBe(true);
    await send(ws, { t: "pickupObjects", ids: ["c1", BED_ID] });
    expect(ws.last("reject").reason).toBe("Your bed stays. You can move it instead.");
    expect(at("c1")).toBeTruthy();
  });

  it("keeps everything when the bag can't take it all", async () => {
    const ws = await furnished();
    const inv = room.save.inventory as Inventory;
    for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = { item: "stone", qty: 99 };
    const before = JSON.stringify(inv);
    await send(ws, { t: "pickupObjects", ids: ["c1", "c2"] });
    expect(ws.last("reject").reason).toBe("Your bag is full.");
    expect(JSON.stringify(room.save.inventory)).toBe(before);
    expect(at("c1")).toBeTruthy();
    expect(at("c2")).toBeTruthy();
  });
});

describe("edit mode pickup rules", () => {
  it("the bed, the house wardrobe and a fridge with food in it stay", () => {
    const obj = (id: string, item: string): PlacedObject => ({ id, item, x: 1, y: 1, rotation: 0 });
    expect(pickupRefusal(obj(BED_ID, "bed_simple"), {})).toMatch(/bed stays/);
    expect(pickupRefusal(obj(WARDROBE_ID, "wardrobe"), {})).toMatch(/wardrobe stays/);
    expect(pickupRefusal(obj("w2", "wardrobe"), {})).toBeNull();
    expect(pickupRefusal(obj("f1", "fridge"), { f1: [{ item: "turnip", qty: 1 }] })).toBe("Empty the fridge first.");
    expect(pickupRefusal(obj("f1", "fridge"), { f1: [null] })).toBeNull();
  });

  it("adds all or nothing to the bag, leaving the original untouched", () => {
    const inv: Inventory = { coins: 0, slots: [null, { item: "stone", qty: 1 }] };
    while (inv.slots.length < 24) inv.slots.push({ item: "stone", qty: 99 });
    expect(addAllOrNothing(inv, ["chair_wood"])?.slots[0]).toEqual({ item: "chair_wood", qty: 1 });
    expect(addAllOrNothing(inv, ["chair_wood", "lamp"])).toBeNull();
    expect(inv.slots[0]).toBeNull();
  });
});
