// Moving several placed pieces at once (the house edit mode). The HomeRoom runs checkArrange on
// every moveObjects message and the client runs it for the drag ghost, so both agree. All or
// nothing: one piece that doesn't fit refuses the whole move.
import type { FarmTile, ItemId, MapData, PlacedObject, Vec2 } from "../types";
import { footprint } from "./geometry";
import { canPlace, type PlaceResult } from "./placement";

export type Rotation = 0 | 1 | 2 | 3;

/** Most pieces one moveObjects / pickupObjects message may carry (and edit mode may select). */
export const MAX_ARRANGE = 12;

export interface ArrangeMove {
  id: string;
  x: number;
  y: number;
  rotation: Rotation;
}

export type ArrangeResult = { ok: true } | { ok: false; reason: string; id?: string };

/**
 * Can every move land at once? Each piece is checked with canPlace against the pieces that stay
 * put plus the moved pieces already checked, so the moving set never blocks itself but two moved
 * pieces still can't overlap. Ids must be distinct and on this map (`objects`).
 */
export function checkArrange(
  map: MapData,
  objects: readonly PlacedObject[],
  farm: FarmTile[],
  moves: readonly ArrangeMove[],
  opts?: { occupied?: Vec2[]; fixed?: (o: PlacedObject) => string | null },
): ArrangeResult {
  if (moves.length === 0) return { ok: false, reason: "Nothing to move." };
  if (moves.length > MAX_ARRANGE) return { ok: false, reason: `Move at most ${MAX_ARRANGE} pieces at once.` };
  const moving = new Set<string>();
  for (const m of moves) {
    if (moving.has(m.id)) return { ok: false, reason: "Each piece moves once.", id: m.id };
    moving.add(m.id);
  }
  const byId = new Map(objects.map((o) => [o.id, o]));
  const placed: PlacedObject[] = objects.filter((o) => !moving.has(o.id));
  for (const m of moves) {
    const obj = byId.get(m.id);
    if (!obj) return { ok: false, reason: "That isn't here any more.", id: m.id };
    const why = opts?.fixed?.(obj);
    if (why) return { ok: false, reason: why, id: m.id };
    const res: PlaceResult = canPlace(map, placed, farm, obj.item, m.x, m.y, m.rotation, {
      ...(opts?.occupied ? { occupied: opts.occupied } : {}),
    });
    if (!res.ok) return { ok: false, reason: res.reason, id: m.id };
    placed.push({ ...obj, x: m.x, y: m.y, rotation: m.rotation });
  }
  return { ok: true };
}

/**
 * Top-left that keeps a piece centred on the same spot when it turns from `from` to `to` (a 2x1
 * table turned upright stays where it was, rather than swinging off its corner).
 */
export function turnInPlace(item: ItemId, x: number, y: number, from: Rotation, to: Rotation): Vec2 {
  const a = footprint(item, from);
  const b = footprint(item, to);
  // Truncating toward zero makes turning back undo the turn exactly (no drift on R, R, R, R).
  const half = (d: number) => Math.trunc(d / 2) || 0;
  return { x: x + half(a.w - b.w), y: y + half(a.h - b.h) };
}
