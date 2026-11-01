// Farming rules. Crops grow one stage-step per *completed* watered day: watering today counts
// once the day rolls over (like an overnight growth tick). Unwatered days simply don't count,
// so crops pause but never die.
import { DAY_MS, Ground, type FarmTile, type ItemId, type MapData, type PlacedObject } from "../types";
import { getItem, ITEMS } from "../items";
import { objectRect, pointInRect, tileInAny } from "./geometry";

export interface CropView {
  /** 0 = seed, 1 = sprout, 2 = growing, 3 = ready */
  stage: 0 | 1 | 2 | 3;
  ready: boolean;
  wateredToday: boolean;
}

export function dayIndex(now: number): number {
  return Math.floor(now / DAY_MS);
}

/** Watered days a crop needs, keyed by crop id (derived from seed defs). */
const CROP_DAYS: Map<ItemId, number> = new Map(
  Object.values(ITEMS)
    .filter((d) => d.grows)
    .map((d): [ItemId, number] => [d.grows!.crop, d.grows!.days]),
);

/** Days of watering a crop needs, or undefined if `crop` isn't a crop. */
export function cropDays(crop: ItemId): number | undefined {
  return CROP_DAYS.get(crop);
}

/** Watered days that have fully passed (today's watering counts tomorrow). */
export function grownDays(tile: FarmTile, now: number): number {
  const today = dayIndex(now);
  const wateredToday = tile.lastWateredDay === today;
  return Math.max(0, tile.wateredDays - (wateredToday ? 1 : 0));
}

/** Growth only advances on watered days (relaxed: unwatered crops pause, never die). */
export function cropView(tile: FarmTile, now: number): CropView {
  const wateredToday = tile.lastWateredDay === dayIndex(now);
  const days = tile.crop ? CROP_DAYS.get(tile.crop) : undefined;
  if (!tile.crop || !days) return { stage: 0, ready: false, wateredToday };
  const grown = grownDays(tile, now);
  if (grown >= days) return { stage: 3, ready: true, wateredToday };
  if (grown === 0) return { stage: 0, ready: false, wateredToday };
  return { stage: grown / days < 0.5 ? 1 : 2, ready: false, wateredToday };
}

// ---- Tile mutations (helpers for HomeRoom + client prediction) ----

/** A freshly hoed, empty tile. */
export function tillTile(x: number, y: number): FarmTile {
  return { x, y, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null };
}

/** Plants a seed item on an empty tile. Returns false if occupied or not a seed. */
export function plantTile(tile: FarmTile, seed: ItemId, now: number): boolean {
  const grows = getItem(seed)?.grows;
  if (!grows || tile.crop) return false;
  tile.crop = grows.crop;
  tile.plantedAt = now;
  tile.wateredDays = 0;
  tile.lastWateredDay = null;
  return true;
}

/** Waters a planted tile. Returns false if empty or already watered today (no double counting). */
export function waterTile(tile: FarmTile, now: number): boolean {
  const today = dayIndex(now);
  if (!tile.crop || tile.lastWateredDay === today) return false;
  tile.wateredDays += 1;
  tile.lastWateredDay = today;
  return true;
}

/**
 * The crop a harvest would yield, or null if not ready. Does not mutate: callers check
 * canAdd(inv, crop, 1) first, then call harvestTile, so a full inventory never destroys a crop.
 */
export function harvestable(tile: FarmTile, now: number): ItemId | null {
  return tile.crop && cropView(tile, now).ready ? tile.crop : null;
}

/** Harvests a ready crop: returns the crop id and resets the tile to tilled-empty, or null. */
export function harvestTile(tile: FarmTile, now: number): ItemId | null {
  if (!harvestable(tile, now)) return null;
  const crop = tile.crop!;
  Object.assign(tile, tillTile(tile.x, tile.y));
  return crop;
}

/**
 * Local dev only: makes one day pass for a tile by moving its timestamps a day into the past, so
 * today's watering counts as grown and the crop can be watered again. Returns true if it changed.
 */
export function passDay(tile: FarmTile): boolean {
  if (!tile.crop) return false;
  if (tile.plantedAt !== null) tile.plantedAt -= DAY_MS;
  if (tile.lastWateredDay !== null) tile.lastWateredDay -= 1;
  return true;
}

const FARMABLE_GROUND = new Set<Ground>([Ground.Grass, Ground.Dirt, Ground.Tilled]);

/** Inside a farm area, on soil, and not under a prop or (when `objects` is given) placed furniture. */
export function isFarmable(map: MapData, x: number, y: number, objects?: PlacedObject[]): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  if (!tileInAny(map.farmArea, tx, ty)) return false;
  if (!FARMABLE_GROUND.has(map.ground[ty * map.width + tx])) return false;
  if (map.props.some((p) => pointInRect(p, tx, ty))) return false;
  return !objects?.some((o) => pointInRect(objectRect(o.item, o.x, o.y, o.rotation), tx, ty));
}
