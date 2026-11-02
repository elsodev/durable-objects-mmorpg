// Yard edit mode: the owner's layout over the base yard, what may go where (trees, rocks and the
// pond stay put; nobody and nothing gets shut in), tilling cleared ground, the HomeRoom messages
// with their owner-only rule, and old saves picking up the plot's fence.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMap } from "../src/shared/maps";
import { HOME_DOOR, HOME_FENCES, HOME_HOUSE } from "../src/shared/maps/home";
import {
  applyYard,
  checkYardHouse,
  checkYardMoves,
  checkYardPlace,
  fenceGroup,
  fenceRun,
  houseAt,
  houseDoor,
  keepsYardOpen,
  sanitizeYard,
  withoutTrees,
  yardHint,
  type YardWorld,
} from "../src/shared/yard";
import { isFarmable } from "../src/shared/engine";
import { decodeClient } from "../src/shared/protocol";
import type { PlacedObject } from "../src/shared/types";
import { TreeField } from "../src/worker/game/treeField";
import { SubMaps, emptyObjects } from "../src/worker/home/submaps";
import { connectOwner, createRooms, FakeCtx, installWorkersGlobals, sendMsg, type Rooms } from "./do-harness";
import { HomeRoom } from "../src/worker/home";
import { checkHouse, checkMoves, checkNew, runStep, runTiles, stayHint } from "../src/client/game/edit-logic";
import { gateTurn, FENCE_E, FENCE_N, FENCE_S } from "../src/client/render/fence";

const YARD = getMap("home");
const fences = (): PlacedObject[] => HOME_FENCES.map((t, i) => ({ id: `f${i}`, item: "fence", x: t.x, y: t.y, rotation: 0 }));
const barn = (x = 6, y = 16): PlacedObject => ({ id: "barn", item: "barn", x, y, rotation: 0 });
const world = (objects: PlacedObject[] = [barn(), ...fences()], extra: Partial<YardWorld> = {}): YardWorld => ({
  map: YARD,
  objects,
  farm: [],
  ...extra,
});
const tree = (x: number, y: number) => YARD.props.find((p) => p.type === "tree" && p.x === x && p.y === y)!;
const anyTree = YARD.props.find((p) => p.type === "tree" && p.x > 2 && p.x < 37 && p.y > 13 && p.y < 27)!;

describe("yard layout", () => {
  it("the base yard is laid out as before when the owner changed nothing", () => {
    expect(applyYard(YARD, {})).toBe(YARD);
    expect(applyYard(YARD, { house: { x: HOME_HOUSE.x, y: HOME_HOUSE.y } })).toBe(YARD);
    expect(houseAt(YARD)).toEqual({ x: HOME_HOUSE.x, y: HOME_HOUSE.y });
  });

  it("a moved house takes its door, doorstep and spawns along, and leaves grass behind", () => {
    const moved = applyYard(YARD, { house: { x: 14, y: 9 } });
    expect(houseAt(moved)).toEqual({ x: 14, y: 9 });
    const door = moved.exits.find((e) => e.map === "home_in")!;
    expect({ x: door.x, y: door.y }).toEqual(houseDoor({ x: 14, y: 9 }));
    expect(moved.spawns.from_home_in).toEqual({ x: YARD.spawns.from_home_in!.x + 8, y: YARD.spawns.from_home_in!.y + 1 });
    expect(moved.exits.filter((e) => e.map === "home_in")).toHaveLength(1);
    // The village exit and its spawn don't move.
    expect(moved.exits.find((e) => e.to === "village")).toEqual(YARD.exits.find((e) => e.to === "village"));
    // The old doorstep is grass (tillable) again; the old door tile is no exit.
    expect(isFarmable(moved, HOME_DOOR.x, HOME_DOOR.y + 1)).toBe(true);
    expect(isFarmable(YARD, HOME_DOOR.x, HOME_DOOR.y + 1)).toBe(false);
  });

  it("stored layouts are sanitised (migration default: nothing moved)", () => {
    expect(sanitizeYard(undefined)).toEqual({});
    expect(sanitizeYard({ house: { x: "1", y: 2 }, fenced: "yes" })).toEqual({});
    expect(sanitizeYard({ house: { x: 14, y: 9 }, fenced: true, extra: 1 })).toEqual({ house: { x: 14, y: 9 }, fenced: true });
    expect(sanitizeYard({ house: { x: 1.5, y: 9 } })).toEqual({});
  });

  it("the plot's fence pieces all fit the base yard (old saves get them as placed fences)", () => {
    const res = checkYardPlace(world([]), "fence", [], 0);
    expect(res.ok).toBe(false);
    const objs: PlacedObject[] = [];
    for (const f of fences()) {
      expect(checkYardPlace(world(objs), "fence", [{ x: f.x, y: f.y }], 0)).toEqual({ ok: true });
      objs.push(f);
    }
    expect(fenceGroup(objs, "f0", 200)).toHaveLength(HOME_FENCES.length);
  });
});

describe("what stays put", () => {
  it("trees, rocks and the pond say why they stay", () => {
    expect(yardHint(YARD, anyTree.x, anyTree.y)).toMatch(/axe/);
    const rock = YARD.rocks![0]!;
    expect(yardHint(YARD, rock.x, rock.y)).toMatch(/pickaxe/);
    const water = YARD.ground.findIndex((g, i) => g === 4 && i > 0);
    expect(yardHint(YARD, water % YARD.width, Math.floor(water / YARD.width))).toMatch(/pond/);
    expect(stayHint(YARD, { x: 20, y: 14 })).toBeNull();
    expect(stayHint(getMap("home_in"), { x: 3, y: 3 })).toBeNull();
  });

  it("the barn can't go on a tree, a rock, the pond, the road edge or another building, and can go on clear grass", () => {
    expect(checkYardMoves(world(), [{ id: "barn", x: 10, y: 15, rotation: 0 }])).toMatchObject({ ok: false, reason: expect.stringMatching(/tree.*axe/i) });
    const rock = YARD.rocks![0]!;
    expect(checkYardMoves(world(), [{ id: "barn", x: rock.x, y: rock.y, rotation: 0 }])).toMatchObject({ ok: false });
    expect(checkYardMoves(world(), [{ id: "barn", x: 6, y: 21, rotation: 0 }]).ok).toBe(false);
    expect(checkYardMoves(world(), [{ id: "barn", x: 6, y: 8, rotation: 0 }]).ok).toBe(false);
    expect(checkYardMoves(world(), [{ id: "barn", x: 13, y: 18, rotation: 0 }])).toEqual({ ok: true });
    // Off the map edge.
    expect(checkYardMoves(world(), [{ id: "barn", x: 37, y: 18, rotation: 0 }]).ok).toBe(false);
  });

  it("the house can't go over trees, the pond, the road or the barn, and its roof needs room", () => {
    expect(checkYardHouse(world(), { x: 9, y: 4 })).toMatchObject({ ok: false });
    expect(checkYardHouse(world(), { x: 6, y: 21 })).toMatchObject({ ok: false });
    expect(checkYardHouse(world(), { x: 12, y: 11 })).toMatchObject({ ok: false });
    expect(checkYardHouse(world(), { x: 6, y: 15 })).toMatchObject({ ok: false });
    expect(checkYardHouse(world(), { x: 6, y: 1 })).toMatchObject({ ok: false, reason: expect.stringMatching(/edge/) });
    expect(checkYardHouse(world(), { x: 14, y: 9 })).toEqual({ ok: true });
  });

  it("a cleared tree's tile is open ground: tillable and buildable; a standing one is neither", () => {
    const t = anyTree;
    expect(isFarmable(YARD, t.x, t.y)).toBe(false);
    const cleared = withoutTrees(YARD, new Set([t.id]));
    expect(isFarmable(cleared, t.x, t.y)).toBe(true);
    expect(yardHint(cleared, t.x, t.y)).toBeNull();
    expect(checkYardPlace(world([], { map: cleared }), "scarecrow", [{ x: t.x, y: t.y }], 0)).toEqual({ ok: true });
  });

  it("a cleared tree waits to grow back while its tile is tilled or built on", () => {
    const field = new TreeField(YARD);
    const t = tree(anyTree.x, anyTree.y);
    field.fell(t, 0);
    const maps = new SubMaps(emptyObjects());
    field.clearStump(t, maps.grids.home);
    expect(field.goneIds()).toEqual(new Set([t.id]));
    expect(field.regrowDue(maps.grids.home, 10 ** 12, [], () => true)).toEqual([]);
    expect(field.goneIds().has(t.id)).toBe(true);
    expect(field.regrowDue(maps.grids.home, 10 ** 13, [], () => false)).toEqual([t.id]);
  });
});

describe("tilling the yard", () => {
  it("any open grass may be tilled, inside the fence or not; never the road, the pond, under buildings or the exits", () => {
    expect(isFarmable(YARD, 20, 18)).toBe(true);
    expect(isFarmable(YARD, 3, 14)).toBe(true);
    expect(isFarmable(YARD, 22, 6)).toBe(true);
    expect(isFarmable(YARD, 20, 12)).toBe(false); // road
    expect(isFarmable(YARD, 7, 9)).toBe(false); // house
    expect(isFarmable(YARD, 39, 12)).toBe(false); // village exit
    const water = YARD.ground.findIndex((g) => g === 4);
    expect(isFarmable(YARD, water % YARD.width, Math.floor(water / YARD.width))).toBe(false);
    expect(isFarmable(YARD, 7, 16, [barn()])).toBe(false); // under the barn
  });
});

describe("nobody gets shut in", () => {
  it("a fence ring round the front door is refused; one with a gate is fine", () => {
    const at = houseAt(YARD)!;
    const door = houseDoor(at);
    // A ring two tiles out round the doorstep and the house front.
    const ring: { x: number; y: number }[] = [];
    const x0 = door.x - 3, x1 = door.x + 3, y0 = door.y + 1, y1 = door.y + 4;
    for (let x = x0; x <= x1; x++) ring.push({ x, y: y1 });
    for (let y = y0; y < y1; y++) ring.push({ x: x0, y }, { x: x1, y });
    const w = world([barn(13, 18), ...fences()]);
    const objs = (gateAt?: number) => ring.map((t, i): PlacedObject => ({ id: `r${i}`, item: i === gateAt ? "gate" : "fence", x: t.x, y: t.y, rotation: 0 }));
    // Check the shut-in rule on its own (some ring tiles are on the road; the rule doesn't mind).
    const shut = keepsYardOpen(w, { ...w, objects: [...w.objects, ...objs()] });
    expect(shut.ok).toBe(false);
    const gated = keepsYardOpen(w, { ...w, objects: [...w.objects, ...objs(3)] });
    expect(gated).toEqual({ ok: true });
  });

  it("someone standing inside a closed fence: refused; something already shut in doesn't block other work", () => {
    const box = (x: number, y: number, id: string): PlacedObject[] => {
      const out: PlacedObject[] = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) out.push({ id: `${id}${dx}${dy}`, item: "fence", x: x + dx, y: y + dy, rotation: 0 });
      return out;
    };
    const partial = box(25, 18, "b").filter((o) => o.id !== "b01");
    const w = world([barn(), ...fences(), ...partial], { occupied: [{ x: 25.5, y: 18.5 }] });
    expect(checkYardPlace(w, "fence", [{ x: 25, y: 19 }], 0)).toMatchObject({ ok: false, reason: expect.stringMatching(/fence someone in/) });
    expect(checkYardPlace(w, "gate", [{ x: 25, y: 19 }], 0)).toEqual({ ok: true });
    // Already closed in (an old save): placing elsewhere still works.
    const closed = world([barn(), ...fences(), ...box(25, 18, "c")], { occupied: [{ x: 25.5, y: 18.5 }] });
    expect(checkYardPlace(closed, "scarecrow", [{ x: 30, y: 17 }], 0)).toEqual({ ok: true });
  });

  it("the barn and the well stay reachable", () => {
    // Close the barn's front with a fence run along its open side.
    const b = barn(13, 18);
    const run = fenceRun({ x: 12, y: 17 }, { x: 17, y: 17 }).concat(fenceRun({ x: 12, y: 20 }, { x: 17, y: 20 }), [{ x: 12, y: 18 }, { x: 12, y: 19 }, { x: 17, y: 18 }, { x: 17, y: 19 }]);
    const objs = run.map((t, i): PlacedObject => ({ id: `w${i}`, item: "fence", x: t.x, y: t.y, rotation: 0 }));
    const w = world([b, ...fences()]);
    expect(keepsYardOpen(w, { ...w, objects: [...w.objects, ...objs] })).toMatchObject({ ok: false, reason: expect.stringMatching(/barn/) });
  });

  it("the house can't be moved into a closed fence", () => {
    // The plot with its opening closed: the house inside it would be shut in.
    const closedPlot = [...fences(), ...[24, 25, 26, 27].map((x, i): PlacedObject => ({ id: `g${i}`, item: "fence", x, y: 11, rotation: 0 }))];
    expect(checkYardHouse(world([barn(), ...closedPlot]), { x: 20, y: 4 })).toMatchObject({ ok: false, reason: expect.stringMatching(/front door/) });
    expect(checkYardHouse(world([barn(), ...fences()]), { x: 20, y: 4 })).toEqual({ ok: true });
  });
});

describe("edit mode helpers (client)", () => {
  const cw = { map: YARD, objects: [barn(), ...fences()], farm: [], occupied: [] };

  it("uses the yard rules in the yard and the house rules inside", () => {
    expect(checkMoves(cw, [{ id: "barn", x: 10, y: 15, rotation: 0 }]).ok).toBe(false);
    expect(checkMoves(cw, [{ id: "barn", x: 13, y: 18, rotation: 0 }]).ok).toBe(true);
    expect(checkNew(cw, "fence", runTiles({ x: 17, y: 15 }, { x: 21, y: 15 }, 10), 0)).toEqual({ ok: true });
    expect(checkNew(cw, "fence", runTiles({ x: 20, y: 15 }, { x: 24, y: 15 }, 10), 0).ok).toBe(false); // a tree at 23,15
    expect(checkHouse(cw, { x: 14, y: 9 })).toEqual({ ok: true });
    expect(checkHouse({ ...cw, map: getMap("home_in") }, { x: 14, y: 9 }).ok).toBe(false);
  });

  it("a run is cut to what the bag holds and sent as start, step and count", () => {
    const tiles = runTiles({ x: 5, y: 5 }, { x: 5, y: 12 }, 3);
    expect(tiles).toEqual([{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }]);
    expect(runStep(tiles)).toEqual({ x: 5, y: 5, dx: 0, dy: 1, n: 3 });
    expect(runStep([{ x: 1, y: 2 }])).toEqual({ x: 1, y: 2, dx: 0, dy: 0, n: 1 });
  });

  it("a gate is drawn across the run it sits in", () => {
    expect(gateTurn(FENCE_E, 1)).toBe(0);
    expect(gateTurn(FENCE_N | FENCE_S, 0)).toBe(1);
    expect(gateTurn(0, 1)).toBe(1);
  });

  it("frames for the yard messages are checked", () => {
    expect(decodeClient(JSON.stringify({ t: "moveHouse", x: 14, y: 9 }))).toEqual({ t: "moveHouse", x: 14, y: 9 });
    expect(decodeClient(JSON.stringify({ t: "moveHouse", x: 1.5, y: 9 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "placeRun", slot: 1, x: 3, y: 4, dx: 1, dy: 1, n: 3, rotation: 0 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "placeRun", slot: 1, x: 3, y: 4, dx: 1, dy: 0, n: 3, rotation: 0 }))).toMatchObject({ n: 3 });
  });
});

// ---------------------------------------------------------------- HomeRoom

let r: Rooms;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  r = createRooms();
});
afterEach(() => {
  vi.useRealTimers();
});

async function owner() {
  const ws = await connectOwner(r, "alice", "Alice");
  const room = r.room("alice") as any;
  return { ws, room };
}
const tick = () => vi.advanceTimersByTime(300);

describe("HomeRoom yard edit", () => {
  it("a new home gets the plot's fence as its own pieces, once", async () => {
    const { room } = await owner();
    expect(room.yard).toEqual({ fenced: true });
    expect(room.objects.home.filter((o: any) => o.item === "fence")).toHaveLength(HOME_FENCES.length);
  });

  it("moves the house (persisted, door follows, everyone in the yard gets a fresh welcome); refuses trees and the pond", async () => {
    const { ws, room } = await owner();
    room.player.entity.x = 30.5;
    room.player.entity.y = 13.5;
    await sendMsg(r, "alice", ws, { t: "moveHouse", x: 6, y: 21 });
    expect(ws.last("reject").reason).toMatch(/pond|way/);
    tick();
    await sendMsg(r, "alice", ws, { t: "moveHouse", x: 9, y: 4 });
    expect(ws.last("reject")).toBeTruthy();
    tick();
    ws.sent = [];
    await sendMsg(r, "alice", ws, { t: "moveHouse", x: 14, y: 9 });
    expect(room.yard.house).toEqual({ x: 14, y: 9 });
    expect(r.ctx("alice").storage.data.get("yard")).toMatchObject({ house: { x: 14, y: 9 } });
    const w = ws.last("welcome");
    expect(w.yard).toMatchObject({ house: { x: 14, y: 9 } });
    expect(room.maps.yard.exits.find((e: any) => e.map === "home_in")).toMatchObject(houseDoor({ x: 14, y: 9 }));
    // Reload from storage: the house is still there.
    const again = new HomeRoom(r.ctx("alice") as any, r.env) as any;
    await r.ctx("alice").ready;
    expect(houseAt(again.maps.yard)).toEqual({ x: 14, y: 9 });
  });

  it("moves the barn onto clear grass only, and the hens follow it", async () => {
    const { ws, room } = await owner();
    room.save.animals = { ...(room.save.animals ?? {}), barn: true, chickens: [], eggs: [], pets: [] };
    room.settleAnimals(Date.now());
    room.player.entity.x = 30.5;
    room.player.entity.y = 13.5;
    await sendMsg(r, "alice", ws, { t: "moveObject", id: "barn", x: 10, y: 15, rotation: 0 });
    expect(ws.last("reject").reason).toMatch(/tree/i);
    tick();
    await sendMsg(r, "alice", ws, { t: "moveObject", id: "barn", x: 13, y: 18, rotation: 0 });
    expect(room.objects.home.find((o: any) => o.id === "barn")).toMatchObject({ x: 13, y: 18 });
    // Barns never go into the bag.
    tick();
    await sendMsg(r, "alice", ws, { t: "pickup", id: "barn" });
    expect(ws.last("reject").reason).toMatch(/barn stays/);
  });

  it("lays a fence run from the bag, slides the plot's whole fence, picks pieces back up", async () => {
    const { ws, room } = await owner();
    room.player.entity.x = 30.5;
    room.player.entity.y = 13.5;
    room.save.inventory.slots[10] = { item: "fence", qty: 5 };
    await sendMsg(r, "alice", ws, { t: "placeRun", slot: 10, x: 17, y: 15, dx: 1, dy: 0, n: 5, rotation: 0 });
    expect(room.objects.home.filter((o: any) => o.y === 15 && o.x >= 17 && o.x <= 21)).toHaveLength(5);
    expect(room.save.inventory.slots[10]).toBeNull();
    tick();
    const plot = room.objects.home.filter((o: any) => HOME_FENCES.some((t) => t.x === o.x && t.y === o.y)).map((o: any) => o.id);
    await sendMsg(r, "alice", ws, { t: "shiftObjects", ids: plot, dx: -1, dy: 0 });
    expect(room.objects.home.some((o: any) => o.x === 17 && o.y === 2)).toBe(true);
    tick();
    await sendMsg(r, "alice", ws, { t: "shiftObjects", ids: plot, dx: -4, dy: 0 });
    expect(ws.last("reject").reason).toMatch(/tree/i); // trees at 13,2 and 13,5
    expect(room.objects.home.some((o: any) => o.x === 17 && o.y === 2)).toBe(true);
    tick();
    const five = room.objects.home.filter((o: any) => o.y === 15 && o.x >= 17 && o.x <= 21).map((o: any) => o.id);
    await sendMsg(r, "alice", ws, { t: "pickupObjects", ids: five });
    expect(room.objects.home.some((o: any) => o.y === 15 && o.x === 17)).toBe(false);
    expect(room.save.inventory.slots.find((s: any) => s?.item === "fence")?.qty).toBe(5);
  });

  it("places a bag item in the yard and takes it back", async () => {
    const { ws, room } = await owner();
    room.player.entity.x = 30.5;
    room.player.entity.y = 13.5;
    room.save.inventory.slots[10] = { item: "scarecrow", qty: 1 };
    await sendMsg(r, "alice", ws, { t: "place", slot: 10, x: 26, y: 17, rotation: 0 });
    const sc = room.objects.home.find((o: any) => o.item === "scarecrow");
    expect(sc).toMatchObject({ x: 26, y: 17 });
    expect(room.save.inventory.slots[10]).toBeNull();
    tick();
    await sendMsg(r, "alice", ws, { t: "pickup", id: sc.id });
    expect(room.objects.home.some((o: any) => o.item === "scarecrow")).toBe(false);
    expect(room.save.inventory.slots.some((s: any) => s?.item === "scarecrow")).toBe(true);
  });

  it("refuses a run that would fence the owner in", async () => {
    const { ws, room } = await owner();
    room.save.inventory.slots[10] = { item: "fence", qty: 20 };
    const lay = async (x: number, y: number, dx: number, dy: number, n: number) => {
      tick();
      await sendMsg(r, "alice", ws, { t: "placeRun", slot: 10, x, y, dx, dy, n, rotation: 0 });
    };
    room.player.entity.x = 19.5;
    room.player.entity.y = 23.5;
    await lay(18, 22, 1, 0, 3);
    await lay(18, 24, 1, 0, 3);
    await lay(18, 23, 0, 0, 1);
    expect(ws.of("reject").map((m: any) => m.reason)).toEqual([]);
    ws.sent = [];
    await lay(20, 23, 0, 0, 1);
    expect(ws.last("reject").reason).toMatch(/fence someone in/);
  });
});

describe("old saves", () => {
  it("a save from before yard editing loads with the house where it was and the plot's fence as pieces", async () => {
    installWorkersGlobals();
    const ctx = new FakeCtx();
    ctx.storage.data.set("owner", "olga");
    ctx.storage.data.set("save", { userId: "olga", name: "Olga", inventory: { coins: 5, slots: [] }, hp: 100, maxHp: 100, sprite: "ninja_blue", zone: "home", x: 8.5, y: 12.5 });
    ctx.storage.data.set("layout", "v2-house");
    const room = new HomeRoom(ctx as any, r.env) as any;
    await ctx.ready;
    expect(room.yard).toEqual({ fenced: true });
    expect(houseAt(room.maps.yard)).toEqual({ x: HOME_HOUSE.x, y: HOME_HOUSE.y });
    expect(room.objects.home.filter((o: any) => o.item === "fence")).toHaveLength(HOME_FENCES.length);
    expect(ctx.storage.data.get("yard")).toEqual({ fenced: true });
  });
});
