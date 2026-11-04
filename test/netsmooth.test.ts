// Rubber band fixes: timed moves on the server, step-size independent sliding, reconcile at the
// moment a tick lands, and the jitter buffer for everyone else. The harness numbers these
// guard (all with internet-like latency, jitter, bunched packets and server stalls) are in
// netsim.ts; NETSIM_REPORT=1 prints them for every link profile.
import { describe, expect, it } from "vitest";
import { createPredictor } from "../src/client/game/prediction";
import { createStore } from "../src/client/state/store";
import { createPlayback, MAX_DELAY_MS, MIN_DELAY_MS } from "../src/client/state/playback";
import { IDLE_BANK_MS, LEAD_CAP_MS, MOVE_BANK_MS, Motion } from "../src/worker/game/motion";
import { buildCollision, canStand, PLAYER_SPEED, stepDirection } from "../src/shared/engine";
import { decodeClient, type ServerMsg } from "../src/shared/protocol";
import type { EntityState } from "../src/shared/types";
import { makeMap, openMap, rng } from "./engine-fixtures";
import { crossingKeys, LINKS, pillarField, randomKeys, runProfile, simulate } from "./netsim";

const player = (x: number, y: number): EntityState => ({ id: "p:me", kind: "player", name: "me", sprite: "player_1", x, y, facing: "down", moving: false });

describe("sliding is the same in one long step or many short ones", () => {
  // The server walks a move in one go when the next message arrives; the client walks it frame
  // by frame. Any difference near a wall or corner came back as a correction.
  const grid = buildCollision(pillarField(), { objects: [], rocks: [] });
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const;

  it("matches for random walks past pillars and walls", () => {
    const r = rng(7);
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      // Start near a pillar (x % 7 === 3, y % 6 === 2) so most walks touch one.
      const px = 7 * (1 + Math.floor(r() * 8)) + 3;
      const py = 6 * (1 + Math.floor(r() * 5)) + 2;
      const from = { x: px + 0.5 + (r() - 0.5) * 3, y: py + 0.5 + (r() - 0.5) * 3, facing: "down" as const };
      if (!canStand(grid, from.x, from.y)) continue;
      const [dx, dy] = dirs[Math.floor(r() * dirs.length)]!;
      const ms = 50 + r() * 400;
      const one = stepDirection(from, dx, dy, PLAYER_SPEED, ms, grid);
      let p = { x: from.x, y: from.y, facing: from.facing as EntityState["facing"] };
      let left = ms;
      while (left > 0) {
        const step = Math.min(left, 5 + r() * 30);
        const s = stepDirection(p, dx, dy, PLAYER_SPEED, step, grid);
        p = { x: s.x, y: s.y, facing: s.facing };
        left -= step;
      }
      worst = Math.max(worst, Math.hypot(one.x - p.x, one.y - p.y));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("still nudges into a doorway when walking straight at its edge", () => {
    // Pillar at (10, 8); walking up at x = 9.8 clips it, so the walk slides left to clear it.
    const r = stepDirection({ x: 9.8, y: 9.4, facing: "up" }, 0, -1, PLAYER_SPEED, 400, grid);
    expect(r.x).toBeCloseTo(9.7, 5);
    expect(r.y).toBeLessThan(8.5);
  });
});

describe("timed moves on the server", () => {
  const grid = buildCollision(openMap(80, 12), { objects: [], rocks: [] });

  it("walks a move for the length the client says, not the gap between arrivals", () => {
    const e = player(3.5, 5.5);
    const m = new Motion(0);
    m.onMove(e, grid, 1, 0, 1, 0, false, 0);
    // The next message is 80 ms late: the server guessed ahead, then settles back to 100 ms.
    m.step(e, grid, 100);
    m.step(e, grid, 180);
    m.onMove(e, grid, 0, 0, 2, 180, false, 100);
    expect(e.x).toBeCloseTo(3.5 + PLAYER_SPEED * 0.1, 6);
    // And the reverse: arriving early walks on to the full length at once.
    const f = player(3.5, 5.5);
    const n = new Motion(0);
    n.onMove(f, grid, 1, 0, 1, 0, false, 0);
    n.step(f, grid, 40);
    n.onMove(f, grid, 0, 0, 2, 40, false, 100);
    expect(f.x).toBeCloseTo(3.5 + PLAYER_SPEED * 0.1, 6);
  });

  it("reports how much of the current move it has walked as ackMs", () => {
    const e = player(3.5, 5.5);
    const m = new Motion(0);
    m.onMove(e, grid, 1, 0, 1, 0, false, 0);
    expect(m.step(e, grid, 70)).toBe(1);
    expect(m.ackMs(70)).toBe(70);
  });

  it("stops guessing ahead after LEAD_CAP_MS without word from the client", () => {
    const e = player(3.5, 5.5);
    const m = new Motion(0);
    m.onMove(e, grid, 1, 0, 1, 0, false, 0);
    for (let t = 100; t <= 2000; t += 100) m.step(e, grid, t);
    expect(e.x).toBeCloseTo(3.5 + (PLAYER_SPEED * LEAD_CAP_MS) / 1000, 6);
    expect(e.moving).toBe(false);
    // The client was only late: its moves arrive and the walk is settled at their real length.
    m.onMove(e, grid, 1, 0, 2, 2000, false, 1000);
    expect(e.x).toBeCloseTo(3.5 + PLAYER_SPEED, 6);
  });

  it("can't be made faster than walking by claiming long moves", () => {
    const e = player(3.5, 5.5);
    const m = new Motion(0);
    let seq = 1;
    m.onMove(e, grid, 1, 0, seq++, 0, false, 0);
    // A cheat: every 100 ms, claim the last move took a whole second.
    for (let t = 100; t <= 5000; t += 100) {
      m.step(e, grid, t);
      m.onMove(e, grid, 1, 0, seq++, t, false, 60_000);
    }
    const honest = 3.5 + (PLAYER_SPEED * 5000) / 1000;
    expect(e.x - honest).toBeLessThanOrEqual((PLAYER_SPEED * (MOVE_BANK_MS + 1)) / 1000);
  });

  it("can't save up a long move by standing still", () => {
    const e = player(3.5, 5.5);
    const m = new Motion(0);
    m.step(e, grid, 0);
    for (let t = 1000; t <= 60_000; t += 1000) m.step(e, grid, t);
    m.onMove(e, grid, 1, 0, 1, 60_000, false, 0);
    m.onMove(e, grid, 0, 0, 2, 60_000, false, 5000);
    expect(e.x - 3.5).toBeLessThanOrEqual((PLAYER_SPEED * (IDLE_BANK_MS + 1)) / 1000);
  });

  it("keeps the old arrival-time walk for clients that don't send ms", () => {
    const e = player(3.5, 5.5);
    const m = new Motion(0);
    m.onMove(e, grid, 1, 0, 1, 0);
    m.onMove(e, grid, 0, 0, 2, 180);
    expect(e.x).toBeCloseTo(3.5 + PLAYER_SPEED * 0.18, 6);
  });

  it("accepts a sane ms on move and refuses a bad one", () => {
    expect(decodeClient(JSON.stringify({ t: "move", dx: 1, dy: 0, seq: 3, ms: 101.5 }))).toEqual({ t: "move", dx: 1, dy: 0, seq: 3, ms: 101.5 });
    expect(decodeClient(JSON.stringify({ t: "move", dx: 1, dy: 0, seq: 3 }))).toEqual({ t: "move", dx: 1, dy: 0, seq: 3 });
    for (const ms of [-1, "5", 1e9, null]) expect(decodeClient(JSON.stringify({ t: "move", dx: 1, dy: 0, seq: 3, ms }))).toBeNull();
  });
});

describe("reconcile when a tick lands between frames", () => {
  it("counts the walking the server did since our last frame instead of pulling us forward", () => {
    const map = openMap(60, 12);
    const p = createPredictor(
      () => map,
      () => ({ objects: [], rocks: [] }),
    );
    p.reset({ x: 3.5, y: 5.5 }, "down");
    const msg = p.setDir(1, 0, 0)!;
    p.step(1, 0, 16, 16);
    p.step(1, 0, 16, 32);
    // The server has walked 60 ms of this move; our last frame was at 32 ms, the tick lands at 70.
    const server = { ...player(3.5 + PLAYER_SPEED * 0.06, 5.5), moving: true };
    p.reconcile(server, (msg as { seq: number }).seq, 60, 70);
    expect(p.stats!().visible).toBe(0);
    p.step(1, 0, 16, 86);
    expect(p.state().x).toBeCloseTo(3.5 + PLAYER_SPEED * 0.086, 3);
  });
});

describe("resends while ticks land between frames", () => {
  it("still resends a held key every ~100 ms when each frame is preceded by a reconcile", () => {
    const map = openMap(60, 12);
    const p = createPredictor(
      () => map,
      () => ({ objects: [], rocks: [] }),
    );
    p.reset({ x: 3.5, y: 5.5 }, "down");
    const first = p.setDir(1, 0, 0) as { seq: number };
    let sends = 0;
    for (let t = 80; t <= 2000; t += 80) {
      // A slow page: the tick is handled right before the frame, integrating up to its time.
      p.reconcile({ ...player(3.5, 5.5), moving: true }, first.seq, 0, t);
      if (p.step(1, 0, 80, t).send) sends++;
    }
    // 2 s held at 12.5 fps: a resend on (almost) every other frame, never none.
    expect(sends).toBeGreaterThanOrEqual(10);
  });
});

describe("jitter buffer", () => {
  it("draws a tick behind on a steady link and further behind on a jittery one", () => {
    const steady = createPlayback();
    for (let i = 0; i < 40; i++) steady.observe(i * 100, i * 100 + 50);
    expect(steady.delay()).toBeLessThan(MIN_DELAY_MS + 20);
    const jittery = createPlayback();
    const r = rng(3);
    for (let i = 0; i < 60; i++) jittery.observe(i * 100, i * 100 + 50 + r() * 80);
    expect(jittery.delay()).toBeGreaterThan(MIN_DELAY_MS + 50);
    expect(jittery.delay()).toBeLessThanOrEqual(MAX_DELAY_MS);
  });

  it("moves its clock smoothly and never backwards when the estimate changes", () => {
    const pb = createPlayback();
    for (let i = 0; i < 10; i++) pb.observe(i * 100, i * 100 + 50);
    let last = pb.time(1000);
    for (let now = 1016; now < 3000; now += 16) {
      // A burst of late packets halfway: the delay grows, the clock slows down instead of jumping.
      if (now > 1500 && now < 1700) pb.observe(now - 300, now);
      const t = pb.time(now);
      expect(t - last).toBeGreaterThanOrEqual(16 * 0.9 - 1e-9);
      expect(t - last).toBeLessThanOrEqual(16 * 1.1 + 1e-9);
      last = t;
    }
  });

  it("blends a 2 Hz far entity between snapshots instead of stopping and jumping", () => {
    const s = createStore();
    const at = (x: number, t: number): ServerMsg => ({ t: "tick", at: t, upd: [{ ...player(x, 5), id: "p:far", moving: true }], del: [] });
    s.apply({ t: "welcome", zone: "home", you: "p:me", entities: [player(0, 0)], inventory: { coins: 0, slots: [] }, goals: [], serverTime: 0 }, 50);
    let steps: number[] = [];
    let prev: number | null = null;
    for (let now = 50; now < 8000; now += 16) {
      // Far entities change every tick on the server but are sent every 500 ms.
      const t = Math.floor((now - 50) / 500) * 500;
      if ((now - 50) % 500 < 16) s.apply(at(t / 1000, t), now);
      const e = s.sample(now).find((x) => x.id === "p:far");
      if (e && prev !== null && now > 4000) steps.push(e.x - prev);
      prev = e?.x ?? null;
    }
    steps = steps.map((d) => (d / 16) * 1000); // tiles per second; it walks at 1
    expect(Math.min(...steps)).toBeGreaterThan(0.5);
    expect(Math.max(...steps)).toBeLessThan(1.5);
  });

  it("starts a walk from where it stood, not smeared over the time it stood", () => {
    const s = createStore();
    s.apply({ t: "welcome", zone: "home", you: "p:me", entities: [player(0, 0), { ...player(5, 5), id: "p:o" }], inventory: { coins: 0, slots: [] }, goals: [], serverTime: 0 }, 0);
    // Stood still for 5 s (no updates), then one tick of walking.
    s.apply({ t: "tick", at: 5000, upd: [{ ...player(5.45, 5), id: "p:o", moving: true }], del: [] }, 5000);
    const drawnBefore = s.sample(5000 - 1).find((e) => e.id === "p:o")!;
    expect(drawnBefore.x).toBe(5);
  });
});

describe("network harness (prod-like link: 60-110 ms one way, spikes, bunching)", () => {
  it("doesn't correct your own walk at all on a jittery link", () => {
    const r = runProfile(LINKS.prod!, { seeds: [1, 2, 3] });
    expect(r.visible).toBe(0);
    expect(r.maxBack).toBeLessThan(0.01);
    expect(r.finalErr).toBeLessThan(0.01);
  });

  it("rides out server stalls of 120-500 ms", () => {
    const stalls = [3000, 7000, 11000, 15000].map((at, i) => ({ at, ms: [120, 250, 400, 500][i]! }));
    const r = runProfile(LINKS.prod!, { seeds: [1, 2, 3], stalls });
    expect(r.visible).toBe(0);
    expect(r.maxSettle).toBeLessThan(0.05);
  });

  it("draws someone else walking at an even speed, also across the far/near interest edge", () => {
    const near = runProfile(LINKS.prod!, { seeds: [1, 2, 3] });
    expect(near.remote.speedRms).toBeLessThan(1);
    expect(near.remote.maxJump).toBeLessThan(0.1);
    const cross = runProfile(LINKS.prod!, { seeds: [1, 2], keys: crossingKeys(), endMs: 25_000, start: { x: 3.5, y: 30.5 }, watcherAt: { x: 62, y: 30.5 }, view: { x: 30, y: 17 } });
    expect(cross.remote.speedRms).toBeLessThan(1.5);
    expect(cross.remote.maxJump).toBeLessThan(0.5);
  });

  it("keeps others smooth on a slow page (12 fps, messages only between frames)", () => {
    // Before the resend fix a slow page sent no resends while ticks kept landing just before
    // frames; the server then waited and jumped, and the watcher saw 1-3 tile jumps.
    const r = runProfile(LINKS.prod!, { seeds: [1, 2, 3], frameMs: 80, slowPages: true });
    expect(r.visible).toBe(0);
    expect(r.remote.maxJump).toBeLessThan(0.3);
  });

  it("still corrects you when the server really disagrees (a wall you can't see)", () => {
    const map = openMap(40, 12);
    const rows: string[] = [];
    for (let y = 0; y < 12; y++) rows.push(y === 0 || y === 11 ? "#".repeat(40) : "#" + ".".repeat(14) + "#" + ".".repeat(23) + "#");
    const serverMap = makeMap(rows);
    const r = simulate({ seed: 1, endMs: 4000, up: LINKS.prod!, down: LINKS.prod!, keys: [{ at: 100, dx: 1, dy: 0 }, { at: 3000, dx: 0, dy: 0 }], map, serverMap, start: { x: 5.5, y: 5.5 } });
    expect(r.visible).toBeGreaterThan(0);
    expect(r.finalErr).toBeLessThan(0.01);
  });

  it("random walks on the worst link stay free of rubber banding", () => {
    const r = simulate({ seed: 9, endMs: 20_000, up: LINKS.bad!, down: LINKS.bad!, keys: randomKeys(99, 20_000) });
    expect(r.visible).toBe(0);
  });
});
