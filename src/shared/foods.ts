// Prepared food and drink sold at the inn and the bakery stall. Pure data: items.ts turns each
// entry into an ItemDef (kind "food"), so this module must not import items.ts.
import type { ItemId } from "./types";

/** Snacks are small, meals are big, drinks are light. All share the same eat animation. */
export type FoodType = "snack" | "meal" | "drink";

export interface FoodSpec {
  id: ItemId;
  name: string;
  type: FoodType;
  /** Energy (stamina) restored by eating one, capped at the max. */
  energy: number;
  /** Shop price in coins; it sells back for FOOD_SELL_SHARE of that. */
  price: number;
  desc: string;
}

/** Energy each type of food restores, inclusive. Tests hold the catalog to these. */
export const FOOD_ENERGY: Readonly<Record<FoodType, { min: number; max: number }>> = {
  drink: { min: 6, max: 15 },
  snack: { min: 10, max: 25 },
  meal: { min: 40, max: 70 },
};

/** Sold back to a shop or the bin for well under the price, so buying to resell never pays. */
export const FOOD_SELL_SHARE = 0.4;

export const FOODS: readonly FoodSpec[] = [
  // Snacks
  { id: "bread_roll", name: "Bread Roll", type: "snack", energy: 15, price: 30, desc: "Still warm from the bakery oven." },
  { id: "oat_cookie", name: "Oat Cookie", type: "snack", energy: 10, price: 20, desc: "Chewy, with a few chocolate chips." },
  { id: "apple_pie", name: "Apple Pie Slice", type: "snack", energy: 22, price: 50, desc: "Lattice crust, cinnamon apples." },
  { id: "berry_muffin", name: "Berry Muffin", type: "snack", energy: 18, price: 40, desc: "Bursting with blueberries." },
  { id: "cheese_wedge", name: "Cheese Wedge", type: "snack", energy: 16, price: 35, desc: "Sharp, holey and good with bread." },
  // Meals
  { id: "inn_stew", name: "Mossy Mug Stew", type: "meal", energy: 50, price: 120, desc: "Rue's recipe, older than the bridge and twice as sturdy." },
  { id: "roast_dinner", name: "Roast Dinner", type: "meal", energy: 70, price: 190, desc: "Roast, potatoes, greens and gravy. A whole day's work in one plate." },
  { id: "fish_pie", name: "Fish Pie", type: "meal", energy: 60, price: 160, desc: "River trout under a golden crust." },
  { id: "shepherds_pie", name: "Shepherd's Pie", type: "meal", energy: 65, price: 175, desc: "Mince and gravy under browned mash." },
  { id: "pancakes", name: "Pancake Stack", type: "meal", energy: 40, price: 90, desc: "Three high, with butter and syrup." },
  { id: "omelette", name: "Herb Omelette", type: "meal", energy: 42, price: 95, desc: "Fluffy eggs folded over fresh herbs." },
  { id: "veggie_curry", name: "Veggie Curry", type: "meal", energy: 62, price: 165, desc: "Warming spice, garden vegetables and rice." },
  { id: "pumpkin_soup", name: "Pumpkin Soup", type: "meal", energy: 45, price: 110, desc: "Velvety, with a swirl of cream." },
  { id: "mushroom_risotto", name: "Mushroom Risotto", type: "meal", energy: 55, price: 145, desc: "Creamy rice and cave-cellar mushrooms." },
  // Drinks
  { id: "mint_tea", name: "Mint Tea", type: "drink", energy: 8, price: 15, desc: "Fresh mint, steeped strong." },
  { id: "coffee", name: "Coffee", type: "drink", energy: 12, price: 25, desc: "Dark and strong. Wakes up tired arms." },
  { id: "hot_cocoa", name: "Hot Cocoa", type: "drink", energy: 14, price: 30, desc: "Topped with cream." },
  { id: "apple_juice", name: "Apple Juice", type: "drink", energy: 10, price: 20, desc: "Pressed this morning." },
  { id: "milk", name: "Glass of Milk", type: "drink", energy: 10, price: 20, desc: "Cold and creamy." },
  { id: "cider", name: "Sweet Cider", type: "drink", energy: 12, price: 25, desc: "The inn's own, served in a wooden tankard." },
];

const BY_ID: ReadonlyMap<ItemId, FoodSpec> = new Map(FOODS.map((f) => [f.id, f]));

/** The food entry for an item id, or undefined for anything that isn't prepared food. */
export function foodSpec(id: ItemId): FoodSpec | undefined {
  return typeof id === "string" ? BY_ID.get(id) : undefined;
}

/** What the Mossy Mug Inn serves over the bar (Rue): hot meals and drinks. */
export const INN_MENU: readonly ItemId[] = [
  "inn_stew",
  "roast_dinner",
  "fish_pie",
  "shepherds_pie",
  "veggie_curry",
  "pumpkin_soup",
  "mushroom_risotto",
  "bread_roll",
  "cheese_wedge",
  "cider",
  "mint_tea",
  "coffee",
  "milk",
];

/** The bakery stall on the square (Wren's by day, self-serve after hours): breakfasts, bakes and drinks. */
export const BAKERY_MENU: readonly ItemId[] = [
  "bread_roll",
  "oat_cookie",
  "berry_muffin",
  "apple_pie",
  "pancakes",
  "omelette",
  "coffee",
  "hot_cocoa",
  "apple_juice",
  "milk",
];
