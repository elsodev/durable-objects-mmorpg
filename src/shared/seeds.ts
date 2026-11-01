// Where seeds come from: the town store's stock, seeds monsters drop, and rare seeds villagers
// give at heart milestones. Pure tables and rolls; callers pass `rand`.
import { GIFT_MILESTONES } from "./hearts";
import { baseItem, getItem, ITEMS, type CropRarity } from "./items";
import type { MonsterState } from "./engine/monsters";
import type { ItemId } from "./types";
import { SEASONS, type Season } from "./calendar";
import { DEFAULT_DROP_RATES, rollDrop, type DropRates } from "./engine/dropRate";

type MonsterType = MonsterState["type"];

/** Seed ids of one rarity, in item-table order. */
export function seedsOf(rarity: CropRarity): ItemId[] {
  return Object.values(ITEMS)
    .filter((d) => d.kind === "seed" && (d.rarity ?? "common") === rarity)
    .map((d) => d.id);
}

/** Every crop id (normal quality) that grows from a seed. */
export function allCrops(): ItemId[] {
  return Object.values(ITEMS)
    .filter((d) => d.kind === "seed" && d.grows)
    .map((d) => d.grows!.crop);
}

/** A crop or seed of rare rarity (any quality). */
export function isRareCrop(item: ItemId): boolean {
  const def = getItem(baseItem(item));
  return !!def && (def.kind === "crop" || def.kind === "seed") && def.rarity === "rare";
}

/** Every seed the town store may stock (all common seeds); storeSeedsFor picks the season's shelf. */
export const STORE_SEEDS: readonly ItemId[] = seedsOf("common");

/** Always on the shelf, whatever the season. */
export const STAPLE_SEEDS: readonly ItemId[] = ["seed_turnip", "seed_carrot", "seed_strawberry", "seed_pumpkin"].filter((id) => STORE_SEEDS.includes(id));

/**
 * The seasons a store seed is stocked in (world calendar, shared/calendar.ts): staples all year,
 * every other common seed for two seasons in a row, spread round the year in table order.
 */
export function seedSeasons(item: ItemId): Season[] {
  if (STAPLE_SEEDS.includes(item)) return [...SEASONS];
  const i = STORE_SEEDS.filter((id) => !STAPLE_SEEDS.includes(id)).indexOf(item);
  if (i < 0) return [];
  return [SEASONS[i % 4]!, SEASONS[(i + 1) % 4]!];
}

/** The store's seed shelf this season. */
export function storeSeedsFor(season: Season): ItemId[] {
  return STORE_SEEDS.filter((id) => seedSeasons(id).includes(season));
}

export interface SeedDropRule {
  /** Chance a kill drops a seed at all. */
  chance: number;
  pool: readonly { item: ItemId; weight: number }[];
}

const pool = (weights: Partial<Record<CropRarity, number>>) =>
  (Object.entries(weights) as [CropRarity, number][]).flatMap(([rarity, weight]) =>
    seedsOf(rarity).map((item) => ({ item, weight })),
  );

/**
 * Seeds monsters drop, by zone then monster type. Riverside slimes drop common and uncommon
 * seeds; cave monsters drop uncommon seeds and now and then a rare one (rock crabs most often).
 * Kept apart from MONSTER_STATS.drops so drop-table rewrites can fold it in as one entry.
 */
export const MONSTER_SEED_DROPS: Readonly<Record<string, Partial<Record<MonsterType, SeedDropRule>>>> = {
  riverside: {
    slime: { chance: 0.25, pool: pool({ common: 6, uncommon: 1 }) },
  },
  caves: {
    slime: { chance: 0.15, pool: pool({ uncommon: 10, rare: 1 }) },
    bat: { chance: 0.15, pool: pool({ uncommon: 10, rare: 1 }) },
    rock_crab: { chance: 0.25, pool: pool({ uncommon: 6, rare: 1 }) },
  },
};

function weighted<T>(entries: readonly { item: T; weight: number }[], rand: () => number): T | null {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r < 0) return e.item;
  }
  return entries[entries.length - 1]!.item;
}

/**
 * The seed a kill drops in `zone`, if any. Whether a seed drops scales with DROP_RATE_MONSTER;
 * whether it is a rare one (its share of the pool's weight) with DROP_RATE_RARE when set.
 */
export function rollSeedDrop(
  zone: string,
  type: MonsterType,
  rand: () => number,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
): { item: ItemId; qty: number } | null {
  const rule = MONSTER_SEED_DROPS[zone]?.[type];
  if (!rule || !rollDrop(rule.chance, "monster", rand, rates)) return null;
  const rare = rule.pool.filter((e) => isRareCrop(e.item));
  const rest = rule.pool.filter((e) => !isRareCrop(e.item));
  const total = rule.pool.reduce((s, e) => s + e.weight, 0);
  const rareShare = total > 0 ? rare.reduce((s, e) => s + e.weight, 0) / total : 0;
  const pickRare = rare.length > 0 && (rest.length === 0 || rollDrop(rareShare, "monster", rand, rates, true));
  const item = weighted(pickRare ? rare : rest, rand);
  return item ? { item, qty: 1 } : null;
}

/** Rare seeds villagers may hand a friend at heart milestones. */
export const RARE_SEED_GIFTS: readonly ItemId[] = seedsOf("rare");

/** Chance of a rare seed at each heart milestone (index matches GIFT_MILESTONES). */
export const SEED_GIFT_CHANCE: readonly number[] = [0.1, 0.2, 0.3, 0.45, 0.6];

/** The rare seed a villager gives at `milestone`, or null (scales with DROP_RATE_GIFT / DROP_RATE_RARE). */
export function rollMilestoneSeed(milestone: number, rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): ItemId | null {
  const i = GIFT_MILESTONES.indexOf(milestone as (typeof GIFT_MILESTONES)[number]);
  if (i < 0 || !rollDrop(SEED_GIFT_CHANCE[i] ?? 0, "gift", rand, rates, true)) return null;
  return weighted(RARE_SEED_GIFTS.map((item) => ({ item, weight: 1 })), rand);
}
