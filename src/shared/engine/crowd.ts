// Soft obstacles: other characters (players, NPCs). Walls live in the collision grid; people
// don't, because they move every tick. NPCs check this before each step and plan around people
// standing still. Pure and cheap: a handful of distance checks per step.
import type { Vec2 } from "../types";
import type { CollisionGrid } from "./collision";

/** Personal space between two characters' feet, in tiles (a body is ~0.6 wide). */
export const BODY_GAP = 0.75;

/**
 * True when stepping from `from` to `next` walks into someone: `next` is within `gap` of them
 * and closer than `from` was. Moving away from someone already too close is always allowed, so
 * nobody gets stuck after spawning on top of another character.
 */
export function bumps(from: Vec2, next: Vec2, others: readonly Vec2[], gap = BODY_GAP): boolean {
  for (const o of others) {
    const after = Math.hypot(next.x - o.x, next.y - o.y);
    if (after < gap && after < Math.hypot(from.x - o.x, from.y - o.y)) return true;
  }
  return false;
}

/**
 * A copy of `grid` with the tiles people stand on blocked, for planning a path around them.
 * Tiles in `keepFree` (the walker's own tile and its goal) stay as they were.
 */
export function withPeople(grid: CollisionGrid, people: readonly Vec2[], keepFree: readonly Vec2[]): CollisionGrid {
  const cells = grid.cells.slice();
  const keep = new Set(keepFree.map((p) => Math.floor(p.y) * grid.width + Math.floor(p.x)));
  for (const p of people) {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
    const i = ty * grid.width + tx;
    if (!keep.has(i)) cells[i] = 1;
  }
  return { width: grid.width, height: grid.height, cells };
}
