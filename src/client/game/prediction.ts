// Client-side prediction for your own player: moves locally with the same engine the server runs,
// numbers move intents with `seq`, and reconciles against authoritative ticks by rewinding to the
// server position and replaying the inputs the server has not acked yet.
import type { CreatePredictor, Predictor, PredictorStats } from "../contracts";
import type { ClientMsg } from "../../shared/protocol";
import type { Facing, MapData, PlacedObject, Vec2 } from "../../shared/types";
import {
  ARRIVE_DIST,
  PLAYER_SPEED,
  buildCollision,
  paceSpeed,
  pathSpeed,
  pickPace,
  type Pace,
  dist,
  findPath,
  moveGoal,
  setBlocked,
  stepDirection,
  stepToward,
  type CollisionGrid,
} from "../../shared/engine";

/** Resend a held direction this often so the server keeps moving us (and acks progress). */
export const RESEND_MS = 100;
/** Reconcile error above this (tiles) teleports; below it the display eases over CORRECT_MS. */
export const SNAP_DIST = 1.5;
export const CORRECT_MS = 150;
/** Errors smaller than this are ignored, so float noise doesn't start a correction. */
const EPS_DIST = 0.01;
/** A correction at least this big (tiles, about 2 px) can be seen; counted in stats(). */
export const VISIBLE_ERR = 0.06;
/** Integration step cap: a long stall (tab in background) must not produce a huge local jump. */
const MAX_DT_MS = 250;
/** Input history cap, in case the server never acks (old server, dropped socket). */
const MAX_INPUTS = 600;

/** One predicted frame of movement, replayable on top of a server position. */
export interface InputFrame {
  seq: number;
  /** Direction actually moved (held key or unit vector toward a path waypoint). */
  dx: number;
  dy: number;
  dtMs: number;
  /** Tiles per second it moved at (walk, dash or worn out); absent: walking. */
  speed?: number;
}

interface Extras {
  objects: PlacedObject[];
  rocks: Vec2[];
  /** Map-blocked tiles that are open now (trees chopped down to nothing). */
  cleared?: Vec2[];
}

/** Rebuilds the collision grid only when the map, objects or rocks actually change. */
export function createCollisionCache(getMap: () => MapData | null, getExtras: () => Extras) {
  let map: MapData | null = null;
  let objects: PlacedObject[] = [];
  let rocks: Vec2[] = [];
  let cleared: Vec2[] = [];
  let grid: CollisionGrid | null = null;

  const sameObjects = (a: PlacedObject[], b: PlacedObject[]) =>
    a === b ||
    (a.length === b.length &&
      a.every((o, i) => {
        const p = b[i];
        return o === p || (o.id === p.id && o.item === p.item && o.x === p.x && o.y === p.y && o.rotation === p.rotation);
      }));
  const sameRocks = (a: Vec2[], b: Vec2[]) =>
    a === b || (a.length === b.length && a.every((r, i) => r === b[i] || (r.x === b[i].x && r.y === b[i].y)));

  return {
    get(): CollisionGrid | null {
      const m = getMap();
      if (!m) return (grid = map = null);
      const ex = getExtras();
      const exCleared = ex.cleared ?? [];
      if (grid && m === map && sameObjects(ex.objects, objects) && sameRocks(ex.rocks, rocks) && sameRocks(exCleared, cleared)) return grid;
      map = m;
      objects = ex.objects.slice();
      rocks = ex.rocks.slice();
      cleared = exCleared.slice();
      grid = buildCollision(m, { objects, rocks });
      for (const c of cleared) setBlocked(grid, c.x, c.y, 1, 1, false);
      return grid;
    },
  };
}

/**
 * The part of the input history the server has not simulated yet. Frames older than the acked
 * seq are done. With `ackMs` (how long the server has run the acked input), the first ackMs of
 * the acked seq's own frames are done too, so a held key is replayed for exactly the time the
 * server is behind. Without it (older server), every frame of the acked seq counts as done.
 */
export function unsimulated(inputs: readonly InputFrame[], ack: number, ackMs: number | undefined): InputFrame[] {
  const out: InputFrame[] = [];
  let skip = ackMs ?? 0;
  for (const f of inputs) {
    if (f.seq < ack) continue;
    if (f.seq === ack) {
      if (ackMs === undefined) continue;
      if (skip >= f.dtMs) {
        skip -= f.dtMs;
        continue;
      }
      if (skip > 0) {
        out.push({ ...f, dtMs: f.dtMs - skip });
        skip = 0;
        continue;
      }
    }
    out.push(f);
  }
  return out;
}

/**
 * How far (ms) the server has walked the acked move past the length it had here, when this
 * client has already moved on from it. The server walks a held move ahead until the next move
 * arrives, so a late packet shows it a little too far; it takes that back once the next move
 * says how long this one lasted (Motion.settle). Such a position is a guess, not a correction.
 */
export function walkedAhead(inputs: readonly InputFrame[], ack: number, ackMs: number | undefined, current: number): number {
  if (ackMs === undefined || ack >= current) return 0;
  let had = 0;
  for (const f of inputs) if (f.seq === ack) had += f.dtMs;
  return Math.max(0, ackMs - had);
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
/** Frames at walking speed leave `speed` out, so the history stays as small as before. */
const speedOf = (speed: number): { speed?: number } => (speed === PLAYER_SPEED ? {} : { speed });

export const createPredictor: CreatePredictor = (getMap, getBlockedExtras) => {
  const collision = createCollisionCache(getMap, getBlockedExtras);

  // Predicted (true local) position; what the player sees is this plus a decaying correction.
  let x = 0;
  let y = 0;
  let facing: Facing = "down";
  let moving = false;
  let corr = { x: 0, y: 0 };
  let corrLeftMs = 0;

  let seq = 0;
  let acked = 0;
  let inputs: InputFrame[] = [];
  let lastDir = { dx: 0, dy: 0 };
  /** Shift held with the current direction, and what the server allows (setLimits). */
  let dash = false;
  let tired = false;
  let canDash = true;
  let sinceSendMs = 0;
  let path: Vec2[] | null = null;
  /** Clock time (ms) the predicted position is integrated up to; null until the first step. */
  let simAt: number | null = null;
  const stats: PredictorStats = { corrections: 0, visible: 0, snaps: 0, maxErr: 0 };

  /** Ms of input recorded under the current seq: sent with the next move as its `ms`. */
  let seqMs = 0;

  function nextSeq(): number {
    seq += 1;
    seqMs = 0;
    return seq;
  }

  /** The pace a held direction moves at now: the same rule the server's Motion uses. */
  function pace(): Pace {
    return pickPace({ dash, tired, canDash });
  }

  function moveMsg(dx: number, dy: number): ClientMsg {
    // How long the move being replaced lasted here, so the server walks it exactly that long.
    const ms = Math.round(seqMs * 10) / 10;
    // The server decides whether a dash is allowed; asking is all the client does.
    return dash && (dx !== 0 || dy !== 0) ? { t: "move", dx, dy, seq: nextSeq(), dash: true, ms } : { t: "move", dx, dy, seq: nextSeq(), ms };
  }

  function record(frame: InputFrame): void {
    if (frame.seq === seq) seqMs += frame.dtMs;
    inputs.push(frame);
    if (inputs.length > MAX_INPUTS) inputs.splice(0, inputs.length - MAX_INPUTS);
  }

  function decayCorrection(dtMs: number): void {
    if (corrLeftMs <= 0) return;
    const keep = Math.max(0, corrLeftMs - dtMs) / corrLeftMs;
    corr = { x: corr.x * keep, y: corr.y * keep };
    corrLeftMs = Math.max(0, corrLeftMs - dtMs);
    if (corrLeftMs === 0) corr = { x: 0, y: 0 };
  }

  /** Advances along the click-to-move path for dtMs, recording what was moved for replay. */
  function walkPath(dtMs: number, grid: CollisionGrid): void {
    let left = dtMs;
    moving = false;
    while (path && left > 0) {
      const target = path[0];
      const d = dist({ x, y }, target);
      if (d <= ARRIVE_DIST) {
        path.shift();
        if (path.length === 0) path = null;
        continue;
      }
      const speed = pathSpeed(tired);
      const r = stepToward({ x, y, facing }, target, speed, left, grid);
      // Time actually spent: stepToward never overshoots, so a short final leg uses less than dt.
      const used = Math.min(left, (d / speed) * 1000);
      if (r.x === x && r.y === y) {
        path = null; // stuck (something blocks the path): stop like the server would
        break;
      }
      record({ seq, dx: (target.x - x) / d, dy: (target.y - y) / d, dtMs: used, ...speedOf(speed) });
      x = r.x;
      y = r.y;
      facing = r.facing;
      moving = true;
      left -= used;
      if (r.arrived) {
        path.shift();
        if (path.length === 0) path = null;
      }
    }
  }

  /** Integrates the current input (held direction or path) up to clock time `t`. */
  function advance(t: number): void {
    const from = simAt ?? t;
    simAt = Math.max(from, t);
    // Counted here, not per frame: a tick that lands between frames integrates part of the
    // frame early (reconcile), and that time must still count toward the next resend.
    sinceSendMs += simAt - from;
    const dtMs = Math.min(Math.max(0, t - from), MAX_DT_MS);
    const grid = collision.get();
    if (!grid) {
      moving = false;
      return;
    }
    if (path) {
      walkPath(dtMs, grid);
    } else if (lastDir.dx !== 0 || lastDir.dy !== 0) {
      if (dtMs <= 0) return;
      const speed = paceSpeed(pace());
      const r = stepDirection({ x, y, facing }, lastDir.dx, lastDir.dy, speed, dtMs, grid);
      record({ seq, dx: lastDir.dx, dy: lastDir.dy, dtMs, ...speedOf(speed) });
      x = r.x;
      y = r.y;
      facing = r.facing;
      moving = r.moving;
    } else {
      moving = false;
    }
  }

  /**
   * Switches direction at clock time `at` (a key event's timeStamp, or the frame start). The old
   * input is integrated up to `at` first, so walking lasts exactly as long as the key was held,
   * which is also how long the server walks (it integrates between the same two messages).
   */
  function changeDir(dx: number, dy: number, at: number, wantDash: boolean): ClientMsg {
    advance(Math.max(at, simAt ?? at));
    if ((dx !== 0 || dy !== 0) && path) path = null; // keys override click-to-move
    lastDir = { dx, dy };
    dash = wantDash && (dx !== 0 || dy !== 0);
    sinceSendMs = 0;
    return moveMsg(dx, dy);
  }

  /** Same direction, but Shift was pressed or released. */
  const dashChanged = (dx: number, dy: number, wantDash: boolean) => (wantDash && (dx !== 0 || dy !== 0)) !== dash;

  const predictor: Predictor = {
    step(rawDx, rawDy, rawDt, now, wantDash = false) {
      const dtMs = Math.max(0, rawDt);
      const t = now ?? (simAt ?? 0) + dtMs;
      if (simAt === null) simAt = t - Math.min(dtMs, MAX_DT_MS);
      const dx = sign(rawDx);
      const dy = sign(rawDy);
      decayCorrection(Math.min(dtMs, MAX_DT_MS));

      let send: ClientMsg | null = null;
      // A change that setDir() did not already see (no key event, e.g. typing started): treat it
      // as starting with this frame, so the player still moves on this very frame.
      if (dx !== lastDir.dx || dy !== lastDir.dy || dashChanged(dx, dy, wantDash)) send = changeDir(dx, dy, simAt, wantDash);
      advance(t);
      if (!send && (dx !== 0 || dy !== 0) && sinceSendMs >= RESEND_MS) {
        send = moveMsg(dx, dy);
        sinceSendMs = 0;
      }
      return { send };
    },

    setDir(rawDx, rawDy, at, wantDash = false) {
      const dx = sign(rawDx);
      const dy = sign(rawDy);
      if (dx === lastDir.dx && dy === lastDir.dy && !dashChanged(dx, dy, wantDash)) return null;
      return changeDir(dx, dy, at, wantDash);
    },

    setLimits(l) {
      if (l.tired === tired && l.canDash === canDash) return;
      // Movement so far keeps the old speed (the server switches the same way, see Motion.setTired).
      if (simAt !== null) advance(simAt);
      tired = l.tired;
      canDash = l.canDash;
    },

    reconcile(server, ack, ackMs, now) {
      // A tick can land between two frames (or during a long one). The server's ackMs counts
      // walking we have not integrated yet, so bring the prediction up to the present first:
      // otherwise the replay comes up short, we are pulled forward, and the next frame then
      // walks that stretch a second time and gets pulled back on the following tick.
      if (now !== undefined && simAt !== null && now > simAt) advance(now);
      const shown = { x: x + corr.x, y: y + corr.y };
      const grid = collision.get();
      let px = server.x;
      let py = server.y;
      let pf = server.facing;

      if (ack === undefined) {
        // No ack support: we can't tell which inputs the server has seen, so only fix big
        // errors, or drift while standing still (where server and client must agree).
        const err = dist(shown, server);
        if (err > SNAP_DIST || (!moving && !path && inputs.length === 0 && err > EPS_DIST)) {
          applyCorrection(px, py, err > SNAP_DIST);
          if (!moving) facing = pf;
        }
        return;
      }

      if (ack > acked) acked = ack;
      // ackMs describes `ack`; for a stale ack (from before a reset) it says nothing useful.
      const ms = ack === acked ? ackMs : undefined;
      // Past the end of a move we already replaced: the server will settle back. Keep our own
      // position until it has (the next tick), instead of being pulled forward and then back.
      const guess = walkedAhead(inputs, acked, ms, seq) > 0;
      const replay = unsimulated(inputs, acked, ms);
      inputs = inputs.filter((f) => (ms === undefined ? f.seq > acked : f.seq >= acked));
      if (grid) {
        for (const f of replay) {
          const r = stepDirection({ x: px, y: py, facing: pf }, f.dx, f.dy, f.speed ?? PLAYER_SPEED, f.dtMs, grid);
          px = r.x;
          py = r.y;
          pf = r.facing;
        }
      }
      if (inputs.length > 0 || path || lastDir.dx !== 0 || lastDir.dy !== 0) pf = facing;
      facing = pf;
      if (guess) return;
      const err = dist(shown, { x: px, y: py });
      if (err <= EPS_DIST) return;
      applyCorrection(px, py, err > SNAP_DIST);
    },

    moveTo(target) {
      const msg: ClientMsg = { t: "moveTo", x: target.x, y: target.y, seq: nextSeq() };
      lastDir = { dx: 0, dy: 0 };
      dash = false;
      sinceSendMs = 0;
      const grid = collision.get();
      if (!grid) {
        path = null;
        return msg;
      }
      const tiles = findPath(grid, { x, y }, target);
      if (tiles === null) {
        // Unreachable target: the server decides; walk straight and let walls stop us.
        path = [{ x: target.x, y: target.y }];
      } else {
        path = tiles;
        // End on the clicked point (kept inside the goal tile, like the server) not the tile centre.
        const goal = moveGoal(grid, target);
        if (path.length > 0) path[path.length - 1] = goal;
        else path.push(goal);
        if (path.length === 0) path = null;
      }
      return msg;
    },

    state() {
      const held = lastDir.dx !== 0 || lastDir.dy !== 0;
      const p = tired ? "tired" : held && moving && pace() === "dash" ? "dash" : undefined;
      return p ? { x: x + corr.x, y: y + corr.y, facing, moving, pace: p } : { x: x + corr.x, y: y + corr.y, facing, moving };
    },

    face(f) {
      // A swing turns you toward its tile. Without this the predictor kept the facing of your
      // last step, and reconcile handed that back once the swing ended, so you spun away.
      if (!moving && !path && lastDir.dx === 0 && lastDir.dy === 0) facing = f;
    },

    stats: () => ({ ...stats }),

    reset(at, f) {
      // seq stays monotonic so a late ack from before the reset can't drop newer inputs.
      x = at.x;
      y = at.y;
      facing = f;
      moving = false;
      corr = { x: 0, y: 0 };
      corrLeftMs = 0;
      inputs = [];
      acked = seq;
      lastDir = { dx: 0, dy: 0 };
      dash = false;
      sinceSendMs = 0;
      path = null;
      simAt = null;
    },
  };

  function applyCorrection(nx: number, ny: number, snap: boolean): void {
    const shown = { x: x + corr.x, y: y + corr.y };
    const err = dist(shown, { x: nx, y: ny });
    stats.corrections += 1;
    if (err >= VISIBLE_ERR) stats.visible += 1;
    if (snap) stats.snaps += 1;
    stats.maxErr = Math.max(stats.maxErr, err);
    x = nx;
    y = ny;
    if (snap) {
      corr = { x: 0, y: 0 };
      corrLeftMs = 0;
      if (path) {
        // The old route started somewhere else: re-plan from the corrected position.
        const goal = path[path.length - 1];
        const grid = collision.get();
        const tiles = grid ? findPath(grid, { x, y }, goal) : null;
        path = tiles ? [...tiles.slice(0, -1), goal] : null;
      }
    } else {
      corr = { x: shown.x - nx, y: shown.y - ny };
      corrLeftMs = CORRECT_MS;
    }
  }

  return predictor;
};
