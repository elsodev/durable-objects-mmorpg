// Inventory operations on the fixed slot grid. All are all-or-nothing: on failure the inventory
// is left untouched. The pseudo item id "coins" maps to `inv.coins` so rewards/costs can be
// expressed uniformly. Slots never shift: emptied slots become null, new stacks fill the first
// null slot, so the hotbar keeps its order.
import type { Inventory, InventorySlot, ItemId } from "../types";
import { getItem, MAX_SLOTS } from "../items";

export const COINS: ItemId = "coins";

function validQty(qty: number): boolean {
  return Number.isInteger(qty) && qty > 0;
}

function validSlot(slot: number): boolean {
  // slot comes from client JSON: a non-integer like "constructor" or "length" would index Array members.
  return Number.isInteger(slot) && slot >= 0 && slot < MAX_SLOTS;
}

const q = (s: { quality?: number }): number => s.quality ?? 0;

/** Same item and quality: the stacks may merge. */
export function sameStack(a: InventorySlot, b: { item: ItemId; quality?: number }): boolean {
  return a.item === b.item && q(a) === q(b);
}

function copySlot(s: InventorySlot | null | undefined): InventorySlot | null {
  return s && s.qty > 0 ? { ...s } : null;
}

/** A full-length grid copy (missing indices become null). */
export function gridOf(slots: readonly (InventorySlot | null | undefined)[]): (InventorySlot | null)[] {
  const out: (InventorySlot | null)[] = [];
  for (let i = 0; i < MAX_SLOTS; i++) out.push(copySlot(slots[i]));
  return out;
}

/** Writes a planned grid back, keeping the array no longer than it needs to be for short (packed) inputs. */
function commit(inv: Inventory, grid: (InventorySlot | null)[]): void {
  if (inv.slots.length >= MAX_SLOTS) {
    inv.slots = grid;
    return;
  }
  let last = grid.length - 1;
  while (last >= inv.slots.length && grid[last] === null) last--;
  inv.slots = grid.slice(0, last + 1);
}

/** Adds items: tops up matching stacks first, then fills the first empty slots. */
export function addItem(inv: Inventory, item: ItemId, qty: number, quality?: number): boolean {
  if (!validQty(qty)) return false;
  if (item === COINS) {
    inv.coins += qty;
    return true;
  }
  const def = getItem(item);
  if (!def) return false;
  const stack = Math.max(1, def.stack);
  const want = { item, ...(quality ? { quality } : {}) };

  // Plan on a copy so a partial fit never mutates the real inventory.
  const grid = gridOf(inv.slots);
  let left = qty;
  for (const s of grid) {
    if (left === 0) break;
    if (!s || !sameStack(s, want) || s.qty >= stack) continue;
    const take = Math.min(stack - s.qty, left);
    s.qty += take;
    left -= take;
  }
  for (let i = 0; i < grid.length && left > 0; i++) {
    if (grid[i]) continue;
    const take = Math.min(stack, left);
    grid[i] = { ...want, qty: take };
    left -= take;
  }
  if (left > 0) return false;
  commit(inv, grid);
  return true;
}

/** True if `qty` of `item` would fit (does not modify `inv`). */
export function canAdd(inv: Inventory, item: ItemId, qty: number, quality?: number): boolean {
  return addItem({ coins: inv.coins, slots: gridOf(inv.slots) }, item, qty, quality);
}

/** Removes qty from a slot. Returns false (unchanged) if not enough. An emptied slot becomes null. */
export function removeFromSlot(inv: Inventory, slot: number, qty: number): boolean {
  if (!validSlot(slot) || slot >= inv.slots.length) return false;
  if (!validQty(qty)) return false;
  const s = inv.slots[slot];
  if (!s || s.qty < qty) return false;
  s.qty -= qty;
  if (s.qty === 0) inv.slots[slot] = null;
  return true;
}

export function countItem(inv: Inventory, item: ItemId): number {
  if (item === COINS) return inv.coins;
  let n = 0;
  for (const s of inv.slots) if (s && s.item === item) n += s.qty;
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
    if (!s || s.item !== item) continue;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    if (s.qty === 0) inv.slots[i] = null;
  }
  return true;
}

export type MoveResult = "swap" | "merge" | "move" | "split";

/**
 * Moves a stack from one slot to another. Onto an empty slot it moves (or splits off `qty`);
 * onto the same item and quality it merges up to the stack limit (the rest stays behind);
 * onto anything else it swaps (a partial `qty` can't swap, so that is refused).
 * Returns what happened, or null (inventory unchanged) if the move is invalid.
 */
export function moveSlot(inv: Inventory, from: number, to: number, qty?: number): MoveResult | null {
  if (!validSlot(from) || !validSlot(to) || from === to) return null;
  const grid = gridOf(inv.slots);
  const a = grid[from];
  if (!a) return null;
  const n = qty === undefined ? a.qty : qty;
  if (!validQty(n) || n > a.qty) return null;
  const b = grid[to];
  let result: MoveResult;
  if (!b) {
    result = n === a.qty ? "move" : "split";
    grid[to] = { ...a, qty: n };
    a.qty -= n;
  } else if (sameStack(b, a)) {
    const stack = Math.max(1, getItem(a.item)?.stack ?? 1);
    const take = Math.min(stack - b.qty, n);
    if (take <= 0) {
      // Both stacks full: a plain swap keeps the gesture meaningful.
      if (n !== a.qty) return null;
      grid[to] = a;
      grid[from] = b;
      commit(inv, grid);
      return "swap";
    }
    b.qty += take;
    a.qty -= take;
    result = "merge";
  } else {
    if (n !== a.qty) return null;
    grid[to] = a;
    grid[from] = b;
    commit(inv, grid);
    return "swap";
  }
  if (a.qty === 0) grid[from] = null;
  commit(inv, grid);
  return result;
}
