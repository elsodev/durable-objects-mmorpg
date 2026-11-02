// Which placed storage piece (fridge) or wardrobe the player can open: one they face or stand beside.
import { objectRect } from "../../shared/engine";
import { getItem, isWardrobeItem } from "../../shared/items";
import type { PlacedObject, Vec2 } from "../../shared/types";

/** Reach to open storage (tiles from the feet to the piece's footprint), as on the server. */
export const STORE_REACH = 2.5;
/** The panel closes once you walk this far from the piece. */
export const STORE_WALK_AWAY = 3;

const distToRect = (p: Vec2, r: { x: number; y: number; w: number; h: number }): number => {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
};

/**
 * The piece (of those `opens` accepts) covering the tile ahead, else the nearest one within
 * `reach` of the feet; null when there is none.
 */
function pieceTarget(objects: Iterable<PlacedObject>, me: Vec2, ahead: Vec2, reach: number, opens: (o: PlacedObject) => boolean): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of objects) {
    if (!opens(o)) continue;
    const r = objectRect(o.item, o.x, o.y, o.rotation);
    if (Math.floor(ahead.x) >= r.x && Math.floor(ahead.x) < r.x + r.w && Math.floor(ahead.y) >= r.y && Math.floor(ahead.y) < r.y + r.h) return o.id;
    const d = distToRect(me, r);
    if (d <= reach && d < bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

export function storeTarget(objects: Iterable<PlacedObject>, me: Vec2, ahead: Vec2, reach = STORE_REACH): string | null {
  return pieceTarget(objects, me, ahead, reach, (o) => !!getItem(o.item)?.storage);
}

/** The wardrobe to open (same reach as storage; the server checks it again). */
export function wardrobeTarget(objects: Iterable<PlacedObject>, me: Vec2, ahead: Vec2, reach = STORE_REACH): string | null {
  return pieceTarget(objects, me, ahead, reach, (o) => isWardrobeItem(o.item));
}
