// Deterministic network harness: a predicting client, the real server Motion and a watching
// client's store, joined by in-order links with latency, jitter and retransmit spikes, a server
// tick that drifts and stalls, and frames that sometimes run long. It measures what a player
// sees: corrections of their own character and hitches in someone else's walk.
import { createPredictor } from "../src/client/game/prediction";
import { createStore } from "../src/client/state/store";
import { Motion } from "../src/worker/game/motion";
import { snapshotEntity } from "../src/worker/game/diff";
import { PlayerInterest } from "../src/worker/game/interest";
import { buildCollision, DASH_SPEED, PLAYER_SPEED } from "../src/shared/engine";
import type { ClientMsg, ServerMsg } from "../src/shared/protocol";
import type { EntityState, MapData } from "../src/shared/types";
import { makeMap, rng } from "./engine-fixtures";

/** One direction of a WebSocket: TCP keeps order, so a late packet holds up the ones behind it. */
export interface LinkProfile {
  baseMs: number;
  /** Uniform extra delay 0..jitterMs per packet. */
  jitterMs: number;
  /** Chance per packet of a retransmit-sized delay (spikeMs/2..spikeMs) that bunches what follows. */
  spikeChance: number;
  spikeMs: number;
}

export const LINKS: Record<string, LinkProfile> = {
  lan: { baseMs: 5, jitterMs: 2, spikeChance: 0, spikeMs: 0 },
  good: { baseMs: 30, jitterMs: 20, spikeChance: 0.005, spikeMs: 120 },
  prod: { baseMs: 60, jitterMs: 50, spikeChance: 0.02, spikeMs: 250 },
  bad: { baseMs: 120, jitterMs: 90, spikeChance: 0.04, spikeMs: 350 },
};

class Link<T> {
  private q: { at: number; msg: T }[] = [];
  private last = 0;
  constructor(
    private readonly p: LinkProfile,
    private readonly rand: () => number,
  ) {}
  send(t: number, msg: T): void {
    let at = t + this.p.baseMs + this.rand() * this.p.jitterMs;
    if (this.rand() < this.p.spikeChance) at += this.p.spikeMs * (0.5 + this.rand() * 0.5);
    at = Math.max(at, this.last);
    this.last = at;
    this.q.push({ at, msg });
  }
  take(t: number): T[] {
    const out: T[] = [];
    while (this.q.length && this.q[0]!.at <= t) out.push(this.q.shift()!.msg);
    return out;
  }
}

export interface KeyChange {
  at: number;
  dx: number;
  dy: number;
  dash?: boolean;
}

/** Random walk with stops, turns, diagonals and Shift, from a seed. */
export function randomKeys(seed: number, endMs: number): KeyChange[] {
  const r = rng(seed);
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
  const out: KeyChange[] = [];
  let t = 200;
  while (t < endMs - 1000) {
    if (r() < 0.2) out.push({ at: t, dx: 0, dy: 0 });
    else {
      const d = dirs[Math.floor(r() * dirs.length)]!;
      out.push({ at: t, dx: d[0], dy: d[1], dash: r() < 0.25 });
    }
    t += 150 + Math.floor(r() * 750);
  }
  out.push({ at: t, dx: 0, dy: 0 });
  return out;
}

/** A field with pillars and a wall stub, so walks slide along walls and stop against them. */
export function pillarField(): MapData {
  const w = 70;
  const h = 40;
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 7 === 3 && y % 6 === 2;
      const stub = y === 20 && x >= 30 && x < 40;
      row += border || pillar || stub ? "#" : ".";
    }
    rows.push(row);
  }
  return makeMap(rows);
}

export interface SimOptions {
  seed: number;
  endMs: number;
  up: LinkProfile;
  down: LinkProfile;
  /** The watcher's own downlink (defaults to `down`). */
  watcherDown?: LinkProfile;
  keys: KeyChange[];
  map?: MapData;
  /** The server's map when it differs from what the client knows (a wall the client can't see). */
  serverMap?: MapData;
  start?: { x: number; y: number };
  /** The server isolate stops for these spans (GC, a slow storage write); input and ticks queue up. */
  stalls?: { at: number; ms: number }[];
  /** Server time the player becomes worn out (half speed). */
  tiredAt?: number;
  /** Where the watcher stands (interest: far changes come at 2 Hz). */
  watcherAt?: { x: number; y: number };
  /** The walker's frame interval (ms): 60 fps by default; a slow software-rendered page is ~80. */
  frameMs?: number;
  /** Both pages run at frameMs and see socket messages only between frames (a slow page). */
  slowPages?: boolean;
  /** Half the watcher's view in tiles (1920x1080 at 64 px a tile: 15 x 8.5); only that is judged. */
  view?: { x: number; y: number };
}

export interface SimResult {
  /** Own player: reconcile corrections (any size), visible ones (>= VISIBLE_ERR), hard snaps, the largest error. */
  corrections: number;
  visible: number;
  snaps: number;
  maxErr: number;
  /** Most the shown position moved in one frame beyond what running could cover. */
  maxJump: number;
  /** Frames the shown position moved against the held key (rubber band), and the worst one. */
  backSteps: number;
  maxBack: number;
  /** Own player: how far the shown position drifted after the key was let go (sliding back). */
  maxSettle: number;
  /** Watcher's view of the walker, while it walked in a straight line: */
  remote: {
    /** Frames whose step was off the walk speed by more than half a frame's walk. */
    hitches: number;
    frames: number;
    /** RMS error of the drawn speed (tiles/s). */
    speedRms: number;
    maxJump: number;
    backSteps: number;
  };
  finalErr: number;
}

const FRAME = 1000 / 60;

export function simulate(o: SimOptions): SimResult {
  const rand = rng(o.seed);
  const map = o.map ?? pillarField();
  const grid = buildCollision(o.serverMap ?? map, { objects: [], rocks: [] });
  const start = o.start ?? { x: 10.5, y: 10.5 };
  const pred = createPredictor(
    () => map,
    () => ({ objects: [], rocks: [] }),
  );
  pred.reset(start, "down");
  const ent: EntityState = { id: "p:me", kind: "player", name: "me", sprite: "player_1", x: start.x, y: start.y, facing: "down", moving: false };
  const motion = new Motion(0);
  const up = new Link<ClientMsg>(o.up, rand);
  const down = new Link<{ msg: ServerMsg; tired: boolean }>(o.down, rand);
  const watchDown = new Link<ServerMsg>(o.watcherDown ?? o.down, rand);
  const watcher = createStore();
  const interest = new PlayerInterest(0);
  const watcherAt = o.watcherAt ?? { x: start.x + 4, y: start.y + 4 };

  let tired = false;
  let lastMine: EntityState = { ...ent };
  let lastAck: number | undefined;
  let lastSnap = "";
  let nextTick = 37;
  let tickNo = 0;
  const stalls = [...(o.stalls ?? [])].sort((a, b) => a.at - b.at);
  const stalledAt = (t: number) => stalls.find((s) => t >= s.at && t < s.at + s.ms);

  let keyIdx = 0;
  let held: KeyChange = { at: 0, dx: 0, dy: 0 };
  let heldSince = 0;
  let nextFrame = 0;
  let lastFrameAt = 0;
  let watchFrame = 5;
  let lastShown = { ...start };
  let lastWatch: { x: number; y: number } | null = null;
  let lastWatchAt = 0;
  let releasedAt: number | null = null;
  let releasePos: { x: number; y: number } | null = null;

  const r: SimResult = {
    corrections: 0,
    visible: 0,
    snaps: 0,
    maxErr: 0,
    maxJump: 0,
    backSteps: 0,
    maxBack: 0,
    maxSettle: 0,
    remote: { hitches: 0, frames: 0, speedRms: 0, maxJump: 0, backSteps: 0 },
    finalErr: 0,
  };
  let rmsSum = 0;

  const serverTick = (now: number) => {
    const ack = motion.step(ent, grid, now);
    const snap = snapshotEntity(ent);
    const key = JSON.stringify(snap);
    const changed = key !== lastSnap;
    lastSnap = key;
    if (changed || ack !== lastAck) {
      lastAck = ack;
      const msg: ServerMsg = { t: "tick", at: now, upd: changed ? [snap] : [], del: [] };
      if (ack !== undefined) {
        msg.ack = ack;
        msg.ackMs = motion.ackMs(now);
      }
      down.send(now, { msg, tired });
    }
    const f = interest.filter(changed ? [snap] : [], [], watcherAt, tickNo++);
    if (f.upd.length) watchDown.send(now, { t: "tick", at: now, upd: f.upd, del: [] });
  };

  for (let t = 0; t <= o.endMs; t++) {
    // --- server
    const stall = stalledAt(t);
    if (!stall) {
      for (const m of up.take(t)) {
        if (m.t === "move") motion.onMove(ent, grid, m.dx, m.dy, m.seq, t, m.dash === true, m.ms);
      }
      if (o.tiredAt !== undefined && t >= o.tiredAt && !tired) {
        tired = true;
        motion.setTired(ent, grid, true, t);
      }
      if (t >= nextTick) {
        serverTick(t);
        // setInterval: missed ticks during a stall collapse into one; each fires a few ms late.
        while (nextTick <= t) nextTick += 100;
        nextTick += Math.floor(rand() * 4);
      }
    }

    // --- your client
    // A busy page handles socket messages only between frames.
    for (const d of o.slowPages && t < nextFrame ? [] : down.take(t)) {
      pred.setLimits!({ tired: d.tired, canDash: true });
      const m = d.msg;
      if (m.t !== "tick") continue;
      const mine = m.upd.find((e) => e.id === "p:me");
      if (mine) lastMine = mine;
      pred.reconcile(lastMine, m.ack, m.ackMs, t);
    }
    while (keyIdx < o.keys.length && o.keys[keyIdx]!.at <= t) {
      held = o.keys[keyIdx++]!;
      heldSince = t;
      const msg = pred.setDir(held.dx, held.dy, t, held.dash === true);
      if (msg) up.send(t, msg);
      if (held.dx === 0 && held.dy === 0) {
        releasedAt = t;
        releasePos = { ...pred.state() };
      } else releasedAt = null;
    }
    if (t >= nextFrame) {
      const dt = t - lastFrameAt;
      const prevFrameAt = lastFrameAt;
      lastFrameAt = t;
      const { send } = pred.step(held.dx, held.dy, dt, t, held.dash === true);
      if (send) up.send(t, send);
      const s = pred.state();
      const step = Math.hypot(s.x - lastShown.x, s.y - lastShown.y);
      r.maxJump = Math.max(r.maxJump, step - (DASH_SPEED * dt) / 1000);
      const len = Math.hypot(held.dx, held.dy);
      // Only frames that started after the key changed (a long frame can span a turn).
      if (len > 0 && heldSince < prevFrameAt && t - heldSince > 50) {
        const along = ((s.x - lastShown.x) * held.dx + (s.y - lastShown.y) * held.dy) / len;
        if (along < -0.002) {
          r.backSteps++;
          r.maxBack = Math.max(r.maxBack, -along);
        }
      }
      if (releasedAt !== null && releasePos && t - releasedAt > 50) {
        r.maxSettle = Math.max(r.maxSettle, Math.hypot(s.x - releasePos.x, s.y - releasePos.y));
      }
      lastShown = { x: s.x, y: s.y };
      // A busy page: now and then a frame runs long.
      const frame = o.frameMs ?? FRAME;
      nextFrame += rand() < 0.05 ? frame * (2 + Math.floor(rand() * 3)) : frame;
    }

    // --- someone watching you
    if (!o.slowPages || t >= watchFrame) for (const m of watchDown.take(t)) watcher.apply(m, t);
    if (t >= watchFrame) {
      const seen = watcher.sample(t).find((e) => e.id === "p:me");
      if (seen && lastWatch) {
        const dx = seen.x - lastWatch.x;
        const dy = seen.y - lastWatch.y;
        const stepLen = Math.hypot(dx, dy);
        // Judge only the middle of straight walks (the watcher draws ~100-250 ms behind).
        const k = keyAt(o.keys, t - 400);
        const k2 = keyAt(o.keys, t - 100);
        const k3 = keyAt(o.keys, t - 700);
        const view = o.view ?? { x: 15, y: 8.5 };
        const inView = Math.abs(seen.x - watcherAt.x) <= view.x && Math.abs(seen.y - watcherAt.y) <= view.y;
        if (inView && k && k === k2 && k === k3 && (k.dx !== 0 || k.dy !== 0) && !tired && t > 1000 && freeLine(grid, seen, k)) {
          const speed = k.dash ? DASH_SPEED : PLAYER_SPEED;
          const v = (stepLen / (t - lastWatchAt)) * 1000;
          rmsSum += (v - speed) ** 2;
          r.remote.frames++;
          if (Math.abs(v - speed) > speed / 2) r.remote.hitches++;
          const along = (dx * k.dx + dy * k.dy) / Math.hypot(k.dx, k.dy);
          if (along < -0.002) r.remote.backSteps++;
          r.remote.maxJump = Math.max(r.remote.maxJump, stepLen - (speed * (t - lastWatchAt)) / 1000);
        }
      }
      lastWatch = seen ? { x: seen.x, y: seen.y } : null;
      lastWatchAt = t;
      watchFrame += o.slowPages ? (o.frameMs ?? FRAME) * (rand() < 0.1 ? 2 : 1) : FRAME;
    }
  }
  const st = pred.stats!();
  r.corrections = st.corrections;
  r.visible = st.visible;
  r.snaps = st.snaps;
  r.maxErr = st.maxErr;
  r.remote.speedRms = r.remote.frames ? Math.sqrt(rmsSum / r.remote.frames) : 0;
  const s = pred.state();
  r.finalErr = Math.hypot(s.x - ent.x, s.y - ent.y);
  return r;
}

function keyAt(keys: KeyChange[], t: number): KeyChange | undefined {
  let k: KeyChange | undefined;
  for (const c of keys) if (c.at <= t) k = c;
  return k;
}

/** True when nothing blocks the next two tiles of the walk (wall slides change speed for real). */
function freeLine(grid: ReturnType<typeof buildCollision>, at: { x: number; y: number }, k: KeyChange): boolean {
  for (let d = -2; d <= 2; d += 0.5) {
    const x = Math.floor(at.x + k.dx * d);
    const y = Math.floor(at.y + k.dy * d);
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const i = (y + oy) * grid.width + (x + ox);
      if (x + ox < 0 || y + oy < 0 || x + ox >= grid.width || y + oy >= grid.height || grid.cells[i]) return false;
    }
  }
  return true;
}

/** Walks right across the field and back, past a watcher standing at the east end. */
export function crossingKeys(): KeyChange[] {
  return [
    { at: 200, dx: 1, dy: 0 },
    { at: 12_000, dx: 0, dy: 0 },
    { at: 12_500, dx: -1, dy: 0 },
    { at: 24_000, dx: 0, dy: 0 },
  ];
}

/** Sums several seeds of one profile. */
export function runProfile(profile: LinkProfile, opts: Partial<SimOptions> & { seeds?: number[] } = {}): SimResult & { runs: number } {
  const seeds = opts.seeds ?? [1, 2, 3, 4, 5, 6];
  const total: SimResult & { runs: number } = {
    corrections: 0,
    visible: 0,
    snaps: 0,
    maxErr: 0,
    maxJump: 0,
    backSteps: 0,
    maxBack: 0,
    maxSettle: 0,
    remote: { hitches: 0, frames: 0, speedRms: 0, maxJump: 0, backSteps: 0 },
    finalErr: 0,
    runs: seeds.length,
  };
  let rms = 0;
  for (const seed of seeds) {
    const endMs = opts.endMs ?? 20_000;
    const r = simulate({ seed, endMs, up: profile, down: profile, keys: opts.keys ?? randomKeys(seed * 31, endMs), ...opts });
    total.corrections += r.corrections;
    total.visible += r.visible;
    total.snaps += r.snaps;
    total.maxErr = Math.max(total.maxErr, r.maxErr);
    total.maxJump = Math.max(total.maxJump, r.maxJump);
    total.backSteps += r.backSteps;
    total.maxBack = Math.max(total.maxBack, r.maxBack);
    total.maxSettle = Math.max(total.maxSettle, r.maxSettle);
    total.remote.hitches += r.remote.hitches;
    total.remote.frames += r.remote.frames;
    total.remote.maxJump = Math.max(total.remote.maxJump, r.remote.maxJump);
    total.remote.backSteps += r.remote.backSteps;
    rms += r.remote.speedRms ** 2 * r.remote.frames;
    total.finalErr = Math.max(total.finalErr, r.finalErr);
  }
  total.remote.speedRms = total.remote.frames ? Math.sqrt(rms / total.remote.frames) : 0;
  return total;
}

/** One line per measure, for the report. */
export function describe(name: string, r: SimResult): string {
  const f = (v: number) => v.toFixed(3);
  return (
    `${name.padEnd(22)} corr ${String(r.corrections).padStart(4)} visible ${String(r.visible).padStart(4)} snaps ${r.snaps} maxErr ${f(r.maxErr)} ` +
    `maxJump ${f(r.maxJump)} back ${r.backSteps}/${f(r.maxBack)} settle ${f(r.maxSettle)} final ${f(r.finalErr)} | ` +
    `remote hitch ${r.remote.hitches}/${r.remote.frames} rms ${r.remote.speedRms.toFixed(2)} jump ${f(r.remote.maxJump)} back ${r.remote.backSteps}`
  );
}
