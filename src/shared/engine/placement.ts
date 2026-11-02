// Furniture placement rules for any home map (yard or house). Used by HomeRoom (authoritative)
// and the client (ghost preview), so both agree on what is allowed. Nothing here knows a map's
// layout: floor pieces need the map's floorArea, wall pieces need a wall face above a floor.
import { BLOCKING_GROUND, Ground, type FarmTile, type ItemId, type MapData, type MapProp, type PlacedObject, type Vec2 } from "../types";
import { allowedRotations, getItem } from "../items";
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
  if (!allowedRotations(item).includes(rotation)) return fail("It doesn't turn that way.");

  const r = objectRect(item, x, y, rotation);
  if (r.x < 0 || r.y < 0 || r.x + r.w > map.width || r.y + r.h > map.height) return fail("Out of bounds.");
  if (def.placeOn === "wall") return canHang(map, objects, r, opts?.ignoreId);

  const indoor = def.placeOn === "floor";
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      // A doorway is neither floor nor yard: say why it's refused, not "This goes indoors."
      if (map.exits.some((e) => pointInRect(e, tx, ty))) return fail("Keep the way out clear.");
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
    // A rug lies flat under the room, so furniture may stand on it (but rugs don't stack).
    if (isRug(o.item) !== isRug(item)) continue;
    if (rectsOverlap(objectRect(o.item, o.x, o.y, o.rotation), r)) return fail("Overlaps other furniture.");
  }
  if (farm.some((t) => pointInRect(r, t.x, t.y))) return fail("Can't place on farmland.");
  // Never block exits or spawn points (plus a 1-tile margin), or the owner can soft-lock
  // themselves in after a reconnect or wall off the way out. Rugs are walked over, so they can't.
  const margin: Rect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
  if (!def.walkable && map.exits.some((e) => rectsOverlap(e, margin))) return fail("Keep the way out clear.");
  if (!def.walkable && Object.values(map.spawns).some((s) => pointInRect(margin, Math.floor(s.x), Math.floor(s.y)))) {
    return fail("Keep the doorway clear.");
  }
  if (opts?.occupied?.some((p) => rectsOverlap(bodyRect(p), r))) return fail("Someone is standing there.");
  return { ok: true };
}

/** Wall rows a hanging piece may sit above the floor: on the wall's lowest row or the one above. */
export const MAX_WALL_DROP = 1;

const groundAt = (map: MapData, x: number, y: number): Ground | undefined =>
  x < 0 || y < 0 || x >= map.width || y >= map.height ? undefined : map.ground[y * map.width + x];

/**
 * First floor row under a wall tile, if the wall there faces the room: walking down the column
 * from (x, y) crosses at most MAX_WALL_DROP more wall rows and then reaches a floor tile (in the
 * map's floorArea; maps without one have no inside walls). Side and south walls never reach a
 * floor going down.
 */
export function wallFaceRow(map: MapData, x: number, y: number): number | null {
  // Only indoors (a map with a floor area): never on the outside of a house.
  if (!map.floorArea || groundAt(map, x, y) !== Ground.Wall) return null;
  for (let ty = y + 1; ty <= y + 1 + MAX_WALL_DROP; ty++) {
    const g = groundAt(map, x, ty);
    if (g === undefined) return null;
    if (g === Ground.Wall) continue;
    if (BLOCKING_GROUND.has(g)) return null;
    if (!tileInAny(map.floorArea, x, ty)) return null;
    return ty;
  }
  return null;
}

/**
 * Props a picture may hang over: the wall itself (plain wall pieces, a cottage's walls). Windows,
 * built-in shelves and art, stairs and anything already hung are in the way.
 */
function isBareWall(map: MapData, p: MapProp): boolean {
  if (/window|shelf|_art|stairs/.test(p.type)) return false;
  if (p.type.startsWith("iwall_")) return true;
  if (p.walkable) return false;
  for (let ty = p.y; ty < p.y + p.h; ty++) {
    for (let tx = p.x; tx < p.x + p.w; tx++) if (groundAt(map, tx, ty) !== Ground.Wall) return false;
  }
  return true;
}

function canHang(map: MapData, objects: PlacedObject[], r: Rect, ignoreId: string | undefined): PlaceResult {
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (wallFaceRow(map, tx, ty) === null) return fail("This hangs on a wall facing the room.");
    }
  }
  // Zero-size decor props still take their tile.
  const rectOf = (p: MapProp): Rect => ({ x: p.x, y: p.y, w: Math.max(1, p.w), h: Math.max(1, p.h) });
  if (map.props.some((p) => rectsOverlap(rectOf(p), r) && !isBareWall(map, p))) return fail("Something is in the way.");
  for (const o of objects) {
    if (o.id === ignoreId) continue;
    if (getItem(o.item)?.placeOn !== "wall") continue;
    if (rectsOverlap(objectRect(o.item, o.x, o.y, o.rotation), r)) return fail("Overlaps something on the wall.");
  }
  return { ok: true };
}

/**
 * Floor furniture you walk over (rugs and mats): drawn flat, and other pieces may stand on it.
 * A garden gate is walkable too, but it stands upright and nothing goes on top of it.
 */
export function isRug(item: ItemId): boolean {
  const def = getItem(item);
  return !!def?.walkable && def.placeOn === "floor";
}
