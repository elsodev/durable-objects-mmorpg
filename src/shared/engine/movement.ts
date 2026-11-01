// Kinematic movement with wall sliding. Same code runs on the server (authoritative) and the
// client (prediction), so it must stay deterministic.
import type { Facing, Vec2 } from "../types";
import { BODY_DOWN, BODY_HALF_W, BODY_UP, canStand, type CollisionGrid } from "./collision";
import { dist, facingFor } from "./geometry";

export interface MoveResult {
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
}

/** Long moves are split so a single step never crosses more than one cell boundary. */
const MAX_SUBSTEP = 0.25;
/** Collision with a wall "snaps" to the contact point; this is the slack used there. */
const EPS = 1e-6;
/** Holding a key into a wall corner nudges you toward the free lane if you are this close to it. */
const CORNER_NUDGE = 0.4;
/** stepToward considers the target reached within this distance. */
export const ARRIVE_DIST = 0.1;

/** How far inside its tile a move target is kept, so "arrived" never means "still on the neighbour". */
const GOAL_INSET = ARRIVE_DIST + 0.15;

/**
 * Where a click-to-move should stop for target `t`: the clicked point pulled inside its tile by
 * GOAL_INSET (a target on a tile edge such as x = 39 would otherwise "arrive" at 38.9, one tile
 * short of an exit), or the tile centre when that point isn't standable.
 */
export function moveGoal(grid: CollisionGrid, t: Vec2): Vec2 {
  const tx = Math.floor(t.x);
  const ty = Math.floor(t.y);
  const p = {
    x: Math.min(Math.max(t.x, tx + GOAL_INSET), tx + 1 - GOAL_INSET),
    y: Math.min(Math.max(t.y, ty + GOAL_INSET), ty + 1 - GOAL_INSET),
  };
  return canStand(grid, p.x, p.y) ? p : { x: tx + 0.5, y: ty + 0.5 };
}

/**
 * Moves one axis by `d` (|d| <= MAX_SUBSTEP). If blocked, stops flush against the wall
 * instead of leaving a gap. Returns the new coordinate on that axis.
 */
function moveAxis(grid: CollisionGrid, x: number, y: number, d: number, axis: "x" | "y"): number {
  const cur = axis === "x" ? x : y;
  if (d === 0) return cur;
  const target = cur + d;
  const fits = (v: number) => (axis === "x" ? canStand(grid, v, y) : canStand(grid, x, v));
  if (fits(target)) return target;

  // Contact point: body edge exactly on the boundary of the cell we bumped into.
  const lo = axis === "x" ? BODY_HALF_W : BODY_UP; // extent toward negative axis
  const hi = axis === "x" ? BODY_HALF_W : BODY_DOWN; // extent toward positive axis
  const contact = d > 0 ? Math.floor(target + hi - EPS) - hi : Math.floor(target - lo) + 1 + lo;
  const progressed = d > 0 ? contact > cur : contact < cur;
  return progressed && fits(contact) ? contact : cur;
}

/**
 * When pushing straight into a wall but almost lined up with an opening (doorways!),
 * slide sideways toward the centre of the lane. Returns the perpendicular coordinate.
 */
function cornerNudge(grid: CollisionGrid, x: number, y: number, d: number, axis: "x" | "y"): number {
  const perp = axis === "x" ? y : x;
  const centre = Math.floor(perp) + 0.5;
  const off = centre - perp;
  if (off === 0 || Math.abs(off) > CORNER_NUDGE) return perp;
  const open = axis === "x" ? canStand(grid, x + d, centre) : canStand(grid, centre, y + d);
  if (!open) return perp;
  const amount = Math.min(Math.abs(d), Math.abs(off)) * Math.sign(off);
  const next = perp + amount;
  return (axis === "x" ? canStand(grid, x, next) : canStand(grid, next, y)) ? next : perp;
}

/** Moves `distance` tiles along unit vector (ux,uy) with sliding. */
function slide(grid: CollisionGrid, x: number, y: number, ux: number, uy: number, distance: number): Vec2 {
  const n = Math.max(1, Math.ceil(distance / MAX_SUBSTEP));
  const sx = (ux * distance) / n;
  const sy = (uy * distance) / n;
  for (let i = 0; i < n; i++) {
    const nx = moveAxis(grid, x, y, sx, "x");
    const ny = moveAxis(grid, nx, y, sy, "y");
    // Pure axis movement fully blocked: try a corner nudge.
    if (nx === x && ny === y) {
      if (sy === 0 && sx !== 0) y = cornerNudge(grid, x, y, sx, "x");
      else if (sx === 0 && sy !== 0) x = cornerNudge(grid, x, y, sy, "y");
    } else {
      x = nx;
      y = ny;
    }
  }
  return { x, y };
}

/** Move by a held direction for dtMs, sliding along walls. */
export function stepDirection(
  pos: Vec2 & { facing: Facing },
  dx: number,
  dy: number,
  speed: number,
  dtMs: number,
  grid: CollisionGrid,
): MoveResult {
  const len = Math.hypot(dx, dy);
  const facing = facingFor(dx, dy, pos.facing);
  if (len === 0 || dtMs <= 0 || speed <= 0) return { x: pos.x, y: pos.y, facing, moving: false };
  const p = slide(grid, pos.x, pos.y, dx / len, dy / len, (speed * dtMs) / 1000);
  return { x: p.x, y: p.y, facing, moving: p.x !== pos.x || p.y !== pos.y };
}

/** Move toward a target point for dtMs (straight line with wall sliding; stops when within 0.1). */
export function stepToward(
  pos: Vec2 & { facing: Facing },
  target: Vec2,
  speed: number,
  dtMs: number,
  grid: CollisionGrid,
): MoveResult & { arrived: boolean } {
  const d = dist(pos, target);
  if (d <= ARRIVE_DIST) return { x: pos.x, y: pos.y, facing: pos.facing, moving: false, arrived: true };
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const facing = facingFor(dx, dy, pos.facing);
  if (dtMs <= 0 || speed <= 0) return { x: pos.x, y: pos.y, facing, moving: false, arrived: false };
  // Never overshoot: cap the distance at what's left.
  const p = slide(grid, pos.x, pos.y, dx / d, dy / d, Math.min((speed * dtMs) / 1000, d));
  return {
    x: p.x,
    y: p.y,
    facing,
    moving: p.x !== pos.x || p.y !== pos.y,
    arrived: dist(p, target) <= ARRIVE_DIST,
  };
}
