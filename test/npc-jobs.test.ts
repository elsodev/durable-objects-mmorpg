import { afterEach, describe, expect, it, vi } from "vitest";
import { NpcRunner, type NpcHost } from "../src/worker/game/npcRunner";
import { sanitizeActions } from "../src/worker/game/npcActions";
import { buildCollision, dist } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import { atWork, jobZone, NPC_JOBS, npcZoneAt, onShift } from "../src/shared/npcSchedule";
import type { SharedZoneId, Vec2 } from "../src/shared/types";
import type { NpcAction } from "../src/worker/npc/brain";
import type { Env } from "../src/worker/env";

const host: NpcHost = { players: () => [], others: () => [], chat: () => {}, openShop: () => {}, give: () => false };
const storage = { get: async () => new Map(), list: async () => new Map(), put: async () => {}, delete: async () => 0 };
const at = (h: number, m = 0) => Date.UTC(2026, 10, 1, h, m);

function runner(zone: SharedZoneId, seed = 11): NpcRunner {
  const map = getMap(zone);
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return new NpcRunner(map, buildCollision(map), { NPC_AI_MODE: "off" } as Env, storage as never, host, rand);
}

/** The private apply step, as a conversation's sanitized actions reach it. */
const apply = (r: NpcRunner, npcId: string, actions: NpcAction[], now: number) =>
  (r as unknown as { apply(n: unknown, a: NpcAction[], now: number): boolean }).apply(r.byEntityId(npcId), actions, now);

const WORKPLACE: Record<string, SharedZoneId> = {
  bram: "int_townhall",
  fenwick: "int_smithy",
  rue: "int_inn",
  odette: "village",
  wren: "village",
  jory: "village",
  marlo: "riverside",
  iris: "riverside",
  grumm: "caves",
  sheriff: "int_police",
};

afterEach(() => vi.useRealTimers());

describe("job hours", () => {
  it("puts every villager with a job at their workplace at 10:00", () => {
    expect(Object.keys(NPC_JOBS).sort()).toEqual(Object.keys(WORKPLACE).sort());
    for (const [id, zone] of Object.entries(WORKPLACE)) {
      expect(jobZone(id), id).toBe(zone);
      expect(npcZoneAt(id, 10), id).toBe(zone);
      expect(atWork(id, zone, 10), id).toBe(true);
    }
  });

  it("keeps them there for every hour of their shift", () => {
    for (const [id, job] of Object.entries(NPC_JOBS))
      for (let h = job.from; h < job.to; h++) expect(npcZoneAt(id, h), `${id}@${h}`).toBe(jobZone(id));
  });

  it("lets everyone but the innkeeper and the sheriff off in the evening; the inn stays open until midnight", () => {
    for (const id of Object.keys(NPC_JOBS)) if (id !== "rue" && id !== "sheriff") expect(onShift(id, 20), id).toBe(false);
    for (let h = 0; h < 24; h++) expect(onShift("sheriff", h)).toBe(true);
    expect(onShift("rue", 20)).toBe(true);
    expect(onShift("rue", 23)).toBe(true);
    expect(onShift("rue", 2)).toBe(false);
    expect(onShift("pip", 10)).toBe(false);
    expect(npcZoneAt("bram", 20)).not.toBe("int_townhall");
  });

  it("places indoor keepers at their counter, desk or anvil", () => {
    const near = (zone: SharedZoneId, npcId: string, propId: string, within: number) => {
      const map = getMap(zone);
      const s = map.npcs.find((n) => n.npcId === npcId)!;
      const p = map.props.find((pr) => pr.id === propId)!;
      const dx = Math.max(p.x - (s.x + 0.5), 0, s.x + 0.5 - (p.x + p.w));
      const dy = Math.max(p.y - (s.y + 0.5), 0, s.y + 0.5 - (p.y + p.h));
      expect(Math.hypot(dx, dy), `${npcId} by ${propId}`).toBeLessThanOrEqual(within);
    };
    near("int_townhall", "bram", "mayor_desk", 1);
    near("int_inn", "rue", "bar_counter_2", 1);
    near("int_smithy", "fenwick", "anvil", 2.5);
    near("int_police", "sheriff", "sheriff_desk", 1);
  });
});

describe("job NPCs in the zone runner", () => {
  it("at 10:00 the mayor, the smith and the innkeeper are inside, not wandering the village", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(10));
    const village = runner("village");
    for (const id of ["bram", "fenwick", "rue"]) expect(village.byEntityId(id), id).toBeUndefined();
    expect(village.byEntityId("odette")).toBeDefined();
    for (const id of ["bram", "fenwick", "rue"]) expect(runner(WORKPLACE[id]!).byEntityId(id), id).toBeDefined();
  });

  it.each(["bram", "fenwick", "rue"])("%s stays at their spot through a working hour (no benches, no strolls)", (id) => {
    vi.useFakeTimers();
    const start = at(10);
    vi.setSystemTime(start);
    const zone = WORKPLACE[id]!;
    const r = runner(zone);
    const s = getMap(zone).npcs.find((n) => n.npcId === id)!;
    const home: Vec2 = { x: s.x + 0.5, y: s.y + 0.5 };
    let far = 0;
    for (let t = 0; t < 30 * 60 * 10; t++) {
      r.tick(100, start + t * 100);
      const n = r.byEntityId(id)!;
      expect(r.seatOf(n), `${id} sat down`).toBeUndefined();
      far = Math.max(far, dist(n.entity, home));
    }
    expect(far).toBeLessThanOrEqual(Math.max(1, s.wander) + 0.75);
  }, 30_000);

  it("opens Odette's stall in place at 8:00 (not on her doorstep, where she could not walk back)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(7, 59));
    const village = runner("village");
    expect(village.byEntityId("odette")).toBeUndefined();
    village.tick(100, at(8));
    const s = getMap("village").npcs.find((n) => n.npcId === "odette")!;
    const o = village.byEntityId("odette")!;
    expect([o.entity.x, o.entity.y]).toEqual([s.x + 0.5, s.y + 0.5]);
    for (let t = 1; t < 600; t++) village.tick(100, at(8) + t * 100);
    expect([o.entity.x, o.entity.y]).toEqual([s.x + 0.5, s.y + 0.5]);
  });

  it("refuses AI walks off the post and following anyone during work hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(10));
    const r = runner("int_townhall");
    const bram = r.byEntityId("bram")!;
    const door = getMap("int_townhall").exits[0]!;
    apply(r, "bram", [{ kind: "walk_to", x: door.x + 0.5, y: door.y - 0.5 }, { kind: "follow", targetId: "p:1", ms: 10_000 }], at(10));
    expect(bram.path).toBeNull();
    expect(bram.follow).toBeNull();
  });

  it("puts a stall keeper's walk back on the spot (Odette never leaves the stall)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(10));
    const village = runner("village");
    const o = village.byEntityId("odette")!;
    const home = { x: o.spawn.x + 0.5, y: o.spawn.y + 0.5 };
    // As if something had moved her: she is back behind the counter at once.
    o.entity.x = home.x + 3;
    village.tick(100, at(10, 1));
    village.tick(100, at(10, 2));
    expect([o.entity.x, o.entity.y]).toEqual([home.x, home.y]);
  });

  it("lets a villager wander off again once the shift is over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(19));
    const inn = runner("int_inn");
    expect(inn.byEntityId("bram")).toBeDefined();
    apply(inn, "bram", [{ kind: "follow", targetId: "p:1", ms: 5000 }], at(19));
    expect(inn.byEntityId("bram")!.follow).not.toBeNull();
    expect(runner("int_townhall").byEntityId("bram")).toBeUndefined();
  });
});

describe("sanitizeActions on shift", () => {
  const scope = { speakerId: "p:1", home: { x: 10, y: 10 }, leash: 1, hasShop: true, giftAllowed: false, atPost: true };

  it("drops follow and clamps walk_to to the short leash", () => {
    const out = sanitizeActions(
      [
        { kind: "follow", targetId: "p:1", ms: 5000 },
        { kind: "walk_to", x: 30, y: 10 },
        { kind: "open_shop", playerId: "p:1" },
      ],
      scope,
    );
    expect(out.some((a) => a.kind === "follow")).toBe(false);
    expect(out).toContainEqual({ kind: "walk_to", x: 11, y: 10 });
    expect(out).toContainEqual({ kind: "open_shop", playerId: "p:1" });
  });

  it("still allows following off shift", () => {
    const out = sanitizeActions([{ kind: "follow", targetId: "p:1", ms: 5000 }], { ...scope, atPost: false });
    expect(out).toEqual([{ kind: "follow", targetId: "p:1", ms: 5000 }]);
  });
});
