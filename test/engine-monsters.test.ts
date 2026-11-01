import { describe, expect, it } from "vitest";
import {
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_STATS,
  buildCollision,
  canStand,
  dist,
  rollDrops,
  stepMonster,
  type MonsterState,
} from "../src/shared/engine";
import type { EntityState } from "../src/shared/types";
import { openMap, rng } from "./engine-fixtures";

const grid = buildCollision(openMap(30, 30));

function monster(type: MonsterState["type"] = "slime", x = 10.5, y = 10.5): MonsterState {
  return {
    id: "m:1",
    kind: "monster",
    name: type,
    sprite: type,
    x,
    y,
    facing: "down",
    moving: false,
    hp: MONSTER_STATS[type].hp,
    maxHp: MONSTER_STATS[type].hp,
    type,
    home: { x, y },
    radius: 3,
    targetId: null,
    cooldownMs: 0,
    respawnAt: null,
    wanderTarget: null,
  };
}

function player(x: number, y: number, id = "p:a", hp = 100): EntityState {
  return { id, kind: "player", name: id, sprite: "ninja", x, y, facing: "down", moving: false, hp, maxHp: 100 };
}

describe("MONSTER_STATS", () => {
  it("encodes the archetypes", () => {
    const { slime, bat, rock_crab } = MONSTER_STATS;
    expect(bat.speed).toBeGreaterThan(slime.speed);
    expect(bat.hp).toBeLessThan(slime.hp);
    expect(rock_crab.hp).toBeGreaterThan(slime.hp);
    expect(rock_crab.hp).toBeGreaterThan(bat.hp);
    expect(slime.damage).toBeLessThan(rock_crab.damage);
    for (const s of Object.values(MONSTER_STATS)) expect(s.drops.length).toBeGreaterThan(0);
  });

  it("rollDrops respects chances", () => {
    expect(rollDrops("slime", () => 0)).toEqual([{ item: "slime_gel", qty: 1 }]);
    expect(rollDrops("slime", () => 0.99)).toEqual([]);
  });
});

describe("stepMonster", () => {
  it("chases a player in aggro range", () => {
    const m = monster();
    const p = player(13.5, 10.5);
    const before = dist(m, p);
    stepMonster(m, [p], grid, 100, 0, rng(1));
    expect(m.targetId).toBe(p.id);
    expect(dist(m, p)).toBeLessThan(before);
    expect(m.moving).toBe(true);
    expect(m.facing).toBe("right");
  });

  it("ignores players out of aggro range, dead players and non-players", () => {
    const m = monster();
    const far = player(20.5, 10.5);
    const dead = player(11.5, 10.5, "p:dead", 0);
    const npc: EntityState = { ...player(11, 10.5, "n:bram"), kind: "npc" };
    stepMonster(m, [far, dead, npc], grid, 100, 0, rng(1));
    expect(m.targetId).toBeNull();
  });

  it("targets the nearest player", () => {
    const m = monster();
    stepMonster(m, [player(13, 10.5, "p:far"), player(9, 10.5, "p:near")], grid, 100, 0, rng(1));
    expect(m.targetId).toBe("p:near");
  });

  it("attacks in range with a cooldown", () => {
    const m = monster("rock_crab");
    const p = player(11.2, 10.5);
    const r1 = stepMonster(m, [p], grid, 100, 0, rng(1));
    expect(r1.hit).toEqual({ playerId: p.id, damage: MONSTER_STATS.rock_crab.damage });
    expect(m.cooldownMs).toBe(MONSTER_ATTACK_COOLDOWN_MS);
    expect(m.moving).toBe(false);
    let hits = 0;
    for (let t = 1; t <= 10; t++) if (stepMonster(m, [p], grid, 100, t * 100, rng(t)).hit) hits++;
    expect(hits).toBe(1); // exactly one more bite after 1000 ms
  });

  it("stays within 2x radius of home while chasing", () => {
    const m = monster("bat");
    m.radius = 2;
    // Player at the aggro edge but within leash, then keeps backing off.
    let p = player(14.5, 10.5);
    for (let i = 0; i < 100; i++) {
      stepMonster(m, [p], grid, 100, i * 100, rng(i));
      p = player(Math.min(p.x + 0.2, 28), 10.5);
      expect(dist(m, m.home)).toBeLessThanOrEqual(4 + 1e-9);
    }
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

  it("returns home after losing its target", () => {
    const m = monster();
    m.x = 15.5; // pushed out to the leash edge
    stepMonster(m, [], grid, 100, 0, rng(3));
    expect(m.wanderTarget).toEqual(m.home);
    for (let i = 0; i < 100 && dist(m, m.home) > m.radius; i++) stepMonster(m, [], grid, 100, i * 100, rng(i));
    expect(dist(m, m.home)).toBeLessThanOrEqual(m.radius);
  });

  it("does nothing while dead", () => {
    const m = monster();
    m.respawnAt = 5000;
    const r = stepMonster(m, [player(10.8, 10.5)], grid, 100, 0, rng(1));
    expect(r.hit).toBeUndefined();
    expect(m.x).toBe(10.5);
  });

  it("is deterministic for the same RNG seed", () => {
    const a = monster();
    const b = monster();
    const ra = rng(7);
    const rb = rng(7);
    for (let i = 0; i < 200; i++) {
      stepMonster(a, [], grid, 100, i * 100, ra);
      stepMonster(b, [], grid, 100, i * 100, rb);
    }
    expect({ x: a.x, y: a.y }).toEqual({ x: b.x, y: b.y });
  });
});
