// Mining rules: which pickaxe breaks which rock, what it drops, and when it comes back.
import type { ItemId } from "../../shared/types";

export type Ore = "stone" | "copper" | "iron" | "gem";

export const ROCK_RESPAWN_MS = 5 * 60 * 1000;

/** Minimum pickaxe power (ItemDef.power) needed to break each ore. */
export const ORE_POWER: Record<Ore, number> = { stone: 1, copper: 1, iron: 2, gem: 2 };

const ORE_DROPS: Record<Ore, { item: ItemId; min: number; max: number; chance: number }[]> = {
  stone: [{ item: "stone", min: 1, max: 3, chance: 1 }],
  copper: [
    { item: "ore_copper", min: 1, max: 2, chance: 1 },
    { item: "stone", min: 0, max: 1, chance: 1 },
  ],
  iron: [
    { item: "ore_iron", min: 1, max: 2, chance: 1 },
    { item: "stone", min: 0, max: 1, chance: 1 },
  ],
  gem: [
    { item: "gem_crystal", min: 1, max: 1, chance: 1 },
    { item: "stone", min: 1, max: 2, chance: 1 },
  ],
};

export function canMine(ore: Ore, pickaxePower: number): boolean {
  return pickaxePower >= ORE_POWER[ore];
}

export function rockDrops(ore: Ore, rand: () => number): { item: ItemId; qty: number }[] {
  const out: { item: ItemId; qty: number }[] = [];
  for (const d of ORE_DROPS[ore]) {
    if (rand() >= d.chance) continue;
    const qty = d.min + Math.floor(rand() * (d.max - d.min + 1));
    if (qty > 0) out.push({ item: d.item, qty });
  }
  return out;
}

