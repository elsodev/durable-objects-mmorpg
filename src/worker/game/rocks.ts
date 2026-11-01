// Mining rules: which pickaxe breaks which rock, what it drops, and when it comes back.
// Hits, power and drops live in the shared tool rules table (shared/engine/toolRules.ts).
import type { ItemId } from "../../shared/types";
import { ROCK_RULES, rollDrops, type Ore } from "../../shared/engine/toolRules";
import { DEFAULT_DROP_RATES, type DropRates } from "../../shared/engine/dropRate";

export type { Ore };

export const ROCK_RESPAWN_MS = 5 * 60 * 1000;

/** Minimum pickaxe power (ItemDef.power) needed to break each ore. */
export const ORE_POWER: Record<Ore, number> = Object.fromEntries(
  (Object.keys(ROCK_RULES) as Ore[]).map((ore) => [ore, ROCK_RULES[ore].power]),
) as Record<Ore, number>;

export function canMine(ore: Ore, pickaxePower: number): boolean {
  return pickaxePower >= ORE_POWER[ore];
}

/** The rock's own ore always drops; bonus drops scale with the drop rates. */
export function rockDrops(ore: Ore, rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): { item: ItemId; qty: number }[] {
  return rollDrops(ROCK_RULES[ore].drops, rand, rates, "rock");
}
