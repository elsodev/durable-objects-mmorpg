// Which ore a mining rock holds this time round. Maps place stone, copper, iron and gem rocks; in
// the caves each spawn of a rock may come back as silver, gold or diamond instead. The roll is
// seeded per (scope, rock, spawn), so the server gives the same answer after a restart and a
// broken rock can't be rerolled. Rare rocks (gold, diamond) scale with DROP_RATE_RARE, silver
// with DROP_RATE_ROCK.
import type { RockOre } from "../types";
import { mulberry32 } from "../maps/rng";
import { DEFAULT_DROP_RATES, rollDrop, type DropRates } from "./dropRate";
import { seedFrom } from "./harvest";

/** Chance per spawn that a rock comes back as each rarer ore (checked diamond, gold, silver). */
export interface RockUpgradeOdds {
  silver: number;
  gold: number;
  diamond: number;
}

/**
 * Per cave floor, keyed by the rock id prefix the caves map uses (f1 copper, f2 iron, f3 gem).
 * Deeper floors weigh in higher. Over the caves' 40 rocks this comes to about 3% gold and 0.6%
 * diamond rocks per spawn; gold needs about 6 hits and diamond 8 (toolRules.ts).
 */
export const CAVE_ROCK_ODDS: Readonly<Record<string, RockUpgradeOdds>> = {
  f1: { silver: 0, gold: 0.01, diamond: 0.002 },
  f2: { silver: 0.1, gold: 0.03, diamond: 0.005 },
  f3: { silver: 0.12, gold: 0.05, diamond: 0.012 },
};

/** Ores silver may replace (it would be a step down from a gem rock). */
const SILVER_REPLACES: ReadonlySet<RockOre> = new Set(["stone", "copper", "iron"]);

/** The upgrade odds for a rock id ("f3_7" -> f3), or null for rocks that never change. */
export function rockOdds(rockId: string): RockUpgradeOdds | null {
  const prefix = rockId.slice(0, rockId.indexOf("_"));
  return prefix && Object.hasOwn(CAVE_ROCK_ODDS, prefix) ? CAVE_ROCK_ODDS[prefix]! : null;
}

/** Rolls one spawn's ore from the rock's base ore. */
export function rollRockOre(base: RockOre, odds: RockUpgradeOdds | null, rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): RockOre {
  if (!odds) return base;
  if (rollDrop(odds.diamond, "rock", rand, rates, true)) return "diamond";
  if (rollDrop(odds.gold, "rock", rand, rates, true)) return "gold";
  if (SILVER_REPLACES.has(base) && rollDrop(odds.silver, "rock", rand, rates)) return "silver";
  return base;
}

/** The ore rock `rock` holds on its `spawn`-th appearance in `scope` (zone id or home owner). */
export function rockOreAt(
  rock: { id: string; ore: RockOre; odds?: RockUpgradeOdds },
  scope: string,
  spawn: number,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
): RockOre {
  // JSON maps carry their own odds on the rock; the caves map uses the prefix table.
  const odds = rock.odds ?? rockOdds(rock.id);
  if (!odds) return rock.ore;
  return rollRockOre(rock.ore, odds, mulberry32(seedFrom(`rockore|${scope}|${rock.id}|${spawn}`)), rates);
}
