// The wardrobe every house has: always there (new and old saves), on a valid free spot by the back
// wall, opened only by the owner within reach, and the look chosen in it validated and saved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canPlace, objectRect, rectsOverlap } from "../src/shared/engine";
import { HOME_IN_WARDROBE } from "../src/shared/maps/home-in";
import { DEFAULT_LOOK } from "../src/shared/look";
import type { Look, PlacedObject } from "../src/shared/types";
import { BED_ID, ensureBed, migrateObjects, validateObjects, HOME_LAYOUT } from "../src/worker/home/migrate";
import { emptyObjects, HOME_IN, HOME_OUT, type HomeObjects } from "../src/worker/home/submaps";
import { backWallSpots, ensureWardrobe, WARDROBE_ID, wardrobeRefusal } from "../src/worker/home/wardrobe";
import { visitorVerdict } from "../src/worker/visit/permissions";
import { storeTarget, wardrobeTarget } from "../src/client/game/storage-target";
import { HomeRoom } from "../src/worker/home";
import { connectOwner, createRooms, FakeCtx, installWorkersGlobals, sendMsg, wsRequest, type FakeWs, type Rooms } from "./do-harness";
import { H_GUEST, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME, H_VISIT_OWNER, H_VISIT_RETURN, H_ZONE } from "../src/worker/env";

const T0 = 1_700_000_000_000;
const door = HOME_OUT.exits.find((e) => e.map === "home_in")!;
const windows = new Set(HOME_IN.props.filter((p) => /^iwall_.*_window$/.test(p.type)).map((p) => p.x));

const NEW_LOOK: Look = {
  body: "female",
  skin: "olive",
  eyes: "green",
  hairStyle: "bun",
  hairColor: "ginger",
  top: "mustard_cardigan",
  bottom: "forest_skirt",
  shoes: "tan_ghillies",
};

function freshHome(): HomeObjects {
  const objects = emptyObjects();
  ensureBed(objects);
  return objects;
}

const wardrobeOf = (o: HomeObjects) => o.home_in.find((x) => x.id === WARDROBE_ID);

/** Valid where it stands, against the back wall, and not in front of a window. */
function expectGoodSpot(objects: HomeObjects): void {
  const w = wardrobeOf(objects)!;
  expect(w).toBeDefined();
  const others = objects.home_in.filter((o) => o !== w);
  expect(canPlace(HOME_IN, others, [], w.item, w.x, w.y, w.rotation).ok).toBe(true);
  expect(w.y).toBe(HOME_IN.floorArea![0]!.y);
  expect(windows.has(w.x) || windows.has(w.x + 1)).toBe(false);
  expect(validateObjects(objects, []).returned).toEqual([]);
}

describe("every house has a wardrobe", () => {
  it("its default spot is on the back wall, clear of the bed, hearth, windows and door", () => {
    const objects = freshHome();
    const r = ensureWardrobe(objects);
    expect(r).toEqual({ changed: true, returned: [] });
    expect(wardrobeOf(objects)).toEqual({ id: WARDROBE_ID, item: "wardrobe", ...HOME_IN_WARDROBE, rotation: 0 });
    expectGoodSpot(objects);
    const rect = objectRect("wardrobe", HOME_IN_WARDROBE.x, HOME_IN_WARDROBE.y, 0);
    const bed = objects.home_in.find((o) => o.id === BED_ID)!;
    expect(rectsOverlap(rect, objectRect(bed.item, bed.x, bed.y, bed.rotation))).toBe(false);
    // Nothing fixed in the room under it, and the way in stays clear.
    expect(HOME_IN.props.some((p) => p.y >= 3 && rectsOverlap(p, rect))).toBe(false);
    const exit = HOME_IN.exits[0]!;
    expect(rect.x <= exit.x && exit.x < rect.x + rect.w && rect.y >= exit.y - 2).toBe(false);
    // Once there, it stays put.
    expect(ensureWardrobe(objects)).toEqual({ changed: false, returned: [] });
  });

  it("back-wall spots never stand in front of a window, nearest the default first", () => {
    const spots = backWallSpots();
    expect(spots[0]).toEqual(HOME_IN_WARDROBE);
    for (const s of spots) expect(windows.has(s.x) || windows.has(s.x + 1)).toBe(false);
  });

  it("takes another free back-wall spot when furniture stands on the default one", () => {
    const objects = freshHome();
    objects.home_in.push({ id: "o1", item: "table_wood", x: HOME_IN_WARDROBE.x, y: HOME_IN_WARDROBE.y, rotation: 0 });
    const r = ensureWardrobe(objects);
    expect(r.returned).toEqual([]);
    expect(objects.home_in.map((o) => o.id)).toContain("o1");
    expectGoodSpot(objects);
  });

  it("clears a back-wall spot when the wall is full, handing the furniture back (never the bed or a fridge)", () => {
    const objects = freshHome();
    const bed = objects.home_in.find((o) => o.id === BED_ID)!;
    // Fill every free first-row tile with a crate, and stand a fridge on the default spot.
    objects.home_in.push({ id: "f1", item: "fridge", x: HOME_IN_WARDROBE.x, y: HOME_IN_WARDROBE.y, rotation: 0 });
    let n = 0;
    for (let x = 1; x <= 12; x++) {
      const o: PlacedObject = { id: `c${n}`, item: "crate", x, y: 3, rotation: 0 };
      if (canPlace(HOME_IN, objects.home_in, [], o.item, o.x, o.y, 0).ok) {
        objects.home_in.push(o);
        n++;
      }
    }
    const r = ensureWardrobe(objects);
    expect(r.changed).toBe(true);
    expect(r.returned.length).toBeGreaterThan(0);
    expect(r.returned.every((i) => i === "crate")).toBe(true);
    expect(objects.home_in).toContain(bed);
    expect(objects.home_in.some((o) => o.id === "f1")).toBe(true);
    expectGoodSpot(objects);
  });

  it("a wardrobe the owner already placed becomes the house's own", () => {
    const objects = freshHome();
    objects.home_in.push({ id: "o7", item: "wardrobe", x: 4, y: 6, rotation: 0 });
    expect(ensureWardrobe(objects)).toEqual({ changed: true, returned: [] });
    expect(objects.home_in.filter((o) => o.item === "wardrobe")).toEqual([{ id: WARDROBE_ID, item: "wardrobe", x: 4, y: 6, rotation: 0 }]);
  });

  it("is never handed back by a migration or a sanitised save", () => {
    const stray: PlacedObject = { id: WARDROBE_ID, item: "wardrobe", x: 0, y: 0, rotation: 0 };
    expect(migrateObjects([{ ...stray, x: -5 }], []).returned).toEqual([]);
    expect(validateObjects({ home: [], home_in: [stray] }, []).returned).toEqual([]);
  });

  it("opens only a wardrobe, within reach", () => {
    const w: PlacedObject = { id: WARDROBE_ID, item: "wardrobe", ...HOME_IN_WARDROBE, rotation: 0 };
    expect(wardrobeRefusal(w, { x: w.x + 1, y: w.y + 1.6 })).toBeNull();
    expect(wardrobeRefusal(w, { x: w.x + 1, y: w.y + 6 })).toBe("Walk a little closer.");
    expect(wardrobeRefusal({ ...w, item: "fridge" }, { x: w.x + 1, y: w.y + 1.6 })).toBe("There's no wardrobe there.");
    expect(wardrobeRefusal(undefined, { x: 0, y: 0 })).toBe("There's no wardrobe there.");
    expect(visitorVerdict({ t: "wardrobeOpen", id: WARDROBE_ID })).toEqual({ deny: expect.stringMatching(/your own/) });
  });
});

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

/** Alice inside her house, standing in front of her wardrobe. */
async function aliceAtWardrobe(): Promise<FakeWs> {
  const ws = await connectOwner(r, "alice", "Alice");
  room = r.room("alice") as any;
  room.player.entity.x = door.x + 0.5;
  room.player.entity.y = door.y + 0.5;
  await room.startTick();
  vi.advanceTimersByTime(150);
  expect(ws.last("welcome").homeMap).toBe("home_in");
  room.player.entity.x = HOME_IN_WARDROBE.x + 1;
  room.player.entity.y = HOME_IN_WARDROBE.y + 1.6;
  vi.advanceTimersByTime(250);
  return ws;
}

describe("HomeRoom wardrobe", () => {
  it("a new player's house has it, and the welcome shows it", async () => {
    const ws = await aliceAtWardrobe();
    expect(room.objects.home_in.find((o: any) => o.id === WARDROBE_ID)).toMatchObject({ item: "wardrobe", ...HOME_IN_WARDROBE });
    expect(ws.last("welcome").objects.some((o: any) => o.id === WARDROBE_ID)).toBe(true);
  });

  it("an older save gets one on load, kept in storage", async () => {
    installWorkersGlobals();
    const ctx = new FakeCtx();
    const save = { userId: "olga", name: "Olga", inventory: { coins: 5, slots: [] }, hp: 100, maxHp: 100, sprite: "ninja_blue", zone: "home", x: 8.5, y: 10.5 };
    ctx.storage.data.set("owner", "olga");
    ctx.storage.data.set("save", save);
    ctx.storage.data.set("layout", HOME_LAYOUT);
    ctx.storage.data.set("homeObjects", {
      home: [],
      home_in: [
        { id: BED_ID, item: "bed_simple", x: 2, y: 3, rotation: 0 },
        { id: "o1", item: "table_wood", x: HOME_IN_WARDROBE.x, y: HOME_IN_WARDROBE.y, rotation: 0 },
      ],
    });
    const home = new HomeRoom(ctx as any, r.env) as any;
    await ctx.ready;
    expectGoodSpot(home.objects);
    expect(home.objects.home_in.some((o: any) => o.id === "o1")).toBe(true);
    expect((ctx.storage.data.get("homeObjects") as any).home_in.some((o: any) => o.id === WARDROBE_ID)).toBe(true);
    const again = new HomeRoom(ctx as any, r.env) as any;
    await ctx.ready;
    expect(again.objects.home_in.filter((o: any) => o.item === "wardrobe")).toHaveLength(1);
  });

  it("the owner opens it (doors open for everyone inside) and closes it", async () => {
    const ws = await aliceAtWardrobe();
    await sendMsg(r, "alice", ws, { t: "wardrobeOpen", id: WARDROBE_ID });
    expect(ws.last("lid")).toEqual({ t: "lid", id: WARDROBE_ID, open: true });
    expect(ws.last("wardrobe")).toEqual({ t: "wardrobe", id: WARDROBE_ID });
    await sendMsg(r, "alice", ws, { t: "storeClose", id: WARDROBE_ID });
    expect(ws.last("lid")).toEqual({ t: "lid", id: WARDROBE_ID, open: false });
  });

  it("must be in reach, can be moved but never picked up", async () => {
    const ws = await aliceAtWardrobe();
    room.player.entity.x = 10.5;
    room.player.entity.y = 9.5;
    await sendMsg(r, "alice", ws, { t: "wardrobeOpen", id: WARDROBE_ID });
    expect(ws.last("reject").reason).toBe("Walk a little closer.");
    expect(ws.of("wardrobe")).toEqual([]);
    await sendMsg(r, "alice", ws, { t: "wardrobeOpen", id: BED_ID });
    expect(ws.last("reject").reason).toBe("There's no wardrobe there.");
    room.player.entity.x = HOME_IN_WARDROBE.x + 1;
    room.player.entity.y = HOME_IN_WARDROBE.y + 1.6;
    await sendMsg(r, "alice", ws, { t: "pickup", id: WARDROBE_ID });
    expect(ws.last("reject").reason).toBe("Your wardrobe stays. You can move it instead.");
    expect(room.objects.home_in.some((o: any) => o.id === WARDROBE_ID)).toBe(true);
    vi.advanceTimersByTime(1000);
    await sendMsg(r, "alice", ws, { t: "moveObject", id: WARDROBE_ID, x: 4, y: 3, rotation: 0 });
    expect(room.objects.home_in.find((o: any) => o.id === WARDROBE_ID)).toMatchObject({ x: 4, y: 3 });
  });

  it("refuses a visitor politely and opens nothing", async () => {
    const ws = await aliceAtWardrobe();
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
    v.entity.x = HOME_IN_WARDROBE.x + 1;
    v.entity.y = HOME_IN_WARDROBE.y + 1.6;
    await sendMsg(r, "alice", guest, { t: "wardrobeOpen", id: WARDROBE_ID });
    expect(guest.last("reject").reason).toBe("That's your host's wardrobe. You can change clothes in your own at home.");
    expect(guest.of("wardrobe")).toEqual([]);
    expect(ws.of("lid")).toEqual([]);
    await sendMsg(r, "alice", guest, { t: "setLook", look: NEW_LOOK });
    expect(guest.last("reject").reason).toBe("Change clothes at your own home.");
  });

  it("a look chosen in it is validated, rate limited, saved and shown", async () => {
    const ws = await aliceAtWardrobe();
    await sendMsg(r, "alice", ws, { t: "wardrobeOpen", id: WARDROBE_ID });
    // A made-up option never reaches the save.
    await sendMsg(r, "alice", ws, { t: "setLook", look: { ...NEW_LOOK, top: "<b>cape</b>" } });
    expect(room.save.look).not.toEqual(expect.objectContaining({ top: "<b>cape</b>" }));
    vi.advanceTimersByTime(1000);
    await sendMsg(r, "alice", ws, { t: "setLook", look: NEW_LOOK });
    await sendMsg(r, "alice", ws, { t: "setLook", look: { ...NEW_LOOK, hairStyle: DEFAULT_LOOK.hairStyle } });
    expect(ws.last("reject").reason).toBe("Slow down a little.");
    expect(room.save.look).toEqual(NEW_LOOK);
    expect(room.player.entity.look).toEqual(NEW_LOOK);
    vi.advanceTimersByTime(3000);
    expect(((await r.ctx("alice").storage.get("save")) as any).look).toEqual(NEW_LOOK);
    const mine = ws.of("tick").flatMap((t: any) => t.upd).filter((e: any) => e.id === room.player.entity.id && e.look);
    expect(mine.at(-1).look).toEqual(NEW_LOOK);
  });
});

describe("client: which wardrobe F or a click opens", () => {
  const w: PlacedObject = { id: WARDROBE_ID, item: "wardrobe", ...HOME_IN_WARDROBE, rotation: 0 };
  const fridge: PlacedObject = { id: "o2", item: "fridge", x: HOME_IN_WARDROBE.x + 2, y: 3, rotation: 0 };

  it("the wardrobe ahead or within reach, never a fridge; storage targeting is unchanged", () => {
    const front = { x: w.x + 1, y: w.y + 1.6 };
    expect(wardrobeTarget([w, fridge], front, { x: w.x + 1, y: w.y })).toBe(WARDROBE_ID);
    expect(wardrobeTarget([w, fridge], { x: w.x + 1, y: 9.5 }, { x: w.x + 1, y: 8.5 })).toBeNull();
    expect(wardrobeTarget([fridge], front, front)).toBeNull();
    expect(storeTarget([w, fridge], front, { x: fridge.x, y: 3 })).toBe("o2");
    expect(storeTarget([w], front, front)).toBeNull();
  });
});
