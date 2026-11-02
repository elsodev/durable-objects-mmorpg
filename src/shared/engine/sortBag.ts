// "Sort" in the bag: the slots after the hotbar are merged and ordered by item type, then name and
// quality. The hotbar (slots 0..HOTBAR_SIZE-1) keeps its order, so your tools stay on their keys.
import { HOTBAR_SIZE } from "../held";
import { getItem, MAX_SLOTS, type ItemKind } from "../items";
import type { Inventory, InventorySlot } from "../types";

/** Type order in a sorted bag: tools first, then things you plant, eat, sell and place. */
export const SORT_ORDER: readonly ItemKind[] = ["tool", "seed", "crop", "produce", "food", "forage", "fish", "ore", "gem", "material", "furniture"];

function rank(s: InventorySlot): number {
  const kind = getItem(s.item)?.kind;
  const i = kind ? SORT_ORDER.indexOf(kind) : -1;
  return i < 0 ? SORT_ORDER.length : i;
}

function nameOf(s: InventorySlot): string {
  const def = getItem(s.item);
  const base = def?.base ? getItem(def.base) : def;
  return (base?.name ?? s.item).toLowerCase();
}

/** Compare for the sorted bag: type, then name, then quality (normal first), then bigger stacks first. */
export function compareStacks(a: InventorySlot, b: InventorySlot): number {
  return rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)) || a.item.localeCompare(b.item) || (a.quality ?? 0) - (b.quality ?? 0) || b.qty - a.qty;
}

/**
 * Sorts the bag in place: everything after the hotbar is merged into full stacks and laid out in
 * SORT_ORDER from the first slot after the hotbar. Returns false (unchanged) when nothing moves.
 */
export function sortBag(inv: Inventory): boolean {
  const before = JSON.stringify(inv.slots.slice(HOTBAR_SIZE));
  const loose: InventorySlot[] = [];
  for (let i = HOTBAR_SIZE; i < MAX_SLOTS; i++) {
    const s = inv.slots[i];
    if (s && s.qty > 0) loose.push({ ...s });
  }
  // Merge equal stacks up to their limit.
  const merged: InventorySlot[] = [];
  for (const s of loose.sort(compareStacks)) {
    const limit = Math.max(1, getItem(s.item)?.stack ?? 1);
    let left = s.qty;
    for (const m of merged) {
      if (left === 0) break;
      if (m.item !== s.item || (m.quality ?? 0) !== (s.quality ?? 0) || m.qty >= limit) continue;
      const take = Math.min(limit - m.qty, left);
      m.qty += take;
      left -= take;
    }
    while (left > 0) {
      const take = Math.min(limit, left);
      merged.push({ item: s.item, qty: take, ...(s.quality ? { quality: s.quality } : {}) });
      left -= take;
    }
  }
  merged.sort(compareStacks);
  const slots = inv.slots.slice(0, HOTBAR_SIZE);
  while (slots.length < HOTBAR_SIZE) slots.push(null);
  for (let i = HOTBAR_SIZE; i < MAX_SLOTS; i++) slots.push(merged[i - HOTBAR_SIZE] ?? null);
  if (JSON.stringify(slots.slice(HOTBAR_SIZE)) === before) return false;
  inv.slots = slots;
  return true;
}
