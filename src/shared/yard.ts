// The owner's yard layout. The base yard (maps/home.ts) is the same for everyone; what each owner
// changes is kept in their HomeRoom as a YardLayout and laid over it here, on the server and on
// the client alike, so collision, the house door, spawns and the drawing always agree.
//
// Only the house is part of the layout: the barn, fences and gates are placed pieces (objects).
// Trees, rocks and the pond belong to the base map and never move; tools deal with those.
// Pure: no clock, no randomness.
import { canPlace, type PlaceResult } from "./engine/placement";
import { checkArrange, isFenceItem, MAX_FENCE_PIECES, type ArrangeMove, type ArrangeResult } from "./engine/arrange";
import { buildCollision, isBlocked } from "./engine/collision";
import { objectRect, pointInRect, rectsOverlap, type Rect } from "./engine/geometry";
import { getItem } from "./items";
import { DOORSTEP_SPAWNS, doorKeep, doorstepTiles, HOME_DOOR, HOME_HOUSE, HOUSE_PROP_ID } from "./maps/home";
import { BLOCKING_GROUND, Ground, type FarmTile, type ItemId, type MapData, type MapProp, type PlacedObject, type Vec2 } from "./types";

export { HOUSE_PROP_ID };

/** What an owner changed about their yard. Absent fields keep the base map's layout. */
export interface YardLayout {
  /** Top-left of the house footprint. */
  house?: Vec2;
  /** The plot's fence (HOME_FENCES) was handed over as placed pieces (done once per home). */
  fenced?: boolean;
}

export const HOUSE_SIZE = { w: HOME_HOUSE.w, h: HOME_HOUSE.h } as const;
/** The door tile, from the house's top-left. */
export const HOUSE_DOOR_AT = { x: HOME_DOOR.x - HOME_HOUSE.x, y: HOME_DOOR.y - HOME_HOUSE.y } as const;
/** Rows the cottage art (roof and chimney) reaches above the footprint: kept on the map. */
export const HOUSE_ROOF_ROWS = 3;

export { isFenceItem, MAX_FENCE_PIECES };
/** Longest fence run one drag lays. */
export const MAX_FENCE_RUN = 24;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Keeps only a well-formed layout (stored data and imports are untrusted). */
export function sanitizeYard(raw: unknown): YardLayout {
  const out: YardLayout = {};
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  const h = o.house as Record<string, unknown> | undefined;
  if (h && isInt(h.x) && isInt(h.y) && Math.abs(h.x) < 1000 && Math.abs(h.y) < 1000) out.house = { x: h.x, y: h.y };
  if (o.fenced === true) out.fenced = true;
  return out;
}

/** Where the house stands on a (laid out) yard; null on maps without one. */
export function houseAt(map: MapData): Vec2 | null {
  const p = map.props.find((q) => q.id === HOUSE_PROP_ID);
  return p ? { x: p.x, y: p.y } : null;
}

export function houseDoor(at: Vec2): Vec2 {
  return { x: at.x + HOUSE_DOOR_AT.x, y: at.y + HOUSE_DOOR_AT.y };
}

/** The house footprint and the doorstep below its door (what must be free to stand it there). */
export function houseLot(at: Vec2): { foot: Rect; step: Rect } {
  const door = houseDoor(at);
  return {
    foot: { x: at.x, y: at.y, w: HOUSE_SIZE.w, h: HOUSE_SIZE.h },
    // The doorstep row and the spawn row below it, one tile either side of the door.
    step: { x: door.x - 1, y: door.y + 1, w: 3, h: 2 },
  };
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * The yard without its house: no house prop, door exit, doorstep spawns or doorstep farm margin,
 * and the doorstep path grassed over. What a house move is checked against.
 */
export function withoutHouse(map: MapData): MapData {
  const at = houseAt(map);
  if (!at) return map;
  const door = houseDoor(at);
  const ground = map.ground.slice();
  for (const t of doorstepTiles(door)) {
    const i = t.y * map.width + t.x;
    if (t.x >= 0 && t.y >= 0 && t.x < map.width && t.y < map.height && ground[i] === Ground.Dirt) ground[i] = Ground.Grass;
  }
  const spawns = { ...map.spawns };
  for (const s of DOORSTEP_SPAWNS) delete spawns[s];
  const keep = doorKeep(door);
  return {
    ...map,
    ground,
    props: map.props.filter((p) => p.id !== HOUSE_PROP_ID),
    exits: map.exits.filter((e) => e.map !== "home_in"),
    spawns,
    ...(map.noFarm ? { noFarm: map.noFarm.filter((r) => !sameRect(r, keep)) } : {}),
  };
}

/** Stands the house (taken from `withHouse`) on `bare` at `at`, with its door, doorstep and spawns. */
function standHouse(bare: MapData, withHouse: MapData, at: Vec2): MapData {
  const prop = withHouse.props.find((p) => p.id === HOUSE_PROP_ID)!;
  const from = houseAt(withHouse)!;
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  const door = houseDoor(at);
  const ground = bare.ground.slice();
  for (const t of doorstepTiles(door)) {
    const i = t.y * bare.width + t.x;
    if (t.x >= 0 && t.y >= 0 && t.x < bare.width && t.y < bare.height && ground[i] === Ground.Grass) ground[i] = Ground.Dirt;
  }
  const spawns = { ...bare.spawns };
  for (const s of DOORSTEP_SPAWNS) {
    const v = withHouse.spawns[s];
    if (v) spawns[s] = { x: v.x + dx, y: v.y + dy };
  }
  const exits = [...bare.exits, ...withHouse.exits.filter((e) => e.map === "home_in").map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }))];
  const props: MapProp[] = [...bare.props, { ...prop, x: at.x, y: at.y }];
  return {
    ...bare,
    ground,
    props,
    exits,
    spawns,
    ...(withHouse.noFarm ? { noFarm: [...(bare.noFarm ?? []), doorKeep(door)] } : {}),
  };
}

/** The base yard with an owner's layout laid over it. Returns `base` itself when nothing moved. */
export function applyYard(base: MapData, layout: YardLayout | null | undefined): MapData {
  const from = houseAt(base);
  const to = layout?.house;
  if (!from || !to || (to.x === from.x && to.y === from.y)) return base;
  return standHouse(withoutHouse(base), base, to);
}

/** Why a tile of the yard can't be built on, naming what is there; null when it is clear. */
function propReason(p: MapProp): string {
  if (p.type === "tree") return "A tree is in the way. Chop it down with an axe first.";
  if (p.type === "rock_deco" || p.type.includes("boulder")) return "A boulder is in the way.";
  if (p.type === "home_house") return "The house is in the way.";
  return "Something is in the way.";
}

export interface HouseMoveWorld {
  /** The yard as it is now (applyYard of the base and the current layout). */
  map: MapData;
  objects: readonly PlacedObject[];
  farm: readonly FarmTile[];
  /** Feet of everyone in the yard. */
  occupied?: readonly Vec2[];
}

/**
 * May the house stand with its top-left at `at`? Its footprint and doorstep must be on open,
 * dry ground off the road, clear of trees, rocks, other buildings, placed pieces (fences, the
 * barn), farmland and people; the roof must stay on the map; and the way out to the village and
 * its spawn keep a tile of room.
 */
export function checkHouseMove(w: HouseMoveWorld, at: Vec2): PlaceResult {
  const fail = (reason: string): PlaceResult => ({ ok: false, reason });
  if (!isInt(at.x) || !isInt(at.y)) return fail("Invalid position.");
  const map = withoutHouse(w.map);
  const { foot, step } = houseLot(at);
  // The art is a little wider than the footprint and its roof rises above it: keep it all on the map.
  if (foot.x < 1 || foot.y < HOUSE_ROOF_ROWS || foot.x + foot.w > map.width - 1 || step.y + step.h > map.height) {
    return fail("Too close to the edge of the yard.");
  }
  const lot = [foot, step];
  const tiles: Vec2[] = [];
  for (const r of lot) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles.push({ x, y });
  for (const t of tiles) {
    const g = map.ground[t.y * map.width + t.x];
    if (g === Ground.Water) return fail("That's the pond.");
    if (BLOCKING_GROUND.has(g)) return fail("Something is in the way.");
    if (g === Ground.Dirt && pointInRect(foot, t.x, t.y)) return fail("Keep the road clear.");
  }
  for (const r of lot) {
    const prop = map.props.find((p) => !p.walkable && rectsOverlap(p, r));
    if (prop) return fail(propReason(prop));
  }
  if (map.rocks?.some((k) => lot.some((r) => pointInRect(r, k.x, k.y)))) return fail("A rock is in the way. Break it with a pickaxe first.");
  // The roof rises over the rows above the footprint: a tree there would grow through it.
  const roof: Rect = { x: foot.x - 1, y: foot.y - HOUSE_ROOF_ROWS, w: foot.w + 2, h: HOUSE_ROOF_ROWS };
  if (map.props.some((p) => p.type === "tree" && rectsOverlap(p, roof))) return fail("A tree is in the way of the roof. Chop it down with an axe first.");
  for (const o of w.objects) {
    const r = objectRect(o.item, o.x, o.y, o.rotation);
    if (lot.some((l) => rectsOverlap(l, r))) return fail(`Move the ${getItem(o.item)?.name.toLowerCase() ?? "piece"} out of the way first.`);
  }
  if (w.farm.some((t) => lot.some((r) => pointInRect(r, t.x, t.y)))) return fail("There's farmland there. Clear it first.");
  const margin = (r: Rect): Rect => ({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
  if (map.exits.some((e) => lot.some((r) => rectsOverlap(e, margin(r))))) return fail("Keep the way out clear.");
  if (Object.values(map.spawns).some((s) => lot.some((r) => pointInRect(margin(r), Math.floor(s.x), Math.floor(s.y))))) {
    return fail("Keep the road clear.");
  }
  if (w.occupied?.some((p) => lot.some((r) => pointInRect(r, Math.floor(p.x), Math.floor(p.y))))) return fail("Someone is standing there.");
  return { ok: true };
}

/**
 * What edit mode says when you try to pick up part of the yard that isn't yours to move: trees,
 * rocks and the pond stay, and tools are how you clear the first two. Null for open ground.
 */
export function yardHint(map: MapData, x: number, y: number): string | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;
  const prop = map.props.find((p) => pointInRect({ x: p.x, y: p.y, w: Math.max(1, p.w), h: Math.max(1, p.h) }, tx, ty));
  if (prop?.type === "tree") return "Trees can't be moved. Chop it down with an axe.";
  if (map.rocks?.some((k) => k.x === tx && k.y === ty)) return "Rocks can't be moved. Break it with a pickaxe.";
  if (prop && (prop.type === "rock_deco" || prop.type.includes("boulder"))) return "That boulder is far too heavy to move.";
  const g = map.ground[ty * map.width + tx];
  if (g === Ground.Water || prop?.type === "lily_pad") return "The pond stays where it is.";
  if (prop && prop.type !== "home_house") return "That stays where it is.";
  return null;
}

/** Tiles a fence run covers from `a` to `b`: a straight line along whichever axis moved more. */
export function fenceRun(a: Vec2, b: Vec2, max = MAX_FENCE_RUN): Vec2[] {
  const ax = Math.floor(a.x);
  const ay = Math.floor(a.y);
  const dx = Math.floor(b.x) - ax;
  const dy = Math.floor(b.y) - ay;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const n = Math.min(max - 1, horizontal ? Math.abs(dx) : Math.abs(dy));
  const sx = horizontal ? Math.sign(dx) : 0;
  const sy = horizontal ? 0 : Math.sign(dy);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: ax + sx * i, y: ay + sy * i });
  return out;
}

/**
 * Can `item` go down on every tile of `tiles` at once? Each piece is checked against what is
 * already placed plus the pieces before it in the run, so a run never overlaps itself.
 */
export function checkPlaceMany(
  map: MapData,
  objects: readonly PlacedObject[],
  farm: FarmTile[],
  item: ItemId,
  tiles: readonly Vec2[],
  rotation: 0 | 1 | 2 | 3,
  opts?: { occupied?: Vec2[] },
): PlaceResult & { index?: number } {
  if (tiles.length === 0) return { ok: false, reason: "Nothing to place." };
  if (tiles.length > 1 && !isFenceItem(item)) return { ok: false, reason: "Only fences go down in a run." };
  if (tiles.length > MAX_FENCE_RUN) return { ok: false, reason: `Lay at most ${MAX_FENCE_RUN} pieces at once.` };
  const placed: PlacedObject[] = [...objects];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    const res = canPlace(map, placed, farm, item, t.x, t.y, rotation, opts?.occupied ? { occupied: opts.occupied } : undefined);
    if (!res.ok) return { ...res, index: i };
    placed.push({ id: `run${i}`, item, x: t.x, y: t.y, rotation });
  }
  return { ok: true };
}

/**
 * Every fence and gate joined to the piece `id` (side by side, not corner to corner): a plot's
 * whole fence, so it can be picked up and moved as one.
 */
export function fenceGroup(objects: readonly PlacedObject[], id: string, max = MAX_FENCE_PIECES): string[] {
  const start = objects.find((o) => o.id === id);
  if (!start || !isFenceItem(start.item)) return start ? [start.id] : [];
  const byTile = new Map<string, PlacedObject>();
  for (const o of objects) if (isFenceItem(o.item)) byTile.set(`${o.x},${o.y}`, o);
  const seen = new Set<string>([start.id]);
  const queue = [start];
  while (queue.length > 0 && seen.size < max) {
    const o = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = byTile.get(`${o.x + dx},${o.y + dy}`);
      if (n && !seen.has(n.id) && seen.size < max) {
        seen.add(n.id);
        queue.push(n);
      }
    }
  }
  return [...seen];
}

// ------------------------------------------------------------------ cleared trees

/**
 * The yard without the trees that were chopped down and cleared (`gone`): their tiles are open
 * grass again, so the owner may till, build or place there until the tree grows back (it waits
 * while anything stands there; see TreeField.regrowDue).
 */
export function withoutTrees(map: MapData, gone: ReadonlySet<string>): MapData {
  if (gone.size === 0) return map;
  return { ...map, props: map.props.filter((p) => !(p.type === "tree" && gone.has(p.id))) };
}

// ------------------------------------------------------------------ nobody gets shut in

/** Everything in the yard a change is checked against. `map` is laid out (applyYard, withoutTrees). */
export interface YardWorld {
  map: MapData;
  objects: readonly PlacedObject[];
  farm: readonly FarmTile[];
  /** Unbroken rocks (default: every rock on the map). */
  rocks?: readonly Vec2[];
  /** Feet of the people and animals in the yard. */
  occupied?: readonly Vec2[];
}

/** Props the owner has to be able to walk up to. */
const VISITED_PROPS = new Set(["well", "mailbox", "shipping_bin"]);

interface Target {
  key: string;
  why: string;
  /** Tiles any one of which, reached, counts (a door tile, or the ring round a prop). */
  tiles: Vec2[];
}

function ring(r: Rect): Vec2[] {
  const out: Vec2[] = [];
  for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
  for (let y = r.y; y < r.y + r.h; y++) out.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
  return out;
}

function targets(w: YardWorld): Target[] {
  const out: Target[] = [];
  for (const e of w.map.exits) {
    const tiles: Vec2[] = [];
    for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) tiles.push({ x, y });
    if (e.map === "home_in") out.push({ key: "door", why: "That would block the way to your front door.", tiles });
  }
  for (const p of w.map.props) {
    if (VISITED_PROPS.has(p.type)) out.push({ key: `prop:${p.id}`, why: `That would shut off the ${p.type.replace("_", " ")}.`, tiles: ring(p) });
  }
  for (const o of w.objects) {
    if (o.item === "barn") out.push({ key: "barn", why: "That would shut off the barn.", tiles: ring(objectRect(o.item, o.x, o.y, o.rotation)) });
  }
  (w.occupied ?? []).forEach((p, i) =>
    out.push({ key: `who:${i}`, why: "That would fence someone in.", tiles: [{ x: Math.floor(p.x), y: Math.floor(p.y) }] }),
  );
  return out;
}

/** Tiles reachable on foot from the way out to the village (gates are walked through). */
function reachable(w: YardWorld): Uint8Array {
  const grid = buildCollision(w.map, { objects: [...w.objects], ...(w.rocks ? { rocks: [...w.rocks] } : {}) });
  const seen = new Uint8Array(grid.width * grid.height);
  const queue: number[] = [];
  for (const e of w.map.exits) {
    if (e.map === "home_in") continue;
    for (let y = e.y; y < e.y + e.h; y++)
      for (let x = e.x; x < e.x + e.w; x++) {
        if (isBlocked(grid, x, y)) continue;
        const i = y * grid.width + x;
        if (!seen[i]) {
          seen[i] = 1;
          queue.push(i);
        }
      }
  }
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (isBlocked(grid, nx, ny)) continue;
      const j = ny * grid.width + nx;
      if (!seen[j]) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  return seen;
}

function reaches(w: YardWorld, seen: Uint8Array, t: Target): boolean {
  return t.tiles.some((p) => p.x >= 0 && p.y >= 0 && p.x < w.map.width && p.y < w.map.height && seen[p.y * w.map.width + p.x] === 1);
}

/**
 * Does the change from `before` to `after` shut anything in? The front door, the barn, the
 * well, mailbox and shipping bin, and everyone in the yard must still be reachable from the way
 * out to the village. Something already cut off before (an old save) doesn't hold up other work.
 */
export function keepsYardOpen(before: YardWorld, after: YardWorld): PlaceResult {
  const seenAfter = reachable(after);
  let seenBefore: Uint8Array | null = null;
  const beforeTargets = new Map(targets(before).map((t) => [t.key, t]));
  for (const t of targets(after)) {
    if (reaches(after, seenAfter, t)) continue;
    // A body standing on a blocked tile (mid-step) can't be judged by its tile: skip it.
    if (t.key.startsWith("who:") && isBlocked(buildCollision(after.map, { objects: [...after.objects] }), t.tiles[0]!.x, t.tiles[0]!.y)) continue;
    const was = beforeTargets.get(t.key);
    seenBefore ??= reachable(before);
    if (was && !reaches(before, seenBefore, was)) continue;
    return { ok: false, reason: t.why };
  }
  return { ok: true };
}

/**
 * "Something is in the way" said plainly for the yard: which of the things that stay put (a
 * tree, a rock, the pond) is under `r`, and what to do about it. Null when it's none of those.
 */
export function yardBlocker(map: MapData, r: Rect): string | null {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const prop = map.props.find((p) => pointInRect({ x: p.x, y: p.y, w: Math.max(1, p.w), h: Math.max(1, p.h) }, x, y));
      if (prop?.type === "tree") return "A tree is in the way. Chop it down with an axe first.";
      if (map.rocks?.some((k) => k.x === x && k.y === y)) return "A rock is in the way. Break it with a pickaxe first.";
      if (prop && (prop.type === "rock_deco" || prop.type.includes("boulder"))) return "A boulder is in the way.";
      const g = map.ground[y * map.width + x];
      if (g === Ground.Water || prop?.type === "lily_pad") return "That's the pond.";
    }
  return null;
}

const asWorld = (w: YardWorld, objects: readonly PlacedObject[]): YardWorld => ({ ...w, objects });

/** Edit mode moves in the yard: the usual arrange rules, and nothing gets shut in. */
export function checkYardMoves(w: YardWorld, moves: readonly ArrangeMove[]): ArrangeResult {
  const res = checkArrange(w.map, [...w.objects], [...w.farm], moves, { occupied: w.occupied ? [...w.occupied] : [] });
  if (!res.ok) {
    const m = moves.find((x) => x.id === res.id);
    const o = m && w.objects.find((x) => x.id === m.id);
    const why = res.reason === "Something is in the way." && m && o ? yardBlocker(w.map, objectRect(o.item, m.x, m.y, m.rotation)) : null;
    return why ? { ...res, reason: why } : res;
  }
  const to = new Map(moves.map((m) => [m.id, m]));
  const after = w.objects.map((o) => {
    const m = to.get(o.id);
    return m ? { ...o, x: m.x, y: m.y, rotation: m.rotation } : o;
  });
  const open = keepsYardOpen(w, asWorld(w, after));
  return open.ok ? res : open;
}

/** New pieces from the bag (a fence run or one piece): placement rules, and nothing gets shut in. */
export function checkYardPlace(w: YardWorld, item: ItemId, tiles: readonly Vec2[], rotation: 0 | 1 | 2 | 3): PlaceResult & { index?: number } {
  const res = checkPlaceMany(w.map, w.objects, [...w.farm], item, tiles, rotation, w.occupied ? { occupied: [...w.occupied] } : undefined);
  if (!res.ok) {
    const t = tiles[res.index ?? 0];
    const why = res.reason === "Something is in the way." && t ? yardBlocker(w.map, objectRect(item, t.x, t.y, rotation)) : null;
    return why ? { ...res, reason: why } : res;
  }
  const added = tiles.map((t, i): PlacedObject => ({ id: `new${i}`, item, x: t.x, y: t.y, rotation }));
  return keepsYardOpen(w, asWorld(w, [...w.objects, ...added]));
}

/** The house to `at`: where it may stand (checkHouseMove), and nothing gets shut in. */
export function checkYardHouse(w: YardWorld, at: Vec2): PlaceResult {
  const res = checkHouseMove({ map: w.map, objects: w.objects, farm: w.farm, ...(w.occupied ? { occupied: w.occupied } : {}) }, at);
  if (!res.ok) return res;
  const from = houseAt(w.map);
  const moved = from ? standHouse(withoutHouse(w.map), w.map, at) : w.map;
  return keepsYardOpen(w, { ...w, map: moved });
}
