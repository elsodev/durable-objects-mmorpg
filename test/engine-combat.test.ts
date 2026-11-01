import { describe, expect, it } from "vitest";
import {
  buildCollision,
  facingVector,
  farFromPlayers,
  forageCap,
  hurtShakeMs,
  hurtWithIframes,
  inSwingArc,
  knockbackFrom,
  knockbackProgress,
  knockbackRemaining,
  lootShares,
  pickSpawnPoint,
  planForage,
  PLAYER_IFRAME_MS,
  respawnDelayMs,
  rollHit,
  spawnTarget,
  stepKnockback,
  SWING_RADIUS,
} from "../src/shared/engine";
import { CRIT_MULT, toolDamage, weaponStats } from "../src/shared/engine/toolRules";
import { FORAGE_RULES, SPAWN_TUNING } from "../src/shared/spawns";
import { getMap } from "../src/shared/maps";
import { makeMap, openMap, rng } from "./engine-fixtures";

/** Plays back a fixed list of rolls. */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe("weapon stats", () => {
  it("swords roll min..max and outrank every other tool", () => {
    expect(weaponStats("sword_wood")).toMatchObject({ min: 4, max: 6, arc: true });
    expect(weaponStats("sword_copper")).toMatchObject({ min: 8, max: 12, arc: true });
    for (const t of ["pickaxe", "pickaxe_iron", "axe", "hoe", "watering_can"]) {
      const w = weaponStats(t)!;
      expect(w.arc).toBe(false);
      expect(w.min).toBe(w.max);
      expect(weaponStats("sword_wood")!.min).toBeGreaterThan(w.max);
    }
    expect(weaponStats("turnip")).toBeNull();
    expect(toolDamage("sword_wood")).toBe(5);
  });
});

describe("rollHit", () => {
  const w = { min: 4, max: 6, critChance: 0.02, critMult: CRIT_MULT };

  it("rolls within min..max minus defense", () => {
    expect(rollHit(w, 0, 0, seq(0, 0.5))).toEqual({ dmg: 4, crit: false, miss: false });
    expect(rollHit(w, 0, 0, seq(0.999, 0.5))).toEqual({ dmg: 6, crit: false, miss: false });
    expect(rollHit(w, 1, 0, seq(0.999, 0.5)).dmg).toBe(5);
    const r = rng(3);
    for (let i = 0; i < 500; i++) {
      const h = rollHit(w, 0, 0, r);
      expect(h.dmg).toBeGreaterThanOrEqual(4);
      expect(h.dmg).toBeLessThanOrEqual(18);
    }
  });

  it("crits 2% of the time for x3", () => {
    expect(rollHit(w, 0, 0, seq(0.999, 0.01))).toEqual({ dmg: 18, crit: true, miss: false });
    expect(rollHit(w, 0, 0, seq(0.999, 0.03)).crit).toBe(false);
    const r = rng(11);
    let crits = 0;
    for (let i = 0; i < 20_000; i++) if (rollHit(w, 0, 0, r).crit) crits++;
    expect(crits / 20_000).toBeGreaterThan(0.012);
    expect(crits / 20_000).toBeLessThan(0.028);
  });

  it("always lands at least 1, and a miss deals nothing", () => {
    expect(rollHit({ ...w, min: 1, max: 1 }, 5, 0, seq(0, 0.5)).dmg).toBe(1);
    expect(rollHit(w, 0, 0.1, seq(0.05))).toEqual({ dmg: 0, crit: false, miss: true });
    expect(rollHit(w, 0, 0.1, seq(0.5, 0, 0.5)).miss).toBe(false);
  });
});

describe("inSwingArc", () => {
  const me = { x: 10, y: 10 };
  it("covers a 120 degree, 1.6 tile sector in front", () => {
    expect(inSwingArc(me, "right", { x: 11.5, y: 10 })).toBe(true);
    expect(inSwingArc(me, "right", { x: 10 + SWING_RADIUS + 0.05, y: 10 })).toBe(false);
    // 55 degrees off the facing: in; 65: out.
    const at = (deg: number, r = 1.2) => ({ x: 10 + Math.cos((deg * Math.PI) / 180) * r, y: 10 + Math.sin((deg * Math.PI) / 180) * r });
    expect(inSwingArc(me, "right", at(55))).toBe(true);
    expect(inSwingArc(me, "right", at(-55))).toBe(true);
    expect(inSwingArc(me, "right", at(65))).toBe(false);
    expect(inSwingArc(me, "right", at(180))).toBe(false);
  });

  it("follows the facing and counts point-blank overlaps", () => {
    expect(inSwingArc(me, "up", { x: 10, y: 8.6 })).toBe(true);
    expect(inSwingArc(me, "up", { x: 10, y: 11.4 })).toBe(false);
    expect(inSwingArc(me, "down", { x: 10, y: 11.4 })).toBe(true);
    expect(inSwingArc(me, "left", { x: 10.2, y: 10.1 })).toBe(true);
    expect(facingVector("left")).toEqual({ x: -1, y: 0 });
  });
});

describe("knockback", () => {
  const grid = buildCollision(openMap(30, 30));

  it("pushes about 0.6 tiles away from the attacker, halving every 100 ms", () => {
    const kb = knockbackFrom({ x: 10, y: 10 }, { x: 11, y: 10 }, 0.6);
    expect(kb.vy).toBe(0);
    expect(kb.vx).toBeGreaterThan(0);
    expect(knockbackRemaining(kb)).toBeCloseTo(0.6, 6);
    const m = { x: 11, y: 10 };
    let v: typeof kb | null = kb;
    v = stepKnockback(m, v, 100, grid);
    expect(v!.vx).toBeCloseTo(kb.vx / 2, 9);
    expect(m.x - 11).toBeCloseTo(0.3, 6); // half the slide in the first half-life
    for (let i = 0; i < 20 && v; i++) v = stepKnockback(m, v, 100, grid);
    expect(v).toBeNull();
    expect(m.x - 11).toBeCloseTo(0.6, 2);
    expect(knockbackProgress(100)).toBeCloseTo(0.5, 9);
  });

  it("is the same over 10 Hz ticks and finer steps", () => {
    const kb = knockbackFrom({ x: 10, y: 10 }, { x: 10, y: 11 }, 0.6);
    const a = { x: 10, y: 11 };
    const b = { x: 10, y: 11 };
    let va: typeof kb | null = kb;
    let vb: typeof kb | null = kb;
    for (let i = 0; i < 3; i++) va = va && stepKnockback(a, va, 100, grid);
    for (let i = 0; i < 30; i++) vb = vb && stepKnockback(b, vb, 10, grid);
    expect(a.y).toBeCloseTo(b.y, 6);
  });

  it("stops at walls (gliders only at the map edge)", () => {
    const walled = buildCollision(makeMap(["#######", "#.....#", "#..#..#", "#.....#", "#######"]));
    const m = { x: 2.5, y: 2.5 };
    const v = stepKnockback(m, knockbackFrom({ x: 1.5, y: 2.5 }, m, 2), 200, walled);
    expect(m.x).toBeLessThanOrEqual(2.71);
    expect(v === null || v.vx === 0).toBe(true);
    const bat = { x: 2.5, y: 2.5 };
    stepKnockback(bat, knockbackFrom({ x: 1.5, y: 2.5 }, bat, 2), 200, walled, true);
    expect(bat.x).toBeGreaterThan(3.2);
  });

  it("pushes along the attacker's facing when they overlap", () => {
    const kb = knockbackFrom({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.6, "left");
    expect(kb.vx).toBeLessThan(0);
  });
});

describe("player i-frames", () => {
  it("ignores hits for 1200 ms after each hit", () => {
    const p = { hp: 100, maxHp: 100, iframeUntil: 0 };
    expect(hurtWithIframes(p, 5, 1000)).toBe(5);
    expect(p.iframeUntil).toBe(1000 + PLAYER_IFRAME_MS);
    // Three slimes in the same tick: one bite.
    expect(hurtWithIframes(p, 5, 1000)).toBe(0);
    expect(hurtWithIframes(p, 5, 1000)).toBe(0);
    expect(hurtWithIframes(p, 5, 2199)).toBe(0);
    expect(p.hp).toBe(95);
    expect(hurtWithIframes(p, 5, 2200)).toBe(5);
    expect(p.hp).toBe(90);
  });

  it("shakes ~15 ms per damage point, capped", () => {
    expect(hurtShakeMs(4)).toBe(60);
    expect(hurtShakeMs(100)).toBe(300);
  });
});

describe("loot shares", () => {
  it("gives a roll to everyone with at least 15% of max HP dealt, plus the killer", () => {
    expect(lootShares({ "p:a": 14, "p:b": 3, "p:c": 3 }, 20, "p:c")).toEqual(["p:a", "p:b", "p:c"]);
    expect(lootShares({ "p:a": 18, "p:b": 2 }, 20, "p:a")).toEqual(["p:a"]);
    expect(lootShares({ "p:a": 10, "p:b": 7.5 }, 50, "p:a")).toEqual(["p:a", "p:b"]);
    expect(lootShares({}, 20, "p:z")).toEqual(["p:z"]);
  });
});

describe("spawn scaling", () => {
  const camp = { base: 2, perPlayer: 0.5, max: 4, respawnMs: 45_000, minPlayerDist: 6 };

  it("adds perPlayer per extra player, capped", () => {
    expect([0, 1, 2, 3, 4, 10].map((n) => spawnTarget(camp, n))).toEqual([2, 2, 3, 3, 4, 4]);
    const floor1 = { base: 5, perPlayer: 1.5, max: 14, respawnMs: 30_000, minPlayerDist: 6 };
    expect([1, 4, 10].map((n) => spawnTarget(floor1, n))).toEqual([5, 10, 14]);
  });

  it("refills at respawnMs / sqrt(players)", () => {
    expect(respawnDelayMs(camp, 0)).toBe(45_000);
    expect(respawnDelayMs(camp, 1)).toBe(45_000);
    expect(respawnDelayMs(camp, 4)).toBe(22_500);
  });

  it("spawns only on standable tiles far from every player", () => {
    const grid = buildCollision(openMap(40, 40));
    const players = [{ x: 20, y: 20 }];
    const r = rng(5);
    for (let i = 0; i < 50; i++) {
      const p = pickSpawnPoint({ x: 20, y: 20 }, 10, grid, players, 6, r);
      if (!p) continue;
      expect(farFromPlayers(p, players, 6)).toBe(true);
    }
    // A camp the player stands in, smaller than the distance rule: nothing spawns.
    expect(pickSpawnPoint({ x: 20, y: 20 }, 3, grid, players, 6, r)).toBeNull();
  });

  it("has a tuning row for every monster group of the riverside and caves", () => {
    for (const zone of ["riverside", "caves"] as const) {
      const rows = SPAWN_TUNING[zone]!;
      const map = getMap(zone);
      expect(rows.length).toBe(map.monsters.length);
      for (const t of rows) {
        expect(t.minPlayerDist).toBeGreaterThanOrEqual(5);
        expect(t.minPlayerDist).toBeLessThanOrEqual(8);
      }
    }
    const sum = (k: "base" | "max") => SPAWN_TUNING.caves!.reduce((n, t) => n + t[k], 0);
    expect(sum("base")).toBe(14);
    expect(sum("max")).toBe(42);
    expect(SPAWN_TUNING.riverside!.reduce((n, t) => n + t.base, 0)).toBe(6);
    expect(SPAWN_TUNING.riverside!.reduce((n, t) => n + t.max, 0)).toBe(12);
  });

  it("forage tops up to 6 + 2 per player", () => {
    const rule = FORAGE_RULES.riverside!;
    expect(forageCap(rule, 1)).toBe(8);
    expect(forageCap(rule, 3)).toBe(12);
    expect(forageCap(rule, 10)).toBe(14);
    expect(planForage(5, 8)).toBe(3);
    expect(planForage(9, 8)).toBe(0);
  });
});
