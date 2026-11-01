// Home farm rules that run once per day end (sleep, passing out at 2:00, or a day that ended
// while nobody was home), plus harvest quality, regrowing crops, stamina and the watering can.
// Pure: callers pass `now` (farm time, see homeclock.farmNow) and `rand`.
//
// Growth itself needs no work here: farm time moves to the next day, so a crop watered today
// counts one more grown day tomorrow (cropView), and soil reads dry again (wateredToday false).
import type { FarmTile, ItemId, PlacedObject, Vec2 } from "../types";
import { getItem, qualityItem, type ToolKind } from "../items";
import { dayIndex, harvestable, tillTile } from "./farming";

/** Crows never touch crops within this many tiles of a scarecrow. */
export const SCARECROW_RADIUS = 8;
/** Chance per morning that crows visit an unprotected farm. */
export const CROW_CHANCE = 0.3;
/** One extra crop eaten per this many unprotected crops. */
export const CROWS_PER_CROPS = 16;
/** Empty tilled soil reverts after 2 dry days with this chance, and always after 3. */
export const REVERT_CHANCE_DAY2 = 0.5;
export const REVERT_DAYS_MAX = 3;

/** Harvest quality weights: normal, silver, gold. */
export const QUALITY_WEIGHTS = [0.7, 0.22, 0.08] as const;

export const MAX_STAMINA = 100;
/** Passing out at 2:00 leaves you more tired the next morning. */
export const PASS_OUT_STAMINA = 50;
export const TOOL_STAMINA: Record<ToolKind, number> = { hoe: 2, water: 2, pickaxe: 4, sword: 3 };
export const MAX_WATER = 20;

export interface CropLoss {
  x: number;
  y: number;
  crop: ItemId;
}

export interface FarmDayResult {
  /** Tiles that still exist (changed in place). */
  farm: FarmTile[];
  /** Tiles that reverted to grass. */
  reverted: Vec2[];
  /** Crops the crows ate this morning. */
  eaten: CropLoss[];
  /** Crops that grew (were watered on the day that ended). */
  grown: number;
}

/** Scarecrow positions (tile centres) among placed objects. */
export function scarecrowsOf(objects: readonly PlacedObject[]): Vec2[] {
  return objects.filter((o) => o.item === "scarecrow").map((o) => ({ x: o.x, y: o.y }));
}

export function protectedByScarecrow(tile: Vec2, scarecrows: readonly Vec2[], radius = SCARECROW_RADIUS): boolean {
  return scarecrows.some((s) => Math.hypot(s.x - tile.x, s.y - tile.y) <= radius);
}

/**
 * Picks the crops crows eat this morning: with CROW_CHANCE, one crop (plus one per
 * CROWS_PER_CROPS unprotected crops) among those not near a scarecrow.
 */
export function crowTargets(farm: readonly FarmTile[], objects: readonly PlacedObject[], rand: () => number): FarmTile[] {
  const scarecrows = scarecrowsOf(objects);
  const open = farm.filter((t) => t.crop && !protectedByScarecrow(t, scarecrows));
  if (open.length === 0 || rand() >= CROW_CHANCE) return [];
  const n = Math.min(open.length, 1 + Math.floor(open.length / CROWS_PER_CROPS));
  const pool = open.slice();
  const out: FarmTile[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rand() * pool.length) % pool.length, 1)[0]);
  return out;
}

/**
 * Ends `endedDay` for the farm: empty soil dries out (and may revert), then crows visit.
 * Mutates tiles in place and returns the surviving list.
 */
export function rollFarmDay(
  farm: readonly FarmTile[],
  objects: readonly PlacedObject[],
  endedDay: number,
  rand: () => number,
): FarmDayResult {
  const kept: FarmTile[] = [];
  const reverted: Vec2[] = [];
  let grown = 0;
  for (const t of farm) {
    if (t.crop) {
      if (t.lastWateredDay === endedDay) grown++;
      t.dryDays = 0;
      kept.push(t);
      continue;
    }
    const dry = (t.dryDays ?? 0) + 1;
    if (dry >= REVERT_DAYS_MAX || (dry >= 2 && rand() < REVERT_CHANCE_DAY2)) {
      reverted.push({ x: t.x, y: t.y });
      continue;
    }
    t.dryDays = dry;
    kept.push(t);
  }
  const eaten: CropLoss[] = [];
  for (const t of crowTargets(kept, objects, rand)) {
    eaten.push({ x: t.x, y: t.y, crop: t.crop! });
    Object.assign(t, tillTile(t.x, t.y), { dryDays: 0 });
  }
  return { farm: kept, reverted, eaten, grown };
}

/** 0 normal, 1 silver, 2 gold. */
export function rollQuality(rand: () => number): 0 | 1 | 2 {
  const r = rand();
  if (r < QUALITY_WEIGHTS[2]) return 2;
  if (r < QUALITY_WEIGHTS[2] + QUALITY_WEIGHTS[1]) return 1;
  return 0;
}

/**
 * The item a harvest yields (quality rolled), or null if not ready. Does not mutate, so the
 * caller can check the bag first; then call harvestCrop.
 */
export function harvestYield(tile: FarmTile, now: number, rand: () => number): ItemId | null {
  const crop = harvestable(tile, now);
  return crop ? qualityItem(crop, rollQuality(rand)) : null;
}

/** Days a crop regrows in after a harvest, if it regrows. */
export function regrowDays(crop: ItemId): number | undefined {
  return getItem(`seed_${crop}`)?.grows?.regrow;
}

/**
 * Harvests a ready crop. Regrowing crops stay planted and need `regrow` more watered days;
 * others leave empty tilled soil. Returns false if nothing was ready.
 */
export function harvestCrop(tile: FarmTile, now: number): boolean {
  const crop = harvestable(tile, now);
  if (!crop) return false;
  const total = getItem(`seed_${crop}`)?.grows?.days;
  const again = regrowDays(crop);
  if (!again || !total) {
    Object.assign(tile, tillTile(tile.x, tile.y), { dryDays: 0 });
    return true;
  }
  // grownDays = wateredDays - (watered today ? 1 : 0); keep today's watering counting tomorrow.
  const wateredToday = tile.lastWateredDay === dayIndex(now);
  tile.wateredDays = Math.max(0, total - again) + (wateredToday ? 1 : 0);
  return true;
}

/** Stamina a tool use costs (0 for non-tools). */
export function staminaCost(tool: ToolKind | undefined): number {
  return tool ? TOOL_STAMINA[tool] : 0;
}

export function clampStamina(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_STAMINA, Math.max(0, Math.round(v))) : MAX_STAMINA;
}

export function clampWater(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_WATER, Math.max(0, Math.round(v))) : MAX_WATER;
}

/** Stamina gained by eating one of `item` (0 if not edible), capped at the max. */
export function eatGain(item: ItemId, stamina: number): number {
  const v = getItem(item)?.eat ?? 0;
  return Math.max(0, Math.min(MAX_STAMINA - stamina, v));
}

/** Coins lost for passing out: 10%, at most 100. */
export function passOutPenalty(coins: number): number {
  return Math.min(100, Math.floor(Math.max(0, coins) * 0.1));
}
