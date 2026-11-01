// Prediction against the real server Motion, with network latency and 10 Hz ticks: the shown
// position must never be corrected by more than float noise, and must stop where the key was let go.
import { describe, expect, it } from "vitest";
import { createPredictor, unsimulated, type InputFrame } from "../src/client/game/prediction";
import { Motion } from "../src/worker/game/motion";
import { buildCollision } from "../src/shared/engine";
import type { ClientMsg } from "../src/shared/protocol";
import type { EntityState } from "../src/shared/types";
import { openMap } from "./engine-fixtures";

const FRAME = 1000 / 60;

interface Wire<T> {
  at: number;
  msg: T;
}

/** Holds `keys` (time ranges with a direction) and returns the shown x per frame plus the final server x. */
function simulate(oneWayMs: number, keys: { from: number; to: number; dx: number }[], endMs: number, tickPhase = 37) {
  const map = openMap(60, 12);
  const grid = buildCollision(map, { objects: [], rocks: [] });
  const p = createPredictor(
    () => map,
    () => ({ objects: [], rocks: [] }),
  );
  p.reset({ x: 3.5, y: 3.5 }, "down");
  const ent: EntityState = { id: "p:me", kind: "player", name: "me", sprite: "player_1", x: 3.5, y: 3.5, facing: "down", moving: false };
  const motion = new Motion(0);
  const up: Wire<ClientMsg>[] = [];
  const down: Wire<{ x: number; ack?: number; ackMs?: number }>[] = [];
  const shown: { t: number; x: number }[] = [];
  let nextTick = tickPhase;
  // 1 ms simulation clock; frames every FRAME ms.
  let nextFrame = 0;
  let lastHeld = 0;
  for (let t = 0; t <= endMs; t++) {
    while (up.length && up[0]!.at <= t) {
      const m = up.shift()!.msg;
      if (m.t === "move") motion.onMove(ent, grid, m.dx, m.dy, m.seq, t);
    }
    if (t >= nextTick) {
      const ack = motion.step(ent, grid, t);
      down.push({ at: t + oneWayMs, msg: { x: ent.x, ack, ackMs: motion.ackMs(t) } });
      nextTick += 100;
    }
    while (down.length && down[0]!.at <= t) {
      const m = down.shift()!.msg;
      p.reconcile({ ...ent, x: m.x }, m.ack, m.ackMs);
    }
    const k = keys.find((k) => t >= k.from && t < k.to);
    const held = k ? k.dx : 0;
    if (held !== lastHeld) {
      // Key event: the client sends at once, stamped with the event time.
      lastHeld = held;
      const m = p.setDir(held, 0, t);
      if (m) up.push({ at: t + oneWayMs, msg: m });
    }
    if (t >= nextFrame) {
      const { send } = p.step(held, 0, FRAME, t);
      if (send) up.push({ at: t + oneWayMs, msg: send });
      shown.push({ t, x: p.state().x });
      nextFrame += FRAME;
    }
  }
  return { shown, serverX: ent.x };
}

describe("prediction against the server Motion", () => {
  for (const latency of [0, 40, 120]) {
    it(`moves at a steady speed and stops dead on release (${latency} ms one way)`, () => {
      const { shown, serverX } = simulate(latency, [{ from: 100, to: 750, dx: 1 }, { from: 1200, to: 1530, dx: -1 }], 2500);
      // No frame moves backwards or jumps more than a frame's walk (plus a little easing).
      for (let i = 1; i < shown.length; i++) {
        const d = Math.abs(shown[i]!.x - shown[i - 1]!.x);
        expect(d).toBeLessThan((4.5 * FRAME) / 1000 + 0.01);
      }
      // After release nothing slides: the position a frame after key-up is the final position.
      const atRelease = shown.find((s) => s.t >= 1530 + FRAME)!.x;
      const last = shown[shown.length - 1]!.x;
      expect(Math.abs(last - atRelease)).toBeLessThan(0.02);
      expect(Math.abs(last - serverX)).toBeLessThan(0.02);
    });
  }
});

describe("unsimulated", () => {
  const f = (seq: number, dtMs: number): InputFrame => ({ seq, dx: 1, dy: 0, dtMs });
  it("drops older seqs and the first ackMs of the acked one", () => {
    const frames = [f(1, 10), f(2, 10), f(2, 10), f(2, 10), f(3, 10)];
    expect(unsimulated(frames, 2, 15)).toEqual([f(2, 5), f(2, 10), f(3, 10)]);
    expect(unsimulated(frames, 2, 0)).toEqual([f(2, 10), f(2, 10), f(2, 10), f(3, 10)]);
    expect(unsimulated(frames, 2, 100)).toEqual([f(3, 10)]);
  });
  it("without ackMs treats the whole acked seq as done (older servers)", () => {
    expect(unsimulated([f(1, 10), f(2, 10), f(3, 10)], 2, undefined)).toEqual([f(3, 10)]);
  });
});
