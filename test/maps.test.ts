import { describe, expect, it } from "vitest";
import { getMap, mapToAscii, PROP_FOOTPRINTS } from "../src/shared/maps";
import { buildCaves } from "../src/shared/maps/caves";
import { buildHome } from "../src/shared/maps/home";
import { NPC_SCHEDULE, placeZone } from "../src/shared/npcSchedule";
import { isFarmable } from "../src/shared/engine";
import { BUILDING_DOORS } from "../src/shared/maps/interiors";
import { BLOCKING_GROUND, Ground, INTERIOR_ZONES, type MapData, type MapId, type ZoneId } from "../src/shared/types";

const ZONES: MapId[] = ["home", "home_in", "village", "riverside", "caves", "quarry", ...INTERIOR_ZONES];
const SIZES: Partial<Record<MapId, [number, number]>> = {
  home: [40, 30],
  village: [64, 48],
  riverside: [80, 40],
  caves: [72, 56],
  quarry: [40, 30],
};
const NPC_HOMES: Record<string, ZoneId> = {
  bram: "village",
  odette: "village",
  fenwick: "village",
  rue: "village",
  pip: "village",
  marlo: "riverside",
  sable: "riverside",
  iris: "riverside",
  grumm: "caves",
  tess: "caves",
};

/** NPCs a zone's map must place: its outdoor workers, plus everyone whose routine visits it. */
function expectedNpcs(zone: MapId): string[] {
  const ids = new Set(Object.entries(NPC_HOMES).filter(([, z]) => z === zone).map(([id]) => id));
  for (const [id, bands] of Object.entries(NPC_SCHEDULE)) if (bands.some((b) => placeZone(id, b.at) === zone)) ids.add(id);
  return [...ids].sort();
}

/**
 * Blocked = blocking ground, any (non-flat) prop footprint, or an (unbroken) mining rock.
 * Exit tiles are always open (doors are cut into building footprints), as in buildCollision.
 */
function blockedGrid(map: MapData): Uint8Array {
  const g = new Uint8Array(map.width * map.height);
  map.ground.forEach((t, i) => {
    if (BLOCKING_GROUND.has(t)) g[i] = 1;
  });
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) g[y * map.width + x] = 1;
  };
  for (const p of map.props) {
    if (p.walkable) continue;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) mark(x, y);
  }
  for (const r of map.rocks ?? []) mark(r.x, r.y);
  for (const e of map.exits)
    for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) g[y * map.width + x] = 0;
  return g;
}

function walkable(map: MapData, grid: Uint8Array, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && grid[ty * map.width + tx] === 0;
}

/** 4-connected BFS from a point; returns visited mask. */
function bfs(map: MapData, grid: Uint8Array, from: { x: number; y: number }): Uint8Array {
  const seen = new Uint8Array(map.width * map.height);
  const start = Math.floor(from.y) * map.width + Math.floor(from.x);
  const queue = [start];
  seen[start] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    const x = i % map.width;
    const y = (i - x) / map.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!;
      const ny = y + dy!;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const j = ny * map.width + nx;
      if (seen[j] || grid[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

function exitTiles(e: MapData["exits"][number]) {
  const out: { x: number; y: number }[] = [];
  for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) out.push({ x, y });
  return out;
}

describe.each(ZONES)("map %s", (zone) => {
  const map = getMap(zone);
  const grid = blockedGrid(map);

  it("has the expected size and a complete ground grid", () => {
    expect(map.homeMap ?? map.zone).toBe(zone);
    if (SIZES[zone]) expect([map.width, map.height]).toEqual(SIZES[zone]);
    expect(map.ground.length).toBe(map.width * map.height);
  });

  it("props are inside the map, have known types, unique ids and do not overlap", () => {
    const ids = new Set<string>();
    const cover = new Uint8Array(map.width * map.height);
    for (const p of map.props) {
      expect(p.type in PROP_FOOTPRINTS, p.type).toBe(true);
      expect(ids.has(p.id), `dup id ${p.id}`).toBe(false);
      ids.add(p.id);
      expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= map.width && p.y + p.h <= map.height, p.id).toBe(true);
      if (p.walkable) continue; // rugs may lie under furniture
      for (let y = p.y; y < p.y + p.h; y++)
        for (let x = p.x; x < p.x + p.w; x++) {
          expect(cover[y * map.width + x], `${p.id} overlaps at ${x},${y}`).toBe(0);
          cover[y * map.width + x] = 1;
        }
    }
  });

  it("has a default spawn and all spawns stand on walkable tiles", () => {
    expect(map.spawns.default).toBeDefined();
    for (const [name, s] of Object.entries(map.spawns)) expect(walkable(map, grid, s.x, s.y), name).toBe(true);
  });

  it("npcs, monster spawns and exits stand on walkable tiles", () => {
    for (const n of map.npcs) if (!stallOf(map, n)) expect(walkable(map, grid, n.x, n.y), n.npcId).toBe(true);
    for (const m of map.monsters) expect(walkable(map, grid, m.x, m.y), `${m.type}@${m.x},${m.y}`).toBe(true);
    for (const e of map.exits) for (const t of exitTiles(e)) expect(walkable(map, grid, t.x, t.y), `exit ${e.to}`).toBe(true);
  });

  it("rocks stand on walkable ground and are not under props", () => {
    const ground = blockedGrid({ ...map, rocks: [] });
    const ids = new Set<string>();
    for (const r of map.rocks ?? []) {
      expect(walkable(map, ground, r.x, r.y), r.id).toBe(true);
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
    }
  });

  it("every exit, spawn and npc is reachable from the default spawn (rocks unbroken)", () => {
    const seen = bfs(map, grid, map.spawns.default!);
    const reach = (x: number, y: number) => seen[Math.floor(y) * map.width + Math.floor(x)] === 1;
    for (const e of map.exits) expect(exitTiles(e).some((t) => reach(t.x, t.y)), `exit to ${e.to}`).toBe(true);
    for (const [name, s] of Object.entries(map.spawns)) expect(reach(s.x, s.y), name).toBe(true);
    for (const n of map.npcs) {
      const stall = stallOf(map, n);
      // A shopkeeper behind a counter is talked to from the tile in front of the stall.
      if (stall) expect(reach(n.x, stall.y + stall.h + 0.5), `${n.npcId} counter`).toBe(true);
      else expect(reach(n.x, n.y), n.npcId).toBe(true);
    }
    for (const m of map.monsters) expect(reach(m.x, m.y), m.type).toBe(true);
  });

  it("exits point at valid spawns in the target map, and spawns exist for each connected zone", () => {
    // A house door (exit.map) leads to another map of the same home zone.
    const dest = (e: MapData["exits"][number]) => e.map ?? e.to;
    for (const e of map.exits) {
      const target = getMap(dest(e));
      expect(target.spawns[e.spawn], `${zone} -> ${dest(e)}:${e.spawn}`).toBeDefined();
      expect(e.spawn).toBe(`from_${zone}`);
      expect(map.spawns[`from_${dest(e)}`], `${zone} needs from_${dest(e)}`).toBeDefined();
      // and the target has an exit back
      expect(target.exits.some((b) => dest(b) === zone)).toBe(true);
    }
  });

  it("each from_<zone> spawn sits just inside the matching exit", () => {
    for (const e of map.exits) {
      const s = map.spawns[`from_${e.map ?? e.to}`]!;
      const dx = Math.max(e.x - s.x, 0, s.x - (e.x + e.w));
      const dy = Math.max(e.y - s.y, 0, s.y - (e.y + e.h));
      const d = Math.hypot(dx, dy);
      expect(d).toBeGreaterThan(0.5); // not inside the exit (would bounce straight back)
      expect(d).toBeLessThan(4);
    }
  });

  it("places its NPCs with sensible wander radii", () => {
    expect(map.npcs.map((n) => n.npcId).sort()).toEqual(expectedNpcs(zone));
    for (const n of map.npcs) {
      if (stallOf(map, n)) expect(n.wander, `${n.npcId} keeps the stall`).toBe(0);
      else expect(n.wander).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders as ascii with one char per tile", () => {
    const rows = mapToAscii(map).split("\n");
    expect(rows.length).toBe(map.height);
    for (const r of rows) expect(r.length).toBe(map.width);
  });
});

/** The market stall an NPC stands inside (a shopkeeper behind the counter), if any. */
function stallOf(map: MapData, n: { x: number; y: number }) {
  return map.props.find(
    (p) => p.type === "market_stall" && n.x >= p.x && n.x < p.x + p.w && n.y >= p.y && n.y < p.y + p.h,
  );
}

describe("map specifics", () => {
  it("keeps monsters out of home and the village", () => {
    expect(getMap("home").monsters).toHaveLength(0);
    expect(getMap("village").monsters).toHaveLength(0);
  });

  it("is deterministic and cached", () => {
    expect(getMap("village")).toBe(getMap("village"));
    expect(JSON.stringify(buildHome())).toBe(JSON.stringify(getMap("home")));
    expect(JSON.stringify(buildCaves())).toBe(JSON.stringify(getMap("caves")));
  });

  it("home yard: one house with its door into home_in, bin and mailbox beside it, grass to farm", () => {
    const home = getMap("home");
    const grid = blockedGrid(home);
    expect(home.floorArea).toBeUndefined();
    expect(home.farmGrass).toBe(true);
    const houses = home.props.filter((p) => p.type === "home_house");
    expect(houses).toHaveLength(1);
    const house = houses[0]!;
    const door = home.exits.find((e) => e.map === "home_in")!;
    expect(door).toMatchObject({ to: "home", spawn: "from_home" });
    expect(door.y).toBe(house.y + house.h - 1);
    expect(door.x >= house.x && door.x < house.x + house.w).toBe(true);
    for (const id of ["shipping_bin", "mailbox"]) {
      const p = home.props.find((q) => q.id === id)!;
      expect(Math.hypot(p.x - door.x, p.y - door.y), id).toBeLessThan(5);
    }
    // Plenty of reachable grass to till, and none of it on the road, the house or the doorstep.
    const seen = bfs(home, grid, home.spawns.default!);
    const open = blockedGrid({ ...home, rocks: [] });
    let farmable = 0;
    for (let y = 0; y < home.height; y++)
      for (let x = 0; x < home.width; x++) {
        if (!isFarmable(home, x, y)) continue;
        farmable++;
        // Rocks are left to the caller (a broken one leaves grass to till).
        expect(walkable(home, open, x, y), `${x},${y}`).toBe(true);
      }
    expect(farmable).toBeGreaterThan(300);
    expect(isFarmable(home, door.x, door.y)).toBe(false);
    expect(isFarmable(home, door.x, door.y + 1)).toBe(false);
    expect(isFarmable(home, 20, 12)).toBe(false); // the road
    expect(isFarmable(home, 25, 6)).toBe(true); // the fenced field
    expect(seen[6 * home.width + 25]).toBe(1);
    expect(home.npcs).toEqual([]);
    expect((home.rocks ?? []).every((r) => r.ore === "stone")).toBe(true);
  });

  it("home_in: a walled room with the whole floor for furniture, door back to the doorstep", () => {
    const inside = getMap("home_in");
    expect(inside.zone).toBe("home");
    expect(inside.ambient).toBe("indoor");
    expect(inside.farmArea).toBeUndefined();
    const floor = inside.floorArea![0]!;
    expect(floor.w * floor.h).toBeGreaterThanOrEqual(80);
    const grid = blockedGrid(inside);
    const seen = bfs(inside, grid, inside.spawns.default!);
    for (let y = floor.y; y < floor.y + floor.h; y++)
      for (let x = floor.x; x < floor.x + floor.w; x++) if (walkable(inside, grid, x, y)) expect(seen[y * inside.width + x]).toBe(1);
    expect(inside.exits).toEqual([expect.objectContaining({ to: "home", map: "home", spawn: "from_home_in" })]);
    expect(getMap("home").spawns.from_home_in).toBeDefined();
  });

  it("caves have each ore type and each monster type", () => {
    const caves = getMap("caves");
    const ores = new Set((caves.rocks ?? []).map((r) => r.ore));
    for (const o of ["copper", "iron", "gem"]) expect(ores.has(o as never)).toBe(true);
    const types = new Set(caves.monsters.map((m) => m.type));
    for (const t of ["slime", "bat", "rock_crab"]) expect(types.has(t as never)).toBe(true);
    expect(caves.ambient).toBe("cave");
  });

  it("riverside has slimes and key landmarks", () => {
    const r = getMap("riverside");
    expect(r.monsters.every((m) => m.type === "slime")).toBe(true);
    for (const t of ["dock", "shrine", "bridge_broken"]) expect(r.props.some((p) => p.type === t)).toBe(true);
  });

  it.runIf(process.env.PRINT_MAPS)("prints maps (debug)", () => {
    for (const z of ZONES) console.log(`\n== ${z} ==\n${mapToAscii(getMap(z))}`);
  });
});

describe("village paths", () => {
  it("lead from every building's door to the main road", () => {
    const map = getMap("village");
    const dirt = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.ground[y * map.width + x] === Ground.Dirt;
    for (const d of BUILDING_DOORS) {
      // The path passes under or beside the doorstep (or the tile below it) and reaches the square.
      const start = [1, 2].flatMap((dy) => [0, 1, -1].map((dx) => ({ x: d.door.x + dx, y: d.door.y + dy }))).find((p) => dirt(p.x, p.y));
      expect(start, `${d.name} doorstep`).toBeDefined();
      const seen = new Set([`${start!.x},${start!.y}`]);
      const queue = [start!];
      for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i]!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const k = `${x + dx},${y + dy}`;
          if (dirt(x + dx, y + dy) && !seen.has(k)) {
            seen.add(k);
            queue.push({ x: x + dx, y: y + dy });
          }
        }
      }
      expect(seen.has("31,23"), `${d.name} path reaches the square`).toBe(true);
    }
  });
});
