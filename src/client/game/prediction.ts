// Client-side prediction for your own player: moves locally with the same engine the server runs,
// numbers move intents with `seq`, and reconciles against authoritative ticks by rewinding to the
// server position and replaying the inputs the server has not acked yet.
import type { CreatePredictor, Predictor } from "../contracts";
import type { ClientMsg } from "../../shared/protocol";
import type { Facing, MapData, PlacedObject, Vec2 } from "../../shared/types";
import {
  ARRIVE_DIST,
  PLAYER_SPEED,
  buildCollision,
  dist,
  findPath,
  moveGoal,
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
/** Frame dt cap: a long stall (tab in background) must not produce a huge local jump. */
const MAX_DT_MS = 250;
/** Input history cap, in case the server never acks (old server, dropped socket). */
const MAX_INPUTS = 600;

/** One predicted frame of movement, replayable on top of a server position. */
interface InputFrame {
  seq: number;
  /** Direction actually moved (held key or unit vector toward a path waypoint). */
  dx: number;
  dy: number;
  dtMs: number;
}

interface Extras {
  objects: PlacedObject[];
  rocks: Vec2[];
}

/** Rebuilds the collision grid only when the map, objects or rocks actually change. */
export function createCollisionCache(getMap: () => MapData | null, getExtras: () => Extras) {
  let map: MapData | null = null;
  let objects: PlacedObject[] = [];
  let rocks: Vec2[] = [];
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
      if (grid && m === map && sameObjects(ex.objects, objects) && sameRocks(ex.rocks, rocks)) return grid;
      map = m;
      objects = ex.objects.slice();
      rocks = ex.rocks.slice();
      grid = buildCollision(m, { objects, rocks });
      return grid;
    },
  };
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

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
  let sinceSendMs = 0;
  let path: Vec2[] | null = null;

  function nextSeq(): number {
    seq += 1;
    return seq;
  }

  function record(frame: InputFrame): void {
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
      const r = stepToward({ x, y, facing }, target, PLAYER_SPEED, left, grid);
      // Time actually spent: stepToward never overshoots, so a short final leg uses less than dt.
      const used = Math.min(left, (d / PLAYER_SPEED) * 1000);
      if (r.x === x && r.y === y) {
        path = null; // stuck (something blocks the path): stop like the server would
        break;
      }
      record({ seq, dx: (target.x - x) / d, dy: (target.y - y) / d, dtMs: used });
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

  const predictor: Predictor = {
    step(rawDx, rawDy, rawDt) {
      const dtMs = Math.min(Math.max(0, rawDt), MAX_DT_MS);
      const dx = sign(rawDx);
      const dy = sign(rawDy);
      decayCorrection(dtMs);
      sinceSendMs += dtMs;

      let send: ClientMsg | null = null;
      const held = dx !== 0 || dy !== 0;
      if (held && path) path = null; // keys override click-to-move
      if (dx !== lastDir.dx || dy !== lastDir.dy || (held && sinceSendMs >= RESEND_MS)) {
        send = { t: "move", dx, dy, seq: nextSeq() };
        lastDir = { dx, dy };
        sinceSendMs = 0;
      }

      const grid = collision.get();
      if (!grid) {
        moving = false;
        return { send };
      }
      if (path) {
        walkPath(dtMs, grid);
      } else if (held) {
        const r = stepDirection({ x, y, facing }, dx, dy, PLAYER_SPEED, dtMs, grid);
        record({ seq, dx, dy, dtMs });
        x = r.x;
        y = r.y;
        facing = r.facing;
        moving = r.moving;
      } else {
        moving = false;
      }
      return { send };
    },

    reconcile(server, ack) {
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
      inputs = inputs.filter((f) => f.seq > acked);
      if (grid) {
        for (const f of inputs) {
          const r = stepDirection({ x: px, y: py, facing: pf }, f.dx, f.dy, PLAYER_SPEED, f.dtMs, grid);
          px = r.x;
          py = r.y;
          pf = r.facing;
        }
      }
      if (inputs.length > 0 || path || lastDir.dx !== 0 || lastDir.dy !== 0) pf = facing;
      facing = pf;
      const err = dist(shown, { x: px, y: py });
      if (err <= EPS_DIST) return;
      applyCorrection(px, py, err > SNAP_DIST);
    },

    moveTo(target) {
      const msg: ClientMsg = { t: "moveTo", x: target.x, y: target.y, seq: nextSeq() };
      lastDir = { dx: 0, dy: 0 };
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
      return { x: x + corr.x, y: y + corr.y, facing, moving };
    },

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
      sinceSendMs = 0;
      path = null;
    },
  };

  function applyCorrection(nx: number, ny: number, snap: boolean): void {
    const shown = { x: x + corr.x, y: y + corr.y };
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
