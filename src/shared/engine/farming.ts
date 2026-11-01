// Farming rules. Crops grow one stage-step per *completed* watered day: watering today counts
// once the day rolls over (like an overnight growth tick). Unwatered days don't count: a crop
// left dry overnight wilts (homeday.rollFarmDay counts `dryDays`), and dies after
// CROP_DEATH_DAYS dry days in a row. Ripe crops no longer need water.
import { DAY_MS, Ground, type FarmTile, type ItemId, type MapData, type PlacedObject } from "../types";
import { getItem, ITEMS } from "../items";
import { objectRect, pointInRect, tileInAny } from "./geometry";

/** Growth stage: 0 = seedling, 1 = small, 2 = medium, 3 = ready (fruiting). */
export type GrowthStage = 0 | 1 | 2 | 3;
export const STAGE_NAMES = ["seedling", "small", "medium", "ready"] as const;

/** A crop left dry this many day ends in a row dies (it wilts from the first). */
export const CROP_DEATH_DAYS = 3;

export interface CropView {
  stage: GrowthStage;
  ready: boolean;
  wateredToday: boolean;
  /** Missed yesterday's water and not watered yet today: drawn drooping, doesn't grow. */
  wilted: boolean;
  /** Died of thirst: drawn as a dead plant until cleared (hoe or by hand). */
  dead: boolean;
}

/** Which art a crop shows on top of its growth stage. */
export type CropLook = "normal" | "wilted" | "dead";

export function cropLook(v: Pick<CropView, "wilted" | "dead">): CropLook {
  return v.dead ? "dead" : v.wilted ? "wilted" : "normal";
}

/**
 * Maps watered days grown to a stage, evenly over the crop's `days`: seedling on day 0, then
 * small and medium each about a third of the way, and ready only once fully grown.
 */
export function growthStage(grown: number, days: number): GrowthStage {
  if (days <= 0 || grown >= days) return 3;
  if (grown <= 0) return 0;
  return Math.min(2, Math.floor((grown * 3) / days)) as GrowthStage;
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

/** How a tile's crop looks and behaves now. Server, client prediction and visitors all use it. */
export function cropView(tile: FarmTile, now: number): CropView {
  const wateredToday = tile.lastWateredDay === dayIndex(now);
  const days = tile.crop ? CROP_DAYS.get(tile.crop) : undefined;
  if (!tile.crop || !days) return { stage: 0, ready: false, wateredToday, wilted: false, dead: false };
  const stage = growthStage(grownDays(tile, now), days);
  if (tile.dead) return { stage, ready: false, wateredToday, wilted: false, dead: true };
  const ready = stage === 3;
  const wilted = !ready && !wateredToday && (tile.dryDays ?? 0) >= 1;
  return { stage, ready, wateredToday, wilted, dead: false };
}

// ---- Tile mutations (helpers for HomeRoom + client prediction) ----

/** A freshly hoed, empty tile. */
export function tillTile(x: number, y: number): FarmTile {
  return { x, y, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null };
}

/**
 * Plants a seed item on an empty tile. Returns false if occupied or not a seed. Soil watered
 * earlier today counts as the seed's first watered day, so it grows tomorrow.
 */
export function plantTile(tile: FarmTile, seed: ItemId, now: number): boolean {
  const grows = getItem(seed)?.grows;
  if (!grows || tile.crop) return false;
  const wetToday = tile.lastWateredDay === dayIndex(now);
  tile.crop = grows.crop;
  tile.dryDays = 0;
  tile.plantedAt = now;
  tile.wateredDays = wetToday ? 1 : 0;
  tile.lastWateredDay = wetToday ? tile.lastWateredDay : null;
  return true;
}

/**
 * Waters tilled soil, planted or not. Returns false if already watered today (no double
 * counting). Empty soil only remembers the day; a seed planted on it today counts it.
 */
export function waterTile(tile: FarmTile, now: number): boolean {
  const today = dayIndex(now);
  if (tile.lastWateredDay === today || tile.dead) return false;
  if (tile.crop) tile.wateredDays += 1;
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

/** Pulls up a dead crop, leaving empty tilled soil. Returns false if nothing dead is there. */
export function clearDeadCrop(tile: FarmTile): boolean {
  if (!tile.crop || !tile.dead) return false;
  Object.assign(tile, tillTile(tile.x, tile.y), { dryDays: 0 });
  delete tile.dead;
  return true;
}

/**
 * Local dev only: makes one day pass for a tile by moving its timestamps a day into the past, so
 * today's watering counts as grown and the crop can be watered again. Returns true if it changed.
 */
export function passDay(tile: FarmTile): boolean {
  if (!tile.crop) {
    if (tile.lastWateredDay === null) return false;
    tile.lastWateredDay -= 1;
    return true;
  }
  if (tile.plantedAt !== null) tile.plantedAt -= DAY_MS;
  if (tile.lastWateredDay !== null) tile.lastWateredDay -= 1;
  return true;
}

const FARMABLE_GROUND = new Set<Ground>([Ground.Grass, Ground.Dirt, Ground.Tilled]);

/** Ground that `farmGrass` maps till: grass (and soil already tilled), never paths. */
const GRASS_FARM_GROUND = new Set<Ground>([Ground.Grass, Ground.Tilled]);

/**
 * Inside a farm area (or, on a `farmGrass` map, any grass outside `noFarm` and the exits), on
 * soil, and not under a prop or (when `objects` is given) placed furniture. Rocks are the
 * caller's to check: broken ones leave tillable grass.
 */
export function isFarmable(map: MapData, x: number, y: number, objects?: PlacedObject[]): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  const g = map.ground[ty * map.width + tx];
  if (map.farmGrass) {
    if (!GRASS_FARM_GROUND.has(g) || tileInAny(map.noFarm, tx, ty)) return false;
    if (map.exits.some((e) => pointInRect(e, tx, ty))) return false;
  } else {
    if (!tileInAny(map.farmArea, tx, ty)) return false;
    if (!FARMABLE_GROUND.has(g)) return false;
  }
  if (map.props.some((p) => pointInRect(p, tx, ty))) return false;
  return !objects?.some((o) => pointInRect(objectRect(o.item, o.x, o.y, o.rotation), tx, ty));
}

/** Where the watering can refills: any water tile, or a well prop. */
export function isWaterSource(map: MapData, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && map.ground[ty * map.width + tx] === Ground.Water) return true;
  return map.props.some((p) => p.type === "well" && pointInRect(p, tx, ty));
}
