// Collision grid + body test.
import { BLOCKING_GROUND, type MapData, type PlacedObject } from "../types";
import { getItem } from "../items";
import { objectRect } from "./geometry";

/** Collision grid: 1 = blocked. Built from ground + props (+ placed objects at home + unbroken rocks). */
export interface CollisionGrid {
  width: number;
  height: number;
  cells: Uint8Array;
}

/** Body extents around the feet position (x,y), in tiles. Fits inside one tile when centred on it. */
export const BODY_HALF_W = 0.3;
export const BODY_UP = 0.3; // how far the body reaches above the feet
export const BODY_DOWN = 0.1; // how far below
/** Keeps the right/bottom body edge from touching the next cell when flush against it. */
const EDGE_EPS = 1e-6;

/**
 * Builds the collision grid for a map. Ground kinds in BLOCKING_GROUND, every prop footprint
 * (except flat ones like rugs; exit tiles are cut back out),
 * placed furniture (except walkable ones like rugs) and rocks block.
 * `extra.rocks` is the list of *unbroken* rocks; when omitted every rock in `map.rocks` blocks.
 */
export function buildCollision(
  map: MapData,
  extra?: { objects?: PlacedObject[]; rocks?: { x: number; y: number }[] },
): CollisionGrid {
  const grid: CollisionGrid = { width: map.width, height: map.height, cells: new Uint8Array(map.width * map.height) };
  for (let i = 0; i < grid.cells.length; i++) {
    if (BLOCKING_GROUND.has(map.ground[i])) grid.cells[i] = 1;
  }
  for (const p of map.props) if (!p.walkable) setBlocked(grid, p.x, p.y, p.w, p.h, true);
  // Exit tiles are always walkable: a building's door is an exit cut into its footprint.
  for (const e of map.exits) setBlocked(grid, e.x, e.y, e.w, e.h, false);
  for (const o of extra?.objects ?? []) {
    if (getItem(o.item)?.walkable) continue;
    const r = objectRect(o.item, o.x, o.y, o.rotation);
    setBlocked(grid, r.x, r.y, r.w, r.h, true);
  }
  for (const r of extra?.rocks ?? map.rocks ?? []) setBlocked(grid, r.x, r.y, 1, 1, true);
  return grid;
}

/** Marks (or clears) a tile rectangle. Parts outside the grid are ignored. */
export function setBlocked(grid: CollisionGrid, x: number, y: number, w: number, h: number, blocked: boolean): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(grid.width, Math.floor(x) + w);
  const y1 = Math.min(grid.height, Math.floor(y) + h);
  const v = blocked ? 1 : 0;
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) grid.cells[ty * grid.width + tx] = v;
  }
}

/** True if tile (tx,ty) is outside the map or blocked. */
export function isBlocked(grid: CollisionGrid, tx: number, ty: number): boolean {
  // NaN/fractions fail every bounds comparison below, so reject them explicitly.
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return true;
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.cells[ty * grid.width + tx] === 1;
}

/** True if an entity with a ~0.6 tile wide body centred at (x,y) (feet position) fits. */
export function canStand(grid: CollisionGrid, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const x0 = Math.floor(x - BODY_HALF_W);
  const x1 = Math.floor(x + BODY_HALF_W - EDGE_EPS);
  const y0 = Math.floor(y - BODY_UP);
  const y1 = Math.floor(y + BODY_DOWN - EDGE_EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (isBlocked(grid, tx, ty)) return false;
  }
  return true;
}
