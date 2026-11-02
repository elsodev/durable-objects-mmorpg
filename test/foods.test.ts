// The food catalog (shared/foods.ts): every food has an icon, a price and energy in its type's
// range; the inn and the bakery stall sell it at the item table's prices; crops stay edible.
import { describe, expect, it } from "vitest";
import { BAKERY_MENU, FOOD_ENERGY, FOOD_SELL_SHARE, FOODS, foodSpec, INN_MENU, type FoodType } from "../src/shared/foods";
import { getItem, isShippable } from "../src/shared/items";
import { buyFrom, COUNTER_KEEPERS, STALL_SHOPS, stallShop } from "../src/worker/game/shop";
import { NPCS } from "../src/worker/npc/catalog";
import { buildVillage } from "../src/shared/maps/village";
import { buildInn } from "../src/shared/maps/interiors/inn";
import { SORT_ORDER } from "../src/shared/engine/sortBag";
import type { Inventory } from "../src/shared/types";
import catalogJson from "../src/client/public/assets/lpc/catalog.json";

const ASSETS = "src/client/public/assets/lpc/";
const catalog = catalogJson as unknown as { icons: Record<string, { file: string; rect: number[] }> };

interface NodeFs {
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, enc: "utf8"): string;
}
const nodeFs = () => import(/* @vite-ignore */ ["node", "fs"].join(":")) as Promise<NodeFs>;

/** Width and height from a PNG's IHDR. */
async function pngSize(path: string): Promise<{ w: number; h: number }> {
  const b = (await nodeFs()).readFileSync(path);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

const byType = (t: FoodType) => FOODS.filter((f) => f.type === t);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("food catalog", () => {
  it("has 15-25 foods with unique ids, names and descriptions", () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(15);
    expect(FOODS.length).toBeLessThanOrEqual(25);
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
    expect(new Set(FOODS.map((f) => f.name)).size).toBe(FOODS.length);
    for (const f of FOODS) {
      expect(f.desc.length, f.id).toBeGreaterThan(5);
      expect(f.desc.length, f.id).toBeLessThanOrEqual(80);
    }
    for (const t of ["snack", "meal", "drink"] as const) expect(byType(t).length, t).toBeGreaterThanOrEqual(4);
  });

  it("every food is an edible item with a price, a lower sell value and its type", () => {
    for (const f of FOODS) {
      const def = getItem(f.id)!;
      expect(def, f.id).toBeDefined();
      expect(def.kind).toBe("food");
      expect(def.food).toBe(f.type);
      expect(def.eat).toBe(f.energy);
      expect(def.buy).toBe(f.price);
      expect(def.sell).toBe(Math.round(f.price * FOOD_SELL_SHARE));
      expect(def.sell).toBeLessThan(def.buy!);
      expect(def.stack).toBe(99);
      expect(isShippable(f.id)).toBe(true);
      expect(foodSpec(f.id)).toBe(f);
    }
    expect(foodSpec("turnip")).toBeUndefined();
    expect(foodSpec("__proto__")).toBeUndefined();
  });

  it("energy is scaled by type: drinks light, snacks small, meals big", () => {
    for (const f of FOODS) {
      const r = FOOD_ENERGY[f.type];
      expect(f.energy, f.id).toBeGreaterThanOrEqual(r.min);
      expect(f.energy, f.id).toBeLessThanOrEqual(r.max);
      expect(f.price, f.id).toBeGreaterThan(0);
    }
    const drinks = byType("drink").map((f) => f.energy);
    const snacks = byType("snack").map((f) => f.energy);
    const meals = byType("meal").map((f) => f.energy);
    expect(Math.max(...snacks)).toBeLessThan(Math.min(...meals));
    expect(mean(drinks)).toBeLessThan(mean(snacks));
    expect(mean(snacks)).toBeLessThan(mean(meals));
  });

  it("every food has its own 32 px icon inside the food sheet", async () => {
    const size = await pngSize(`${ASSETS}icons/food_icons.png`);
    const rects = new Set<string>();
    for (const f of FOODS) {
      const icon = catalog.icons[f.id];
      expect(icon, f.id).toBeDefined();
      expect(icon!.file).toBe("icons/food_icons.png");
      const [x, y, w, h] = icon!.rect as [number, number, number, number];
      expect([w, h]).toEqual([32, 32]);
      expect(x + w).toBeLessThanOrEqual(size.w);
      expect(y + h).toBeLessThanOrEqual(size.h);
      rects.add(`${x},${y}`);
    }
    expect(rects.size).toBe(FOODS.length);
    expect((await nodeFs()).readFileSync(`${ASSETS}CREDITS.md`, "utf8")).toContain("### icons/food_icons.png");
  });

  it("raw crops stay edible at their old values", () => {
    expect(getItem("turnip")!.eat).toBe(8);
    expect(getItem("pumpkin")!.eat).toBe(25);
    expect(getItem("egg")!.eat).toBe(12);
    expect(getItem("turnip")!.food).toBeUndefined();
  });

  it("food sorts after crops and produce in the bag", () => {
    expect(SORT_ORDER.indexOf("food")).toBe(SORT_ORDER.indexOf("produce") + 1);
  });
});

describe("where food is sold", () => {
  it("Rue serves the inn menu at item prices and buys nothing", () => {
    const shop = NPCS.rue!.shop!;
    expect(shop.sells.map((o) => o.item)).toEqual([...INN_MENU]);
    for (const o of shop.sells) expect(o.price).toBe(getItem(o.item)!.buy);
    expect(shop.buys).toEqual([]);
    // Hot meals and drinks: the stew is the house dish.
    expect(INN_MENU).toContain("inn_stew");
    expect(INN_MENU.filter((id) => foodSpec(id)?.type === "meal").length).toBeGreaterThanOrEqual(5);
    expect(INN_MENU.filter((id) => foodSpec(id)?.type === "drink").length).toBeGreaterThanOrEqual(3);
  });

  it("the inn's bar counter is Rue's, and she keeps the bar", () => {
    expect(COUNTER_KEEPERS.int_inn).toBe("rue");
    const inn = buildInn();
    expect(inn.props.some((p) => p.type === "bar_counter")).toBe(true);
    expect(inn.npcs.some((n) => n.npcId === "rue")).toBe(true);
  });

  it("the bakery stall is a labelled self-serve stall with a different menu", () => {
    const prop = buildVillage().props.find((p) => p.id === "stall_bakery");
    expect(prop?.type).toBe("market_stall");
    expect(prop?.label).toBe("Bakery");
    const s = stallShop("stall:stall_bakery")!;
    expect(s.name).toBe("Bakery Stall");
    expect(s.shop.sells.map((o) => o.item)).toEqual([...BAKERY_MENU]);
    expect(s.shop.buys).toEqual([]);
    for (const o of s.shop.sells) expect(o.price).toBe(getItem(o.item)!.buy);
    expect(new Set(BAKERY_MENU)).not.toEqual(new Set(INN_MENU));
    expect(STALL_SHOPS.stall_bakery!.shop).toBe(s.shop);
  });

  it("every food is sold somewhere, and the menus hold only food", () => {
    const sold = new Set([...INN_MENU, ...BAKERY_MENU]);
    for (const f of FOODS) expect(sold.has(f.id), f.id).toBe(true);
    for (const id of sold) expect(getItem(id)?.kind, id).toBe("food");
  });

  it("buying food goes through the server's all-or-nothing trade", () => {
    const shop = NPCS.rue!.shop!;
    const inv: Inventory = { coins: 200, slots: [null, null] };
    expect(buyFrom(inv, shop, "inn_stew", 1)).toEqual({ ok: true, text: "Bought 1 Mossy Mug Stew for 120 coins" });
    expect(inv.coins).toBe(80);
    expect(inv.slots[0]).toEqual({ item: "inn_stew", qty: 1 });
    expect(buyFrom(inv, shop, "roast_dinner", 1)).toEqual({ ok: false, reason: "Not enough coins." });
    expect(buyFrom(inv, shop, "oat_cookie", 1)).toEqual({ ok: false, reason: "They don't sell that." });
    expect(inv.coins).toBe(80);
  });
});
