// Authoritative player movement shared by ZoneRoom and HomeRoom: held direction or a path from
// moveTo. Movement is integrated in real time between messages, not only once per tick: a new
// input first finishes the old one up to the moment it arrived. Without that, a key held for
// 300 ms could move the player for 200 or 400 ms depending on where the ticks fell, and the
// client's prediction would be corrected (pulled forward after release) on every tick.
//
// Each tick reports the last seq received (`ack`) and how long that input has been applied
// (`ackMs`), so the client can replay exactly the part of its input history the server has not
// simulated yet.
import type { EntityState, Vec2 } from "../../shared/types";
import { MOVE_TO_MIN_INTERVAL_MS } from "../env";
import { findPath, moveGoal, PLAYER_SPEED, stepDirection, stepToward, type CollisionGrid } from "../../shared/engine";

/** One integration step never covers more than this (a stalled isolate must not teleport anyone). */
export const MAX_STEP_MS = 250;

export class Motion {
  dx = 0;
  dy = 0;
  path: Vec2[] | null = null;
  /** Highest seq received; reported as `ack`. */
  private seq: number | undefined;
  /** When the input with `seq` started being applied. */
  private seqAt = 0;
  /** Time the entity has been integrated up to; undefined until the first input or tick. */
  private at: number | undefined;
  private lastMoveTo = -Infinity;
  /** Set when an integration step changed the position (lets the tick mark the save dirty). */
  private movedFlag = false;

  constructor(now?: number) {
    this.at = now;
  }

  /** Integrates the current input from the last integration time up to `now`. */
  advance(e: EntityState, grid: CollisionGrid, now: number): void {
    const from = this.at ?? now;
    this.at = Math.max(from, now);
    const dtMs = Math.min(MAX_STEP_MS, Math.max(0, now - from));
    const bx = e.x;
    const by = e.y;
    if (this.dx !== 0 || this.dy !== 0) {
      const r = stepDirection(e, this.dx, this.dy, PLAYER_SPEED, dtMs, grid);
      Object.assign(e, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
    } else if (this.path && this.path.length > 0) {
      let left = dtMs;
      // A short step can reach several waypoints; keep walking with the time that is left.
      while (this.path && this.path.length > 0 && left > 0) {
        const target = this.path[0]!;
        const d = Math.hypot(target.x - e.x, target.y - e.y);
        const r = stepToward(e, target, PLAYER_SPEED, left, grid);
        Object.assign(e, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
        if (r.arrived) {
          this.path.shift();
          left -= Math.min(left, (d / PLAYER_SPEED) * 1000);
        } else {
          if (!r.moving) this.path = null; // stuck (something moved into the way)
          left = 0;
        }
        if (this.path && this.path.length === 0) this.path = null;
      }
    } else {
      e.moving = false;
    }
    if (e.x !== bx || e.y !== by) this.movedFlag = true;
  }

  onMove(e: EntityState, grid: CollisionGrid, dx: number, dy: number, seq: number | undefined, now: number): void {
    this.advance(e, grid, now);
    this.dx = dx;
    this.dy = dy;
    if (dx !== 0 || dy !== 0) this.path = null;
    this.noteSeq(seq, now);
  }

  /** Returns false if throttled or unreachable (caller rejects). */
  onMoveTo(grid: CollisionGrid, e: EntityState, x: number, y: number, seq: number | undefined, now: number): boolean {
    this.advance(e, grid, now);
    this.noteSeq(seq, now);
    if (now - this.lastMoveTo < MOVE_TO_MIN_INTERVAL_MS) return false;
    this.lastMoveTo = now;
    const path = findPath(grid, e, { x, y });
    if (!path) return false;
    this.dx = 0;
    this.dy = 0;
    // End on the clicked point (kept inside the goal tile, see moveGoal), not the tile centre.
    const goal = moveGoal(grid, { x, y });
    if (path.length > 0) path[path.length - 1] = goal;
    this.path = path.length > 0 ? path : [goal];
    return true;
  }

  private noteSeq(seq: number | undefined, now: number): void {
    if (seq === undefined) return;
    this.seq = seq;
    this.seqAt = now;
  }

  /** No held direction and no path: stepping would not move the player. */
  get idle(): boolean {
    return this.dx === 0 && this.dy === 0 && !this.path;
  }

  stop(): void {
    this.dx = 0;
    this.dy = 0;
    this.path = null;
  }

  /** True once after any step that moved the entity. */
  takeMoved(): boolean {
    const m = this.movedFlag;
    this.movedFlag = false;
    return m;
  }

  /** Brings the entity up to `now` (call once per tick); returns the seq to ack (undefined if none received). */
  step(e: EntityState, grid: CollisionGrid, now: number): number | undefined {
    this.advance(e, grid, now);
    return this.seq;
  }

  /** How long (ms, as of `now`) the acked input has been applied; undefined with no seq. */
  ackMs(now: number): number | undefined {
    if (this.seq === undefined) return undefined;
    return Math.max(0, now - this.seqAt);
  }
}
