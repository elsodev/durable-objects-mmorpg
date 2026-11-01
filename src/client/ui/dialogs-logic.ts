// Pure shop/goal math for ui/dialogs.ts, kept DOM-free so tests can run it under the Workers tsconfig.
import type { Inventory, ItemId } from "../../shared/types";
import { baseItem, getItem, shopSellPrice } from "../../shared/items";

/** Largest quantity the steppers offer: one full stack. */
export const MAX_STEP_QTY = 99;

export function clampQty(n: number, max: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(Math.floor(n), Math.max(1, max)));
}

/** How many of an item at `price` the player can pay for, capped at one stack. */
export function maxAffordable(price: number, coins: number, cap = MAX_STEP_QTY): number {
  if (price <= 0) return cap;
  return Math.max(0, Math.min(cap, Math.floor(coins / price)));
}

export interface SellRow {
  slot: number;
  item: ItemId;
  qty: number;
  price: number;
}

/** Inventory slots this NPC buys and that are worth something, in slot order. */
export function sellRows(inv: Inventory, buys: readonly ItemId[]): SellRow[] {
  const wanted = new Set(buys);
  const rows: SellRow[] = [];
  inv.slots.forEach((s, slot) => {
    if (!s || s.qty <= 0 || !wanted.has(baseItem(s.item))) return;
    const price = shopSellPrice(s.item);
    if (price > 0) rows.push({ slot, item: s.item, qty: s.qty, price });
  });
  return rows;
}

/** The donation one click makes: from the fullest slot holding the item, up to what's still needed. */
export function donatePlan(
  need: { item: ItemId; qty: number; have: number },
  inv: Inventory,
): { slot: number; qty: number } | null {
  const remaining = need.qty - need.have;
  if (remaining <= 0) return null;
  let best = -1;
  inv.slots.forEach((s, i) => {
    if (s && s.item === need.item && s.qty > 0 && (best < 0 || s.qty > inv.slots[best]!.qty)) best = i;
  });
  if (best < 0) return null;
  return { slot: best, qty: Math.min(remaining, inv.slots[best]!.qty) };
}

export function progress(have: number, qty: number): number {
  if (qty <= 0) return 1;
  return Math.max(0, Math.min(1, have / qty));
}

export function itemName(id: ItemId): string {
  return getItem(id)?.name ?? id;
}
