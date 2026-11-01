// Shop transactions. All-or-nothing on the inventory; synchronous so no await splits a read/write.
import type { ShopOffer } from "../../shared/protocol";
import type { Inventory, ItemId } from "../../shared/types";
import { baseItem, getItem } from "../../shared/items";
import { addItem, canAdd, removeFromSlot } from "../../shared/engine";

export interface Shop {
  sells: ShopOffer[];
  buys: ItemId[];
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

/** Sells to an NPC (only items in shop.buys) at ItemDef.sell. */
export function sellTo(inv: Inventory, shop: Shop | null, slot: number, qty: number): TradeResult {
  const s = Number.isInteger(slot) ? inv.slots[slot] : undefined;
  if (!s) return { ok: false, reason: "Nothing in that slot." };
  const def = getItem(s.item);
  if (!def || def.sell <= 0) return { ok: false, reason: "That can't be sold." };
  // Quality crops sell wherever the normal crop does (at their own, higher price).
  if (shop && !shop.buys.includes(baseItem(s.item))) return { ok: false, reason: "They don't buy that." };
  if (s.qty < qty) return { ok: false, reason: "You don't have that many." };
  if (!removeFromSlot(inv, slot, qty)) return { ok: false, reason: "Invalid amount." };
  const gain = def.sell * qty;
  inv.coins += gain;
  return { ok: true, text: `Sold ${qty} ${def.name} for ${gain} coins` };
}
