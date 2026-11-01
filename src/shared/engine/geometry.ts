// Small tile-geometry helpers shared by collision, farming and placement.
import type { Facing, ItemId, MapData, MapExit, Vec2 } from "../types";
import { getItem } from "../items";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Footprint of an item at a rotation; odd rotations swap w/h. Non-furniture is 1x1. */
export function footprint(item: ItemId, rotation: 0 | 1 | 2 | 3): { w: number; h: number } {
  const fp = getItem(item)?.footprint ?? { w: 1, h: 1 };
  return rotation % 2 === 1 ? { w: fp.h, h: fp.w } : { w: fp.w, h: fp.h };
}

/** Tile rectangle covered by an object with top-left (x,y). */
export function objectRect(item: ItemId, x: number, y: number, rotation: 0 | 1 | 2 | 3): Rect {
  return { x: Math.floor(x), y: Math.floor(y), ...footprint(item, rotation) };
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True if tile (tx,ty) is inside any of the rectangles. */
export function tileInAny(rects: Rect[] | undefined, tx: number, ty: number): boolean {
  return !!rects?.some((r) => pointInRect(r, tx, ty));
}

const FACING_DELTA: Record<Facing, Vec2> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Tile the player is facing (for using tools). Integer tile coordinates. */
export function facingTile(pos: Vec2, facing: Facing): Vec2 {
  const d = FACING_DELTA[facing];
  return { x: Math.floor(pos.x) + d.x, y: Math.floor(pos.y) + d.y };
}

/** Facing for a movement vector: the dominant axis wins, horizontal on ties. */
export function facingFor(dx: number, dy: number, fallback: Facing): Facing {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/** Facing that turns someone standing at `from` toward the centre of tile (tx, ty), e.g. to swing a tool at it. */
export function facingToTile(from: { x: number; y: number; facing: Facing }, tx: number, ty: number): Facing {
  return facingFor(tx + 0.5 - from.x, ty + 0.5 - from.y, from.facing);
}

/** The exit whose trigger rectangle contains the tile under (x,y), if any. */
export function exitAt(map: MapData, x: number, y: number): MapExit | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return map.exits.find((e) => pointInRect(e, tx, ty)) ?? null;
}
