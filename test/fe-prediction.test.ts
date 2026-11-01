import { describe, expect, it } from "vitest";
import { createCollisionCache, createPredictor, CORRECT_MS, RESEND_MS } from "../src/client/game/prediction";
import { ARRIVE_DIST, PLAYER_SPEED, buildCollision, canStand, stepDirection } from "../src/shared/engine";
import type { ClientMsg } from "../src/shared/protocol";
import type { EntityState, MapData, PlacedObject, Vec2 } from "../src/shared/types";
import { makeMap, openMap } from "./engine-fixtures";

const FRAME = 1000 / 60;

function setup(map: MapData | null = openMap(20, 12), extras: { objects: PlacedObject[]; rocks: Vec2[] } = { objects: [], rocks: [] }) {
  const ctx = { map, extras };
  const p = createPredictor(
    () => ctx.map,
    () => ctx.extras,
  );
  p.reset({ x: 3.5, y: 3.5 }, "down");
  return { p, ctx };
}

function you(x: number, y: number, facing: EntityState["facing"] = "down"): EntityState {
  return { id: "p:me", kind: "player", name: "me", sprite: "player_1", x, y, facing, moving: false };
}

/** Runs frames for `ms`, collecting sent messages. */
function hold(p: ReturnType<typeof createPredictor>, dx: number, dy: number, ms: number, dt = FRAME): ClientMsg[] {
  const out: ClientMsg[] = [];
  for (let t = 0; t + 1e-9 < ms; t += dt) {
    const { send } = p.step(dx, dy, Math.min(dt, ms - t));
    if (send) out.push(send);
  }
  return out;
}

describe("predictor input & sending", () => {
  it("sends a move on direction change, resends every 100 ms while held, and sends stop", () => {
    const { p } = setup();
    const first = p.step(1, 0, FRAME).send;
    expect(first).toEqual({ t: "move", dx: 1, dy: 0, seq: 1 });
    expect(p.step(1, 0, FRAME).send).toBeNull();
    const resent = hold(p, 1, 0, 1000);
    // ~10 resends per second while held.
    expect(resent.length).toBeGreaterThanOrEqual(9);
    expect(resent.length).toBeLessThanOrEqual(11);
    const seqs = resent.map((m) => (m as { seq: number }).seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const turn = p.step(0, 1, FRAME).send as { t: string; dx: number; dy: number; seq: number };
    expect(turn).toMatchObject({ t: "move", dx: 0, dy: 1 });
    expect(turn.seq).toBeGreaterThan(seqs[seqs.length - 1]);
    expect(p.step(0, 0, FRAME).send).toMatchObject({ t: "move", dx: 0, dy: 0 });
    // Idle: nothing further.
    expect(hold(p, 0, 0, 500)).toEqual([]);
    expect(RESEND_MS).toBe(100);
  });

  it("moves at PLAYER_SPEED and stops at walls", () => {
    const { p } = setup();
    hold(p, 1, 0, 1000);
    const s = p.state();
    expect(s.x).toBeCloseTo(3.5 + PLAYER_SPEED, 3);
    expect(s.facing).toBe("right");
    expect(s.moving).toBe(true);
    hold(p, 1, 0, 5000);
    expect(p.state().x).toBeLessThan(19); // right border wall at x=19
    hold(p, 0, 0, FRAME);
    expect(p.state().moving).toBe(false);
  });

  it("setDir walks from the key event time and sends at once", () => {
    const { p } = setup();
    p.step(0, 0, FRAME, 1000);
    const msg = p.setDir(1, 0, 1010);
    expect(msg).toMatchObject({ t: "move", dx: 1, dy: 0 });
    expect(p.setDir(1, 0, 1012)).toBeNull(); // unchanged (key repeat)
    // The next frame moves only for the 6 ms since the press, and doesn't send again.
    expect(p.step(1, 0, FRAME, 1016).send).toBeNull();
    expect(p.state().x).toBeCloseTo(3.5 + (PLAYER_SPEED * 6) / 1000, 6);
    // Released between frames: walking stops at the release time, not at the next frame.
    p.setDir(0, 0, 1100);
    p.step(0, 0, FRAME, 1116);
    expect(p.state().x).toBeCloseTo(3.5 + (PLAYER_SPEED * 90) / 1000, 6);
  });

  it("does nothing (but still sends) without a map", () => {
    const { p } = setup(null);
    expect(p.step(1, 0, FRAME).send).toMatchObject({ t: "move" });
    expect(p.state().x).toBe(3.5);
  });
});

describe("predictor reconcile", () => {
  /** Server that applies each move message for one 100 ms tick per message it received. */
  function serverReplay(map: MapData, msgs: ClientMsg[], start: Vec2, frames: { dx: number; dy: number; dt: number }[]) {
    // Frame-exact server: apply the same frames up to the last acked message.
    const grid = buildCollision(map, { objects: [], rocks: [] });
    let s = { x: start.x, y: start.y, facing: "down" as EntityState["facing"] };
    for (const f of frames) s = { ...stepDirection(s, f.dx, f.dy, PLAYER_SPEED, f.dt, grid) };
    return s;
  }

  it("replays unacked inputs so an agreeing server causes no correction", () => {
    const map = openMap(20, 12);
    const { p } = setup(map);
    const frames: { dx: number; dy: number; dt: number; seq: number }[] = [];
    let seq = 0;
    for (let i = 0; i < 30; i++) {
      const { send } = p.step(1, 0, FRAME);
      if (send && "seq" in send && send.seq !== undefined) seq = send.seq;
      frames.push({ dx: 1, dy: 0, dt: FRAME, seq });
    }
    const before = p.state();
    // Server has applied everything up to seq 2.
    const acked = frames.filter((f) => f.seq <= 2);
    const srv = serverReplay(map, [], { x: 3.5, y: 3.5 }, acked);
    p.reconcile(you(srv.x, srv.y, "right"), 2);
    const after = p.state();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("snaps when the error exceeds 1.5 tiles", () => {
    const { p } = setup();
    p.reconcile(you(8.5, 3.5), 0);
    expect(p.state().x).toBe(8.5);
  });

  it("eases small errors over ~150 ms", () => {
    const { p } = setup();
    p.reconcile(you(4.5, 3.5), 0);
    expect(p.state().x).toBeCloseTo(3.5, 6); // display unchanged at first
    p.step(0, 0, CORRECT_MS / 2);
    const mid = p.state().x;
    expect(mid).toBeGreaterThan(3.6);
    expect(mid).toBeLessThan(4.4);
    p.step(0, 0, CORRECT_MS);
    expect(p.state().x).toBeCloseTo(4.5, 6);
  });

  it("corrects onto the server path when the server blocked us (rewind + replay)", () => {
    const map = openMap(20, 12);
    const { p } = setup(map);
    hold(p, 1, 0, 200); // seq 1, 2 (resend at 100 ms)
    // Server says it never moved us for those inputs (e.g. stunned): position stays put.
    p.reconcile(you(3.5, 3.5), 100);
    p.step(0, 0, CORRECT_MS + 1);
    expect(p.state().x).toBeCloseTo(3.5, 6);
  });

  it("ignores stale acks", () => {
    const { p } = setup();
    hold(p, 1, 0, 300);
    p.reconcile(you(3.5, 3.5), 3); // drops seq <= 3
    const x1 = p.state();
    p.reconcile(you(3.5, 3.5), 1); // older ack must not resurrect anything / change replay base
    p.step(0, 0, 1000);
    expect(Number.isFinite(x1.x)).toBe(true);
    expect(p.state().x).toBeCloseTo(3.5, 1);
  });

  it("without ack only fixes big errors while moving", () => {
    const { p } = setup();
    hold(p, 1, 0, 200);
    const x = p.state().x;
    p.reconcile(you(x - 0.4, 3.5), undefined);
    expect(p.state().x).toBe(x);
    p.reconcile(you(x - 3, 3.5), undefined);
    expect(p.state().x).toBeCloseTo(x - 3, 6);
  });
});

describe("predictor moveTo", () => {
  it("returns a moveTo with seq and walks a path around a wall to the exact target", () => {
    const map = makeMap([
      "##########",
      "#........#",
      "#.####...#",
      "#....#...#",
      "#....#...#",
      "##########",
    ]);
    const { p } = setup(map);
    p.reset({ x: 2.5, y: 3.5 }, "down");
    const before = p.step(1, 0, FRAME).send as { seq: number };
    p.step(0, 0, FRAME);
    const msg = p.moveTo({ x: 7.3, y: 4.2 });
    expect(msg).toMatchObject({ t: "moveTo", x: 7.3, y: 4.2 });
    expect((msg as { seq: number }).seq).toBeGreaterThan(before.seq);
    const grid = buildCollision(map);
    let sends = 0;
    for (let i = 0; i < 600; i++) {
      if (p.step(0, 0, FRAME).send) sends++;
      const s = p.state();
      expect(canStand(grid, s.x, s.y)).toBe(true);
    }
    expect(sends).toBe(0);
    const s = p.state();
    expect(Math.hypot(s.x - 7.3, s.y - 4.2)).toBeLessThanOrEqual(ARRIVE_DIST + 1e-9);
    expect(s.moving).toBe(false);
  });

  it("is cancelled by a held direction", () => {
    const { p } = setup();
    p.moveTo({ x: 15.5, y: 3.5 });
    hold(p, 0, 0, 200);
    const sent = p.step(0, 1, FRAME).send;
    expect(sent).toMatchObject({ t: "move", dx: 0, dy: 1 });
    const x = p.state().x;
    hold(p, 0, 1, 300);
    expect(p.state().x).toBeCloseTo(x, 6);
  });

  it("path walking replays consistently after an ack", () => {
    const map = openMap(20, 12);
    const { p } = setup(map);
    const msg = p.moveTo({ x: 10.5, y: 3.5 }) as { seq: number };
    hold(p, 0, 0, 500);
    const before = p.state();
    // Server has not processed the moveTo yet: still at start; replay should reproduce our position.
    p.reconcile(you(3.5, 3.5), msg.seq - 1);
    expect(p.state().x).toBeCloseTo(before.x, 6);
  });
});

describe("collision cache", () => {
  it("rebuilds only when map/objects/rocks change", () => {
    const map = openMap(10, 10);
    const ctx = { map: map as MapData | null, extras: { objects: [] as PlacedObject[], rocks: [] as Vec2[] } };
    const c = createCollisionCache(
      () => ctx.map,
      () => ({ objects: [...ctx.extras.objects], rocks: ctx.extras.rocks.map((r) => ({ ...r })) }),
    );
    const g1 = c.get();
    expect(c.get()).toBe(g1); // fresh-but-equal arrays don't rebuild
    ctx.extras.objects = [{ id: "o1", item: "chair_wood", x: 4, y: 4, rotation: 0 }];
    const g2 = c.get();
    expect(g2).not.toBe(g1);
    expect(g2!.cells[4 * 10 + 4]).toBe(1);
    ctx.extras.rocks = [{ x: 2, y: 2 }];
    const g3 = c.get();
    expect(g3).not.toBe(g2);
    expect(g3!.cells[2 * 10 + 2]).toBe(1);
    ctx.map = openMap(10, 10);
    expect(c.get()).not.toBe(g3);
    ctx.map = null;
    expect(c.get()).toBeNull();
  });

  it("predictor collides with placed objects", () => {
    const { p, ctx } = setup(openMap(20, 12));
    ctx.extras = { objects: [{ id: "o", item: "chair_wood", x: 6, y: 3, rotation: 0 }], rocks: [] };
    hold(p, 1, 0, 2000);
    expect(p.state().x).toBeLessThan(6);
  });
});
