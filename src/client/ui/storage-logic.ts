// Pure helpers for the storage panel (fridge): which bag slots can go in, and the panel's texts.
import type { StorageAccepts } from "../../shared/furnitureItems";
import { getItem } from "../../shared/items";
import type { InventorySlot } from "../../shared/types";
import { storageAccepts } from "../../shared/engine/storage";

/** True when this bag stack may be put into storage that takes `accepts`. */
export function canStore(accepts: StorageAccepts, slot: InventorySlot | null | undefined): boolean {
  return !!slot && slot.qty > 0 && storageAccepts({ slots: 1, accepts }, slot.item);
}

/** How many to move on a click: the whole stack, or one with Shift held. */
export function moveQty(slot: InventorySlot, one: boolean): number {
  return one ? 1 : slot.qty;
}

/** "3 / 12 shelves used". */
export function usedLabel(slots: readonly (InventorySlot | null)[]): string {
  const used = slots.filter((s) => s && s.qty > 0).length;
  return `${used} / ${slots.length} shelves used`;
}

export function storageTitle(item: string): string {
  return getItem(item)?.name ?? "Storage";
}

export function storageHint(accepts: StorageAccepts): string {
  const what = accepts === "food" ? "food" : "an item";
  return `Click ${what} in your bag to put it in, or a shelf to take it out. Shift-click moves one.`;
}
