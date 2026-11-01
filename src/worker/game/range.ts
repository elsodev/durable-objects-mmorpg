// Reach checks for player actions (all distances in tiles, from the player's feet).
import type { Vec2 } from "../../shared/types";

/** Tools reach the tile the player stands on and its neighbours (a little slack for latency). */
export const TOOL_REACH = 2;
export const NPC_TALK_RANGE = 3;
export const NPC_CHAT_RANGE = 4;
export const PROP_REACH = 2.5;
/** Shops stay open while you browse near the NPC. */
export const SHOP_RANGE = 6;

export function tileCentreDist(p: Vec2, tx: number, ty: number): number {
  return Math.hypot(p.x - (tx + 0.5), p.y - (ty + 0.5));
}

/** Distance from a point to the nearest point of a tile rectangle (0 inside). */
export function distToRect(p: Vec2, r: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function inToolReach(p: Vec2, tx: number, ty: number): boolean {
  return tileCentreDist(p, tx, ty) <= TOOL_REACH;
}
