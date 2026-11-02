// The yard's animals: where the barn goes, who wanders where, and the eggs as ground items.
// Pure helpers for HomeRoom; the rules for buying and laying are in shared/ranch.ts.
import { villageAnimal, type AnimalSave } from "../../shared/animals";
import { canPlace, canStand, objectRect, pointInRect, rectsOverlap, type CollisionGrid } from "../../shared/engine";
import { getItem } from "../../shared/items";
import type { GroundItemView } from "../../shared/protocol";
import { BARN_ID, BARN_ITEM, BARN_SIZE, BARN_SPOT, coopCentre, COOP_RADIUS, EGG_ITEM } from "../../shared/ranch";
import type { FarmTile, ItemId, MapData, PlacedObject, Vec2 } from "../../shared/types";
import { HOME_OUT } from "./submaps";
import type { AnimalSpec } from "../game/animalHerd";
import type { HomeObjects } from "./submaps";

/** Adopted pets roam the lawn around the house and the road. */
export const PET_HOME: Vec2 = { x: 13.5, y: 14.5 };
export const PET_RADIUS = 7;

export interface BarnBuilt {
  /** Furniture that stood on the lot (back to the owner). */
  returned: ItemId[];
  /** Farm tiles dug up for the barn (their seeds go back to the owner). */
  cleared: FarmTile[];
}

/**
 * Where a new barn goes: BARN_SPOT (tests check it is clear of the base map's props, paths and
 * exits), unless the owner stood their house there; then the nearest free lot. Null if none.
 */
export function barnLot(yard: MapData, objects: readonly PlacedObject[], farm: FarmTile[]): Vec2 | null {
  if (canPlace(yard, [], [], BARN_ITEM, BARN_SPOT.x, BARN_SPOT.y, 0).ok) return { ...BARN_SPOT };
  for (let r = 1; r < Math.max(yard.width, yard.height); r++) {
    for (let y = BARN_SPOT.y - r; y <= BARN_SPOT.y + r; y++)
      for (let x = BARN_SPOT.x - r; x <= BARN_SPOT.x + r; x++) {
        if (Math.max(Math.abs(x - BARN_SPOT.x), Math.abs(y - BARN_SPOT.y)) !== r) continue;
        if (canPlace(yard, [...objects], farm, BARN_ITEM, x, y, 0).ok) return { x, y };
      }
  }
  return null;
}

/**
 * Builds the barn when the save owns one and the yard doesn't have it yet, at barnLot.
 * Whatever the owner put on BARN_SPOT since (furniture, farm tiles) is cleared first and handed
 * back. Null when nothing was built.
 */
export function ensureBarn(animals: AnimalSave, objects: HomeObjects, farm: FarmTile[], yard: MapData = HOME_OUT): (BarnBuilt & { farm: FarmTile[] }) | null {
  if (!animals.barn || objects.home.some((o) => o.id === BARN_ID)) return null;
  const spot = barnLot(yard, objects.home, farm);
  if (!spot) return null;
  const lot = { x: spot.x, y: spot.y, w: BARN_SIZE.w, h: BARN_SIZE.h };
  const returned: ItemId[] = [];
  objects.home = objects.home.filter((o) => {
    const hit = rectsOverlap(objectRect(o.item, o.x, o.y, o.rotation), lot);
    if (hit) returned.push(o.item);
    return !hit;
  });
  const cleared = farm.filter((t) => pointInRect(lot, t.x, t.y));
  for (const t of cleared) {
    const seed = t.crop && !t.dead ? `seed_${t.crop}` : null;
    if (seed && getItem(seed)) returned.push(seed);
  }
  const barn: PlacedObject = { id: BARN_ID, item: BARN_ITEM, x: spot.x, y: spot.y, rotation: 0 };
  objects.home.push(barn);
  return { returned, cleared, farm: farm.filter((t) => !pointInRect(lot, t.x, t.y)) };
}

/** The herd for the yard: your adopted pets, and your hens around the barn (once it stands at `barn`). */
export function yardAnimals(animals: AnimalSave, barn: Vec2 | null): AnimalSpec[] {
  const out: AnimalSpec[] = [];
  for (const id of animals.pets) {
    const def = villageAnimal(id);
    if (def) out.push({ id: `pet_${id}`, name: def.name, sprite: def.sprite, species: def.species, home: PET_HOME, radius: PET_RADIUS });
  }
  if (barn) {
    const home = coopCentre(barn);
    for (const hen of animals.chickens) out.push({ id: hen.id, name: "", sprite: hen.sprite, species: "chicken", home, radius: COOP_RADIUS });
  }
  return out;
}

/** Tiles in front of the barn (top-left `barn`) where hens lay (centres, standable on `grid`). */
export function eggSpots(grid: CollisionGrid, barn: Vec2 = BARN_SPOT): Vec2[] {
  const out: Vec2[] = [];
  for (let y = barn.y + BARN_SIZE.h; y <= barn.y + BARN_SIZE.h + 1; y++)
    for (let x = barn.x - 1; x <= barn.x + BARN_SIZE.w; x++) {
      const p = { x: x + 0.5, y: y + 0.5 };
      if (canStand(grid, p.x, p.y)) out.push(p);
    }
  return out;
}

/** Eggs as ground items: the owner picks them (forage); visitors only see them. */
export function eggViews(animals: AnimalSave, owner: boolean): GroundItemView[] {
  return animals.eggs.map((e) => ({ id: e.id, item: EGG_ITEM, qty: 1, x: e.x, y: e.y, ...(owner ? { forage: true } : {}) }));
}
