import { describe, expect, it } from "vitest";
import { getMap } from "../src/shared/maps";
import { CAVE_LEVEL_FILES, CAVE_MAX_DEPTH, CAVE_WINGS } from "../src/shared/maps/cave-levels";
import { buildFromSpec, checkMapLinks, loadJsonMap, MapSpecError, parseMapSpec } from "../src/shared/maps/json";
import { caveDepth, caveLevelLabel, caveLevelOf, noteCaveArrival, sanitizeCaveTrail } from "../src/shared/caveLevels";
import { levelStats, MONSTER_STATS } from "../src/shared/engine";
import { mergeLoot, rollDropEntry, rollKillDrop } from "../src/shared/engine/mapDrops";
import { rockOreAt } from "../src/shared/engine/rockOres";
import { arrivedFrom, routeExit } from "../src/worker/game/spawn";
import { isZoneId } from "../src/worker/game/sanitize";
import { ForageGrower } from "../src/worker/game/forage";
import { GroundItems } from "../src/worker/game/groundItems";
import { MonsterPool } from "../src/worker/game/monsterPool";
import { buildCollision } from "../src/shared/engine";
import { BLOCKING_GROUND, CAVE_DEPTH_ZONES, Ground, type MapData, type MapExit, type ZoneId } from "../src/shared/types";

/** Feeds a fixed sequence of rolls (then repeats the last). */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)]!;
};

const tiny = (extra: Record<string, unknown> = {}) => ({
  id: "caves_2_left",
  name: "Test Cave",
  width: 24,
  height: 20,
  seed: 7,
  rooms: [
    { id: "a", x: 12, y: 15, rx: 4, ry: 2 },
    { id: "b", x: 12, y: 7, rx: 8, ry: 5 },
  ],
  tunnels: [{ from: "a", to: "b" }],
  exits: [
    { edge: "bottom", room: "a", to: "caves", label: "↓ Up" },
    { edge: "left", room: "b", to: "caves_3_left" },
  ],
  spawns: { default: { room: "a" } },
  monsters: [{ room: "b", type: "slime", count: 2, level: 2 }],
  rocks: [{ room: "b", count: 3, ores: { iron: 1 } }],
  ...extra,
});

/** 4-connected flood from a tile over open ground, with props and rocks blocking. */
function reachable(map: MapData, from: { x: number; y: number }, rocksBlock = true): Uint8Array {
  const block = new Uint8Array(map.width * map.height);
  map.ground.forEach((g, i) => (block[i] = BLOCKING_GROUND.has(g) ? 1 : 0));
  for (const p of map.props) if (!p.walkable) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) block[y * map.width + x] = 1;
  if (rocksBlock) for (const r of map.rocks ?? []) block[r.y * map.width + r.x] = 1;
  const seen = new Uint8Array(map.width * map.height);
  const start = Math.floor(from.y) * map.width + Math.floor(from.x);
  const q = [start];
  seen[start] = 1;
  for (let i = 0; i < q.length; i++) {
    const x = q[i]! % map.width;
    const y = (q[i]! - x) / map.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const j = ny * map.width + nx;
      if (seen[j] || block[j]) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

describe("parseMapSpec", () => {
  it("fills defaults and keeps only known fields", () => {
    const spec = parseMapSpec({ ...tiny(), sneaky: 1 }, "t.json");
    expect(spec.ambient).toBe("cave");
    expect(spec.fill).toBe("cave_wall");
    expect(spec.monsters[0]).toMatchObject({ type: "slime", count: 2, max: 4, level: 2, radius: 4 });
    expect(spec.rooms[0]!.noise).toBe(0.3);
    expect("sneaky" in spec).toBe(false);
  });

  it.each([
    ["an unknown zone", { exits: [{ edge: "left", room: "a", to: "moon" }] }, /exits\[0\]\.to is not a known zone/],
    ["an unknown room", { tunnels: [{ from: "a", to: "zz" }] }, /tunnels\[0\]\.to names no room/],
    ["a repeated room", { rooms: [{ id: "a", x: 5, y: 5, rx: 2, ry: 2 }, { id: "a", x: 9, y: 9, rx: 2, ry: 2 }] }, /rooms\[1\]\.id repeats/],
    ["no default spawn", { spawns: { other: { room: "a" } } }, /spawns needs a default/],
    ["an unknown monster", { monsters: [{ room: "a", type: "dragon", count: 1 }] }, /monsters\[0\]\.type must be one of/],
    ["too many monsters", { monsters: [{ room: "a", type: "bat", count: 99 }] }, /monsters\[0\]\.count/],
    ["a room off the map", { rooms: [{ id: "a", x: 40, y: 5, rx: 2, ry: 2 }] }, /rooms\[0\]\.x/],
    ["an unknown item", { drops: { kill: { chance: 0.5, table: [{ item: "unobtainium", weight: 1 }] } } }, /drops\.kill\.table\[0\]\.item is not a known item/],
    ["an empty drop table", { drops: { kill: { chance: 0.5, table: [{ item: "stone", weight: 0 }] } } }, /needs an entry with weight above 0/],
    ["a bad ore", { rocks: [{ room: "a", count: 2, ores: { mithril: 1 } }] }, /rocks\[0\]\.ores key/],
    ["an exit with no place", { exits: [{ to: "caves" }] }, /needs edge \+ room, ladder \+ room\/at, or rect/],
    ["an unknown prop", { props: [{ type: "spaceship", at: [3, 3] }] }, /props\[0\]\.type is not a known prop/],
  ])("rejects %s, naming the field", (_what, patch, msg) => {
    expect(() => parseMapSpec(tiny(patch), "t.json")).toThrow(MapSpecError);
    expect(() => parseMapSpec(tiny(patch), "t.json")).toThrow(msg);
  });

  it("rejects a file that isn't an object, and a wrong id for its slot", () => {
    expect(() => parseMapSpec([], "t.json")).toThrow(/map must be an object/);
    expect(() => loadJsonMap(tiny(), "t.json", "caves_3_top")).toThrow(/expected "caves_3_top"/);
  });

  it("checks painted tiles against the size and the legend", () => {
    const legend = { "#": "wall", ".": "wood" };
    const rows = (n: number, w: number) => Array.from({ length: n }, () => "#".repeat(w));
    expect(() => parseMapSpec(tiny({ rooms: [], tiles: { legend, rows: rows(19, 24) } }), "t.json")).toThrow(/tiles\.rows must be 20 rows/);
    expect(() => parseMapSpec(tiny({ rooms: [], tiles: { legend, rows: rows(20, 23) } }), "t.json")).toThrow(/tiles\.rows\[0\] must be 24/);
    const bad = rows(20, 24);
    bad[3] = "#".repeat(23) + "x";
    expect(() => parseMapSpec(tiny({ rooms: [], tiles: { legend, rows: bad } }), "t.json")).toThrow(/uses "x"/);
  });
});

describe("buildFromSpec", () => {
  it("carves rooms, passages to the edges, spawns just inside, and keeps things out of walls", () => {
    const map = loadJsonMap(tiny(), "t.json");
    expect([map.width, map.height]).toEqual([24, 20]);
    const left = map.exits.find((e) => e.to === "caves_3_left")!;
    expect(left).toMatchObject({ x: 0, w: 1, h: 2, spawn: "from_caves_2_left" });
    expect(map.exits.find((e) => e.to === "caves")).toMatchObject({ y: 19, w: 2, h: 1, label: "↓ Up" });
    expect(map.spawns.from_caves_3_left).toEqual({ x: 2.5, y: left.y + 0.5 });
    const seen = reachable(map, map.spawns.default!);
    for (const e of map.exits) expect(seen[e.y * map.width + e.x], `exit ${e.to}`).toBe(1);
    for (const m of map.monsters) {
      expect(map.ground[Math.floor(m.y) * map.width + Math.floor(m.x)]).toBe(Ground.Stone);
      expect(m.level).toBe(2);
      expect(m.tuning).toMatchObject({ base: 2, max: 4 });
    }
    expect(map.rocks?.length).toBeGreaterThan(0);
  });

  it("paints exact tiles and fixed doorways, for interiors", () => {
    const rows = ["##########", ...Array.from({ length: 7 }, () => "#........#"), "####.#####", "##########"];
    const map = loadJsonMap(
      {
        id: "int_inn",
        name: "Painted Room",
        width: 10,
        height: 10,
        seed: 1,
        ambient: "indoor",
        floor: "wood",
        tiles: { legend: { "#": "wall", ".": "wood" }, rows },
        exits: [{ rect: [4, 8, 1, 1], spawnAt: [4, 6], to: "village", arrive: "from_int_inn" }],
        spawns: { default: { at: [4, 5] } },
        props: [{ type: "table_round", at: [2, 2] }],
      },
      "room.json",
    );
    expect(map.ground[0]).toBe(Ground.Wall);
    expect(map.ground[8 * 10 + 4]).toBe(Ground.Wood);
    expect(map.ground[5 * 10 + 5]).toBe(Ground.Wood);
    expect(map.exits[0]).toMatchObject({ x: 4, y: 8, to: "village", spawn: "from_int_inn" });
    expect(map.spawns.from_village).toEqual({ x: 4.5, y: 6.5 });
    expect(map.props.some((p) => p.type === "table_round")).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const a = buildFromSpec(parseMapSpec(tiny(), "t.json"));
    const b = buildFromSpec(parseMapSpec(tiny(), "t.json"));
    expect(a).toEqual(b);
  });
});

describe("the shipped cave levels", () => {
  const all: MapData[] = ["caves" as const, ...CAVE_DEPTH_ZONES].map((z) => getMap(z));

  it.each(CAVE_DEPTH_ZONES)("%s loads from its own JSON file and declares its depth", (zone) => {
    const map = loadJsonMap(CAVE_LEVEL_FILES[zone], `${zone}.json`, zone);
    const level = caveLevelOf(zone)!;
    expect(map.depth).toBe(level.depth);
    expect(map.ambient).toBe("cave");
    // Monsters scale with depth; every map hunts something and holds ore.
    expect(map.monsters.length).toBeGreaterThan(0);
    for (const m of map.monsters) expect(m.level).toBe(level.depth);
    expect(map.rocks?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(map.drops?.kill?.table.length).toBeGreaterThan(0);
    expect(map.drops?.ground?.spots.length).toBeGreaterThan(10);
  });

  it.each(CAVE_DEPTH_ZONES)("%s: ladders lead one level down per wing, and one climbs back up", (zone) => {
    const map = getMap(zone);
    const { depth, wing } = caveLevelOf(zone)!;
    const up = map.exits.filter((e) => e.climb === "up");
    expect(up.length).toBe(1);
    const above = depth === 2 ? "caves" : `caves_${depth - 1}_${wing}`;
    expect(up[0]!.to).toBe(above);
    // The ladder leans on a wall: the two tiles above it are wall.
    for (const dy of [1, 2]) expect(BLOCKING_GROUND.has(map.ground[(up[0]!.y - dy) * map.width + up[0]!.x]!)).toBe(true);
    expect(map.props.some((p) => p.type === "ladder" && p.x === up[0]!.x && p.y === up[0]!.y)).toBe(true);
    if (depth > 2) expect([...up[0]!.back!].sort()).toEqual(CAVE_WINGS.filter((w) => w !== wing).map((w) => `caves_${depth - 1}_${w}`).sort());
    const down = map.exits.filter((e) => e.climb === "down");
    expect(down.length + up.length).toBe(map.exits.length);
    if (depth === CAVE_MAX_DEPTH) expect(down).toEqual([]);
    else {
      // Each hole sits on the side of the map its wing is named for.
      const sideOf = (e: MapExit) => (e.x < map.width / 3 ? "left" : e.x > (map.width * 2) / 3 ? "right" : e.y < map.height / 3 ? "top" : "?");
      expect(Object.fromEntries(down.map((e) => [sideOf(e), e.to]))).toEqual(Object.fromEntries(CAVE_WINGS.map((w) => [w, `caves_${depth + 1}_${w}`])));
      for (const e of down) {
        expect(e.label).toMatch(new RegExp(`Depth ${depth + 1}`));
        expect(map.props.find((p) => p.x === e.x && p.y === e.y)).toMatchObject({ type: "ladder_hole", walkable: true });
      }
    }
  });

  it.each(CAVE_DEPTH_ZONES)("%s: monsters, rocks and floor finds stand on open floor, all reachable", (zone) => {
    const map = getMap(zone);
    const seen = reachable(map, map.spawns.default!);
    const at = (x: number, y: number) => Math.floor(y) * map.width + Math.floor(x);
    for (const m of map.monsters) {
      expect(map.ground[at(m.x, m.y)], `${m.type} in a wall`).toBe(Ground.Stone);
      expect(seen[at(m.x, m.y)], `${m.type} camp reachable`).toBe(1);
    }
    const open = reachable(map, map.spawns.default!, false);
    for (const r of map.rocks ?? []) {
      expect(map.ground[at(r.x, r.y)]).toBe(Ground.Stone);
      expect(open[at(r.x, r.y)], `${r.id} reachable`).toBe(1);
      expect(r.odds).toBeDefined();
    }
    for (const s of map.drops!.ground!.spots) expect(seen[at(s.x, s.y)], `spot ${s.x},${s.y}`).toBe(1);
    // No walkable pocket is cut off from the way in.
    const underProp = new Set<number>();
    for (const p of map.props) if (!p.walkable) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) underProp.add(y * map.width + x);
    map.ground.forEach((g, i) => {
      if (!BLOCKING_GROUND.has(g) && !underProp.has(i)) expect(open[i], `pocket at ${i % map.width},${Math.floor(i / map.width)}`).toBe(1);
    });
  });

  it("every exit lands on a real spawn, and every shared way up has a spawn to return to", () => {
    expect(checkMapLinks(all, (id) => getMap(id))).toEqual([]);
  });

  it("every level map can be reached from the caves, four levels deep at most", () => {
    const depth = new Map<ZoneId, number>([["caves", 1]]);
    const queue: ZoneId[] = ["caves"];
    while (queue.length) {
      const z = queue.shift()!;
      for (const e of getMap(z).exits) {
        if (!e.to.startsWith("caves") || depth.has(e.to)) continue;
        depth.set(e.to, depth.get(z)! + 1);
        queue.push(e.to);
      }
    }
    for (const z of CAVE_DEPTH_ZONES) expect(depth.get(z), z).toBe(caveLevelOf(z)!.depth);
    expect(Math.max(...depth.values())).toBe(CAVE_MAX_DEPTH);
  });

  it("deeper levels pay better: kill drops come more often", () => {
    for (const wing of CAVE_WINGS) {
      const chances = [2, 3, 4].map((d) => getMap(`caves_${d}_${wing}` as ZoneId).drops!.kill!.chance);
      expect(chances).toEqual([...chances].sort((a, b) => a - b));
      expect(chances[2]).toBeGreaterThan(chances[0]!);
    }
  });

  it("level 1 has a ladder down to each level-2 wing", () => {
    const caves = getMap("caves");
    for (const w of CAVE_WINGS) {
      const e = caves.exits.find((x) => x.to === `caves_2_${w}`)!;
      expect(e, w).toBeDefined();
      expect(e.climb).toBe("down");
      expect(e.spawn).toBe("from_caves");
      expect(caves.spawns[`from_caves_2_${w}`]).toBeDefined();
    }
  });
});

describe("drop tables", () => {
  const table = [
    { item: "ore_iron", weight: 3, min: 1, max: 3 },
    { item: "gem_crystal", weight: 1, min: 2, max: 2 },
  ];

  it("picks by weight and rolls qty in range", () => {
    expect(rollDropEntry(table, seq(0, 0))).toEqual({ item: "ore_iron", qty: 1 });
    expect(rollDropEntry(table, seq(0.5, 0.99))).toEqual({ item: "ore_iron", qty: 3 });
    expect(rollDropEntry(table, seq(0.8, 0))).toEqual({ item: "gem_crystal", qty: 2 });
    expect(rollDropEntry([], seq(0))).toBeNull();
  });

  it("a kill rolls the chance first", () => {
    const drops = { kill: { chance: 0.25, table } };
    expect(rollKillDrop(drops, seq(0.3))).toBeNull();
    expect(rollKillDrop(drops, seq(0.1, 0.9, 0))).toEqual({ item: "gem_crystal", qty: 2 });
    expect(rollKillDrop(undefined, seq(0))).toBeNull();
    // DROP_RATE_MONSTER scales the chance.
    expect(rollKillDrop(drops, seq(0.3, 0, 0), { global: 1, monster: 2 })).toEqual({ item: "ore_iron", qty: 1 });
  });

  it("merges the extra into the kill's loot", () => {
    expect(mergeLoot([{ item: "ore_iron", qty: 1 }], { item: "ore_iron", qty: 2 })).toEqual([{ item: "ore_iron", qty: 3 }]);
    expect(mergeLoot([{ item: "bat_wing", qty: 1 }], { item: "ore_iron", qty: 2 })).toHaveLength(2);
    expect(mergeLoot([], null)).toEqual([]);
  });

  it("rocks of JSON maps use their own odds", () => {
    const rock = { id: "r1_1", ore: "iron" as const, odds: { silver: 0, gold: 0, diamond: 1 } };
    expect(rockOreAt(rock, "caves_4_top", 0)).toBe("diamond");
    expect(rockOreAt({ id: "r1_1", ore: "iron" }, "caves_4_top", 0)).toBe("iron");
  });
});

describe("a cave level's zone", () => {
  const map = getMap("caves_4_left");
  const grid = buildCollision(map, { rocks: map.rocks ?? [] });

  it("grows floor finds from the map's own table, in its rooms, stacks in range", () => {
    const grower = ForageGrower.forZone("caves_4_left", map, grid)!;
    expect(grower).not.toBeNull();
    const ground = new GroundItems();
    let i = 0;
    const rand = () => [0.13, 0.71, 0.42, 0.97, 0.05, 0.6][i++ % 6]!;
    const grown = grower.refill(ground, [], 0, rand);
    expect(grown.length).toBe(map.drops!.ground!.base);
    const table = map.drops!.ground!.table;
    for (const g of grown) {
      const row = table.find((t) => t.item === g.item)!;
      expect(row, g.item).toBeDefined();
      expect(g.qty).toBeGreaterThanOrEqual(row.min);
      expect(g.qty).toBeLessThanOrEqual(row.max);
      expect(g.owner).toBeNull();
    }
    // Not again until the refill time.
    expect(grower.refill(ground, [], 1000, rand)).toEqual([]);
  });

  it("spawns its monsters at their level, with the map's own spawn tuning", () => {
    const pool = new MonsterPool(map, grid, () => 0.5, "caves_4_left", 0);
    const alive = pool.alive();
    expect(alive.length).toBe(map.monsters.reduce((n, m) => n + m.count, 0));
    for (const m of alive) {
      expect(m.level).toBe(4);
      expect(m.maxHp).toBe(levelStats(m.type, 4).hp);
    }
  });
});

describe("monster levels", () => {
  it("level 1 is the base stats; each level adds hp and bite, armour every other level", () => {
    for (const t of ["slime", "bat", "rock_crab"] as const) {
      const base = MONSTER_STATS[t];
      expect(levelStats(t, 1)).toEqual({ hp: base.hp, damage: base.damage, defense: base.defense });
      expect(levelStats(t)).toEqual(levelStats(t, 1));
    }
    expect(levelStats("rock_crab", 4)).toEqual({ hp: 95, damage: 14, defense: 4 });
    expect(levelStats("slime", 3)).toEqual({ hp: 32, damage: 6, defense: 2 });
  });
});

describe("the way back up", () => {
  const up: MapExit = { x: 0, y: 0, w: 2, h: 1, to: "caves_2_left", spawn: "from_caves_3_left", back: ["caves_2_top", "caves_2_right"] };

  it("returns you to the map you came down from when it shares this way up", () => {
    expect(routeExit(up, "caves_3_left", "caves_2_top")).toMatchObject({ to: "caves_2_top", spawn: "from_caves_3_left" });
    expect(routeExit(up, "caves_3_left", "caves_2_left")).toBe(up);
    expect(routeExit(up, "caves_3_left", undefined)).toBe(up);
    expect(routeExit(up, "caves_3_left", "village")).toBe(up);
  });

  it("remembers the map above only when you came down into a level", () => {
    const t0 = {};
    const t1 = noteCaveArrival(t0, "caves_3_left", "caves_2_top");
    expect(t1).toEqual({ caves_3_left: "caves_2_top" });
    // Coming back up from below, or warping in, keeps what was there.
    expect(noteCaveArrival(t1, "caves_3_left", "caves_4_right")).toBe(t1);
    expect(noteCaveArrival(t1, "caves_3_left", undefined)).toBe(t1);
    expect(noteCaveArrival(t1, "caves", "quarry")).toBe(t1);
    expect(noteCaveArrival(t1, "caves_2_left", "caves")).toEqual({ caves_3_left: "caves_2_top", caves_2_left: "caves" });
  });

  it("keeps only cave levels one apart from a stored trail", () => {
    expect(sanitizeCaveTrail({ caves_3_left: "caves_2_top", caves_2_top: "caves", caves_4_top: "caves_2_top", village: "caves", caves_3_top: 5 })).toEqual({
      caves_3_left: "caves_2_top",
      caves_2_top: "caves",
    });
    expect(sanitizeCaveTrail(null)).toEqual({});
    expect(sanitizeCaveTrail(["x"])).toEqual({});
    expect([caveDepth("caves"), caveDepth("caves_4_top"), caveDepth("village")]).toEqual([1, 4, 0]);
  });

  it("reads the zone you came from only off an honoured from_<zone> spawn", () => {
    expect(arrivedFrom("from_caves_2_top", true, isZoneId)).toBe("caves_2_top");
    expect(arrivedFrom("from_caves_2_top", false, isZoneId)).toBeUndefined();
    expect(arrivedFrom("default", true, isZoneId)).toBeUndefined();
    expect(arrivedFrom("from_nowhere", true, isZoneId)).toBeUndefined();
  });
});

describe("cave level names", () => {
  it("labels the deeper levels and nothing else", () => {
    expect(caveLevelLabel("caves_3_left")).toBe("Caves, depth 3 west");
    expect(caveLevelLabel("caves_2_top")).toBe("Caves, depth 2 north");
    expect(caveLevelLabel("caves")).toBeNull();
    expect(caveLevelOf("caves_4_right")).toEqual({ depth: 4, wing: "right" });
  });
});
