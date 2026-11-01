// Item catalog. Signatures are the contract; fill in the data.
import type { Inventory, ItemId } from "./types";

export type ItemKind = "seed" | "crop" | "ore" | "gem" | "tool" | "furniture" | "material" | "fish" | "forage";
export type ToolKind = "hoe" | "water" | "pickaxe" | "sword";

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  /** Client icon key (see src/client/render/icons.ts). */
  icon: string;
  /** Coins an NPC pays when you sell one. 0 = cannot sell. */
  sell: number;
  /** Coins to buy one from a shop, if any shop sells it. */
  buy?: number;
  /** Max per inventory slot. Tools and furniture: 1..10, others 99. */
  stack: number;
  tool?: ToolKind;
  /**
   * Seeds: which crop they grow and how many watered days it takes. `regrow`: after the first
   * harvest the plant stays and is ready again after this many more watered days.
   */
  grows?: { crop: ItemId; days: number; regrow?: number };
  /** Crops: harvest quality (1 silver, 2 gold); `base` is the normal-quality crop id. */
  quality?: 1 | 2;
  base?: ItemId;
  /** Edible items: stamina restored by eating one. */
  eat?: number;
  /** Furniture: footprint in tiles at rotation 0, and where it may go. */
  footprint?: { w: number; h: number };
  placeOn?: "floor" | "outdoor";
  /** Weapons: damage per hit. Pickaxe: rock power. */
  power?: number;
  /** Furniture: true if entities can walk over it once placed (rugs). Default: furniture blocks. */
  walkable?: boolean;
  /** Short flavour text for tooltips. */
  desc?: string;
}

// ---- small builders so the table below stays readable ----

type Extra = Partial<Omit<ItemDef, "id" | "name" | "kind" | "icon">>;

function def(id: ItemId, name: string, kind: ItemKind, sell: number, extra: Extra = {}): ItemDef {
  return { id, name, kind, icon: id, sell, stack: 99, ...extra };
}

function tool(id: ItemId, name: string, t: ToolKind, power: number, extra: Extra = {}): ItemDef {
  return def(id, name, "tool", 0, { stack: 1, tool: t, power, ...extra });
}

function furniture(
  id: ItemId,
  name: string,
  w: number,
  h: number,
  placeOn: "floor" | "outdoor",
  buy: number,
  extra: Extra = {},
): ItemDef {
  return def(id, name, "furniture", Math.floor(buy / 2), { stack: 10, buy, footprint: { w, h }, placeOn, ...extra });
}

/** Sell price multipliers for silver / gold quality crops. */
export const QUALITY_PRICE = [1, 1.25, 1.5] as const;
const QUALITY_NAME = ["", "Silver", "Gold"] as const;
const QUALITY_SUFFIX = ["", "_silver", "_gold"] as const;
/** Eating a better crop restores a little more stamina. */
const QUALITY_EAT = [1, 1.4, 1.8] as const;

/**
 * A seed (`seed_<crop>`) plus the crop it grows into, in three qualities (`<crop>`,
 * `<crop>_silver`, `<crop>_gold`) so each quality stacks on its own.
 */
function crop(
  name: string,
  cropId: ItemId,
  days: number,
  seedBuy: number,
  cropSell: number,
  eat: number,
  regrow?: number,
): ItemDef[] {
  const again = regrow ? ` Keeps producing every ${regrow} days.` : "";
  const out = [
    def(`seed_${cropId}`, `${name} Seeds`, "seed", Math.floor(seedBuy / 2), {
      buy: seedBuy,
      grows: regrow ? { crop: cropId, days, regrow } : { crop: cropId, days },
      desc: `Grows into ${name.toLowerCase()} after ${days} watered days.${again}`,
    }),
    def(cropId, name, "crop", cropSell, { eat }),
  ];
  for (const q of [1, 2] as const) {
    out.push(
      def(`${cropId}${QUALITY_SUFFIX[q]}`, `${QUALITY_NAME[q]} ${name}`, "crop", Math.round(cropSell * QUALITY_PRICE[q]), {
        quality: q,
        base: cropId,
        eat: Math.round(eat * QUALITY_EAT[q]),
        desc: `${QUALITY_NAME[q]} quality: sells for more.`,
      }),
    );
  }
  return out;
}

const ALL: ItemDef[] = [
  // Tools (pickaxe power: 1 = stone/copper, 2 = iron/gem)
  tool("hoe", "Hoe", "hoe", 1, { desc: "Tills grass into farmland." }),
  tool("watering_can", "Watering Can", "water", 1, { desc: "Water each crop once a day." }),
  tool("pickaxe", "Pickaxe", "pickaxe", 1, { desc: "Breaks stone and copper rocks." }),
  tool("pickaxe_iron", "Iron Pickaxe", "pickaxe", 2, { buy: 500, desc: "Breaks iron and gem rocks too." }),
  tool("sword_wood", "Wooden Sword", "sword", 5),
  tool("sword_copper", "Copper Sword", "sword", 10, { buy: 300 }),

  // Seeds & crops
  ...crop("Turnip", "turnip", 2, 10, 25, 8),
  ...crop("Carrot", "carrot", 3, 15, 40, 12),
  ...crop("Strawberry", "strawberry", 4, 25, 70, 15, 3),
  ...crop("Pumpkin", "pumpkin", 5, 30, 110, 25),

  // Ores & gems
  def("stone", "Stone", "ore", 2),
  def("ore_copper", "Copper Ore", "ore", 10),
  def("ore_iron", "Iron Ore", "ore", 25),
  def("gem_crystal", "Gem Crystal", "gem", 80, { desc: "Glows faintly. The shrine lantern might want one." }),

  // Materials
  def("wood", "Wood", "material", 3, { buy: 5 }),
  def("slime_gel", "Slime Gel", "material", 8),
  def("bat_wing", "Bat Wing", "material", 12),
  def("crab_shell", "Crab Shell", "material", 20),

  // Forage & fish
  def("herb_mint", "Mint", "forage", 15),
  def("mushroom", "Mushroom", "forage", 20),
  def("fish_trout", "Trout", "fish", 30),

  // Furniture (footprint at rotation 0)
  furniture("chair_wood", "Wooden Chair", 1, 1, "floor", 40),
  furniture("table_wood", "Wooden Table", 2, 1, "floor", 80),
  furniture("bed_simple", "Simple Bed", 1, 2, "floor", 150),
  furniture("rug", "Rug", 2, 2, "floor", 60, { walkable: true }),
  furniture("lamp", "Lamp", 1, 1, "floor", 50),
  furniture("flower_pot", "Flower Pot", 1, 1, "floor", 30),
  furniture("fence", "Fence", 1, 1, "outdoor", 10),
  furniture("scarecrow", "Scarecrow", 1, 1, "outdoor", 75),
];

export const ITEMS: Record<ItemId, ItemDef> = Object.fromEntries(ALL.map((d) => [d.id, d]));

/**
 * Looks up an item. Ids often come from clients, so only OWN keys count: "constructor",
 * "__proto__" etc. must not resolve to Object.prototype members.
 */
export function getItem(id: ItemId): ItemDef | undefined {
  return typeof id === "string" && Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
}

export const MAX_SLOTS = 24;

/** Normal-quality id of an item (quality crops map to their base crop; others to themselves). */
export function baseItem(id: ItemId): ItemId {
  return getItem(id)?.base ?? id;
}

/** Item id for a crop at a quality (0 normal, 1 silver, 2 gold); unknown combos fall back to the crop. */
export function qualityItem(cropId: ItemId, quality: 0 | 1 | 2): ItemId {
  const id = `${cropId}${QUALITY_SUFFIX[quality] ?? ""}`;
  return getItem(id) ? id : cropId;
}

/** New player's inventory: hoe, watering can, pickaxe, wooden sword, 10 turnip seeds, a chair, 50 coins. */
export function starterInventory(): Inventory {
  return {
    coins: 50,
    slots: [
      { item: "hoe", qty: 1 },
      { item: "watering_can", qty: 1 },
      { item: "pickaxe", qty: 1 },
      { item: "sword_wood", qty: 1 },
      { item: "seed_turnip", qty: 10 },
      { item: "chair_wood", qty: 1 },
    ],
  };
}
