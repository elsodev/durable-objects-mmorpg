// Dropping things from the bag onto the ground: how much comes out of the slot, and where it lands.
import type { Facing, Inventory, ItemId, Vec2 } from "../types";
import { isBlocked, type CollisionGrid } from "./collision";
import { facingVector } from "./combat";
import { removeFromSlot } from "./inventory";

/** How far in front of your feet a dropped item lands (tiles). */
export const DROP_AHEAD = 0.6;

/** Takes `qty` (default: the whole stack) out of `slot` to drop it. Null (bag unchanged) if it can't. */
export function takeForDrop(inv: Inventory, slot: number, qty?: number): { item: ItemId; qty: number } | null {
  const s = inv.slots[slot];
  if (!s) return null;
  const n = qty ?? s.qty;
  const item = s.item;
  return removeFromSlot(inv, slot, n) ? { item, qty: n } : null;
}

/** In front of you when that spot is open ground, otherwise at your feet. */
export function dropSpot(grid: CollisionGrid, pos: Vec2, facing: Facing): Vec2 {
  const f = facingVector(facing);
  const ahead = { x: pos.x + f.x * DROP_AHEAD, y: pos.y + f.y * DROP_AHEAD };
  return isBlocked(grid, Math.floor(ahead.x), Math.floor(ahead.y)) ? { x: pos.x, y: pos.y } : ahead;
}
