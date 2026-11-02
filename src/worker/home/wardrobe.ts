// The wardrobe every house has: where the owner changes clothes (the character designer). Like
// the bed it can be moved but never picked up, and a home without one gets it against the back
// wall. Pure helpers for HomeRoom.
import { canPlace, isRug, objectRect, rectsOverlap } from "../../shared/engine";
import { getItem, isBedItem, isWardrobeItem, WARDROBE_ITEM } from "../../shared/items";
import { HOME_IN_WARDROBE } from "../../shared/maps/home-in";
import type { ItemId, MapData, PlacedObject, Vec2 } from "../../shared/types";
import { BED_ID, findSpot, WARDROBE_ID } from "./migrate";
import { distToRect, PROP_REACH } from "../game/range";
import { HOME_IN, type HomeObjects } from "./submaps";

export { WARDROBE_ID };

export interface WardrobeResult {
  /** True when the home's furniture changed (a wardrobe was added or adopted). */
  changed: boolean;
  /** Furniture cleared off the wardrobe's spot: back to the owner. */
  returned: ItemId[];
}

const WIDTH = 2;

/**
 * Left columns where the wardrobe can stand on the first floor row with no window behind it,
 * nearest HOME_IN_WARDROBE first. Tall furniture never hides a window (see interiors/rules.ts).
 */
export function backWallSpots(map: MapData = HOME_IN): Vec2[] {
  const floor = map.floorArea![0]!;
  const windows = new Set(map.props.filter((p) => p.y === 0 && /^iwall_.*_window$/.test(p.type)).map((p) => p.x));
  const out: Vec2[] = [];
  for (let x = floor.x; x + WIDTH <= floor.x + floor.w; x++) {
    if (!windows.has(x) && !windows.has(x + 1)) out.push({ x, y: floor.y });
  }
  return out.sort((a, b) => Math.abs(a.x - HOME_IN_WARDROBE.x) - Math.abs(b.x - HOME_IN_WARDROBE.x) || a.x - b.x);
}

/** Furniture that is never cleared to make room: the bed, and storage (it may hold food). */
const stays = (o: PlacedObject): boolean => o.id === BED_ID || isBedItem(o.item) || !!getItem(o.item)?.storage;

/**
 * Makes sure the house has its wardrobe (id WARDROBE_ID). A wardrobe the owner placed themselves
 * becomes it. Otherwise it goes on a free back-wall spot; when every one is taken, the first spot
 * with nothing that must stay is cleared and its furniture handed back (as the barn lot does);
 * failing that, any free floor spot. Pure apart from editing `objects`.
 */
export function ensureWardrobe(objects: HomeObjects): WardrobeResult {
  const none: WardrobeResult = { changed: false, returned: [] };
  if (objects.home_in.some((o) => o.id === WARDROBE_ID)) return none;
  // A wardrobe id left in the yard by a bad save moves in.
  objects.home = objects.home.filter((o) => o.id !== WARDROBE_ID);
  const own = objects.home_in.find((o) => isWardrobeItem(o.item));
  if (own) {
    own.id = WARDROBE_ID;
    return { changed: true, returned: [] };
  }
  const base: PlacedObject = { id: WARDROBE_ID, item: WARDROBE_ITEM, ...HOME_IN_WARDROBE, rotation: 0 };
  const spots = backWallSpots();
  const free = findSpot("home_in", objects.home_in, [], base, spots);
  if (free && spots.some((s) => s.x === free.x && s.y === free.y)) {
    objects.home_in.push(free);
    return { changed: true, returned: [] };
  }
  for (const s of spots) {
    const r = objectRect(WARDROBE_ITEM, s.x, s.y, 0);
    const blocking = objects.home_in.filter((o) => !isRug(o.item) && rectsOverlap(objectRect(o.item, o.x, o.y, o.rotation), r));
    if (blocking.some(stays)) continue;
    const rest = objects.home_in.filter((o) => !blocking.includes(o));
    // The hearth or the way in may still be there: only a spot that is valid once cleared.
    if (!canPlace(HOME_IN, rest, [], WARDROBE_ITEM, s.x, s.y, 0).ok) continue;
    objects.home_in = [...rest, { ...base, ...s }];
    return { changed: true, returned: blocking.map((o) => o.item) };
  }
  if (!free) return none;
  objects.home_in.push(free);
  return { changed: true, returned: [] };
}

/**
 * Why `obj` can't be opened as a wardrobe by someone standing at `at`, or null when it can.
 * Ownership is checked before this (visitors never get here; see visit/permissions.ts).
 */
export function wardrobeRefusal(obj: PlacedObject | undefined, at: Vec2): string | null {
  if (!obj || !isWardrobeItem(obj.item)) return "There's no wardrobe there.";
  if (distToRect(at, objectRect(obj.item, obj.x, obj.y, obj.rotation)) > PROP_REACH) return "Walk a little closer.";
  return null;
}
