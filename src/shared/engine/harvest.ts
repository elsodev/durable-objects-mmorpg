// Harvest rolls: quality and yield from a light farming level, drawn from a seeded PRNG so the
// same crop on the same day always gives the same result (a retry or reconnect can't reroll).
// Rock drops are seeded the same way, per rock and per respawn.
import type { ItemId } from "../types";
import { qualityItem } from "../items";
import { mulberry32 } from "../maps/rng";
import { DEFAULT_DROP_RATES, dropChance, type DropRates } from "./dropRate";

export type Quality = 0 | 1 | 2;

export const MAX_FARMING_LEVEL = 10;
/** Crops harvested for level L: HARVESTS_PER_LEVEL_SQ * L^2 (5, 20, 45, ... 500 for level 10). */
export const HARVESTS_PER_LEVEL_SQ = 5;
/** Silver never gets likelier than this. */
export const MAX_SILVER_CHANCE = 0.75;
/** Extra crops never chain past this chance per draw (or one roll could loop for long). */
export const MAX_EXTRA_CHANCE = 0.9;
/** Hard cap on one harvest's count. */
export const MAX_HARVEST = 10;

/** Per-crop yield: a uniform count in [min, max], then extra crops while a roll beats `extra`. */
export interface CropYield {
  min: number;
  max: number;
  extra: number;
}

const ONE: CropYield = { min: 1, max: 1, extra: 0 };

export const CROP_YIELD: Readonly<Record<ItemId, CropYield>> = {
  turnip: { min: 1, max: 1, extra: 0.1 },
  carrot: { min: 1, max: 1, extra: 0.15 },
  strawberry: { min: 1, max: 2, extra: 0.02 },
  pumpkin: ONE,
  radish: { min: 1, max: 1, extra: 0.1 },
  potato: { min: 1, max: 1, extra: 0.2 },
  green_bean: { min: 1, max: 2, extra: 0 },
  tomato: { min: 1, max: 1, extra: 0.05 },
  blueberry: { min: 1, max: 2, extra: 0.05 },
  corn: { min: 1, max: 1, extra: 0.1 },
  grape: { min: 1, max: 2, extra: 0 },
  moonberry: { min: 1, max: 2, extra: 0.02 },
};

export function cropYield(crop: ItemId): CropYield {
  return Object.hasOwn(CROP_YIELD, crop) ? CROP_YIELD[crop]! : ONE;
}

/** Farming level 0..10 from the lifetime harvest count (the player save's stats.cropsHarvested). */
export function farmingLevel(cropsHarvested: number): number {
  const n = Number.isFinite(cropsHarvested) ? Math.max(0, cropsHarvested) : 0;
  return Math.min(MAX_FARMING_LEVEL, Math.floor(Math.sqrt(n / HARVESTS_PER_LEVEL_SQ)));
}

/**
 * Gold-chance bonus from fertilizer of tier 0 (none) .. 3. There is no fertilizer item yet; this
 * is where it plugs in, scaled by level so it helps experienced farmers most.
 */
export function fertilizerGoldBonus(tier: number, level: number): number {
  return tier > 0 ? 0.2 * tier * ((level + 2) / 12) : 0;
}

/** Chances of gold and silver at `level` (silver is checked only when gold missed). */
export function qualityOdds(level: number, fertilizer = 0): { gold: number; silver: number } {
  const L = Math.min(MAX_FARMING_LEVEL, Math.max(0, level));
  const gold = 0.2 * (L / 10) + fertilizerGoldBonus(fertilizer, L) + 0.01;
  return { gold, silver: Math.min(MAX_SILVER_CHANCE, 2 * gold) };
}

export function rollQuality(level: number, rand: () => number, fertilizer = 0): Quality {
  const { gold, silver } = qualityOdds(level, fertilizer);
  if (rand() < gold) return 2;
  if (rand() < silver) return 1;
  return 0;
}

/** How many crops one harvest gives (at least 1). Extra crops scale with DROP_RATE_HARVEST. */
export function rollCount(y: CropYield, rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): number {
  const lo = Math.max(1, Math.floor(y.min));
  const hi = Math.max(lo, Math.floor(y.max));
  let n = lo + Math.floor(rand() * (hi - lo + 1));
  const extra = Math.min(MAX_EXTRA_CHANCE, dropChance(Math.max(0, y.extra), "harvest", rates));
  while (n < MAX_HARVEST && extra > 0 && rand() < extra) n++;
  return Math.min(MAX_HARVEST, n);
}

export interface HarvestRoll {
  quality: Quality;
  count: number;
  /** What goes in the bag: the first crop at `quality`, the rest at normal quality. */
  items: { item: ItemId; qty: number }[];
}

export function rollHarvest(crop: ItemId, level: number, rand: () => number, fertilizer = 0, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): HarvestRoll {
  const quality = rollQuality(level, rand, fertilizer);
  const count = rollCount(cropYield(crop), rand, rates);
  const first = qualityItem(crop, quality);
  const items = [{ item: first, qty: 1 }];
  if (count > 1) {
    if (first === crop) items[0]!.qty = count;
    else items.push({ item: crop, qty: count - 1 });
  }
  return { quality, count, items };
}

/** FNV-1a of a key string, as a 32-bit PRNG seed. */
export function seedFrom(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The PRNG for harvesting tile (x, y) of `owner`'s farm on home day `day`. */
export function harvestRand(owner: string, day: number, x: number, y: number): () => number {
  return mulberry32(seedFrom(`harvest|${owner}|${day}|${x},${y}`));
}

/** The PRNG for what rock `rockId` drops the `spawn`-th time it breaks (`scope`: home owner or zone). */
export function rockRand(scope: string, rockId: string, spawn: number): () => number {
  return mulberry32(seedFrom(`rock|${scope}|${rockId}|${spawn}`));
}
