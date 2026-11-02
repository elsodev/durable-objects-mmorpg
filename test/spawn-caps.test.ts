// Monster respawn limits in the hunting grounds: per-zone caps, the crowd slowdown, safe arrival
// spots, and refills that only happen inside the zone tick (no timers of their own).
import { describe, expect, it } from "vitest";
import { buildCollision, canStand, outsideSafeAreas, respawnDelayMs, safeSpots, zoneMonsterCap } from "../src/shared/engine";
import { CAVE_DEPTH_MONSTER_CAP, RESPAWN_CROWD_SLOWDOWN, SPAWN_SAFE_RADIUS, ZONE_MONSTER_CAP } from "../src/shared/spawns";
import { getMap } from "../src/shared/maps";
import { SHARED_ZONES, type EntityState, type MonsterSpawn } from "../src/shared/types";
import { weaponStats } from "../src/shared/engine/toolRules";
import { MonsterPool } from "../src/worker/game/monsterPool";
import { openMap, rng } from "./engine-fixtures";

const sword = weaponStats("sword_copper")!;

function player(x: number, y: number, id: string): EntityState {
  return { id, kind: "player", name: id, sprite: "ninja", x, y, facing: "right", moving: false, hp: 100, maxHp: 100 };
}

/** Runs the pool's tick every 100 ms from `from` to `to` (as the zone tick would). */
function run(pl: MonsterPool, players: EntityState[], from: number, to: number): void {
  for (let t = from; t < to; t += 100) pl.tick(players, 100, t);
}

describe("zone monster caps", () => {
  it("hunting grounds are capped below what their groups could add up to", () => {
    expect(zoneMonsterCap("caves")).toBe(28);
    expect(zoneMonsterCap("riverside")).toBe(10);
    expect(zoneMonsterCap("caves_2_left")).toBe(CAVE_DEPTH_MONSTER_CAP);
    expect(zoneMonsterCap("village")).toBe(ZONE_MONSTER_CAP);
    expect(zoneMonsterCap(undefined)).toBe(ZONE_MONSTER_CAP);
  });

  it("a crowd of 30 in the caves never pushes it past the cap, however long they stay", () => {
    const map = getMap("caves");
    const pl = new MonsterPool(map, buildCollision(map), rng(7), "caves", 0);
    // Ten players at every group: each wants its maximum.
    const players = map.monsters.flatMap((g, i) => Array.from({ length: 10 }, (_, k) => player(g.x + 9, g.y + (k % 3), `p:${i}:${k}`)));
    let peak = 0;
    for (let t = 0; t < 15 * 60_000; t += 100) {
      pl.tick(players, 100, t);
      peak = Math.max(peak, pl.list.length);
    }
    expect(peak).toBe(28);
  });

  it("every monster map keeps over a quarter of each group's ground spawnable outside the safe spots", () => {
    for (const z of SHARED_ZONES) {
      const map = getMap(z);
      if (map.monsters.length === 0) continue;
      const grid = buildCollision(map);
      const safe = safeSpots(map);
      for (const g of map.monsters) {
        let ok = 0;
        let stand = 0;
        for (let dx = -g.radius; dx <= g.radius; dx += 0.5) {
          for (let dy = -g.radius; dy <= g.radius; dy += 0.5) {
            if (dx * dx + dy * dy > g.radius * g.radius || !canStand(grid, g.x + dx, g.y + dy)) continue;
            stand++;
            if (outsideSafeAreas({ x: g.x + dx, y: g.y + dy }, safe)) ok++;
          }
        }
        expect(ok / stand, `${z} ${g.type} at ${g.x},${g.y}`).toBeGreaterThan(0.25);
      }
    }
  });
});

describe("respawn timing", () => {
  const tune = { base: 2, perPlayer: 0.5, max: 4, respawnMs: 40_000, minPlayerDist: 6 };

  it("the delay grows as the group fills and shrinks (sublinearly) with players near", () => {
    expect(respawnDelayMs(tune, 1, 0, 4)).toBe(40_000);
    expect(respawnDelayMs(tune, 1, 4, 4)).toBe(40_000 * (1 + RESPAWN_CROWD_SLOWDOWN));
    expect(respawnDelayMs(tune, 1, 2, 4)).toBe(40_000 * (1 + RESPAWN_CROWD_SLOWDOWN / 2));
    expect(respawnDelayMs(tune, 4, 0, 4)).toBe(20_000);
    expect(respawnDelayMs(tune, 1, 99, 4)).toBe(40_000 * (1 + RESPAWN_CROWD_SLOWDOWN));
  });

  it("a killed monster comes back only after its delay, and only when the zone ticks", () => {
    const camp: MonsterSpawn = { type: "slime", x: 30.5, y: 30.5, radius: 4, count: 2 };
    const map = openMap(60, 60, { monsters: [camp] });
    const pl = new MonsterPool(map, buildCollision(map), rng(3), "riverside", 0);
    const me = player(30.5 + 11, 30.5, "p:me");
    run(pl, [me], 0, 5_000);
    expect(pl.countIn(0)).toBe(2);
    const m = pl.list[0]!;
    m.hp = 1;
    pl.strike(player(m.x - 0.5, m.y, "p:me"), [m], sword, 5_000);
    expect(pl.countIn(0)).toBe(1);
    // One of two still up when it died: 45 s (riverside camp) * (1 + 0.5 * 1/2).
    const delay = 45_000 * (1 + RESPAWN_CROWD_SLOWDOWN / 2);
    run(pl, [me], 5_000, 5_000 + delay - 2_100);
    expect(pl.countIn(0)).toBe(1);
    run(pl, [me], 5_000 + delay - 2_100, 5_000 + delay + 2_100);
    expect(pl.countIn(0)).toBe(2);
  });

  it("fresh monsters never appear on an arrival spot or exit", () => {
    // An exit right at the camp's centre: every spawn after the first lands outside the safe radius.
    const camp: MonsterSpawn = { type: "slime", x: 30.5, y: 30.5, radius: 6, count: 1 };
    const map = openMap(60, 60, { monsters: [camp] });
    map.exits.push({ x: 30, y: 30, w: 1, h: 1, to: "village", spawn: "default" });
    const pl = new MonsterPool(map, buildCollision(map), rng(9), "riverside", 0);
    const players = [0, 1, 2, 3].map((i) => player(30.5 + 14, 30.5 + i, `p:${i}`));
    const seen = new Set(pl.list.map((m) => m.id));
    let fresh = 0;
    for (let round = 0; round < 6; round++) {
      while (pl.list.length > 0) {
        const m = pl.list[0]!;
        m.hp = 1;
        pl.strike(player(m.x - 0.5, m.y, "p:0"), [m], sword, round * 200_000);
      }
      // Checked on the tick it appears (monsters wander afterwards, which is fine).
      for (let t = round * 200_000; t < (round + 1) * 200_000; t += 100) {
        pl.tick(players, 100, t);
        for (const m of pl.list) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          fresh++;
          expect(Math.hypot(m.x - 30.5, m.y - 30.5)).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS);
        }
      }
    }
    expect(fresh).toBeGreaterThanOrEqual(6);
  });
});
