// Inventory operations. All are all-or-nothing: on failure the inventory is left untouched.
// The pseudo item id "coins" maps to `inv.coins` so rewards/costs can be expressed uniformly.
import type { Inventory, InventorySlot, ItemId } from "../types";
import { getItem, MAX_SLOTS } from "../items";

export const COINS: ItemId = "coins";

function validQty(qty: number): boolean {
  return Number.isInteger(qty) && qty > 0;
}

/** Adds items, stacking first. Returns false (and leaves inv unchanged) if it doesn't fit. */
export function addItem(inv: Inventory, item: ItemId, qty: number): boolean {
  if (!validQty(qty)) return false;
  if (item === COINS) {
    inv.coins += qty;
    return true;
  }
  const def = getItem(item);
  if (!def) return false;
  const stack = Math.max(1, def.stack);

  // Plan on a copy so a partial fit never mutates the real inventory.
  const slots: InventorySlot[] = inv.slots.map((s) => ({ ...s }));
  let left = qty;
  for (const s of slots) {
    if (left === 0) break;
    if (s.item !== item || s.qty >= stack) continue;
    const take = Math.min(stack - s.qty, left);
    s.qty += take;
    left -= take;
  }
  while (left > 0) {
    if (slots.length >= MAX_SLOTS) return false;
    const take = Math.min(stack, left);
    slots.push({ item, qty: take });
    left -= take;
  }
  inv.slots = slots;
  return true;
}

/** True if `qty` of `item` would fit (does not modify `inv`). */
export function canAdd(inv: Inventory, item: ItemId, qty: number): boolean {
  return addItem({ coins: inv.coins, slots: inv.slots.map((s) => ({ ...s })) }, item, qty);
}

/** Removes qty from a slot. Returns false (unchanged) if not enough. Empty slots are removed. */
export function removeFromSlot(inv: Inventory, slot: number, qty: number): boolean {
  // slot comes from client JSON: a non-integer like "constructor" or "length" would index Array members.
  if (!Number.isInteger(slot) || slot < 0 || slot >= inv.slots.length) return false;
  if (!validQty(qty)) return false;
  const s = inv.slots[slot];
  if (!s || s.qty < qty) return false;
  s.qty -= qty;
  if (s.qty === 0) inv.slots.splice(slot, 1);
  return true;
}

export function countItem(inv: Inventory, item: ItemId): number {
  if (item === COINS) return inv.coins;
  let n = 0;
  for (const s of inv.slots) if (s.item === item) n += s.qty;
  return n;
}

/** Removes qty of an item across slots (last slots first, keeping the hotbar stable). Returns false (unchanged) if not enough. */
export function removeItem(inv: Inventory, item: ItemId, qty: number): boolean {
  if (!validQty(qty)) return false;
  if (countItem(inv, item) < qty) return false;
  if (item === COINS) {
    inv.coins -= qty;
    return true;
  }
  let left = qty;
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i];
    if (s.item !== item) continue;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    if (s.qty === 0) inv.slots.splice(i, 1);
  }
  return true;
}
