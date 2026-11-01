// Authoritative player movement shared by ZoneRoom and HomeRoom: held direction or a path from
// moveTo, applied once per tick. Input seq numbers are acked once the tick has applied them.
import type { EntityState, Vec2 } from "../../shared/types";
import { MOVE_TO_MIN_INTERVAL_MS } from "../env";
import { findPath, moveGoal, PLAYER_SPEED, stepDirection, stepToward, type CollisionGrid } from "../../shared/engine";

export class Motion {
  dx = 0;
  dy = 0;
  path: Vec2[] | null = null;
  /** Highest seq received; becomes `ack` after the next tick applies it. */
  private seq: number | undefined;
  private lastMoveTo = -Infinity;

  onMove(dx: number, dy: number, seq: number | undefined): void {
    this.dx = dx;
    this.dy = dy;
    if (dx !== 0 || dy !== 0) this.path = null;
    if (seq !== undefined) this.seq = seq;
  }

  /** Returns false if throttled or unreachable (caller rejects). */
  onMoveTo(grid: CollisionGrid, from: Vec2, x: number, y: number, seq: number | undefined, now: number): boolean {
    if (seq !== undefined) this.seq = seq;
    if (now - this.lastMoveTo < MOVE_TO_MIN_INTERVAL_MS) return false;
    this.lastMoveTo = now;
    const path = findPath(grid, from, { x, y });
    if (!path) return false;
    this.dx = 0;
    this.dy = 0;
    // End on the clicked point (kept inside the goal tile, see moveGoal), not the tile centre.
    const goal = moveGoal(grid, { x, y });
    if (path.length > 0) path[path.length - 1] = goal;
    this.path = path.length > 0 ? path : [goal];
    return true;
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

  /** Moves the entity for one tick; returns the seq to ack (undefined if none received). */
  step(e: EntityState, grid: CollisionGrid, dtMs: number): number | undefined {
    if (this.dx !== 0 || this.dy !== 0) {
      const r = stepDirection(e, this.dx, this.dy, PLAYER_SPEED, dtMs, grid);
      Object.assign(e, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
    } else if (this.path && this.path.length > 0) {
      const r = stepToward(e, this.path[0], PLAYER_SPEED, dtMs, grid);
      Object.assign(e, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
      if (r.arrived) this.path.shift();
      else if (!r.moving) this.path = null; // stuck (something moved into the way)
      if (this.path && this.path.length === 0) this.path = null;
    } else {
      e.moving = false;
    }
    return this.seq;
  }
}
