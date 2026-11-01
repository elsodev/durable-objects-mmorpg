// Seeded, rule-based furniture placer. Given a room shell and a plan (what goes against the north
// wall, which table sets, what stands along the walls), it tries random arrangements from the
// seed until one keeps every rule in rules.ts, so a layout is random but always makes sense, and
// the same seed gives the same room on the server and in every browser.

import type { MapData, NpcSpawn } from "../../types";
import { Rng } from "../rng";
import type { PropType } from "../props";
import { INTERIOR_PROP_FOOTPRINTS, NORTH_WALL_PROPS, PICTURE_HIDING_PROPS, TALL_WALL_PROPS } from "./props";
import { Room, type RoomSpec } from "./room";
import { layoutProblems } from "./rules";

export type TableKind = "table_round" | "table_round_meal" | "table_long" | "table_long_meal" | "writing_desk";

export interface TableSet {
  table: TableKind;
  /** Rug under the set. */
  rug?: "rug_vine" | "rug_red";
  /** Floor lamp beside one of its chairs. */
  lamp?: boolean;
}

export interface FurnishPlan {
  /** Against the north wall, in any order (beds and fireplaces included). */
  north: PropType[];
  /** Stove + kitchen counter side by side against the north wall. */
  kitchen?: boolean;
  tables: TableSet[];
  /** Along a wall or in a corner. */
  wall: PropType[];
  /** Rug in open floor (when no table set has one). */
  rug?: "rug_vine" | "rug_red";
  /** Hung on plain stretches of the north wall (pictures, shelves, sconces). */
  decor?: PropType[];
  /** Set on the room's tables (candles, plates, mugs...). */
  tabletop?: PropType[];
  /** NPC who lives here: gets a free spot of their own. */
  npc?: { id: string; wander: number; /** Where in the room they like to be (0..1 of width/height). */ prefer?: { x: number; y: number } };
}

/** Upper bound on retries; layouts nearly always succeed within a handful. */
export const MAX_ATTEMPTS = 400;

interface Placed {
  type: PropType;
  fx: number;
  fy: number;
  id?: string;
}

const fp = (t: PropType) => (INTERIOR_PROP_FOOTPRINTS as Record<string, { w: number; h: number }>)[t] ?? { w: 1, h: 1 };

class Floor {
  /** 0 free, 1 furniture, 2 kept clear (way in), 3 rug only (walkable, may hold tables/chairs). */
  readonly cells: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    readonly door: number,
  ) {
    this.cells = new Uint8Array(w * h);
    this.cells[(h - 1) * w + door] = 2;
    this.cells[(h - 2) * w + door] = 2;
  }
  free(x: number, y: number, w = 1, h = 1): boolean {
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.cells[yy * this.w + xx] !== 0) return false;
    return true;
  }
  mark(x: number, y: number, w: number, h: number, v = 1): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.cells[yy * this.w + xx] = v;
  }
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

type Chair = { type: PropType; dx: number; dy: number };

/** Chair arrangements around a table (offsets from the table's top-left), each chair facing it. */
function chairPatterns(table: TableKind): Chair[][] {
  const left: Chair = { type: "chair_right", dx: -1, dy: 0 };
  const above = (dx: number): Chair => ({ type: "chair_down", dx, dy: -1 });
  const below = (dx: number): Chair => ({ type: "chair_up", dx, dy: 1 });
  switch (table) {
    case "table_round":
    case "table_round_meal":
      return [
        [left, { type: "chair_left", dx: 1, dy: 0 }],
        [above(0), below(0)],
        [left, { type: "chair_left", dx: 1, dy: 0 }, below(0)],
        [left, above(0)],
      ];
    case "table_long":
    case "table_long_meal":
      return [
        [above(0), above(2), below(1)],
        [below(0), below(2), above(1)],
        [left, { type: "chair_left", dx: 3, dy: 0 }, above(1)],
        [above(1), below(1)],
      ];
    case "writing_desk":
      return [[below(0)], [below(1)]];
  }
}

function attempt(spec: RoomSpec, plan: FurnishPlan, rng: Rng): MapData | null {
  const { w, h, door } = spec;
  const floor = new Floor(w, h, door);
  const placed: Placed[] = [];
  const rugs: Placed[] = [];
  const seatTiles: { x: number; y: number }[] = [];

  const put = (type: PropType, fx: number, fy: number, id?: string) => {
    const f = fp(type);
    floor.mark(fx, fy, f.w, f.h);
    placed.push({ type, fx, fy, id });
  };

  // North wall: one random slot each (the kitchen is a stove + counter block).
  const north: PropType[][] = plan.north.map((t) => [t]);
  if (plan.kitchen) north.push(rng.chance(0.5) ? ["stove", "kitchen_counter"] : ["kitchen_counter", "stove"]);
  for (const group of shuffle(rng, north)) {
    const width = group.reduce((n, t) => n + fp(t).w, 0);
    const height = Math.max(...group.map((t) => fp(t).h));
    const xs: number[] = [];
    for (let x = 0; x + width <= w; x++) if (floor.free(x, 0, width, height)) xs.push(x);
    if (xs.length === 0) return null;
    let x = rng.pick(xs);
    for (const t of group) {
      // Named pieces (the first bed, the hearth, the stove...) get stable ids; extras get numbered ones.
      const name = t.startsWith("bed_") ? "bed" : t === "stove" || t === "kitchen_counter" || t === "hearth" ? t : undefined;
      put(t, x, 0, name && !placed.some((p) => p.id === name) ? name : undefined);
      x += fp(t).w;
    }
  }

  // Table sets: table plus chairs facing it, a rug under it, a lamp by a chair.
  for (const set of plan.tables) {
    const tf = fp(set.table);
    const patterns = chairPatterns(set.table);
    const options: { x: number; y: number; chairs: Chair[] }[] = [];
    for (const chairs of patterns)
      for (let y = 1; y + tf.h <= h - 1; y++)
        for (let x = 0; x + tf.w <= w; x++) {
          if (!floor.free(x, y, tf.w, tf.h)) continue;
          // One free tile of air round the set so you can walk past it.
          if (!chairs.every((c) => floor.free(x + c.dx, y + c.dy))) continue;
          options.push({ x, y, chairs });
        }
    if (options.length === 0) return null;
    const o = rng.pick(options);
    put(set.table, o.x, o.y);
    for (const c of o.chairs) {
      put(c.type, o.x + c.dx, o.y + c.dy);
      seatTiles.push({ x: o.x + c.dx, y: o.y + c.dy });
    }
    if (set.rug) {
      const rf = fp(set.rug);
      const rugOpts: { x: number; y: number }[] = [];
      for (let y = Math.max(0, o.y - rf.h + 1); y <= o.y && y + rf.h <= h; y++)
        for (let x = Math.max(0, o.x + tf.w - rf.w); x <= o.x && x + rf.w <= w; x++) rugOpts.push({ x, y });
      if (rugOpts.length > 0) {
        const r = rng.pick(rugOpts);
        rugs.push({ type: set.rug, fx: r.x, fy: r.y });
      }
    }
    if (set.lamp) {
      const near: { x: number; y: number }[] = [];
      for (const s of seatTiles.slice(-o.chairs.length))
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if (floor.free(s.x + dx, s.y + dy)) near.push({ x: s.x + dx, y: s.y + dy });
      if (near.length > 0) {
        const l = rng.pick(near);
        put("floor_lamp", l.x, l.y);
      }
    }
  }

  // Wall things: any free tile touching a wall, never beside the door.
  for (const t of plan.wall) {
    const f = fp(t);
    const xs: { x: number; y: number }[] = [];
    for (let y = 0; y + f.h <= h; y++)
      for (let x = 0; x + f.w <= w; x++) {
        const touches = x === 0 || y === 0 || x + f.w === w || y + f.h === h;
        const byDoor = y + f.h === h && x <= door + 1 && x + f.w >= door;
        // A potted tree on the first row stands only before plain wall or a window (which moves away).
        const hides = y === 0 && PICTURE_HIDING_PROPS.has(t) && Array.from({ length: f.w }, (_, i) => spec.wallPattern?.[x + 1 + i] ?? "p").some((c) => !"pw".includes(c));
        if (touches && !byDoor && !hides && floor.free(x, y, f.w, f.h)) xs.push({ x, y });
      }
    if (xs.length === 0) return null;
    const p = rng.pick(xs);
    put(t, p.x, p.y);
  }

  if (plan.rug && rugs.length === 0) {
    const rf = fp(plan.rug);
    const opts: { x: number; y: number }[] = [];
    for (let y = 1; y + rf.h <= h - 1; y++) for (let x = 0; x + rf.w <= w; x++) if (floor.free(x, y, rf.w, rf.h)) opts.push({ x, y });
    if (opts.length > 0) {
      const r = rng.pick(opts);
      rugs.push({ type: plan.rug, fx: r.x, fy: r.y });
    }
  }

  // The resident's own spot: the NPC runner stands them on the corner between four tiles.
  let npc: NpcSpawn | null = null;
  if (plan.npc) {
    const spots: { x: number; y: number }[] = [];
    for (let y = 1; y + 2 <= h - 1; y++) for (let x = 0; x + 2 <= w; x++) if (floor.free(x, y, 2, 2)) spots.push({ x, y });
    if (spots.length === 0) return null;
    const pref = plan.npc.prefer;
    const d = (p: { x: number; y: number }) => (pref ? Math.hypot(p.x + 1 - pref.x * w, p.y + 1 - pref.y * h) : 0);
    const best = Math.min(...spots.map(d));
    const s = rng.pick(spots.filter((p) => d(p) <= best + 1.5));
    npc = { npcId: plan.npc.id, x: s.x, y: s.y, wander: plan.npc.wander };
  }

  // Wall hangings: over plain wall pieces with nothing tall standing in front.
  const hung: { type: PropType; x: number }[] = [];
  const tallAt = (fx: number) =>
    placed.some((p) => (NORTH_WALL_PROPS.has(p.type) || TALL_WALL_PROPS.has(p.type)) && p.fy === 0 && fx >= p.fx && fx < p.fx + fp(p.type).w);
  const plain = (mx: number) => mx >= 1 && mx <= w && "p".includes(spec.wallPattern?.[mx] ?? "p") && !tallAt(mx - 1) && !hung.some((d) => mx >= d.x && mx < d.x + fp(d.type).w);
  for (const t of plan.decor ?? []) {
    const dw = fp(t).w;
    const xs: number[] = [];
    for (let x = 1; x + dw <= w + 1; x++) if (Array.from({ length: dw }, (_, i) => plain(x + i)).every(Boolean)) xs.push(x);
    if (xs.length > 0) hung.push({ type: t, x: rng.pick(xs) });
  }

  // Tabletop things: one per free table tile.
  const tops: { type: PropType; fx: number; fy: number }[] = [];
  const surfaces: { x: number; y: number }[] = [];
  for (const p of placed) {
    // Meal tables already carry their food, and the writing desk its candle and papers.
    if (!["table_round", "table_long"].includes(p.type)) continue;
    for (let dx = 0; dx < fp(p.type).w; dx++) surfaces.push({ x: p.fx + dx, y: p.fy });
  }
  for (const t of plan.tabletop ?? []) {
    const free = surfaces.filter((s) => !tops.some((q) => q.fx === s.x && q.fy === s.y));
    if (free.length === 0) break;
    const s = rng.pick(free);
    tops.push({ type: t, fx: s.x, fy: s.y });
  }

  const room = new Room(spec);
  for (const r of rugs) room.put(r.type, r.fx, r.fy);
  for (const p of placed) room.put(p.type, p.fx, p.fy, p.id);
  for (const d of hung) room.hang(d.type, d.x);
  for (const t of tops) room.put(t.type, t.fx, t.fy);
  if (npc) room.npc(npc.npcId, npc.x, npc.y, npc.wander);
  const map = room.build();
  return layoutProblems(map).length === 0 ? map : null;
}

/** Furnishes a room shell by the plan; the seed picks every position. Throws if nothing fits. */
export function furnish(spec: RoomSpec, plan: FurnishPlan, seed: number): MapData {
  const rng = new Rng(seed);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const map = attempt(spec, plan, rng);
    if (map) return map;
  }
  throw new Error(`no sensible layout for ${spec.zone} (seed ${seed})`);
}

/** Stable 32-bit seed from an id ("house_pip"). */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
