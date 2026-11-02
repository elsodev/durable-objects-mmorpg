// Item catalog. Signatures are the contract; fill in the data.
import type { Inventory, ItemId } from "./types";
import { HOME_GOODS, type StorageSpec } from "./furnitureItems";
import { FOOD_SELL_SHARE, FOODS, type FoodType } from "./foods";

export type Rotation = 0 | 1 | 2 | 3;

export type ItemKind = "seed" | "crop" | "ore" | "gem" | "tool" | "furniture" | "material" | "fish" | "forage" | "produce" | "food";
export type ToolKind = "hoe" | "water" | "pickaxe" | "axe" | "sword";

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
  /** Prepared food (shared/foods.ts): snack, meal or drink. Drinks sound different when you have one. */
  food?: FoodType;
  /**
   * Furniture: footprint in tiles at rotation 0, and where it may go. "wall" items hang on the
   * face of a wall (wall tiles just above the floor), never on the floor.
   */
  footprint?: { w: number; h: number };
  placeOn?: "floor" | "outdoor" | "wall";
  /**
   * Furniture: the rotations it may be placed at (default [0]). Only rotations with art are
   * listed: turned art from the pack, or 3 = the front art mirrored for pieces where a mirror
   * image still reads right (1x1, so the footprint is unchanged).
   */
  rotations?: readonly Rotation[];
  /** Weapons: damage per hit. Pickaxe: rock power. */
  power?: number;
  /** Furniture: true if entities can walk over it once placed (rugs). Default: furniture blocks. */
  walkable?: boolean;
  /** Short flavour text for tooltips. */
  desc?: string;
  /** Seeds and crops: how hard the seed is to come by (shop, monster drops, villager gifts). Furniture: "rare" pieces are never sold. */
  rarity?: CropRarity;
  /** Furniture you can keep items in (the fridge): its slots and what it takes. */
  storage?: StorageSpec;
  /** Furniture you can sleep in to end the day. */
  bed?: boolean;
}

export type CropRarity = "common" | "uncommon" | "rare";

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
  placeOn: "floor" | "outdoor" | "wall",
  buy: number,
  extra: Extra = {},
): ItemDef {
  return def(id, name, "furniture", Math.floor(buy / 2), { stack: 10, buy, footprint: { w, h }, placeOn, ...extra });
}

/** Every rotation: turned art exists for left and back, and right is the left art mirrored. */
const ALL_TURNS: readonly Rotation[] = [0, 1, 2, 3];
/** Front art or its mirror image (1x1 pieces only, so the footprint stays the same). */
const MIRROR: readonly Rotation[] = [0, 3];

/** A gift-only piece: `value` is what it would cost (it sells for half). */
function gift(id: ItemId, name: string, w: number, h: number, placeOn: "floor" | "wall", value: number, extra: Extra = {}): ItemDef {
  const wall = placeOn === "wall";
  return furniture(id, name, w, h, placeOn, value, {
    buy: undefined,
    // Wall pieces hang over wall tiles nobody walks on, so they never block anyone.
    ...(wall ? { walkable: true } : {}),
    ...extra,
  });
}

const GIFT_FURNITURE: ItemDef[] = [
  // Floor pieces
  gift("wardrobe", "Wardrobe", 2, 1, "floor", 400, { desc: "Tall and roomy. Smells of cedar." }),
  gift("workbench", "Workbench", 3, 1, "floor", 320, { desc: "Scarred by years of honest work." }),
  gift("barrel_stack", "Keg Stack", 2, 1, "floor", 220, { desc: "Two kegs, one cradle, no spills." }),
  gift("barrel", "Barrel", 1, 1, "floor", 60),
  gift("barrel_water", "Water Barrel", 1, 1, "floor", 70),
  gift("crate", "Crate", 1, 1, "floor", 40),
  gift("sack", "Grain Sack", 1, 1, "floor", 30, { rotations: MIRROR }),
  gift("basket", "Tall Basket", 1, 1, "floor", 45),
  gift("bookshelf", "Bookshelf", 1, 1, "floor", 260),
  gift("cupboard", "Cupboard", 1, 1, "floor", 220),
  gift("dish_cabinet", "Dish Cabinet", 1, 1, "floor", 240),
  gift("dresser", "Dresser", 2, 1, "floor", 280),
  gift("clock", "Grandfather Clock", 1, 1, "floor", 350, { desc: "Tick... tock..." }),
  gift("floor_lamp", "Reading Lamp", 1, 1, "floor", 120),
  gift("potted_plant", "Potted Fern", 1, 1, "floor", 60, { rotations: MIRROR }),
  gift("potted_tree", "Potted Tree", 1, 1, "floor", 140, { rotations: MIRROR }),
  gift("flower_vase", "Flower Vase", 1, 1, "floor", 50, { rotations: MIRROR }),
  gift("cauldron", "Cauldron", 1, 1, "floor", 180, { rotations: MIRROR, desc: "Still smells faintly of mint." }),
  gift("grindstone", "Grindstone", 1, 1, "floor", 200, { rotations: MIRROR }),
  gift("smith_anvil", "Anvil", 1, 1, "floor", 300, { rotations: MIRROR, desc: "A proper smith's anvil." }),
  gift("bellows", "Bellows", 1, 1, "floor", 150, { rotations: MIRROR }),
  gift("tool_rack", "Tool Rack", 2, 1, "floor", 180),
  gift("coal_pile", "Coal Heap", 2, 1, "floor", 90),
  gift("ore_crate", "Ore Crate", 1, 1, "floor", 110),
  gift("veg_crate", "Veggie Crate", 1, 1, "floor", 70),
  gift("fish_crate", "Fish Crate", 1, 1, "floor", 80),
  gift("herb_box", "Herb Planter", 1, 1, "floor", 90),
  gift("mine_cart", "Mine Cart", 1, 1, "floor", 240, { rotations: MIRROR }),
  gift("toy_chest", "Toy Chest", 1, 1, "floor", 130, { rotations: MIRROR }),
  gift("writing_desk", "Writing Desk", 2, 1, "floor", 300),
  gift("table_round", "Round Table", 1, 1, "floor", 90),
  gift("bar_stool", "Bar Stool", 1, 1, "floor", 50),
  gift("stove", "Iron Stove", 1, 1, "floor", 320),
  gift("candle", "Candle", 1, 1, "floor", 25, { walkable: true, desc: "A cosy little flame." }),
  // Wall pieces (rotation 0 only: they face the room)
  gift("painting_landscape", "Landscape Painting", 2, 1, "wall", 260),
  gift("painting_sea", "Sea Painting", 2, 1, "wall", 240),
  gift("painting_portrait", "Portrait", 1, 1, "wall", 220),
  gift("painting_flowers", "Flower Painting", 1, 1, "wall", 180),
  gift("mirror", "Mirror", 1, 1, "wall", 160),
  gift("wall_shelf", "Wall Shelf", 2, 1, "wall", 120),
  gift("wall_pans", "Hanging Pans", 1, 1, "wall", 90),
  gift("wall_tool_rack", "Wall Tool Rack", 3, 1, "wall", 160),
  gift("wall_sconce", "Wall Sconce", 1, 1, "wall", 110),
];

/** Shipping-bin value of each ore and gem. Rarer ores take more pickaxe hits (toolRules.ts). */
export const ORE_VALUES = {
  stone: 2,
  ore_copper: 10,
  ore_iron: 25,
  ore_silver: 45,
  gem_crystal: 80,
  ore_gold: 90,
  gem_diamond: 350,
} as const satisfies Record<ItemId, number>;

/**
 * Shops pay this share of an ore's or gem's value: cash on the spot, while the shipping bin pays
 * the full value overnight.
 */
export const SHOP_ORE_SHARE = 0.6;

/** Coins a shop pays for one `item` (0 = they can't buy it). */
export function shopSellPrice(item: ItemId): number {
  const def = getItem(item);
  if (!def || def.sell <= 0) return 0;
  if (def.kind === "ore" || def.kind === "gem") return Math.max(1, Math.floor(def.sell * SHOP_ORE_SHARE));
  return def.sell;
}

/** True for items the shipping bin takes: anything with a sell value except tools. */
export function isShippable(item: ItemId): boolean {
  const def = getItem(item);
  return !!def && def.sell > 0 && def.kind !== "tool";
}

/** Sell price multipliers for silver / gold quality crops. */
export const QUALITY_PRICE = [1, 1.25, 1.5] as const;
const QUALITY_NAME = ["", "Silver", "Gold"] as const;
const QUALITY_SUFFIX = ["", "_silver", "_gold"] as const;
/** Eating a better crop restores a little more stamina. */
const QUALITY_EAT = [1, 1.4, 1.8] as const;

/** How much more a crop of each rarity sells for than a common crop of the same growth. */
export const RARITY_PRICE: Readonly<Record<CropRarity, number>> = { common: 1, uncommon: 1.5, rare: 4 };

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/**
 * Sell price of a normal-quality crop, scaling with the watered days it needs. A crop that
 * regrows is priced on its regrow days, since it pays out again and again.
 */
export function cropSellPrice(days: number, rarity: CropRarity = "common", regrow?: number): number {
  const base = regrow ? 14 * regrow + 2 * days + 10 : 16 * days + 5;
  return round5(base * RARITY_PRICE[rarity]);
}

/** Shop price of the seed: single-harvest seeds cost 40% of one crop, regrowing ones 80%. */
export function seedBuyPrice(days: number, rarity: CropRarity = "common", regrow?: number): number {
  const sell = cropSellPrice(days, rarity, regrow);
  return round5(sell * (rarity === "rare" ? 1 : regrow ? 0.8 : 0.4));
}

interface CropSpec {
  name: string;
  id: ItemId;
  days: number;
  regrow?: number;
  rarity?: CropRarity;
  desc?: string;
}

/** A crop from the table below, priced by cropSellPrice / seedBuyPrice. */
function pricedCrop(c: CropSpec): ItemDef[] {
  const rarity = c.rarity ?? "common";
  const sell = cropSellPrice(c.days, rarity, c.regrow);
  const eat = Math.min(40, Math.max(5, Math.round(sell / 5)));
  return crop(c.name, c.id, c.days, seedBuyPrice(c.days, rarity, c.regrow), sell, eat, c.regrow, rarity, c.desc);
}

/**
 * Crops beyond the first four, from the LPC crop packs. Common seeds are sold in town, uncommon
 * ones come from monsters, and rare ones from monsters deep in the caves and from villagers.
 */
export const CROP_SPECS: readonly CropSpec[] = [
  { name: "Radish", id: "radish", days: 3 },
  { name: "Lettuce", id: "lettuce", days: 3 },
  { name: "Potato", id: "potato", days: 4 },
  { name: "Beet", id: "beet", days: 4 },
  { name: "Onion", id: "onion", days: 5 },
  { name: "Bell Pepper", id: "bell_pepper", days: 5, regrow: 3 },
  { name: "Green Bean", id: "green_bean", days: 6, regrow: 3 },
  { name: "Tomato", id: "tomato", days: 6, regrow: 3 },
  { name: "Eggplant", id: "eggplant", days: 6, regrow: 3 },
  { name: "Cabbage", id: "cabbage", days: 6 },
  { name: "Cauliflower", id: "cauliflower", days: 7 },
  { name: "Blueberry", id: "blueberry", days: 7, regrow: 2 },
  { name: "Corn", id: "corn", days: 8, regrow: 4 },
  { name: "Grape", id: "grape", days: 8, regrow: 3, rarity: "uncommon" },
  { name: "Watermelon", id: "watermelon", days: 9, rarity: "uncommon" },
  { name: "Pineapple", id: "pineapple", days: 10, rarity: "uncommon", desc: "A tropical treat. Its seeds turn up on monsters." },
  { name: "Moonberry", id: "moonberry", days: 8, regrow: 4, rarity: "rare", desc: "Silvery berries that glow faintly at dusk. Villagers adore them." },
  { name: "Golden Melon", id: "golden_melon", days: 10, rarity: "rare", desc: "A melon with a golden rind. Worth a small fortune." },
  { name: "Starfruit", id: "starfruit", days: 12, regrow: 6, rarity: "rare", desc: "Sweet, star-shaped fruit. Rarely seen outside a friend's garden." },
];

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
  rarity: CropRarity = "common",
  flavour?: string,
): ItemDef[] {
  const again = regrow ? ` Keeps producing every ${regrow} days.` : "";
  const out = [
    def(`seed_${cropId}`, `${name} Seeds`, "seed", Math.floor(seedBuy / 2), {
      buy: seedBuy,
      grows: regrow ? { crop: cropId, days, regrow } : { crop: cropId, days },
      desc: `Grows into ${name.toLowerCase()} after ${days} watered days.${again}`,
      rarity,
    }),
    def(cropId, name, "crop", cropSell, { eat, rarity, ...(flavour ? { desc: flavour } : {}) }),
  ];
  for (const q of [1, 2] as const) {
    out.push(
      def(`${cropId}${QUALITY_SUFFIX[q]}`, `${QUALITY_NAME[q]} ${name}`, "crop", Math.round(cropSell * QUALITY_PRICE[q]), {
        quality: q,
        base: cropId,
        rarity,
        eat: Math.round(eat * QUALITY_EAT[q]),
        desc: `${QUALITY_NAME[q]} quality: sells for more.`,
      }),
    );
  }
  return out;
}

const ALL: ItemDef[] = [
  // Tools (pickaxe power: 1 = stone/copper, 2 = iron and everything rarer)
  tool("hoe", "Hoe", "hoe", 1, { desc: "Tills grass into farmland." }),
  tool("watering_can", "Watering Can", "water", 1, { desc: "Water tilled soil once a day." }),
  tool("pickaxe", "Pickaxe", "pickaxe", 1, { desc: "Breaks stone and copper rocks." }),
  tool("pickaxe_iron", "Iron Pickaxe", "pickaxe", 2, { buy: 500, desc: "Breaks iron, silver, gold, gem and diamond rocks too." }),
  tool("axe", "Axe", "axe", 1, { buy: 150, desc: "Chops trees and clears stumps for wood." }),
  tool("sword_wood", "Wooden Sword", "sword", 5),
  tool("sword_copper", "Copper Sword", "sword", 10, { buy: 300 }),
  // Not swung: just carrying it lights the whole cave (see shared/flashlight.ts).
  def("flashlight", "Flashlight", "tool", 120, { stack: 1, rarity: "rare", desc: "Lights up the whole cave while it's in your bag. A rare find from cave monsters and chests." }),

  // Seeds & crops
  ...crop("Turnip", "turnip", 2, 10, 25, 8),
  ...crop("Carrot", "carrot", 3, 15, 40, 12),
  ...crop("Strawberry", "strawberry", 4, 25, 70, 15, 3),
  ...crop("Pumpkin", "pumpkin", 5, 30, 110, 25),
  ...CROP_SPECS.flatMap(pricedCrop),

  // Ores & gems (values: see ORE_VALUES; ship them in the bin or sell to the smith for less)
  def("stone", "Stone", "ore", ORE_VALUES.stone, { desc: "Plain stone. Worth a coin or two." }),
  def("ore_copper", "Copper Ore", "ore", ORE_VALUES.ore_copper, { desc: "Common in the upper caves." }),
  def("ore_iron", "Iron Ore", "ore", ORE_VALUES.ore_iron, { desc: "Dug from the deeper caves." }),
  def("ore_silver", "Silver Ore", "ore", ORE_VALUES.ore_silver, { desc: "A bright vein from the lower cave floors." }),
  def("ore_gold", "Gold Ore", "ore", ORE_VALUES.ore_gold, { desc: "Rare and heavy. Gold rocks need an iron pickaxe." }),
  def("gem_crystal", "Gem Crystal", "gem", ORE_VALUES.gem_crystal, { desc: "Glows faintly. The shrine lantern might want one." }),
  def("gem_diamond", "Diamond", "gem", ORE_VALUES.gem_diamond, { desc: "Flawless and very rare. Found deep in the caves." }),

  // Materials
  def("wood", "Wood", "material", 3, { buy: 5 }),
  def("slime_gel", "Slime Gel", "material", 8),
  def("bat_wing", "Bat Wing", "material", 12),
  def("crab_shell", "Crab Shell", "material", 20),

  // Forage & fish
  def("herb_mint", "Mint", "forage", 15),
  def("mushroom", "Mushroom", "forage", 20),
  def("fish_trout", "Trout", "fish", 30),

  // Animals (shared/animals.ts, shared/ranch.ts). "barn" and "chicken" are what the town hall
  // sells: they never go in the bag (the barn is built in the yard, hens live in it).
  def("egg", "Egg", "produce", 35, { eat: 12, desc: "Fresh from your hens. Sells well, and cats and dogs like them too." }),
  def("pet_treat", "Pet Treat", "material", 5, { desc: "A crunchy treat. Dogs love them; cats are polite about it." }),
  def("chicken", "Hen", "material", 0, { desc: "A laying hen. Needs a barn at home; lays an egg every morning." }),
  furniture("barn", "Barn", 4, 2, "outdoor", 0, { buy: undefined, sell: 0, stack: 1, desc: "A red barn for your hens. Built in your yard by the town hall." }),

  // Furniture (footprint at rotation 0)
  furniture("chair_wood", "Wooden Chair", 1, 1, "floor", 40, { rotations: ALL_TURNS }),
  furniture("table_wood", "Wooden Table", 2, 1, "floor", 80, { rotations: [0, 1] }),
  furniture("bed_simple", "Simple Bed", 1, 2, "floor", 150, { rotations: ALL_TURNS, bed: true }),
  // 5x2 like its art (a 2x2 footprint drew the rug 1.5 tiles past each side, even over walls).
  furniture("rug", "Rug", 5, 2, "floor", 60, { walkable: true }),
  furniture("lamp", "Lamp", 1, 1, "floor", 50),
  furniture("flower_pot", "Flower Pot", 1, 1, "floor", 30),
  furniture("fence", "Fence", 1, 1, "outdoor", 10),
  // A gap you can walk through: fences join it on either side (drawn across the run it sits in).
  furniture("gate", "Garden Gate", 1, 1, "outdoor", 25, { walkable: true, rotations: [0, 1], desc: "Swings open as you walk through. Fences join up with it." }),
  furniture("scarecrow", "Scarecrow", 1, 1, "outdoor", 75),

  // Interior kit furniture: never sold in shops. Villagers give it as friendship gifts and
  // cave chests hold it now and then. Footprints match the village interiors' props.
  ...GIFT_FURNITURE,

  // The furniture stall's stock and the rare pieces (shared/furnitureItems.ts).
  ...HOME_GOODS,

  // Prepared food and drink: the inn and the bakery stall (shared/foods.ts).
  ...FOODS.map((f) => def(f.id, f.name, "food", Math.max(1, Math.round(f.price * FOOD_SELL_SHARE)), { buy: f.price, eat: f.energy, food: f.type, desc: f.desc })),
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

/** Rotations an item may be placed at (furniture without a list only goes at rotation 0). */
export function allowedRotations(id: ItemId): readonly Rotation[] {
  return getItem(id)?.rotations ?? [0];
}

/**
 * Nearest allowed rotation for a stored or requested one: itself if allowed, else the one with
 * the same footprint (r +- 2), else the first allowed. Old saves may hold any of 0..3.
 */
export function normalizeRotation(id: ItemId, r: Rotation): Rotation {
  const ok = allowedRotations(id);
  if (ok.includes(r)) return r;
  const same = ((r + 2) % 4) as Rotation;
  if (ok.includes(same)) return same;
  return ok.find((x) => x % 2 === r % 2) ?? ok[0] ?? 0;
}

/** Next allowed rotation after `r` going one way round (dir 1) or the other (-1). */
export function stepRotation(id: ItemId, r: Rotation, dir: 1 | -1 = 1): Rotation {
  const ok = allowedRotations(id);
  if (ok.length <= 1) return ok[0] ?? 0;
  const i = ok.indexOf(normalizeRotation(id, r));
  return ok[(i + dir + ok.length) % ok.length]!;
}

/** Furniture that opens the character designer (every house has one; see worker/home/wardrobe.ts). */
export const WARDROBE_ITEM: ItemId = "wardrobe";
/** Placed-object id of the house's own wardrobe: it can be moved but never picked up. */
export const WARDROBE_ID = "wardrobe";

export function isWardrobeItem(id: ItemId): boolean {
  return id === WARDROBE_ITEM;
}

/** True for furniture you can sleep in. */
export function isBedItem(id: ItemId): boolean {
  return getItem(id)?.bed === true;
}

/** Normal-quality id of an item (quality crops map to their base crop; others to themselves). */
export function baseItem(id: ItemId): ItemId {
  return getItem(id)?.base ?? id;
}

/** Item id for a crop at a quality (0 normal, 1 silver, 2 gold); unknown combos fall back to the crop. */
export function qualityItem(cropId: ItemId, quality: 0 | 1 | 2): ItemId {
  const id = `${cropId}${QUALITY_SUFFIX[quality] ?? ""}`;
  return getItem(id) ? id : cropId;
}

/** New player's inventory: hoe, watering can, pickaxe, axe, wooden sword, 10 turnip seeds, a chair, 50 coins. */
export function starterInventory(): Inventory {
  return {
    coins: 50,
    slots: [
      { item: "hoe", qty: 1 },
      { item: "watering_can", qty: 1 },
      { item: "pickaxe", qty: 1 },
      { item: "axe", qty: 1 },
      { item: "sword_wood", qty: 1 },
      { item: "seed_turnip", qty: 10 },
      { item: "chair_wood", qty: 1 },
      ...Array.from({ length: MAX_SLOTS - 7 }, () => null),
    ],
  };
}
