import { describe, expect, it } from "vitest";
import {
  buildCollision,
  canStand,
  CONTACT_RANGE,
  dist,
  MONSTER_AI,
  MONSTER_STATS,
  newMonster,
  provoke,
  rollMonsterDrops,
  stepMonster,
  type MonsterState,
} from "../src/shared/engine";
import type { EntityState } from "../src/shared/types";
import { makeMap, openMap, rng } from "./engine-fixtures";

const grid = buildCollision(openMap(30, 30));

function monster(type: MonsterState["type"] = "slime", x = 10.5, y = 10.5): MonsterState {
  return newMonster("m:1", type, { x, y }, { x, y }, 3, 0, 0);
}

function player(x: number, y: number, id = "p:a", hp = 100): EntityState {
  return { id, kind: "player", name: id, sprite: "ninja", x, y, facing: "down", moving: false, hp, maxHp: 100 };
}

/** Never rolls a slime leap, so chase steps stay plain. */
const noLeap = () => 0.999;

describe("MONSTER_STATS", () => {
  it("encodes the archetypes", () => {
    const { slime, bat, rock_crab } = MONSTER_STATS;
    expect(bat.speed).toBeGreaterThan(slime.speed);
    expect(bat.hp).toBeLessThan(slime.hp);
    expect(rock_crab.hp).toBeGreaterThan(slime.hp);
    expect(rock_crab.defense).toBeGreaterThan(slime.defense);
    expect(bat.glider).toBe(true);
    expect(slime.glider).toBe(false);
    for (const s of Object.values(MONSTER_STATS)) expect(s.drops.length).toBeGreaterThan(0);
  });

  it("rolls every drop independently and stacks repeats", () => {
    expect(rollMonsterDrops("slime", () => 0)).toEqual([
      { item: "slime_gel", qty: 2 },
      { item: "herb_mint", qty: 1 },
      { item: "gem_crystal", qty: 1 },
      { item: "flashlight", qty: 1 },
    ]);
    expect(rollMonsterDrops("slime", () => 0.99)).toEqual([]);
    const crab = rollMonsterDrops("rock_crab", () => 0);
    expect(crab.find((d) => d.item === "stone")?.qty).toBe(1);
  });

  it("keeps gems out of the riverside", () => {
    expect(rollMonsterDrops("slime", () => 0, "riverside").some((d) => d.item === "gem_crystal")).toBe(false);
    expect(rollMonsterDrops("slime", () => 0, "caves").some((d) => d.item === "gem_crystal")).toBe(true);
  });
});

describe("stepMonster", () => {
  it("chases a player in sight", () => {
    const m = monster("rock_crab");
    const p = player(13, 10.5);
    const before = dist(m, p);
    stepMonster(m, [p], grid, 100, 0, noLeap);
    expect(m.targetId).toBe(p.id);
    expect(m.mode).toBe("chase");
    expect(dist(m, p)).toBeLessThan(before);
    expect(m.facing).toBe("right");
  });

  it("ignores players out of sight, dead players and non-players", () => {
    const m = monster();
    const far = player(20.5, 10.5);
    const dead = player(11.5, 10.5, "p:dead", 0);
    const npc: EntityState = { ...player(11, 10.5, "n:bram"), kind: "npc" };
    stepMonster(m, [far, dead, npc], grid, 100, 0, noLeap);
    expect(m.targetId).toBeNull();
  });

  it("bites on contact every tick it touches; the player's i-frames are the limit", () => {
    const m = monster("rock_crab");
    const p = player(10.5 + CONTACT_RANGE - 0.1, 10.5);
    let bites = 0;
    for (let t = 0; t < 10; t++) if (stepMonster(m, [p], grid, 100, t * 100, noLeap).hit) bites++;
    expect(bites).toBe(10);
    const r = stepMonster(m, [p], grid, 100, 2000, noLeap);
    expect(r.hit).toEqual({ playerId: p.id, damage: MONSTER_STATS.rock_crab.damage });
  });

  it("deals no contact damage while it is itself invincible", () => {
    const m = monster("rock_crab");
    m.iframeUntil = 500;
    expect(stepMonster(m, [player(10.9, 10.5)], grid, 100, 100, noLeap).hit).toBeUndefined();
  });

  it("does nothing but slide while knocked back", () => {
    const m = monster("rock_crab");
    m.kb = { vx: 0.004, vy: 0 };
    const r = stepMonster(m, [player(10.8, 10.5)], grid, 100, 0, noLeap);
    expect(r.hit).toBeUndefined();
    expect(m.x).toBeGreaterThan(10.5);
    expect(m.moving).toBe(false);
  });

  it("slime crouches for 800 ms, then leaps at the player", () => {
    const m = monster("slime");
    const p = player(13.5, 10.5);
    stepMonster(m, [p], grid, 100, 0, () => 0); // the roll succeeds at once
    expect(m.mode).toBe("windup");
    expect(m.act?.k).toBe("windup");
    const x0 = m.x;
    stepMonster(m, [p], grid, 100, 400, () => 0);
    expect(m.x).toBe(x0); // holds still while crouched
    stepMonster(m, [p], grid, 100, MONSTER_AI.slime.windupMs, () => 0);
    expect(m.mode).toBe("leap");
    for (let t = 900; t < 1300; t += 100) stepMonster(m, [p], grid, 100, t, () => 0.999);
    expect(m.x - x0).toBeGreaterThan(1.5);
  });

  it("bat sleeps until a player comes within 6 tiles, then keeps after them", () => {
    const m = monster("bat");
    m.radius = 5;
    expect(m.mode).toBe("dormant");
    stepMonster(m, [player(17.5, 10.5)], grid, 100, 0, noLeap);
    expect(m.mode).toBe("dormant");
    stepMonster(m, [player(16, 10.5)], grid, 100, 100, noLeap);
    expect(m.mode).toBe("chase");
    // Past its normal sight it still follows (within the leash).
    stepMonster(m, [player(18.5, 10.5)], grid, 100, 200, noLeap);
    expect(m.targetId).toBe("p:a");
  });

  it("bat flies over walls and turns on a curve", () => {
    const walled = buildCollision(
      makeMap(["##########", "#........#", "#...#....#", "#...#....#", "#...#....#", "#........#", "##########"]),
    );
    const m = newMonster("m:b", "bat", { x: 2.5, y: 3.5 }, { x: 2.5, y: 3.5 }, 4, 0, 0);
    const p = player(7.5, 3.5);
    const headings: number[] = [];
    m.heading = -Math.PI / 2; // starts facing up, away from the player
    for (let t = 0; t < 30; t++) {
      stepMonster(m, [p], walled, 100, t * 100, noLeap);
      headings.push(m.heading);
      expect(m.x).toBeGreaterThanOrEqual(0.5);
    }
    // It turned gradually (at most a few tenths of a radian a tick), and crossed the wall column.
    for (let i = 1; i < headings.length; i++) expect(Math.abs(headings[i]! - headings[i - 1]!)).toBeLessThanOrEqual(0.25);
    expect(m.x).toBeGreaterThan(4.5);
  });

  it("aggroes on its attacker beyond sight, then leashes home and heals", () => {
    const m = monster("rock_crab");
    m.hp = 10;
    const p = player(15.5, 10.5); // out of sight (3.5)
    provoke(m, p.id, 0);
    stepMonster(m, [p], grid, 100, 100, noLeap);
    expect(m.targetId).toBe(p.id);
    // The attacker runs far off the leash: it gives up and heals on the way home.
    m.x = 18.5;
    const far = player(28, 10.5);
    stepMonster(m, [far], grid, 100, 200, noLeap);
    expect(m.mode).toBe("home");
    for (let t = 300; t < 20_000 && m.mode === "home"; t += 100) stepMonster(m, [far], grid, 100, t, noLeap);
    expect(m.mode).toBe("idle");
    expect(m.hp).toBe(m.maxHp);
    expect(m.damageBy).toEqual({});
  });

  it("wanders near home when idle and stays standable", () => {
    const m = monster();
    const r = rng(42);
    let moved = false;
    for (let i = 0; i < 600; i++) {
      stepMonster(m, [], grid, 100, i * 100, r);
      if (m.moving) moved = true;
      expect(canStand(grid, m.x, m.y)).toBe(true);
      expect(dist(m, m.home)).toBeLessThanOrEqual(m.radius + 1e-6);
    }
    expect(moved).toBe(true);
  });

  it("does nothing while dead", () => {
    const m = monster();
    m.hp = 0;
    const r = stepMonster(m, [player(10.8, 10.5)], grid, 100, 0, noLeap);
    expect(r.hit).toBeUndefined();
    expect(m.x).toBe(10.5);
  });

  it("is deterministic for the same RNG seed", () => {
    const a = monster();
    const b = monster();
    const ra = rng(7);
    const rb = rng(7);
    const p = player(12, 12);
    for (let i = 0; i < 200; i++) {
      stepMonster(a, [p], grid, 100, i * 100, ra);
      stepMonster(b, [p], grid, 100, i * 100, rb);
    }
    expect({ x: a.x, y: a.y }).toEqual({ x: b.x, y: b.y });
  });
});
