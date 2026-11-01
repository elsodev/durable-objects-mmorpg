// Global drop-rate control. Every random drop roll in the game (monster loot, bonus rock drops,
// cave rock upgrades, chest loot, forage, villager gifts, seed drops, extra harvest yield) asks
// this module for its effective chance, so the operator can turn drops up or down from env
// (DROP_RATE and the DROP_RATE_* overrides; see parseDropRates). Guaranteed drops are never
// scaled. Pure: no env access here; the Durable Objects parse env once and pass the rates in.
import { getItem } from "../items";
import type { ItemId } from "../types";

export type DropCategory = "monster" | "rock" | "chest" | "forage" | "gift" | "harvest";

/** Multipliers: `global` for everything, plus optional per-category and rare-item overrides. */
export interface DropRates {
  global: number;
  monster?: number;
  rock?: number;
  chest?: number;
  forage?: number;
  gift?: number;
  harvest?: number;
  /** Rare items (gems, gold, rare seeds, furniture), wherever they drop. */
  rare?: number;
}

export const DEFAULT_DROP_RATES: Readonly<DropRates> = Object.freeze({ global: 1 });

/** Multipliers are clamped to 0..MAX_DROP_RATE. */
export const MAX_DROP_RATE = 10;

/** The env var behind each override (DROP_RATE itself sets `global`). */
export const DROP_RATE_VARS = {
  monster: "DROP_RATE_MONSTER",
  rock: "DROP_RATE_ROCK",
  chest: "DROP_RATE_CHEST",
  forage: "DROP_RATE_FORAGE",
  gift: "DROP_RATE_GIFT",
  harvest: "DROP_RATE_HARVEST",
  rare: "DROP_RATE_RARE",
} as const satisfies Record<Exclude<keyof DropRates, "global">, string>;

/** One env value as a multiplier: a finite number clamped to 0..10, else undefined (ignored). */
export function parseRate(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? clampRate(v) : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  // Number("") is 0 and Number("0x10") is 16: only plain decimals count.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? clampRate(n) : undefined;
}

const clampRate = (n: number) => Math.min(MAX_DROP_RATE, Math.max(0, n));

/** Drop rates from env vars. Missing, empty or non-numeric values fall back (global 1, overrides unset). */
export function parseDropRates(env: Readonly<Record<string, unknown>> | null | undefined): DropRates {
  const e = env ?? {};
  const out: DropRates = { global: parseRate(e.DROP_RATE) ?? 1 };
  for (const [key, name] of Object.entries(DROP_RATE_VARS) as [keyof typeof DROP_RATE_VARS, string][]) {
    const r = parseRate(e[name]);
    if (r !== undefined) out[key] = r;
  }
  return out;
}

/**
 * The multiplier for one roll: a rare item uses DROP_RATE_RARE when set; otherwise the
 * category's override when set; otherwise DROP_RATE.
 */
export function dropMultiplier(category: DropCategory, rates: Readonly<DropRates> = DEFAULT_DROP_RATES, rare = false): number {
  if (rare && rates.rare !== undefined) return rates.rare;
  return rates[category] ?? rates.global;
}

/**
 * Effective chance of a drop roll, capped at 1. A chance of 1 or more is a guaranteed drop and
 * is never scaled (not even by a 0 multiplier).
 */
export function dropChance(chance: number, category: DropCategory, rates: Readonly<DropRates> = DEFAULT_DROP_RATES, rare = false): number {
  if (!(chance > 0)) return 0;
  if (chance >= 1) return 1;
  return Math.min(1, chance * dropMultiplier(category, rates, rare));
}

/** One drop roll: true when `rand()` lands under the effective chance. */
export function rollDrop(chance: number, category: DropCategory, rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES, rare = false): boolean {
  return rand() < dropChance(chance, category, rates, rare);
}

/** A drop count (e.g. how much forage a zone holds), scaled and rounded; never below 0. */
export function dropCount(n: number, category: DropCategory, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): number {
  return Math.max(0, Math.round(n * dropMultiplier(category, rates)));
}

/** Items that count as rare for DROP_RATE_RARE: gems, gold, rare seeds and crops, furniture. */
export function isRareDrop(item: ItemId): boolean {
  const def = getItem(item);
  if (!def) return false;
  return def.kind === "gem" || def.kind === "furniture" || def.id === "ore_gold" || def.rarity === "rare";
}
