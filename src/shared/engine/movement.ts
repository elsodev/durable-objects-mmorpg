// Kinematic movement with wall sliding. Same code runs on the server (authoritative) and the
// client (prediction), so it must stay deterministic.
import type { Facing, Vec2 } from "../types";
import { BODY_DOWN, BODY_HALF_W, BODY_UP, EDGE_EPS, canStand, type CollisionGrid } from "./collision";
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
/** Back-off from a contact point that rounding put inside the wall. */
const CONTACT_SLACK = 1e-9;
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
  if (!progressed) return cur;
  if (fits(contact)) return contact;
  // Rounding can leave the exact contact a hair inside the wall; stop just short of it instead.
  const shy = contact - Math.sign(d) * CONTACT_SLACK;
  const stillProgressed = d > 0 ? shy > cur : shy < cur;
  return stillProgressed && fits(shy) ? shy : cur;
}

/**
 * When pushing straight into a wall but almost lined up with an opening (doorways!),
 * slide sideways toward the centre of the lane, by at most `budget`. Returns the perpendicular
 * coordinate. The lane is probed a fixed distance ahead so the answer doesn't depend on how
 * long the step is.
 */
function cornerNudge(grid: CollisionGrid, x: number, y: number, d: number, budget: number, axis: "x" | "y"): number {
  const perp = axis === "x" ? y : x;
  const centre = Math.floor(perp) + 0.5;
  const off = centre - perp;
  if (off === 0 || Math.abs(off) > CORNER_NUDGE) return perp;
  const probe = Math.sign(d) * MAX_SUBSTEP;
  const open = axis === "x" ? canStand(grid, x + probe, centre) : canStand(grid, centre, y + probe);
  if (!open) return perp;
  // Stop as soon as the body clears the corner (the walk goes on from there), or at the centre.
  const lo = axis === "x" ? BODY_UP : BODY_HALF_W;
  const hi = axis === "x" ? BODY_DOWN : BODY_HALF_W;
  const clearAt = off < 0 ? Math.floor(perp + hi - EDGE_EPS) - hi - CONTACT_SLACK : Math.floor(perp - lo) + 1 + lo + CONTACT_SLACK;
  const need = Math.min(Math.abs(clearAt - perp), Math.abs(off));
  const amount = Math.min(budget, need) * Math.sign(off);
  const next = perp + amount;
  return (axis === "x" ? canStand(grid, x, next) : canStand(grid, next, y)) ? next : perp;
}

/** Distance along the walk (unit component `u`) until either body edge (pos-lo, pos+hi) crosses a cell edge. */
function toCellEdge(pos: number, u: number, lo: number, hi: number): number {
  if (u === 0) return Infinity;
  const gap = (edge: number) => (u > 0 ? Math.floor(edge) + 1 - edge : edge - (Math.ceil(edge) - 1));
  return Math.max(Math.min(gap(pos - lo), gap(pos + hi)), EPS) / Math.abs(u);
}

/**
 * Moves `distance` tiles along unit vector (ux,uy) with sliding. Distance is spent only on
 * movement that happens (a straight walk that stops at a wall keeps the rest for the corner
 * nudge), so the result is the same whether it is walked in one long step (the server, once per
 * message) or in many short ones (the client, once per frame). If it were not, every doorway
 * would pull the predicted player back or forward a little.
 */
function slide(grid: CollisionGrid, x: number, y: number, ux: number, uy: number, distance: number): Vec2 {
  const pure = ux === 0 || uy === 0;
  let left = distance;
  // Each pass spends a substep, stops at a cell edge, reaches a wall or nudges: this bounds it.
  let passes = Math.ceil(distance) * 10 + Math.ceil(distance / MAX_SUBSTEP) * 3 + 16;
  // An axis held against a wall crosses no edges, so its edges don't cut the substeps short.
  let stuckX = false;
  let stuckY = false;
  while (left > EPS && passes-- > 0) {
    // A substep also ends where the body crosses a cell edge, so which cells it overlaps (and so
    // what blocks it) is the same all along it, however long the whole move is.
    const s = Math.min(
      left,
      MAX_SUBSTEP,
      stuckX ? Infinity : toCellEdge(x, ux, BODY_HALF_W, BODY_HALF_W),
      stuckY ? Infinity : toCellEdge(y, uy, BODY_UP, BODY_DOWN),
    );
    const sx = ux * s;
    const sy = uy * s;
    const nx = moveAxis(grid, x, y, sx, "x");
    // y is tried halfway along x: a substep that ends just as the body clears a corner must not
    // count as clear for all of it (that made long steps cut corners that short ones could not).
    let ny = sy === 0 ? y : moveAxis(grid, (x + nx) / 2, y, sy, "y");
    if (ny !== y && !canStand(grid, nx, ny)) ny = moveAxis(grid, nx, y, sy, "y");
    if (nx === x && ny === y) {
      // Fully blocked: only a straight push can be nudged toward a lane.
      if (!pure) break;
      const along = sx !== 0 ? "x" : "y";
      const before = along === "x" ? y : x;
      const after = cornerNudge(grid, x, y, sx !== 0 ? sx : sy, s, along);
      if (after === before) break;
      if (along === "x") y = after;
      else x = after;
      left -= Math.abs(after - before);
      // Held against the wall: its edges no longer cut the substeps (the nudge budget).
      stuckX = sx !== 0;
      stuckY = sy !== 0;
      continue;
    }
    left -= pure ? Math.abs(nx - x) + Math.abs(ny - y) : s;
    stuckX = sx !== 0 && nx === x;
    stuckY = sy !== 0 && ny === y;
    x = nx;
    y = ny;
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
