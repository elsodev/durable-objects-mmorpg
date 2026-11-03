// Home farm rules that run once per day end (sleep, passing out at 2:00, or a day that ended
// while nobody was home), plus regrowing crops, stamina and the watering can. Harvest quality
// and yield live in harvest.ts.
// Pure: callers pass `now` (farm time, see homeclock.farmNow) and `rand`.
//
// Growth itself needs no work here: farm time moves to the next day, so a crop watered today
// counts one more grown day tomorrow (cropView), and soil reads dry again (wateredToday false).
// What does happen here is thirst: a growing crop not watered on the day that ended counts a dry
// day (it wilts), and at CROP_DEATH_DAYS it dies. Ripe crops don't need water.
import { DAY_MS, type FarmTile, type ItemId, type PlacedObject, type Vec2 } from "../types";
import { getItem, type ToolKind } from "../items";
import { CROP_DEATH_DAYS, cropView, dayIndex, harvestable, tillTile } from "./farming";

/** Crows never touch crops within this many tiles of a scarecrow. */
export const SCARECROW_RADIUS = 8;
/** Chance per morning that crows visit an unprotected farm of CROW_FULL_CROPS or more crops. */
export const CROW_CHANCE = 0.3;
/**
 * Smaller plots draw crows less (chance scales with the crop count up to here): with a flat 30%
 * a lone 10-day crop was eaten 97% of the time, so a single rare seed was nearly always lost.
 */
export const CROW_FULL_CROPS = 12;
/** One extra crop eaten per this many unprotected crops. */
export const CROWS_PER_CROPS = 16;
/** Empty tilled soil reverts after 2 dry days with this chance, and always after 3. */
export const REVERT_CHANCE_DAY2 = 0.5;
export const REVERT_DAYS_MAX = 3;

export const MAX_STAMINA = 100;
/** Passing out at 2:00 leaves you more tired the next morning. */
export const PASS_OUT_STAMINA = 50;
// Pickaxe and axe cost per hit (rocks and trees take several, see toolRules.ts).
export const TOOL_STAMINA: Record<ToolKind, number> = { hoe: 2, water: 2, pickaxe: 2, axe: 2, sword: 3, scythe: 2 };
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
  /** Growing crops that went without water and wilted (still alive). */
  wilted: number;
  /** Crops that died of thirst this morning. */
  died: CropLoss[];
}

/** Scarecrow positions (tile centres) among placed objects. */
export function scarecrowsOf(objects: readonly PlacedObject[]): Vec2[] {
  return objects.filter((o) => o.item === "scarecrow").map((o) => ({ x: o.x, y: o.y }));
}

export function protectedByScarecrow(tile: Vec2, scarecrows: readonly Vec2[], radius = SCARECROW_RADIUS): boolean {
  return scarecrows.some((s) => Math.hypot(s.x - tile.x, s.y - tile.y) <= radius);
}

/**
 * Picks the crops crows eat this morning: with CROW_CHANCE (less on small plots), one crop (plus one per
 * CROWS_PER_CROPS unprotected crops) among those not near a scarecrow.
 */
export function crowTargets(farm: readonly FarmTile[], objects: readonly PlacedObject[], rand: () => number): FarmTile[] {
  const scarecrows = scarecrowsOf(objects);
  const open = farm.filter((t) => t.crop && !t.dead && !protectedByScarecrow(t, scarecrows));
  if (open.length === 0 || rand() >= CROW_CHANCE * Math.min(1, open.length / CROW_FULL_CROPS)) return [];
  const n = Math.min(open.length, 1 + Math.floor(open.length / CROWS_PER_CROPS));
  const pool = open.slice();
  const out: FarmTile[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rand() * pool.length) % pool.length, 1)[0]);
  return out;
}

/**
 * Ends `endedDay` for the farm: unwatered crops wilt (and die after CROP_DEATH_DAYS), empty soil
 * dries out (and may revert), then crows visit. Mutates tiles in place and returns the survivors.
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
  let wilted = 0;
  const died: CropLoss[] = [];
  // How the crops look the next morning, before this roll changes anything.
  const morning = (endedDay + 1) * DAY_MS;
  for (const t of farm) {
    if (t.crop) {
      kept.push(t);
      if (t.dead) continue;
      if (t.lastWateredDay === endedDay) {
        grown++;
        t.dryDays = 0;
      } else if (cropView(t, morning).ready) {
        t.dryDays = 0;
      } else {
        t.dryDays = (t.dryDays ?? 0) + 1;
        if (t.dryDays >= CROP_DEATH_DAYS) {
          t.dead = true;
          died.push({ x: t.x, y: t.y, crop: t.crop });
        } else wilted++;
      }
      continue;
    }
    // Soil watered that day stayed damp: its dry count starts over.
    const dry = t.lastWateredDay === endedDay ? 0 : (t.dryDays ?? 0) + 1;
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
  return { farm: kept, reverted, eaten, grown, wilted, died };
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
  tile.dryDays = 0;
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
