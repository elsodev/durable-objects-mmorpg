import { describe, expect, it } from "vitest";
import { getMap, PROP_FOOTPRINTS } from "../src/shared/maps";
import { BUILDING_DOORS, BUILDING_IDS, HOUSE_OWNERS, villageSpawnFor } from "../src/shared/maps/interiors";
import { buildCollision, canStand, exitAt, findPath, isBlocked } from "../src/shared/engine";
import {
  inBand,
  NPC_SCHEDULE,
  NPC_WORK_ZONE,
  npcPresent,
  npcZoneAt,
  placeZone,
  scheduleHour,
} from "../src/shared/npcSchedule";
import { INTERIOR_ZONES, SHARED_ZONES, isInteriorZone, type MapData } from "../src/shared/types";
import { isZoneId } from "../src/worker/game/sanitize";
import { parseWsZone, zoneAllowed } from "../src/worker/http/zone-route";
import { NPCS } from "../src/worker/npc/catalog";
import { musicKeyForZone } from "../src/client/audio/audio-logic";

const BUILDING_TYPES = new Set(["town_hall", "inn", "blacksmith", ...HOUSE_OWNERS.map((o) => `house_${o}`)]);
const village = getMap("village");

describe("village doors", () => {
  it("every building on the village map has exactly one door", () => {
    const buildings = village.props.filter((p) => BUILDING_TYPES.has(p.type));
    expect(buildings.length).toBe(BUILDING_DOORS.length);
    for (const b of buildings) expect(BUILDING_DOORS.filter((d) => d.villageProp === b.id), b.id).toHaveLength(1);
  });

  it("each door tile is in the bottom row of its building and is an exit into the matching interior", () => {
    const grid = buildCollision(village);
    for (const d of BUILDING_DOORS) {
      const b = village.props.find((p) => p.id === d.villageProp)!;
      expect(d.door.y, d.zone).toBe(b.y + b.h - 1);
      expect(d.door.x >= b.x && d.door.x < b.x + b.w, d.zone).toBe(true);
      const exit = exitAt(village, d.door.x + 0.5, d.door.y + 0.5);
      expect(exit?.to, d.zone).toBe(d.zone);
      expect(exit?.spawn).toBe("from_village");
      // You can walk into the doorway from the doorstep.
      expect(canStand(grid, d.door.x + 0.5, d.door.y + 0.5), d.zone).toBe(true);
      expect(findPath(grid, village.spawns[`from_${d.zone}`]!, { x: d.door.x + 0.5, y: d.door.y + 0.5 }), d.zone).not.toBeNull();
      expect(village.spawns[`from_${d.zone}`]).toEqual({ x: villageSpawnFor(d.zone).x + 0.5, y: villageSpawnFor(d.zone).y + 0.5 });
    }
  });

  it("only the door tile of a building is cut out of its footprint", () => {
    const grid = buildCollision(village);
    for (const d of BUILDING_DOORS) {
      const b = village.props.find((p) => p.id === d.villageProp)!;
      for (let y = b.y; y < b.y + b.h; y++)
        for (let x = b.x; x < b.x + b.w; x++) expect(isBlocked(grid, x, y), `${b.id} ${x},${y}`).toBe(!(x === d.door.x && y === d.door.y));
    }
  });
});

describe("building ids", () => {
  it("every interior building id has an interior zone, and houses belong to known villagers", () => {
    const interiors = BUILDING_IDS.filter((b) => b !== "market");
    expect(interiors.map((b) => `int_${b}`).sort()).toEqual([...INTERIOR_ZONES].sort());
    expect(BUILDING_DOORS.map((d) => d.building).sort()).toEqual([...interiors].sort());
    for (const o of HOUSE_OWNERS) expect(NPCS[o], o).toBeDefined();
    expect(BUILDING_IDS).toContain("market");
  });

  it("interior zones are shared zones that route, validate and need an account", () => {
    for (const z of INTERIOR_ZONES) {
      expect(SHARED_ZONES).toContain(z);
      expect(isInteriorZone(z)).toBe(true);
      expect(isZoneId(z)).toBe(true);
      expect(parseWsZone(`/ws/${z}`)).toBe(z);
      expect(zoneAllowed(z, true)).toBe(false);
      expect(zoneAllowed(z, false)).toBe(true);
    }
    expect(isInteriorZone("village")).toBe(false);
    expect(parseWsZone("/ws/int_castle")).toBeNull();
    expect(parseWsZone("/ws/int__proto__")).toBeNull();
  });
});

/** Walkable floor tiles next to a prop's footprint (where you would stand to use it). */
function besideTiles(map: MapData, grid: ReturnType<typeof buildCollision>, p: MapData["props"][number]) {
  const out: { x: number; y: number }[] = [];
  for (let y = p.y - 1; y <= p.y + p.h; y++)
    for (let x = p.x - 1; x <= p.x + p.w; x++) {
      const inside = x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h;
      if (!inside && !isBlocked(grid, x, y) && y < map.height) out.push({ x, y });
    }
  return out;
}

describe.each(INTERIOR_ZONES)("interior %s", (zone) => {
  const map = getMap(zone);
  const grid = buildCollision(map);
  const start = map.spawns.from_village!;

  it("is an indoor room without monsters or rocks, using only known props", () => {
    expect(map.ambient).toBe("indoor");
    expect(map.monsters).toEqual([]);
    expect(map.rocks ?? []).toEqual([]);
    expect(map.farmArea).toBeUndefined();
    for (const p of map.props) expect(p.type in PROP_FOOTPRINTS, p.type).toBe(true);
    expect(map.width).toBeLessThanOrEqual(24);
    expect(map.height).toBeLessThanOrEqual(16);
  });

  it("has one door, back to its village door, and you arrive just inside it", () => {
    expect(map.exits).toHaveLength(1);
    const e = map.exits[0]!;
    expect(e.to).toBe("village");
    expect(e.spawn).toBe(`from_${zone}`);
    expect(village.spawns[e.spawn]).toBeDefined();
    expect(e.y).toBe(map.height - 1); // in the south wall
    expect(Math.floor(start.x)).toBe(e.x);
    expect(e.y - Math.floor(start.y)).toBe(2);
    expect(findPath(grid, start, { x: e.x + 0.5, y: e.y + 0.5 })).not.toBeNull();
    expect(exitAt(map, start.x, start.y)).toBeNull();
  });

  it("the north wall is drawn from inside across the whole width", () => {
    for (let x = 0; x < map.width; x++) {
      const p = map.props.find((q) => q.y === 0 && x >= q.x && x < q.x + q.w);
      expect(p && (p.type.startsWith("iwall_") || p.type === "stairs_up"), `column ${x}`).toBe(true);
    }
  });

  it("every piece of furniture can be walked up to from the door (A*)", () => {
    for (const p of map.props) {
      if (p.walkable || p.type.startsWith("iwall_") || p.type === "stairs_up") continue;
      const spots = besideTiles(map, grid, p).filter((t) => t.y >= 3);
      expect(spots.length, p.id).toBeGreaterThan(0);
      expect(spots.some((t) => findPath(grid, start, { x: t.x + 0.5, y: t.y + 0.5 }) !== null), p.id).toBe(true);
    }
  });

  it("NPCs stand clear of furniture and can reach the door", () => {
    for (const n of map.npcs) {
      // The NPC runner puts the entity half a tile past the spawn point.
      expect(canStand(grid, n.x + 0.5, n.y + 0.5), n.npcId).toBe(true);
      expect(findPath(grid, { x: n.x + 0.5, y: n.y + 0.5 }, start), n.npcId).not.toBeNull();
    }
  });

});

describe("NPC routines", () => {
  it("scheduleHour is the UTC hour, shifted by whole hours", () => {
    const t = Date.UTC(2026, 10, 1, 23, 30);
    expect(scheduleHour(t)).toBe(23);
    expect(scheduleHour(t, 2)).toBe(1);
    expect(scheduleHour(t, -24)).toBe(23);
    expect(scheduleHour(0)).toBe(0);
  });

  it("bands wrap past midnight", () => {
    const night = { from: 22, to: 8, at: "work" as const };
    expect([22, 23, 0, 7].every((h) => inBand(night, h))).toBe(true);
    expect([8, 12, 21].some((h) => inBand(night, h))).toBe(false);
  });

  it("is deterministic and puts each villager in exactly one zone every hour, where a map has a spot for them", () => {
    for (const id of Object.keys(NPC_SCHEDULE)) {
      for (let h = 0; h < 24; h++) {
        const z = npcZoneAt(id, h);
        expect(z, `${id}@${h}`).not.toBeNull();
        expect(npcZoneAt(id, h)).toBe(z);
        expect(getMap(z!).npcs.some((n) => n.npcId === id), `${id}@${h} in ${z}`).toBe(true);
        const present = SHARED_ZONES.filter((zz) => getMap(zz).npcs.some((n) => n.npcId === id) && npcPresent(id, zz, h));
        expect(present, `${id}@${h}`).toEqual([z]);
      }
    }
  });

  it("keeps shopkeepers at their posts through shop hours and sends everyone home at night", () => {
    for (const id of ["odette", "marlo", "iris"]) {
      for (let h = 8; h < 18; h++) expect(npcZoneAt(id, h), `${id}@${h}`).toBe(NPC_WORK_ZONE[id]);
    }
    for (let h = 8; h < 17; h++) expect(npcZoneAt("fenwick", h), `fenwick@${h}`).toBe("int_smithy");
    for (const owner of HOUSE_OWNERS) expect(npcZoneAt(owner, 2)).toBe(`int_house_${owner}`);
    expect(npcZoneAt("rue", 2)).toBe("int_inn");
    expect(npcZoneAt("bram", 15)).toBe("int_townhall");
    expect(npcZoneAt("sable", 2)).toBeNull();
    expect(npcPresent("sable", "riverside", 2)).toBe(true);
  });

  it("only names real places", () => {
    for (const [id, bands] of Object.entries(NPC_SCHEDULE))
      for (const b of bands) {
        expect(placeZone(id, b.at), `${id} ${b.at}`).not.toBeNull();
        expect(b.from >= 0 && b.from < 24 && b.to >= 0 && b.to <= 24, id).toBe(true);
      }
    expect(placeZone("odette", "market")).toBe("village");
  });
});

describe("interior music", () => {
  const music = { title: {}, home: {}, village: {}, festival: {} };
  it("borrows a fitting track", () => {
    expect(musicKeyForZone("int_inn", music)).toBe("festival");
    expect(musicKeyForZone("int_house_pip", music)).toBe("home");
    expect(musicKeyForZone("int_townhall", music)).toBe("village");
    expect(musicKeyForZone("int_inn", { village: {} })).toBe("village");
  });
});
