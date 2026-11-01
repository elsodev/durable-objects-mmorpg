// Furniture placement rules for the home map. Used by HomeRoom (authoritative) and the
// client (ghost preview), so both agree on what is allowed.
import { BLOCKING_GROUND, type FarmTile, type ItemId, type MapData, type PlacedObject, type Vec2 } from "../types";
import { getItem } from "../items";
import { BODY_DOWN, BODY_HALF_W, BODY_UP } from "./collision";
import { objectRect, pointInRect, rectsOverlap, tileInAny, type Rect } from "./geometry";

export type PlaceResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): PlaceResult => ({ ok: false, reason });

/** Body rectangle of an entity standing at feet position p. */
function bodyRect(p: Vec2): Rect {
  return { x: p.x - BODY_HALF_W, y: p.y - BODY_UP, w: BODY_HALF_W * 2, h: BODY_UP + BODY_DOWN };
}

/**
 * Can `item` be placed with its top-left at (x,y)? Checks area (floor vs outdoor),
 * collisions with walls/props/other objects (ignoring `ignoreId` when moving), farm tiles,
 * and that no entity in `occupied` stands on it.
 */
export function canPlace(
  map: MapData,
  objects: PlacedObject[],
  farm: FarmTile[],
  item: ItemId,
  x: number,
  y: number,
  rotation: 0 | 1 | 2 | 3,
  opts?: { ignoreId?: string; occupied?: Vec2[] },
): PlaceResult {
  const def = getItem(item);
  if (!def || def.kind !== "furniture" || !def.footprint) return fail("That can't be placed.");
  if (!Number.isInteger(x) || !Number.isInteger(y)) return fail("Invalid position.");
  if (![0, 1, 2, 3].includes(rotation)) return fail("Invalid rotation.");

  const r = objectRect(item, x, y, rotation);
  if (r.x < 0 || r.y < 0 || r.x + r.w > map.width || r.y + r.h > map.height) return fail("Out of bounds.");

  const indoor = def.placeOn === "floor";
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (BLOCKING_GROUND.has(map.ground[ty * map.width + tx])) return fail("Something is in the way.");
      const onFloor = tileInAny(map.floorArea, tx, ty);
      if (indoor && !onFloor) return fail("This goes indoors.");
      if (!indoor && onFloor) return fail("This goes outdoors.");
    }
  }

  if (map.props.some((p) => rectsOverlap(p, r))) return fail("Something is in the way.");
  if (map.rocks?.some((k) => pointInRect(r, k.x, k.y))) return fail("Something is in the way.");
  for (const o of objects) {
    if (o.id === opts?.ignoreId) continue;
    if (rectsOverlap(objectRect(o.item, o.x, o.y, o.rotation), r)) return fail("Overlaps other furniture.");
  }
  if (farm.some((t) => pointInRect(r, t.x, t.y))) return fail("Can't place on farmland.");
  // Never block exits or spawn points (plus a 1-tile margin), or the owner can soft-lock
  // themselves in after a reconnect or wall off the way out.
  const margin: Rect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
  if (map.exits.some((e) => rectsOverlap(e, margin))) return fail("Keep the way out clear.");
  if (Object.values(map.spawns).some((s) => pointInRect(margin, Math.floor(s.x), Math.floor(s.y)))) {
    return fail("Keep the doorway clear.");
  }
  if (opts?.occupied?.some((p) => rectsOverlap(bodyRect(p), r))) return fail("Someone is standing there.");
  return { ok: true };
}
