// Tool use on the home farm through a real HomeRoom: multi-hit rocks, trees to stumps to cleared
// tiles and back, wrong tools, and swings that play even when nothing happens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, sendMsg, type FakeWs, type Rooms } from "./do-harness";
import { getMap } from "../src/shared/maps";
import { buildCollision, isBlocked } from "../src/shared/engine";
import { clampWater } from "../src/shared/engine/homeday";
import { HIT_RESET_MS, ROCK_RULES, STUMP_RULE, TREE_REGROW_MS, TREE_RULES, treeSize } from "../src/shared/engine/toolRules";
import { TreeField } from "../src/worker/game/treeField";
import type { MapProp } from "../src/shared/types";

const T0 = 1_700_000_000_000;
const HOME = getMap("home");
let r: Rooms;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  vi.spyOn(Math, "random").mockReturnValue(0);
  r = createRooms();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Owner at home standing just below tile (x, y), so it is in tool reach. */
async function ownerBeside(x: number, y: number): Promise<{ ws: FakeWs; room: any }> {
  const ws = await connectOwner(r, "alice", "Alice");
  const room = r.room("alice") as any;
  await r.ctx("alice").ready;
  const p = (room as any).player ?? (await Promise.resolve((room as any).player));
  p.entity.x = x + 0.5;
  p.entity.y = y + 1.5;
  return { ws, room };
}
const slotOf = (room: any, item: string) => room.save.inventory.slots.findIndex((s: any) => s?.item === item);
const count = (room: any, item: string) =>
  room.save.inventory.slots.filter((s: any) => s?.item === item).reduce((n: number, s: any) => n + s.qty, 0);
async function use(ws: FakeWs, room: any, item: string, x: number, y: number): Promise<void> {
  vi.advanceTimersByTime(300); // past the use cooldown
  await sendMsg(r, "alice", ws, { t: "use", slot: slotOf(room, item), x, y });
}
const rejects = (ws: FakeWs) => ws.of("reject").map((m) => m.reason);

/** A home tree whose tile below is free to stand on. */
function reachableTree(size?: "small" | "large"): MapProp {
  const grid = buildCollision(HOME);
  const t = HOME.props.find((p) => p.type === "tree" && !isBlocked(grid, p.x, p.y + 1) && (!size || treeSize(p.id) === size));
  if (!t) throw new Error("no reachable tree");
  return t;
}

describe("home tools", () => {
  it("starts new players with an axe", async () => {
    const { room } = await ownerBeside(10, 10);
    expect(slotOf(room, "axe")).toBeGreaterThanOrEqual(0);
  });

  it("chops a tree in N hits to a stump, clears the stump, drops wood, and regrows it", async () => {
    const tree = reachableTree();
    const need = TREE_RULES[treeSize(tree.id)].hits;
    const { ws, room } = await ownerBeside(tree.x, tree.y);
    for (let i = 1; i < need; i++) {
      await use(ws, room, "axe", tree.x, tree.y);
      expect(ws.last("tree")).toMatchObject({ id: tree.id, stage: "tree", hits: i, need });
    }
    await use(ws, room, "axe", tree.x, tree.y);
    expect(ws.last("tree")).toMatchObject({ id: tree.id, stage: "stump", drops: ["wood"] });
    expect(count(room, "wood")).toBe(TREE_RULES[treeSize(tree.id)].drops[0]!.min);
    // The stump still blocks; clearing it frees the tile.
    expect(isBlocked(room.maps.grids.home, tree.x, tree.y)).toBe(true);
    for (let i = 0; i < STUMP_RULE.hits; i++) await use(ws, room, "axe", tree.x, tree.y);
    expect(ws.last("tree")).toMatchObject({ id: tree.id, stage: "gone" });
    expect(isBlocked(room.maps.grids.home, tree.x, tree.y)).toBe(false);
    expect(rejects(ws)).toEqual([]);
    // Persisted, and back after the regrow time.
    expect(r.ctx("alice").storage.data.get("trees")).toMatchObject({ [tree.id]: { stage: "gone" } });
    vi.setSystemTime(Date.now() + TREE_REGROW_MS + 1);
    await room.alarm();
    expect(ws.last("tree")).toMatchObject({ id: tree.id, stage: "tree", hits: 0 });
    expect(isBlocked(room.maps.grids.home, tree.x, tree.y)).toBe(true);
  });

  it("fells a tree with a full bag: the wood goes to the mailbox", async () => {
    const tree = reachableTree();
    const need = TREE_RULES[treeSize(tree.id)].hits;
    const { ws, room } = await ownerBeside(tree.x, tree.y);
    const slots = room.save.inventory.slots;
    for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = { item: "stone", qty: 99 };
    for (let i = 0; i < need; i++) await use(ws, room, "axe", tree.x, tree.y);
    expect(ws.last("tree")).toMatchObject({ id: tree.id, stage: "stump" });
    expect(rejects(ws)).toEqual([]);
    expect(count(room, "wood")).toBe(0);
    expect(room.mail.parcels).toEqual([{ item: "wood", qty: TREE_RULES[treeSize(tree.id)].drops[0]!.min }]);
    expect(ws.of("notice").map((m) => m.text)).toContain("Your bag is full, so the wood went to your mailbox.");
  });

  it("forgets chopping progress left alone for a while", async () => {
    const tree = reachableTree();
    const { ws, room } = await ownerBeside(tree.x, tree.y);
    await use(ws, room, "axe", tree.x, tree.y);
    vi.advanceTimersByTime(HIT_RESET_MS);
    await use(ws, room, "axe", tree.x, tree.y);
    expect(ws.last("tree")).toMatchObject({ hits: 1 });
  });

  it("mines a stone rock in its hit count and drops stone", async () => {
    const rock = HOME.rocks!.find((k) => k.ore === "stone")!;
    const { ws, room } = await ownerBeside(rock.x, rock.y);
    room.maps.grids.home = buildCollision(HOME); // stand anywhere for the test
    await use(ws, room, "pickaxe", rock.x, rock.y);
    expect(ws.last("rock")).toMatchObject({ id: rock.id, broken: false, hits: 1, need: ROCK_RULES.stone.hits });
    await use(ws, room, "pickaxe", rock.x, rock.y);
    expect(ws.last("rock")).toMatchObject({ id: rock.id, broken: true, drops: ["stone"] });
    expect(count(room, "stone")).toBeGreaterThan(0);
  });

  it("wrong tools clunk with a notice and change nothing, but still swing", async () => {
    const tree = reachableTree();
    const { ws, room } = await ownerBeside(tree.x, tree.y);
    await use(ws, room, "pickaxe", tree.x, tree.y);
    expect(rejects(ws).at(-1)).toMatch(/pickaxe bounces off the tree/);
    expect(room.player.entity.act).toMatchObject({ k: "pickaxe", item: "pickaxe" });
    expect(room.player.entity.facing).toBe("up");
    await use(ws, room, "sword_wood", tree.x, tree.y);
    expect(rejects(ws).at(-1)).toMatch(/You need an axe/);
    expect(ws.of("tree")).toEqual([]);
  });

  it("hoeing tilled soil does nothing; seeds need tilled soil", async () => {
    const { ws, room } = await ownerBeside(24, 6);
    await use(ws, room, "seed_turnip", 24, 6);
    expect(rejects(ws).at(-1)).toMatch(/Till the soil/);
    await use(ws, room, "hoe", 24, 6);
    expect(room.farm.some((t: any) => t.x === 24 && t.y === 6)).toBe(true);
    await use(ws, room, "hoe", 24, 6);
    expect(rejects(ws).at(-1)).toBe("Already tilled.");
    await use(ws, room, "seed_turnip", 24, 6);
    expect(room.farm.find((t: any) => t.x === 24 && t.y === 6).crop).toBe("turnip");
  });

  it("waters empty tilled soil, and a seed planted after counts as watered today", async () => {
    const { ws, room } = await ownerBeside(24, 6);
    await use(ws, room, "hoe", 24, 6);
    const water = clampWater(room.save.water);
    await use(ws, room, "watering_can", 24, 6);
    const tile = () => room.farm.find((t: any) => t.x === 24 && t.y === 6);
    expect(tile()).toMatchObject({ crop: null, lastWateredDay: room.clock.day, wateredDays: 0 });
    expect(room.save.water).toBe(water - 1);
    await use(ws, room, "watering_can", 24, 6);
    expect(rejects(ws).at(-1)).toBe("Already watered today.");
    await use(ws, room, "seed_turnip", 24, 6);
    expect(tile()).toMatchObject({ crop: "turnip", lastWateredDay: room.clock.day, wateredDays: 1 });
    await use(ws, room, "watering_can", 24, 6);
    expect(rejects(ws).at(-1)).toBe("Already watered today.");
  });
});

describe("TreeField", () => {
  it("loads only valid entries and frees cleared tiles in a fresh grid", () => {
    const field = new TreeField(HOME);
    const [a, b] = field.trees;
    field.load({ [a!.id]: { stage: "gone", regrowAt: 5 }, [b!.id]: { stage: "stump", regrowAt: 9 }, bogus: { stage: "gone", regrowAt: 1 }, x: 3 });
    const grid = buildCollision(HOME);
    field.applyTo(grid);
    expect(isBlocked(grid, a!.x, a!.y)).toBe(false);
    expect(isBlocked(grid, b!.x, b!.y)).toBe(true);
    expect(field.at(a!.x, a!.y)).toBeNull();
    expect(field.at(b!.x, b!.y)).toMatchObject({ stage: "stump" });
    expect(field.nextRegrow()).toBe(5);
    // Someone standing on a cleared tile delays its regrowth.
    expect(field.regrowDue(grid, 10, [{ x: a!.x + 0.5, y: a!.y + 0.5 }])).toEqual([b!.id]);
    expect(field.regrowDue(grid, 10, [])).toEqual([a!.id]);
    expect(isBlocked(grid, a!.x, a!.y)).toBe(true);
    expect(field.stages()).toEqual([]);
  });
});
