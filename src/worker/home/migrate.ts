// Furniture save layout. Saves before the house had one list for the single home map (the yard
// with the cottage room carved into it); now each home map has its own list. Indoor furniture
// (placeOn "floor") moves inside the house, outdoor things (fence, scarecrow) stay in the yard,
// and whatever no longer fits goes back to the owner.
import { canPlace } from "../../shared/engine";
import { getItem } from "../../shared/items";
import { HOME_IN_BED } from "../../shared/maps/home-in";
import type { FarmTile, HomeMapId, ItemId, MapData, PlacedObject } from "../../shared/types";
import { emptyObjects, HOME_IN, HOME_OUT, homeMap, type HomeObjects } from "./submaps";

/** Storage "layout" value of saves that keep one furniture list per home map. */
export const HOME_LAYOUT = 2;

/** Every home has a bed inside the house; it can be moved but not picked up. */
export const BED_ID = "bed";
export const BED_ITEM = "bed_simple";

/** The old single map's cottage floor started here; the house floor starts at HOME_IN floorArea. */
const OLD_FLOOR_ORIGIN = { x: 3, y: 5 };

/** Which home map an item belongs on. */
export function mapForItem(item: ItemId): HomeMapId {
  const on = getItem(item)?.placeOn;
  return on === "floor" || on === "wall" ? "home_in" : "home";
}

function fits(map: MapData, list: PlacedObject[], farm: FarmTile[], o: PlacedObject): boolean {
  return canPlace(map, list, farm, o.item, o.x, o.y, o.rotation).ok;
}

/**
 * Finds a free spot for `o` on `id`: `prefer` first, then every tile of the map's furnishable
 * area (row by row) at the object's rotation, then the other rotations. Null when nothing fits.
 */
export function findSpot(
  id: HomeMapId,
  list: PlacedObject[],
  farm: FarmTile[],
  o: PlacedObject,
  prefer: { x: number; y: number }[] = [],
): PlacedObject | null {
  const map = homeMap(id);
  const yardFarm = id === "home" ? farm : [];
  for (const at of prefer) {
    const c = { ...o, x: at.x, y: at.y };
    if (fits(map, list, yardFarm, c)) return c;
  }
  const area = id === "home_in" ? (map.floorArea ?? []) : [{ x: 0, y: 0, w: map.width, h: map.height }];
  const rotations = [o.rotation, ...([0, 1, 2, 3] as const).filter((r) => r !== o.rotation)];
  for (const rotation of rotations)
    for (const r of area)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const c = { ...o, x, y, rotation };
          if (fits(map, list, yardFarm, c)) return c;
        }
  return null;
}

export interface Migrated {
  objects: HomeObjects;
  /** Items that fit nowhere: back to the owner (bag, or the mailbox when the bag is full). */
  returned: ItemId[];
}

/**
 * Splits a pre-house furniture list between the yard and the house. Indoor things keep their
 * place in the room where they can (shifted from the old cottage floor to the house floor), the
 * bed goes first so it always gets a spot, and yard things stay where they were if that is still
 * free. Pure: the same save always migrates the same way.
 */
export function migrateObjects(legacy: readonly PlacedObject[], farm: FarmTile[]): Migrated {
  const objects = emptyObjects();
  const returned: ItemId[] = [];
  const floor = HOME_IN.floorArea![0]!;
  const order = [...legacy].sort((a, b) => Number(b.id === BED_ID) - Number(a.id === BED_ID));
  for (const o of order) {
    const id = mapForItem(o.item);
    const prefer =
      id === "home_in"
        ? [{ x: o.x - OLD_FLOOR_ORIGIN.x + floor.x, y: o.y - OLD_FLOOR_ORIGIN.y + floor.y }]
        : [{ x: o.x, y: o.y }];
    // Yard things only stay where they were; hunting the whole yard for a fence spot makes a mess.
    const spot = id === "home_in" ? findSpot(id, objects[id], farm, o, prefer) : fits(HOME_OUT, objects.home, farm, o) ? { ...o } : null;
    if (spot) objects[id].push(spot);
    else if (o.id !== BED_ID) returned.push(o.item);
  }
  return { objects, returned };
}

/**
 * Adds the bed inside the house when the home has none (fresh homes, or a bed that didn't fit).
 * True when it added one.
 */
export function ensureBed(objects: HomeObjects): boolean {
  if (objects.home_in.some((o) => o.id === BED_ID)) return false;
  // A bed id left in the yard by a bad save moves in.
  objects.home = objects.home.filter((o) => o.id !== BED_ID);
  const bed: PlacedObject = { id: BED_ID, item: BED_ITEM, x: HOME_IN_BED.x, y: HOME_IN_BED.y, rotation: 0 };
  const spot = findSpot("home_in", objects.home_in, [], bed, [HOME_IN_BED]);
  if (!spot) return false;
  objects.home_in.push(spot);
  return true;
}

/**
 * Keeps only objects that are valid on their map (sanitised saves and imports): each one must be
 * placeable there given the ones before it. The rest are returned as items.
 */
export function validateObjects(input: HomeObjects, farm: FarmTile[]): Migrated {
  const objects = emptyObjects();
  const returned: ItemId[] = [];
  for (const id of ["home_in", "home"] as const) {
    for (const o of input[id]) {
      if (mapForItem(o.item) === id && fits(homeMap(id), objects[id], id === "home" ? farm : [], o)) objects[id].push(o);
      else if (o.id !== BED_ID) returned.push(o.item);
    }
  }
  return { objects, returned };
}
