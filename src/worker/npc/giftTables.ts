// Furniture a villager may give a friend at heart milestones. Each table fits the persona (the
// smith's forge decor, the innkeeper's kegs and stools...). How likely a gift is at each milestone
// and how the pieces are weighted are rolled once per villager from a seed, so every villager has
// their own generosity and favourites, the same for every player and every deploy.
import { mulberry32 } from "../../shared/maps/rng";
import { GIFT_MILESTONES, MAX_HEARTS, seedOf, type Bond } from "../../shared/hearts";
import { getItem } from "../../shared/items";
import type { ItemId } from "../../shared/types";
import type { NpcId } from "./bible";
import { DEFAULT_DROP_RATES, rollDrop, type DropRates } from "../../shared/engine/dropRate";

export const GIFT_TABLES: Readonly<Record<NpcId, readonly ItemId[]>> = {
  bram: ["writing_desk", "clock", "bookshelf", "painting_portrait", "potted_tree", "flower_vase", "wall_sconce"],
  odette: ["potted_plant", "flower_vase", "herb_box", "veg_crate", "basket", "sack", "painting_flowers"],
  fenwick: ["smith_anvil", "grindstone", "bellows", "tool_rack", "wall_tool_rack", "workbench", "coal_pile", "wall_sconce"],
  rue: ["barrel", "barrel_stack", "table_round", "bar_stool", "wall_pans", "dish_cabinet", "stove", "candle"],
  pip: ["toy_chest", "crate", "candle", "potted_plant", "painting_sea"],
  marlo: ["fish_crate", "barrel_water", "crate", "wall_shelf", "painting_sea"],
  sable: ["candle", "mirror", "floor_lamp", "potted_tree", "painting_landscape", "wall_sconce"],
  iris: ["cauldron", "herb_box", "potted_plant", "cupboard", "bookshelf", "wall_shelf"],
  grumm: ["mine_cart", "ore_crate", "coal_pile", "barrel", "grindstone", "wall_sconce"],
  tess: ["painting_landscape", "writing_desk", "basket", "sack", "dresser", "wardrobe"],
};

export type Rarity = "common" | "uncommon" | "rare";

/** Rarity from what a piece is worth: cheap things are common, big pieces rare. */
export function rarityOf(item: ItemId): Rarity {
  const value = (getItem(item)?.sell ?? 0) * 2;
  return value >= 250 ? "rare" : value >= 100 ? "uncommon" : "common";
}

/** A piece this villager already gave you is this much less likely to come again. */
const REPEAT_WEIGHT = 0.1;

const RARITY_WEIGHT: Readonly<Record<Rarity, number>> = { common: 6, uncommon: 3, rare: 1 };

export interface GiftProfile {
  /** Chance of a gift at each milestone (index matches GIFT_MILESTONES). */
  chance: number[];
  /** Base weight of each table entry. */
  weights: { item: ItemId; weight: number; rarity: Rarity }[];
}

const profiles = new Map<string, GiftProfile>();

/**
 * A villager's seeded gift profile: a base chance of 35..70% at the first milestone that rises
 * by 5..15 points per milestone (the last milestone always gives something), and each piece's
 * rarity weight scaled by 0.5..1.5 so villagers have favourites.
 */
export function giftProfile(npcId: NpcId): GiftProfile {
  const hit = profiles.get(npcId);
  if (hit) return hit;
  const rand = mulberry32(seedOf(`gifts:${npcId}`));
  const base = 0.35 + rand() * 0.35;
  const rise = 0.05 + rand() * 0.1;
  const chance = GIFT_MILESTONES.map((m, i) => (m === MAX_HEARTS ? 1 : Math.min(1, base + rise * i)));
  const weights = GIFT_TABLES[npcId].map((item) => {
    const rarity = rarityOf(item);
    return { item, rarity, weight: RARITY_WEIGHT[rarity] * (0.5 + rand()) };
  });
  const p = { chance, weights };
  profiles.set(npcId, p);
  return p;
}

/** Weighted pick from [item, weight] pairs; null if every weight is 0. */
export function weightedPick<T>(entries: readonly { value: T; weight: number }[], rand: () => number): T | null {
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const e of entries) {
    r -= Math.max(0, e.weight);
    if (r < 0) return e.value;
  }
  return entries[entries.length - 1]!.value;
}

/**
 * Rolls the gift for one milestone: null when the villager gives nothing this time (scales with
 * DROP_RATE_GIFT, or DROP_RATE_RARE when set). Higher
 * milestones lean towards rare pieces, and pieces this player already got are less likely.
 */
export function rollMilestoneGift(
  npcId: NpcId,
  milestone: number,
  bond: Pick<Bond, "given">,
  rand: () => number,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
): ItemId | null {
  const p = giftProfile(npcId);
  const i = GIFT_MILESTONES.indexOf(milestone as (typeof GIFT_MILESTONES)[number]);
  // Furniture counts as rare; the last milestone's sure gift (chance 1) is never scaled.
  if (i < 0 || !rollDrop(p.chance[i]!, "gift", rand, rates, true)) return null;
  const lean = 1 + milestone / 4;
  return weightedPick(
    p.weights.map((w) => ({
      value: w.item,
      weight: w.weight * (w.rarity === "rare" ? lean : w.rarity === "uncommon" ? Math.sqrt(lean) : 1) * (bond.given.includes(w.item) ? REPEAT_WEIGHT : 1),
    })),
    rand,
  );
}

/** What the villager says when handing a piece over (scripted: no model call, no player data). */
export function giftLine(item: ItemId, rand: () => number): string {
  const name = (getItem(item)?.name ?? "something").toLowerCase();
  const lines = getItem(item)?.kind === "seed" ? [
    `I've been saving these ${name} for someone special. Plant them somewhere sunny.`,
    `Here: ${name}. They're hard to come by, so look after them.`,
  ] : [
    `I've been meaning to give you this ${name}. It'd look nice in your home.`,
    `Here, take this ${name}. Friends look out for each other.`,
    `This ${name} needs a good home. I think yours is just right.`,
  ];
  return lines[Math.floor(rand() * lines.length)]!;
}
