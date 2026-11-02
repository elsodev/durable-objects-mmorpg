// Builds a MapData from a checked MapSpec with the seeded MapBuilder: paint the tiles, carve the
// rooms and passages, seal stray pockets, then place exits, spawns, monsters, rocks and decor the
// same way the hand-written maps do (so nothing lands in a wall or blocks a passage).
import { Ground, type MapData, type MapDropEntry, type Vec2 } from "../../types";
import { MapBuilder, type Rect } from "../builder";
import type { Anchor, BaseOre, Edge, ExitSpec, GroundName, MapSpec, RoomSpec } from "./spec";

const GROUND: Record<GroundName, Ground> = {
  void: Ground.Void,
  grass: Ground.Grass,
  dirt: Ground.Dirt,
  sand: Ground.Sand,
  water: Ground.Water,
  stone: Ground.Stone,
  wood: Ground.Wood,
  tilled: Ground.Tilled,
  cave_wall: Ground.CaveWall,
  wall: Ground.Wall,
};

/** Passages cut to an edge are this wide (two tiles reads as a way through, not a crack). */
const PASSAGE_W = 2;

/** Room interior kept off its ragged rim, for scatter. */
function inner(r: RoomSpec, shrink: number): Rect {
  const sx = Math.min(shrink, r.rx - 1);
  const sy = Math.min(shrink, r.ry - 1);
  return { x: r.x - r.rx + sx, y: r.y - r.ry + sy, w: Math.max(1, (r.rx - sx) * 2), h: Math.max(1, (r.ry - sy) * 2) };
}

interface EdgePassage {
  /** Waypoint where the passage meets the map edge (the path's last point). */
  end: Vec2;
  exit: Rect;
  /** Tile you arrive on, two tiles in from the edge. */
  spawn: Vec2;
}

/** The straight passage from a room's centre out through `edge`. */
export function edgePassage(edge: Edge, room: Pick<RoomSpec, "x" | "y">, width: number, height: number): EdgePassage {
  const { x, y } = room;
  switch (edge) {
    case "left":
      return { end: { x: 0, y }, exit: { x: 0, y, w: 1, h: PASSAGE_W }, spawn: { x: 2, y } };
    case "right":
      return { end: { x: width - PASSAGE_W, y }, exit: { x: width - 1, y, w: 1, h: PASSAGE_W }, spawn: { x: width - 3, y } };
    case "top":
      return { end: { x, y: 0 }, exit: { x, y: 0, w: PASSAGE_W, h: 1 }, spawn: { x, y: 2 } };
    case "bottom":
      return { end: { x, y: height - PASSAGE_W }, exit: { x, y: height - 1, w: PASSAGE_W, h: 1 }, spawn: { x, y: height - 3 } };
  }
}

/** Where to put the passage's sign: inside the room, toward the edge. */
function signSpot(edge: Edge, r: RoomSpec): Vec2 {
  const dx = edge === "left" ? -1 : edge === "right" ? 1 : 0;
  const dy = edge === "top" ? -1 : edge === "bottom" ? 1 : 0;
  // Beside the passage's line (it is reserved), a little in from the rim.
  return { x: r.x + dx * Math.max(1, r.rx - 3) + (dy !== 0 ? -2 : 0), y: r.y + dy * Math.max(1, r.ry - 3) + (dx !== 0 ? -2 : 0) };
}

function expandOres(ores: MapSpec["rocks"][number]["ores"]): BaseOre[] {
  const out: BaseOre[] = [];
  for (const [ore, w] of Object.entries(ores) as [BaseOre, number][]) for (let i = 0; i < w; i++) out.push(ore);
  return out;
}

const table = (t: readonly MapDropEntry[]): MapDropEntry[] => t.map((d) => ({ item: d.item, weight: d.weight, min: d.min, max: d.max }));

export function buildFromSpec(spec: MapSpec): MapData {
  const { width, height } = spec;
  const floor = GROUND[spec.floor];
  const fill = GROUND[spec.fill];
  const b = new MapBuilder(width, height, fill, spec.seed);
  const rooms = new Map(spec.rooms.map((r) => [r.id, r]));
  const room = (id: string) => rooms.get(id)!;
  const tileOf = (a: Anchor): Vec2 => ("room" in a ? { x: room(a.room).x, y: room(a.room).y } : { x: a.at[0], y: a.at[1] });

  // ---- ground ----
  if (spec.tiles) {
    const { legend, rows } = spec.tiles;
    rows.forEach((row, y) => [...row].forEach((ch, x) => b.set(x, y, GROUND[legend[ch]!])));
  }
  for (const r of spec.rooms) b.blob(r.x, r.y, r.rx, r.ry, floor, r.noise);
  const carve = [fill, floor];
  for (const t of spec.tunnels) {
    const a = room(t.from);
    const c = room(t.to);
    b.path([{ x: a.x, y: a.y }, { x: c.x, y: c.y }], t.width, floor, carve);
  }
  const passages = spec.exits.map((e) => ("edge" in e ? edgePassage(e.edge, room(e.room), width, height) : null));
  spec.exits.forEach((e, i) => {
    const pass = passages[i];
    if (pass && "room" in e) b.path([{ x: room(e.room).x, y: room(e.room).y }, pass.end], PASSAGE_W, floor, carve);
  });
  const home = tileOf(spec.spawns.default!);
  if (spec.ambient === "cave") b.sealUnreachable(home.x, home.y, fill);

  // ---- exits & spawns ----
  spec.exits.forEach((e: ExitSpec, i) => {
    const pass = passages[i];
    const rect: Rect = pass ? pass.exit : "rect" in e ? { x: e.rect[0], y: e.rect[1], w: e.rect[2], h: e.rect[3] } : { x: 0, y: 0, w: 1, h: 1 };
    const at = pass ? pass.spawn : "spawnAt" in e ? { x: e.spawnAt[0], y: e.spawnAt[1] } : { x: 0, y: 0 };
    b.exit(rect, e.to, e.arrive ?? `from_${spec.id}`, undefined, { ...(e.label ? { label: e.label } : {}), ...(e.back?.length ? { back: [...e.back] } : {}) });
    b.spawn(`from_${e.to}`, at.x, at.y);
    for (const z of e.back ?? []) b.spawn(`from_${z}`, at.x, at.y);
  });
  for (const [name, a] of Object.entries(spec.spawns)) {
    const t = tileOf(a);
    b.spawn(name, t.x, t.y);
  }

  // ---- placed props, then signs at each passage's mouth ----
  for (const p of spec.props) b.prop(p.type, p.at[0], p.at[1], { ...(p.id ? { id: p.id } : {}), ...(p.label ? { label: p.label } : {}) });
  spec.exits.forEach((e, i) => {
    if (!e.label || !("edge" in e)) return;
    const s = signSpot(e.edge, room(e.room));
    b.decorNear("sign_post", s.x, s.y, { id: `sign_${i + 1}`, label: e.label });
  });

  // ---- monsters (their camps are reserved, so rocks keep off them) ----
  for (const m of spec.monsters) {
    const t = tileOf(m.anchor);
    b.monster(m.type, t.x, t.y, m.radius, m.count, {
      level: m.level,
      tuning: { base: m.count, perPlayer: m.perPlayer, max: m.max, respawnMs: m.respawnSec * 1000, minPlayerDist: m.type === "bat" ? 8 : 5 },
    });
  }

  // ---- rocks and decoration ----
  spec.rocks.forEach((g, i) => b.scatterRocks(`r${i + 1}`, expandOres(g.ores), g.count, inner(room(g.room), 2), g.odds));
  for (const d of spec.decor) b.scatter(d.type, d.count, inner(room(d.room), 1), [floor]);

  const map = b.build({ zone: spec.id, name: spec.name, ambient: spec.ambient });
  if (spec.depth) map.depth = spec.depth;
  if (spec.chests > 0) map.chests = spec.chests;

  // ---- random drops ----
  const drops: NonNullable<MapData["drops"]> = {};
  if (spec.drops.kill) drops.kill = { chance: spec.drops.kill.chance, table: table(spec.drops.kill.table) };
  const g = spec.drops.ground;
  if (g) {
    const spots: Vec2[] = [];
    const seen = new Set<number>();
    for (const id of g.rooms) {
      const r = inner(room(id), 1);
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const k = y * width + x;
          if (seen.has(k) || !b.isOpen(x, y) || b.get(x, y) !== floor) continue;
          seen.add(k);
          spots.push({ x: x + 0.5, y: y + 0.5 });
        }
    }
    drops.ground = { spots, base: g.base, perPlayer: g.perPlayer, max: g.max, refillMs: g.refillSec * 1000, minPlayerDist: 4, table: table(g.table) };
  }
  if (drops.kill || drops.ground) map.drops = drops;
  return map;
}
