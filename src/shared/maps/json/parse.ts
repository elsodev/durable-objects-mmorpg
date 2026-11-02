// Checks a JSON map file and turns it into a MapSpec. Map files ship with the game, but a typo
// in one must fail loudly at load (and in tests) with the path to the bad field, not draw a
// broken cave. Only known fields are copied, numbers are range-checked, every name a field
// refers to (room, zone, item, prop) must exist.
import { getItem } from "../../items";
import { SHARED_ZONES, type ZoneId } from "../../types";
import { PROP_FOOTPRINTS, type PropType } from "../props";
import {
  EDGES,
  GROUND_NAMES,
  type Anchor,
  type DecorSpec,
  type DropEntrySpec,
  type Edge,
  type ExitSpec,
  type GroundName,
  type MapSpec,
  type MonsterGroupSpec,
  type PropSpec,
  type RockGroupSpec,
  type RoomSpec,
  type TileXY,
  type TunnelSpec,
} from "./spec";

export class MapSpecError extends Error {
  constructor(file: string, path: string, problem: string) {
    super(`${file}: ${path} ${problem}`);
    this.name = "MapSpecError";
  }
}

const MAX_SIDE = 160;
const MAX_LIST = 64;
const MONSTER_TYPES = ["slime", "bat", "rock_crab"] as const;
const BASE_ORES = ["stone", "copper", "iron", "gem"] as const;
const AMBIENTS = ["day", "cave", "indoor"] as const;
const ZONES: readonly string[] = [...SHARED_ZONES, "home"];
const NAME_RE = /^[a-z0-9_]{1,32}$/;

type Obj = Record<string, unknown>;

/** Field readers for one file; each throws a MapSpecError naming the field. */
class Reader {
  constructor(readonly file: string) {}

  fail(path: string, problem: string): never {
    throw new MapSpecError(this.file, path, problem);
  }

  obj(v: unknown, path: string): Obj {
    if (!v || typeof v !== "object" || Array.isArray(v)) this.fail(path, "must be an object");
    return v as Obj;
  }

  list(v: unknown, path: string, optional = true): unknown[] {
    if (v === undefined && optional) return [];
    if (!Array.isArray(v)) this.fail(path, "must be a list");
    if (v.length > MAX_LIST) this.fail(path, `has more than ${MAX_LIST} entries`);
    return v;
  }

  str(v: unknown, path: string, max = 64): string {
    if (typeof v !== "string" || v.length === 0 || v.length > max) this.fail(path, `must be a string of 1..${max} chars`);
    return v;
  }

  name(v: unknown, path: string): string {
    const s = this.str(v, path, 32);
    if (!NAME_RE.test(s)) this.fail(path, "must be lowercase letters, digits and _");
    return s;
  }

  num(v: unknown, path: string, min: number, max: number, int = false): number {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
      this.fail(path, `must be ${int ? "a whole number" : "a number"} in ${min}..${max}`);
    }
    return v;
  }

  opt<T>(v: unknown, read: (v: unknown) => T, fallback: T): T {
    return v === undefined ? fallback : read(v);
  }

  oneOf<T extends string>(v: unknown, path: string, options: readonly T[]): T {
    if (typeof v !== "string" || !options.includes(v as T)) this.fail(path, `must be one of ${options.join(", ")}`);
    return v as T;
  }

  zone(v: unknown, path: string): ZoneId {
    if (typeof v !== "string" || !ZONES.includes(v)) this.fail(path, `is not a known zone (${String(v)})`);
    return v as ZoneId;
  }

  tile(v: unknown, path: string, w: number, h: number): TileXY {
    if (!Array.isArray(v) || v.length !== 2) this.fail(path, "must be [x, y]");
    return [this.num(v[0], `${path}[0]`, 0, w - 1, true), this.num(v[1], `${path}[1]`, 0, h - 1, true)];
  }

  item(v: unknown, path: string): string {
    const id = this.str(v, path, 32);
    if (!getItem(id)) this.fail(path, `is not a known item (${id})`);
    return id;
  }

  prop(v: unknown, path: string): PropType {
    if (typeof v !== "string" || !Object.hasOwn(PROP_FOOTPRINTS, v)) this.fail(path, `is not a known prop (${String(v)})`);
    return v as PropType;
  }
}

/**
 * Validates one JSON map. `file` names it in errors. Throws MapSpecError on the first problem.
 * Links to other maps (exit spawns) are checked by checkMapLinks once every map is built.
 */
export function parseMapSpec(raw: unknown, file: string): MapSpec {
  const r = new Reader(file);
  const o = r.obj(raw, "map");
  const width = r.num(o.width, "width", 8, MAX_SIDE, true);
  const height = r.num(o.height, "height", 8, MAX_SIDE, true);
  const ground = (v: unknown, path: string): GroundName => r.oneOf(v, path, GROUND_NAMES);

  const tiles = o.tiles === undefined ? undefined : parseTiles(r, o.tiles, width, height);

  const rooms: RoomSpec[] = r.list(o.rooms, "rooms").map((v, i) => {
    const p = `rooms[${i}]`;
    const room = r.obj(v, p);
    return {
      id: r.name(room.id, `${p}.id`),
      x: r.num(room.x, `${p}.x`, 1, width - 2, true),
      y: r.num(room.y, `${p}.y`, 1, height - 2, true),
      rx: r.num(room.rx, `${p}.rx`, 1, width / 2, true),
      ry: r.num(room.ry, `${p}.ry`, 1, height / 2, true),
      noise: r.opt(room.noise, (n) => r.num(n, `${p}.noise`, 0, 0.6), 0.3),
    };
  });
  const roomIds = new Set<string>();
  for (const [i, room] of rooms.entries()) {
    if (roomIds.has(room.id)) r.fail(`rooms[${i}].id`, `repeats "${room.id}"`);
    roomIds.add(room.id);
  }
  const roomRef = (v: unknown, path: string): string => {
    const id = r.name(v, path);
    if (!roomIds.has(id)) r.fail(path, `names no room (${id})`);
    return id;
  };
  const anchor = (v: Obj, path: string): Anchor =>
    v.room !== undefined ? { room: roomRef(v.room, `${path}.room`) } : { at: r.tile(v.at, `${path}.at`, width, height) };

  const tunnels: TunnelSpec[] = r.list(o.tunnels, "tunnels").map((v, i) => {
    const p = `tunnels[${i}]`;
    const t = r.obj(v, p);
    return { from: roomRef(t.from, `${p}.from`), to: roomRef(t.to, `${p}.to`), width: r.opt(t.width, (n) => r.num(n, `${p}.width`, 1, 4, true), 2) };
  });

  const exits: ExitSpec[] = r.list(o.exits, "exits").map((v, i) => parseExit(r, v, `exits[${i}]`, width, height, roomRef));

  const spawnsObj = r.obj(o.spawns, "spawns");
  const spawns: Record<string, Anchor> = {};
  for (const [name, v] of Object.entries(spawnsObj)) spawns[r.name(name, `spawns key`)] = anchor(r.obj(v, `spawns.${name}`), `spawns.${name}`);
  if (!spawns.default) r.fail("spawns", "needs a default");

  const monsters: MonsterGroupSpec[] = r.list(o.monsters, "monsters").map((v, i) => {
    const p = `monsters[${i}]`;
    const m = r.obj(v, p);
    const count = r.num(m.count, `${p}.count`, 1, 12, true);
    return {
      anchor: anchor(m, p),
      type: r.oneOf(m.type, `${p}.type`, MONSTER_TYPES),
      count,
      max: r.opt(m.max, (n) => r.num(n, `${p}.max`, count, 20, true), count * 2),
      perPlayer: r.opt(m.perPlayer, (n) => r.num(n, `${p}.perPlayer`, 0, 3), 0.5),
      radius: r.opt(m.radius, (n) => r.num(n, `${p}.radius`, 1, 16, true), 4),
      level: r.opt(m.level, (n) => r.num(n, `${p}.level`, 1, 4, true), 1),
      respawnSec: r.opt(m.respawnSec, (n) => r.num(n, `${p}.respawnSec`, 5, 600), 35),
    };
  });

  const rocks: RockGroupSpec[] = r.list(o.rocks, "rocks").map((v, i) => {
    const p = `rocks[${i}]`;
    const g = r.obj(v, p);
    const oresObj = r.obj(g.ores, `${p}.ores`);
    const ores: RockGroupSpec["ores"] = {};
    for (const [ore, w] of Object.entries(oresObj)) ores[r.oneOf(ore, `${p}.ores key`, BASE_ORES)] = r.num(w, `${p}.ores.${ore}`, 0, 100, true);
    if (!Object.values(ores).some((w) => w > 0)) r.fail(`${p}.ores`, "needs a weight above 0");
    const out: RockGroupSpec = { room: roomRef(g.room, `${p}.room`), count: r.num(g.count, `${p}.count`, 1, 40, true), ores };
    if (g.odds !== undefined) {
      const odds = r.obj(g.odds, `${p}.odds`);
      const chance = (k: string) => r.opt(odds[k], (n) => r.num(n, `${p}.odds.${k}`, 0, 0.5), 0);
      out.odds = { silver: chance("silver"), gold: chance("gold"), diamond: chance("diamond") };
    }
    return out;
  });

  const props: PropSpec[] = r.list(o.props, "props").map((v, i) => {
    const p = `props[${i}]`;
    const pr = r.obj(v, p);
    const out: PropSpec = { type: r.prop(pr.type, `${p}.type`), at: r.tile(pr.at, `${p}.at`, width, height) };
    if (pr.id !== undefined) out.id = r.name(pr.id, `${p}.id`);
    if (pr.label !== undefined) out.label = r.str(pr.label, `${p}.label`, 40);
    return out;
  });

  const decor: DecorSpec[] = r.list(o.decor, "decor").map((v, i) => {
    const p = `decor[${i}]`;
    const d = r.obj(v, p);
    return { type: r.prop(d.type, `${p}.type`), room: roomRef(d.room, `${p}.room`), count: r.num(d.count, `${p}.count`, 1, 40, true) };
  });

  const spec: MapSpec = {
    id: r.zone(o.id, "id"),
    name: r.str(o.name, "name", 48),
    width,
    height,
    seed: r.num(o.seed, "seed", 0, 0xffffffff, true),
    ambient: r.opt(o.ambient, (v) => r.oneOf(v, "ambient", AMBIENTS), "cave"),
    fill: r.opt(o.fill, (v) => ground(v, "fill"), "cave_wall"),
    floor: r.opt(o.floor, (v) => ground(v, "floor"), "stone"),
    rooms,
    tunnels,
    exits,
    spawns,
    monsters,
    rocks,
    props,
    decor,
    chests: r.opt(o.chests, (n) => r.num(n, "chests", 0, 8, true), 0),
    drops: parseDrops(r, o.drops, roomRef),
  };
  if (o.depth !== undefined) spec.depth = r.num(o.depth, "depth", 1, 9, true);
  if (tiles) spec.tiles = tiles;
  if (!tiles && rooms.length === 0) r.fail("rooms", "needs at least one room (or tiles)");
  return spec;
}

function parseTiles(r: Reader, v: unknown, width: number, height: number): NonNullable<MapSpec["tiles"]> {
  const t = r.obj(v, "tiles");
  const legendObj = r.obj(t.legend, "tiles.legend");
  const legend: Record<string, GroundName> = {};
  for (const [ch, g] of Object.entries(legendObj)) {
    if ([...ch].length !== 1) r.fail("tiles.legend", `keys must be one character ("${ch}")`);
    legend[ch] = r.oneOf(g, `tiles.legend.${ch}`, GROUND_NAMES);
  }
  if (!Array.isArray(t.rows) || t.rows.length !== height) r.fail("tiles.rows", `must be ${height} rows`);
  const rows = t.rows.map((row, y) => {
    if (typeof row !== "string" || [...row].length !== width) r.fail(`tiles.rows[${y}]`, `must be ${width} characters`);
    for (const ch of row) if (!Object.hasOwn(legend, ch)) r.fail(`tiles.rows[${y}]`, `uses "${ch}", which the legend lacks`);
    return row;
  });
  return { legend, rows };
}

function parseExit(r: Reader, v: unknown, p: string, width: number, height: number, roomRef: (v: unknown, path: string) => string): ExitSpec {
  const e = r.obj(v, p);
  const base: { to: ZoneId; arrive?: string; label?: string; back?: ZoneId[] } = { to: r.zone(e.to, `${p}.to`) };
  if (e.arrive !== undefined) base.arrive = r.name(e.arrive, `${p}.arrive`);
  if (e.label !== undefined) base.label = r.str(e.label, `${p}.label`, 40);
  if (e.back !== undefined) base.back = r.list(e.back, `${p}.back`).map((z, i) => r.zone(z, `${p}.back[${i}]`));
  if (e.edge !== undefined) return { ...base, edge: r.oneOf<Edge>(e.edge, `${p}.edge`, EDGES), room: roomRef(e.room, `${p}.room`) };
  if (e.ladder !== undefined) {
    const anchor: Anchor = e.room !== undefined ? { room: roomRef(e.room, `${p}.room`) } : { at: r.tile(e.at, `${p}.at`, width, height) };
    const shift = (v: unknown, k: string) => r.opt(v, (n) => r.num(n, `${p}.${k}`, -12, 12, true), 0);
    return { ...base, ladder: r.oneOf(e.ladder, `${p}.ladder`, ["up", "down"] as const), anchor, dx: shift(e.dx, "dx"), dy: shift(e.dy, "dy") };
  }
  if (!Array.isArray(e.rect) || e.rect.length !== 4) r.fail(`${p}`, "needs edge + room, ladder + room/at, or rect [x, y, w, h] + spawnAt");
  const [x, y, w, h] = e.rect.map((n, i) => r.num(n, `${p}.rect[${i}]`, i < 2 ? 0 : 1, MAX_SIDE, true)) as [number, number, number, number];
  if (x + w > width || y + h > height) r.fail(`${p}.rect`, "runs off the map");
  return { ...base, rect: [x, y, w, h], spawnAt: r.tile(e.spawnAt, `${p}.spawnAt`, width, height) };
}

function parseDropTable(r: Reader, v: unknown, p: string): DropEntrySpec[] {
  const table = r.list(v, p, false).map((x, i) => {
    const q = `${p}[${i}]`;
    const d = r.obj(x, q);
    const min = r.opt(d.min, (n) => r.num(n, `${q}.min`, 1, 20, true), 1);
    return { item: r.item(d.item, `${q}.item`), weight: r.num(d.weight, `${q}.weight`, 0, 1000), min, max: r.opt(d.max, (n) => r.num(n, `${q}.max`, min, 20, true), min) };
  });
  if (!table.some((d) => d.weight > 0)) r.fail(p, "needs an entry with weight above 0");
  return table;
}

function parseDrops(r: Reader, v: unknown, roomRef: (v: unknown, path: string) => string): MapSpec["drops"] {
  if (v === undefined) return {};
  const o = r.obj(v, "drops");
  const out: MapSpec["drops"] = {};
  if (o.kill !== undefined) {
    const k = r.obj(o.kill, "drops.kill");
    out.kill = { chance: r.num(k.chance, "drops.kill.chance", 0, 1), table: parseDropTable(r, k.table, "drops.kill.table") };
  }
  if (o.ground !== undefined) {
    const g = r.obj(o.ground, "drops.ground");
    const base = r.num(g.base, "drops.ground.base", 0, 20, true);
    out.ground = {
      rooms: r.list(g.rooms, "drops.ground.rooms", false).map((x, i) => roomRef(x, `drops.ground.rooms[${i}]`)),
      base,
      perPlayer: r.opt(g.perPlayer, (n) => r.num(n, "drops.ground.perPlayer", 0, 5), 0.5),
      max: r.opt(g.max, (n) => r.num(n, "drops.ground.max", base, 30, true), base * 2),
      refillSec: r.opt(g.refillSec, (n) => r.num(n, "drops.ground.refillSec", 30, 3600), 300),
      table: parseDropTable(r, g.table, "drops.ground.table"),
    };
  }
  return out;
}
