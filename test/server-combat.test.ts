import { describe, expect, it } from "vitest";
import { buildCollision, MONSTER_IFRAME_MS, MONSTER_STATS, type MonsterState } from "../src/shared/engine";
import { weaponStats } from "../src/shared/engine/toolRules";
import { MonsterPool } from "../src/worker/game/monsterPool";
import { GroundItems, giveOrDrop } from "../src/worker/game/groundItems";
import { ForageGrower, forageSpots } from "../src/worker/game/forage";
import { GROUND_DROP_MS } from "../src/shared/spawns";
import { getMap } from "../src/shared/maps";
import type { EntityState, Inventory, MonsterSpawn } from "../src/shared/types";
import { openMap, rng } from "./engine-fixtures";

function pool(monsters: MonsterSpawn[], seed = 1) {
  const map = openMap(60, 60, { monsters });
  return new MonsterPool(map, buildCollision(map), rng(seed));
}

function player(x: number, y: number, id = "p:a", facing: EntityState["facing"] = "right"): EntityState {
  return { id, kind: "player", name: id, sprite: "ninja", x, y, facing, moving: false, hp: 100, maxHp: 100 };
}

const sword = weaponStats("sword_copper")!;

function place(m: MonsterState, x: number, y: number): void {
  m.x = x;
  m.y = y;
}

describe("MonsterPool strikes", () => {
  it("a sword sweep hits every monster in the arc once, with 250 ms i-frames", () => {
    const pl = pool([{ type: "rock_crab", x: 20.5, y: 20.5, radius: 1, count: 3 }]);
    const [a, b, c] = pl.list as [MonsterState, MonsterState, MonsterState];
    const me = player(20, 20);
    place(a, 21.2, 20);
    place(b, 21, 20.8);
    place(c, 18.8, 20); // behind
    const swept = pl.inArc(me, "right");
    expect(swept.sort((x, y) => x.id.localeCompare(y.id))).toEqual([a, b].sort((x, y) => x.id.localeCompare(y.id)));
    const hits = pl.strike(me, swept, sword, 1000);
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.dmg).toBeGreaterThanOrEqual(sword.min - MONSTER_STATS.rock_crab.defense);
      expect(h.m.iframeUntil).toBe(1000 + MONSTER_IFRAME_MS);
      expect(h.m.kb).not.toBeNull();
      expect(h.m.aggroId).toBe(me.id);
      expect(h.m.damageBy[me.id]).toBe(h.dmg);
    }
    // Inside the i-frames a second swing does nothing; after them it lands.
    expect(pl.strike(me, swept, sword, 1100)).toHaveLength(0);
    expect(pl.strike(me, swept, sword, 1000 + MONSTER_IFRAME_MS)).toHaveLength(2);
  });

  it("knocks monsters away from the attacker", () => {
    const pl = pool([{ type: "rock_crab", x: 20.5, y: 20.5, radius: 5, count: 1 }]);
    const m = pl.list[0]!;
    place(m, 21, 20);
    pl.strike(player(20, 20), [m], sword, 0);
    pl.tick([], 100, 100);
    expect(m.x).toBeGreaterThan(21.2);
    for (let t = 200; m.kb && t < 1500; t += 100) pl.tick([], 100, t);
    expect(m.kb).toBeNull();
    expect(m.x - 21).toBeGreaterThan(0.5);
    expect(m.x - 21).toBeLessThan(0.7);
  });

  it("a kill frees the slot and lists every player with a 15% share", () => {
    const pl = pool([{ type: "slime", x: 20.5, y: 20.5, radius: 1, count: 1 }]);
    const m = pl.list[0]!;
    m.damageBy = { "p:b": 4 };
    m.hp = 1;
    const hits = pl.strike(player(20, 20), [m], sword, 0);
    expect(hits[0]!.killedFor!.sort()).toEqual(["p:a", "p:b"]);
    expect(pl.list).toHaveLength(0);
  });
});

describe("MonsterPool spawning", () => {
  const camp: MonsterSpawn = { type: "slime", x: 30.5, y: 30.5, radius: 4, count: 2 };

  it("starts at base and grows with players, never next to them", () => {
    const map = openMap(60, 60, { monsters: [camp] });
    const pl = new MonsterPool(map, buildCollision(map), rng(2), "riverside", 0);
    expect(pl.countIn(0)).toBe(2);
    // Four players at the camp's edge (inside the +12 margin, but 6+ tiles from much of it).
    const players = [0, 1, 2, 3].map((i) => player(30.5 + 12, 30.5 + i * 0.5, `p:${i}`));
    expect(pl.targetFor(0, players)).toBe(4);
    for (let t = 0; t < 120_000 && pl.countIn(0) < 4; t += 100) pl.tick(players, 100, t);
    expect(pl.countIn(0)).toBe(4);
    for (const m of pl.list) for (const p of players) expect(Math.hypot(m.x - p.x, m.y - p.y)).toBeGreaterThan(3);
  });

  it("refills a free slot faster with more players (respawnMs / sqrt(n))", () => {
    const timeToRefill = (n: number) => {
      const map = openMap(60, 60, { monsters: [{ ...camp }] });
      const pl = new MonsterPool(map, buildCollision(map), rng(4), "riverside", 0);
      const players = Array.from({ length: n }, (_, i) => player(30.5 + 11, 30.5 + i * 0.3, `p:${i}`));
      for (let t = 0; t < 10_000; t += 100) pl.tick(players, 100, t);
      const target = pl.targetFor(0, players);
      while (pl.countIn(0) > target - 1) {
        const m = pl.list.find((x) => x.group === 0)!;
        m.hp = 1;
        pl.strike(player(m.x - 0.5, m.y), [m], sword, 10_000);
      }
      let t = 10_000;
      while (pl.countIn(0) < target && t < 200_000) {
        t += 100;
        pl.tick(players, 100, t);
      }
      return t - 10_000;
    };
    const solo = timeToRefill(1);
    const four = timeToRefill(4);
    expect(solo).toBeGreaterThanOrEqual(45_000);
    expect(four).toBeLessThan(solo * 0.6);
  });

  it("drops quiet extras once players leave", () => {
    const map = openMap(60, 60, { monsters: [camp] });
    const pl = new MonsterPool(map, buildCollision(map), rng(6), "riverside", 0);
    const players = [0, 1, 2, 3].map((i) => player(42.5, 30.5 + i * 0.5, `p:${i}`));
    for (let t = 0; t < 120_000 && pl.countIn(0) < 4; t += 100) pl.tick(players, 100, t);
    expect(pl.countIn(0)).toBe(4);
    for (let t = 120_000; t < 300_000; t += 100) pl.tick([], 100, t);
    expect(pl.countIn(0)).toBe(2);
  });

  it("caves start at their solo numbers", () => {
    const map = getMap("caves");
    const pl = new MonsterPool(map, buildCollision(map), rng(1), "caves", 0);
    expect(pl.list.length).toBe(14);
  });
});

describe("ground drops", () => {
  const fullBag = (): Inventory => ({ coins: 0, slots: Array.from({ length: 24 }, (_, i) => ({ item: i === 0 ? "slime_gel" : "stone", qty: i === 0 ? 98 : 99 })) });

  it("puts what fits in the bag and drops the rest, owned by that player", () => {
    const inv = fullBag();
    const ground = new GroundItems();
    const r = giveOrDrop(inv, ground, "u1", [{ item: "slime_gel", qty: 3 }, { item: "bat_wing", qty: 1 }], { x: 5, y: 5 }, 0, rng(1));
    expect(r.given).toEqual([{ item: "slime_gel", qty: 1 }]);
    expect(r.dropped.map((g) => [g.item, g.qty, g.owner])).toEqual([
      ["slime_gel", 2, "u1"],
      ["bat_wing", 1, "u1"],
    ]);
    expect(inv.slots[0]!.qty).toBe(99);
    // Only the owner sees (and picks up) it.
    expect(ground.visibleTo("u1")).toHaveLength(2);
    expect(ground.visibleTo("u2")).toHaveLength(0);
    expect(ground.ownedNear("u2", { x: 5, y: 5 })).toHaveLength(0);
    expect(ground.ownedNear("u1", { x: 5, y: 5 }).length).toBe(2);
    expect(ground.ownedNear("u1", { x: 8, y: 5 })).toHaveLength(0);
  });

  it("despawns after a few minutes and survives a reload", () => {
    const ground = new GroundItems();
    ground.drop("u1", "stone", 2, { x: 1, y: 1 }, 1000, rng(2));
    const copy = new GroundItems();
    copy.load(JSON.parse(JSON.stringify(ground.record())), 2000);
    expect(copy.record()).toHaveLength(1);
    expect(copy.expire(1000 + GROUND_DROP_MS - 1)).toHaveLength(0);
    expect(copy.expire(1000 + GROUND_DROP_MS)).toHaveLength(1);
    expect(copy.record()).toHaveLength(0);
    // New ids never collide with loaded ones.
    const g = copy.forage("herb_mint", { x: 2, y: 2 })!;
    expect(g.id).not.toBe(ground.record()[0]!.id);
  });
});

describe("forage", () => {
  it("grows near herb patches in the riverside, up to 6 + 2 per player, away from players", () => {
    const map = getMap("riverside");
    const grid = buildCollision(map);
    const spots = forageSpots(map, grid, { near: "herb_patch", nearRadius: 2 });
    expect(spots.length).toBeGreaterThan(20);
    const grower = ForageGrower.forZone("riverside", map, grid)!;
    const ground = new GroundItems();
    const players = [{ x: 40, y: 4 }];
    const first = grower.refill(ground, players, 0, rng(3));
    expect(first.length).toBe(8);
    for (const g of first) expect(Math.hypot(g.x - 40, g.y - 4)).toBeGreaterThanOrEqual(4);
    // Not due again for 5 minutes, then only tops up what was taken.
    expect(grower.refill(ground, players, 60_000, rng(4))).toHaveLength(0);
    ground.take(first[0]!.id);
    expect(grower.refill(ground, players, 300_000, rng(5))).toHaveLength(1);
    expect(ground.forageCount()).toBe(8);
    expect(ground.visibleTo("anyone")).toHaveLength(8);
  });
});

describe("strikes land at the impact frame", () => {
  it("a sword hits whoever is in the arc when it lands; other tools only their aimed target in reach", async () => {
    const { strikeTargets } = await import("../src/worker/game/monsterPool");
    const pl = pool([{ type: "slime", x: 20.5, y: 20.5, radius: 1, count: 2 }]);
    const [a, b] = pl.list as [MonsterState, MonsterState];
    const me = player(20, 20);
    place(a, 21.2, 20);
    place(b, 25, 25);
    expect(strikeTargets(pl, me, "right", sword, null)).toEqual([a]);
    // a slid out of the arc before the swing landed: a whiff
    place(a, 18.8, 20);
    expect(strikeTargets(pl, me, "right", sword, null)).toEqual([]);
    const pick = weaponStats("pickaxe")!;
    place(a, 21, 20);
    expect(strikeTargets(pl, me, "right", pick, a.id)).toEqual([a]);
    expect(strikeTargets(pl, me, "right", pick, b.id)).toEqual([]); // too far by then
    expect(strikeTargets(pl, me, "right", pick, "m:gone")).toEqual([]);
  });
});
