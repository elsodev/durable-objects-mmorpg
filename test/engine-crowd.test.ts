import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_GAP, buildCollision, bumps, findPath, isBlocked, withPeople } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import type { EntityState } from "../src/shared/types";
import { NpcRunner, type NpcHost } from "../src/worker/game/npcRunner";
import { isSitting } from "../src/worker/game/seats";
import type { Env } from "../src/worker/env";
import { makeMap, openMap } from "./engine-fixtures";

describe("bumps", () => {
  const other = [{ x: 5, y: 5 }];
  it("stops a step into someone's personal space", () => {
    expect(bumps({ x: 3.5, y: 5 }, { x: 4.4, y: 5 }, other)).toBe(true);
  });
  it("allows steps that keep clear or move away", () => {
    expect(bumps({ x: 3, y: 5 }, { x: 3.5, y: 5 }, other)).toBe(false);
    expect(bumps({ x: 5.2, y: 5 }, { x: 5.4, y: 5 }, other)).toBe(false); // already too close, leaving
    expect(bumps({ x: 4, y: 5 }, { x: 4.4, y: 5 }, [])).toBe(false);
  });
});

describe("withPeople", () => {
  it("blocks the tiles people stand on but keeps the walker's start and goal free", () => {
    const grid = buildCollision(openMap(10, 10));
    const g = withPeople(grid, [{ x: 4.5, y: 4.5 }, { x: 8.5, y: 8.5 }], [{ x: 8.5, y: 8.5 }]);
    expect(isBlocked(g, 4, 4)).toBe(true);
    expect(isBlocked(g, 8, 8)).toBe(false);
    expect(isBlocked(grid, 4, 4)).toBe(false); // the original grid is untouched
  });
  it("lets A* walk around someone in a corridor", () => {
    const map = makeMap(["#######", "#.....#", "#.....#", "#######"]);
    const grid = buildCollision(map);
    const path = findPath(withPeople(grid, [{ x: 3.5, y: 1.5 }], []), { x: 1.5, y: 1.5 }, { x: 5.5, y: 1.5 })!;
    expect(path.some((p) => p.y === 2.5)).toBe(true);
    expect(path.some((p) => p.x === 3.5 && p.y === 1.5)).toBe(false);
  });
});

describe("NPCs treat people as soft obstacles", () => {
  afterEach(() => vi.useRealTimers());
  it("no walking NPC steps into a player or another NPC", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let now = Date.UTC(2026, 10, 1, 19, 5);
    vi.setSystemTime(now);
    const map = getMap("int_inn");
    const grid = buildCollision(map);
    let s = 11;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    // Players planted in the busiest aisles of the inn.
    const players = [
      { x: 9.5, y: 8.5 },
      { x: 11.5, y: 10.5 },
      { x: 7.5, y: 5.5 },
    ].map((p, i) => ({ id: `p:${i}`, kind: "player", name: `P${i}`, sprite: "player_1", ...p, facing: "down", moving: false }) as EntityState);
    const host: NpcHost = { players: () => players, others: () => [], chat: () => {}, openShop: () => {}, give: () => false };
    const storage = { get: async () => new Map(), list: async () => new Map(), put: async () => {}, delete: async () => 0 };
    const r = new NpcRunner(map, grid, { NPC_AI_MODE: "off" } as Env, storage as never, host, rand);
    const last = new Map<string, { x: number; y: number }>();
    let steps = 0;
    for (let t = 0; t < 120_000; t += 100) {
      now += 100;
      vi.setSystemTime(now);
      r.tick(100, now);
      const npcs = r.present().map((n) => n.entity);
      for (const e of npcs) {
        const before = last.get(e.id);
        last.set(e.id, { x: e.x, y: e.y });
        if (!before || (before.x === e.x && before.y === e.y) || isSitting(e)) continue;
        steps++;
        for (const o of [...players, ...npcs]) {
          if (o === e || isSitting(o)) continue;
          const after = Math.hypot(e.x - o.x, e.y - o.y);
          // A step may never end inside someone's space while getting closer.
          if (after < BODY_GAP) expect(after).toBeGreaterThanOrEqual(Math.hypot(before.x - o.x, before.y - o.y));
        }
      }
    }
    expect(steps).toBeGreaterThan(100); // they still get around
  }, 30_000);
});
