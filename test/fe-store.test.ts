import { describe, expect, it } from "vitest";
import { createStore } from "../src/client/state/store";
import { interpolate, sampleBuffer, INTERP_DELAY_MS, MAX_EXTRAPOLATE_MS } from "../src/client/state/interp";
import type { EntityState } from "../src/shared/types";
import type { ServerMsg } from "../src/shared/protocol";

const ent = (id: string, x: number, y: number, extra: Partial<EntityState> = {}): EntityState => ({
  id,
  kind: "player",
  name: id,
  sprite: "player_1",
  x,
  y,
  facing: "down",
  moving: true,
  ...extra,
});

const welcome = (entities: EntityState[]): ServerMsg => ({
  t: "welcome",
  zone: "home",
  you: "p:me",
  entities,
  inventory: { coins: 5, slots: [{ item: "hoe", qty: 1 }] },
  farm: [{ x: 2, y: 3, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null }],
  objects: [{ id: "o1", item: "chair_wood", x: 1, y: 1, rotation: 0 }],
  brokenRocks: ["r1"],
  goals: [],
  serverTime: 0,
});

const tick = (upd: EntityState[], del: string[] = [], ack?: number): ServerMsg => ({ t: "tick", at: 0, upd, del, ack });

describe("interpolate", () => {
  it("lerps position and keeps b's discrete fields", () => {
    const r = interpolate(ent("a", 0, 0, { facing: "up" }), ent("a", 2, 2, { facing: "left", moving: false, status: "..." }), 0.5);
    expect(r).toMatchObject({ x: 1, y: 1, facing: "left", moving: false, status: "..." });
  });
  it("clamps t", () => {
    expect(interpolate(ent("a", 0, 0), ent("a", 1, 0), 2).x).toBe(1);
    expect(interpolate(ent("a", 0, 0), ent("a", 1, 0), -1).x).toBe(0);
  });
  it("snaps on jumps over 3 tiles", () => {
    expect(interpolate(ent("a", 0, 0), ent("a", 10, 0), 0.1).x).toBe(10);
  });
});

describe("sampleBuffer", () => {
  const buf = [
    { at: 0, s: ent("a", 0, 0) },
    { at: 100, s: ent("a", 1, 0) },
  ];
  it("holds before the first snapshot", () => expect(sampleBuffer(buf, -50).x).toBe(0));
  it("interpolates between snapshots", () => expect(sampleBuffer(buf, 25).x).toBeCloseTo(0.25));
  it("extrapolates up to the cap", () => {
    expect(sampleBuffer(buf, 150).x).toBeCloseTo(1.5);
    expect(sampleBuffer(buf, 1000).x).toBeCloseTo(1 + MAX_EXTRAPOLATE_MS / 100);
  });
  it("never flings an entity when two ticks arrive back to back", () => {
    const burst = [
      { at: 1000, s: ent("a", 5, 5) },
      { at: 1000.2, s: ent("a", 5.2, 5) }, // one tick's walk, received 0.2 ms after the last
    ];
    expect(sampleBuffer(burst, 1100).x).toBeLessThan(5.5);
  });
  it("does not extrapolate a stopped entity", () => {
    const stopped = [buf[0]!, { at: 100, s: ent("a", 1, 0, { moving: false }) }];
    expect(sampleBuffer(stopped, 180).x).toBe(1);
  });
});

describe("store", () => {
  it("applies welcome with map, inventory, farm, objects, rocks", () => {
    const s = createStore();
    const events: string[] = [];
    for (const ev of ["zone", "inventory", "farm", "objects", "rocks", "goals", "you"] as const) s.on(ev, () => events.push(ev));
    s.apply(welcome([ent("p:me", 5, 5), ent("p:other", 1, 1)]), 1000);
    expect(s.zone).toBe("home");
    expect(s.map?.zone).toBe("home");
    expect(s.youId).toBe("p:me");
    expect(s.inventory.coins).toBe(5);
    expect(s.farm.get("2,3")).toBeDefined();
    expect(s.objects.get("o1")?.item).toBe("chair_wood");
    expect(s.brokenRocks.has("r1")).toBe(true);
    expect(events).toEqual(expect.arrayContaining(["zone", "inventory", "farm", "objects", "rocks", "goals", "you"]));
  });

  it("welcome resets previous zone state", () => {
    const s = createStore();
    s.apply(welcome([ent("p:me", 5, 5), ent("p:gone", 1, 1)]), 0);
    s.apply({ ...welcome([ent("p:me", 5, 5)]), objects: [], farm: [], brokenRocks: [] } as ServerMsg, 10);
    expect(s.latest("p:gone")).toBeUndefined();
    expect(s.objects.size).toBe(0);
    expect(s.brokenRocks.size).toBe(0);
  });

  it("sample excludes you and interpolates a tick or so behind, on the server's clock", () => {
    const s = createStore();
    s.apply(welcome([ent("p:me", 0, 0), ent("p:o", 0, 0)]), 0);
    s.apply({ ...tick([ent("p:o", 1, 0), ent("p:me", 9, 9)]), at: 100 } as ServerMsg, 100);
    expect(s.renderDelay!()).toBeGreaterThanOrEqual(INTERP_DELAY_MS);
    const out = s.sample(50 + s.renderDelay!());
    expect(out.map((e) => e.id)).toEqual(["p:o"]);
    expect(out[0]!.x).toBeCloseTo(0.5);
    expect(s.latest("p:o")?.x).toBe(1);
  });

  it("emits you with ack, and removed on del", () => {
    const s = createStore();
    s.apply(welcome([ent("p:me", 0, 0), ent("m:1", 0, 0)]), 0);
    const yous: unknown[] = [];
    const removed: unknown[] = [];
    s.on("you", (p) => yous.push(p));
    s.on("removed", (p) => removed.push(p));
    s.apply(tick([ent("p:me", 1, 0)], ["m:1"], 7), 100);
    s.apply(tick([], [], 8), 200);
    expect(yous).toHaveLength(2);
    expect(yous[0]).toMatchObject({ state: { x: 1 }, ack: 7 });
    expect(yous[1]).toMatchObject({ ack: 8 });
    expect(removed).toEqual(["m:1"]);
    expect(s.latest("m:1")).toBeUndefined();
  });

  it("keeps about 2 s of history", () => {
    const s = createStore();
    s.apply(welcome([ent("p:me", 0, 0), ent("p:o", 0, 0)]), 0);
    for (let t = 100; t <= 3000; t += 100) s.apply({ ...tick([ent("p:o", t / 1000, 0)]), at: t } as ServerMsg, t);
    // Older than the window: clamps to the oldest kept snapshot (>= 1.0 tiles at t=1000).
    expect(s.sample(0)[0]!.x).toBeGreaterThanOrEqual(0.9);
    expect(s.sample(0)[0]!.x).toBeLessThan(1.2);
  });

  it("applies farm, objects, rock, goals, chat and unsubscribes", () => {
    const s = createStore();
    s.apply(welcome([ent("p:me", 0, 0)]), 0);
    let chats = 0;
    const off = s.on("chat", () => chats++);
    s.apply({ t: "farm", tiles: [{ x: 4, y: 4, crop: "turnip", plantedAt: 1, wateredDays: 0, lastWateredDay: null }] }, 1);
    s.apply({ t: "objects", upd: [{ id: "o2", item: "chair_wood", x: 3, y: 3, rotation: 1 }], del: ["o1"] }, 1);
    s.apply({ t: "rock", id: "r1", broken: false }, 1);
    s.apply({ t: "rock", id: "r2", broken: true }, 1);
    s.apply({ t: "goals", goals: [{ id: "bridge", name: "Bridge", needs: [], done: false }] }, 1);
    s.apply({ t: "chat", from: "p:x", name: "X", text: "hi", at: 1 }, 1);
    off();
    s.apply({ t: "chat", from: "p:x", name: "X", text: "again", at: 2 }, 2);
    expect(s.farm.get("4,4")?.crop).toBe("turnip");
    expect([...s.objects.keys()]).toEqual(["o2"]);
    expect([...s.brokenRocks]).toEqual(["r2"]);
    expect(s.goals[0]!.id).toBe("bridge");
    expect(chats).toBe(1);
  });
});
