// Shop transactions. All-or-nothing on the inventory; synchronous so no await splits a read/write.
import type { ShopOffer } from "../../shared/protocol";
import type { Inventory, ItemId } from "../../shared/types";
import { baseItem, getItem, shopSellPrice } from "../../shared/items";
import { addItem, canAdd, removeFromSlot } from "../../shared/engine";
import { seedSeasons, STORE_SEEDS } from "../../shared/seeds";
import { worldDate } from "../../shared/calendar";
import { FURNITURE_SHOP } from "../../shared/furnitureItems";
import { BAKERY_MENU } from "../../shared/foods";

export interface Shop {
  sells: ShopOffer[];
  buys: ItemId[];
}

/** Shop offers at the item table's `buy` price (items without one are left out). */
export function offersFor(ids: readonly ItemId[]): ShopOffer[] {
  return ids.flatMap((id) => {
    const price = getItem(id)?.buy;
    return price ? [{ item: id, price }] : [];
  });
}

/** Prefix of a stall shop's id in shop / buy / sell messages ("stall:<prop id>"). */
export const STALL_PREFIX = "stall:";

/**
 * Self-serve stalls on the village square: no keeper, an honour box for the coins. Keyed by the
 * stall prop's id; Fenwick's workshop stocks the furniture stall and the inn's kitchen bakes for
 * the bakery stall.
 */
export const STALL_SHOPS: Readonly<Record<string, { name: string; shop: Shop }>> = {
  stall_goods: { name: "Furniture Stall", shop: { sells: offersFor(FURNITURE_SHOP), buys: [] } },
  stall_bakery: { name: "Bakery Stall", shop: { sells: offersFor(BAKERY_MENU), buys: [] } },
};

/** Who serves across a room's bar counter (interact with the counter to open their shop). */
export const COUNTER_KEEPERS: Readonly<Partial<Record<string, string>>> = { int_inn: "rue" };

/** The stall shop behind a "stall:<id>" shop id, if any. */
export function stallShop(shopId: string): { propId: string; name: string; shop: Shop } | null {
  if (!shopId.startsWith(STALL_PREFIX)) return null;
  const propId = shopId.slice(STALL_PREFIX.length);
  const s = Object.hasOwn(STALL_SHOPS, propId) ? STALL_SHOPS[propId] : undefined;
  return s ? { propId, ...s } : null;
}

/** The shop as it stands today: store seeds out of season are off the shelf. */
export function shopToday(shop: Shop, now: number): Shop {
  const season = worldDate(now).season;
  const sells = shop.sells.filter((o) => !STORE_SEEDS.includes(o.item) || seedSeasons(o.item).includes(season));
  return sells.length === shop.sells.length ? shop : { ...shop, sells };
}

export type TradeResult = { ok: true; text: string } | { ok: false; reason: string };

export function buyFrom(inv: Inventory, shop: Shop, item: ItemId, qty: number): TradeResult {
  const offer = shop.sells.find((o) => o.item === item);
  const def = getItem(item);
  if (!offer || !def) return { ok: false, reason: "They don't sell that." };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: "Invalid amount." };
  const cost = offer.price * qty;
  if (inv.coins < cost) return { ok: false, reason: "Not enough coins." };
  if (!canAdd(inv, item, qty)) return { ok: false, reason: "Your bag is full." };
  inv.coins -= cost;
  addItem(inv, item, qty);
  return { ok: true, text: `Bought ${qty} ${def.name} for ${cost} coins` };
}

/** Sells to an NPC (only items in shop.buys) at shopSellPrice (ores and gems below their bin value). */
export function sellTo(inv: Inventory, shop: Shop | null, slot: number, qty: number): TradeResult {
  const s = Number.isInteger(slot) ? inv.slots[slot] : undefined;
  if (!s) return { ok: false, reason: "Nothing in that slot." };
  const def = getItem(s.item);
  const price = shopSellPrice(s.item);
  if (!def || price <= 0) return { ok: false, reason: "That can't be sold." };
  // Quality crops sell wherever the normal crop does (at their own, higher price).
  if (shop && !shop.buys.includes(baseItem(s.item))) return { ok: false, reason: "They don't buy that." };
  if (s.qty < qty) return { ok: false, reason: "You don't have that many." };
  if (!removeFromSlot(inv, slot, qty)) return { ok: false, reason: "Invalid amount." };
  const gain = price * qty;
  inv.coins += gain;
  return { ok: true, text: `Sold ${qty} ${def.name} for ${gain} coins` };
}
