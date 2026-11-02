// The fridge on a real HomeRoom: open (door opens for everyone in the house), move food in and
// out, refuse what doesn't belong, keep contents across a reload, and keep visitors out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, sendMsg, wsRequest, type FakeWs, type Rooms } from "./do-harness";
import { H_GUEST, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME, H_VISIT_OWNER, H_VISIT_RETURN, H_ZONE } from "../src/worker/env";
import { HOME_IN, HOME_OUT } from "../src/worker/home/submaps";

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

async function goInside(ws: FakeWs): Promise<void> {
  room = r.room("alice") as any;
  room.player.entity.x = door.x + 0.5;
  room.player.entity.y = door.y + 0.5;
  await room.startTick();
  vi.advanceTimersByTime(150);
  expect(ws.last("welcome").homeMap).toBe("home_in");
}

/** Alice inside her house with a fridge placed at (6, 5) and food in her bag; she stands in front of it. */
async function withFridge(): Promise<FakeWs> {
  const ws = await connectOwner(r, "alice", "Alice");
  await goInside(ws);
  const inv = room.save.inventory;
  inv.slots[10] = { item: "fridge", qty: 1 };
  inv.slots[11] = { item: "turnip", qty: 20 };
  inv.slots[12] = { item: "stone", qty: 5 };
  await sendMsg(r, "alice", ws, { t: "place", slot: 10, x: 6, y: 5, rotation: 0 });
  expect(room.objects.home_in.some((o: any) => o.item === "fridge")).toBe(true);
  room.player.entity.x = 6.5;
  room.player.entity.y = 6.6;
  vi.advanceTimersByTime(250);
  return ws;
}

const fridgeId = () => room.objects.home_in.find((o: any) => o.item === "fridge").id as string;

describe("HomeRoom fridge", () => {
  it("opens, takes food in, gives it back, and closes", async () => {
    const ws = await withFridge();
    const id = fridgeId();
    await sendMsg(r, "alice", ws, { t: "storePut", id, slot: 11 });
    expect(ws.last("reject").reason).toBe("Open it first.");

    await sendMsg(r, "alice", ws, { t: "storeOpen", id });
    expect(ws.last("lid")).toEqual({ t: "lid", id, open: true });
    expect(ws.last("storage")).toMatchObject({ id, item: "fridge", accepts: "food", open: true });
    expect(ws.last("storage").slots).toHaveLength(12);

    await sendMsg(r, "alice", ws, { t: "storePut", id, slot: 11, qty: 15 });
    expect(ws.last("storage").slots[0]).toEqual({ item: "turnip", qty: 15 });
    expect(room.save.inventory.slots[11]).toEqual({ item: "turnip", qty: 5 });
    expect(ws.last("inventory").inventory.slots[11]).toEqual({ item: "turnip", qty: 5 });

    await sendMsg(r, "alice", ws, { t: "storePut", id, slot: 12 });
    expect(ws.last("reject").reason).toBe("Only food keeps in here.");
    expect(room.save.inventory.slots[12]).toEqual({ item: "stone", qty: 5 });

    await sendMsg(r, "alice", ws, { t: "storeTake", id, index: 0, qty: 4 });
    expect(room.containers[id][0]).toEqual({ item: "turnip", qty: 11 });
    expect(room.save.inventory.slots[11]).toEqual({ item: "turnip", qty: 9 });

    await sendMsg(r, "alice", ws, { t: "storeClose", id });
    expect(ws.last("lid")).toEqual({ t: "lid", id, open: false });
  });

  it("must be in reach, and can't be picked up while full", async () => {
    const ws = await withFridge();
    const id = fridgeId();
    await sendMsg(r, "alice", ws, { t: "storeOpen", id });
    await sendMsg(r, "alice", ws, { t: "storePut", id, slot: 11 });
    vi.advanceTimersByTime(250);
    await sendMsg(r, "alice", ws, { t: "pickup", id });
    expect(ws.last("reject").reason).toBe("Empty the fridge first.");
    room.player.entity.x = 11.5;
    room.player.entity.y = 9.5;
    await sendMsg(r, "alice", ws, { t: "storeTake", id, index: 0 });
    expect(ws.last("reject").reason).toBe("Walk a little closer.");
    room.player.entity.x = 6.5;
    room.player.entity.y = 6.6;
    await sendMsg(r, "alice", ws, { t: "storeTake", id, index: 0 });
    expect(room.containers[id][0]).toBeNull();
    vi.advanceTimersByTime(250);
    await sendMsg(r, "alice", ws, { t: "pickup", id });
    expect(room.objects.home_in.some((o: any) => o.id === id)).toBe(false);
    expect(room.containers[id]).toBeUndefined();
  });

  it("keeps its contents in storage across a reload", async () => {
    const ws = await withFridge();
    const id = fridgeId();
    await sendMsg(r, "alice", ws, { t: "storeOpen", id });
    await sendMsg(r, "alice", ws, { t: "storePut", id, slot: 11, qty: 7 });
    const stored = await r.ctx("alice").storage.get("containers");
    expect((stored as any)[id][0]).toEqual({ item: "turnip", qty: 7 });
    // A fresh room over the same storage loads the fridge back.
    await room.loadState();
    expect(room.containers[id][0]).toEqual({ item: "turnip", qty: 7 });
  });

  it("refuses visitors", async () => {
    const ws = await withFridge();
    const id = fridgeId();
    await room.createInvite("alice", "alice", { id: "basil", name: "Basil" });
    const res = await room.fetch(
      wsRequest("http://localhost:8787/ws/visit/alice", {
        [H_USER_ID]: "basil",
        [H_USER_NAME]: "Basil",
        [H_ZONE]: "home",
        [H_SPAWN]: "default",
        [H_GUEST]: "0",
        [H_SESSION]: "s-basil",
        [H_VISIT_OWNER]: "alice",
        [H_VISIT_RETURN]: "village",
      }),
    );
    expect(res.status).toBe(101);
    const guest = r.ctx("alice").sockets.at(-1)!;
    const v = room.visitors.byUser("basil");
    v.map = "home_in";
    v.entity.x = 6.5;
    v.entity.y = 6.6;
    await sendMsg(r, "alice", guest, { t: "storeOpen", id });
    expect(guest.last("reject").reason).toBe("That isn't yours to open.");
    expect(guest.of("storage")).toEqual([]);
    expect(ws.of("lid")).toEqual([]);
    expect(HOME_IN.zone).toBe("home");
  });
});
