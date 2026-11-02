// Server side of the yard edit mode: handing the plot's fence over to a home as its own pieces,
// and keeping the hens and their eggs with the barn when it moves. The rules for where things
// may go are shared (shared/yard.ts, shared/engine/placement.ts); HomeRoom applies them.
import type { AnimalSave } from "../../shared/animals";
import { canPlace, objectRect, pointInRect, type CollisionGrid } from "../../shared/engine";
import { HOME_FENCES } from "../../shared/maps/home";
import type { FarmTile, MapData, PlacedObject } from "../../shared/types";
import type { YardLayout } from "../../shared/yard";
import { eggSpots } from "./ranch";
import type { HomeObjects } from "./submaps";

/**
 * How far from where they stand the owner may place, move and pick up things in the yard: all of
 * it. Yard edit mode pans the view while the owner stays put, and the yard is theirs alone.
 */
export const YARD_REACH = 64;

/**
 * Gives a home the plot's fence as placed fence pieces, once (`yard.fenced` records it). Old
 * yards had it painted into the map, where nothing else could stand, so every piece fits; any
 * that somehow doesn't is skipped. True when it changed the yard.
 */
export function addYardFences(yard: YardLayout, objects: HomeObjects, farm: FarmTile[], map: MapData, nextId: () => string): boolean {
  if (yard.fenced) return false;
  for (const t of HOME_FENCES) {
    if (!canPlace(map, objects.home, farm, "fence", t.x, t.y, 0).ok) continue;
    objects.home.push({ id: nextId(), item: "fence", x: t.x, y: t.y, rotation: 0 });
  }
  yard.fenced = true;
  return true;
}

/**
 * The barn just moved: eggs it now stands on roll out to free spots in front of it, so they can
 * still be seen and picked up. True when an egg moved.
 */
export function onYardBarnMoved(animals: AnimalSave, barn: PlacedObject, grid: CollisionGrid): boolean {
  const under = objectRect(barn.item, barn.x, barn.y, barn.rotation);
  const buried = animals.eggs.filter((e) => pointInRect(under, Math.floor(e.x), Math.floor(e.y)));
  if (buried.length === 0) return false;
  const spots = eggSpots(grid, barn).filter((s) => !animals.eggs.some((e) => Math.floor(e.x) === Math.floor(s.x) && Math.floor(e.y) === Math.floor(s.y)));
  buried.forEach((e, i) => {
    const s = spots[i % Math.max(1, spots.length)];
    if (!s) return;
    e.x = s.x;
    e.y = s.y;
  });
  return true;
}
