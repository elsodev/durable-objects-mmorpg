// What a player visibly holds: the tool or weapon in their selected hotbar slot. The client
// says which slot is selected (`hold`); the server reads the item from its own copy of the
// inventory, so nobody can show off a tool they don't have.
import { getItem } from "./items";
import type { Inventory, ItemId } from "./types";

/** The hotbar is inventory slots 0..HOTBAR_SIZE-1; only those can be selected. */
export const HOTBAR_SIZE = 8;

/** Tools and weapons are drawn in the hand; seeds, crops and furniture are not. */
export function isHoldable(item: ItemId | null | undefined): boolean {
  if (!item) return false;
  return getItem(item)?.kind === "tool";
}

/** The item drawn in the hand for hotbar `slot` of `inv`, or undefined when there is none. */
export function heldItemAt(inv: Inventory, slot: number | null): ItemId | undefined {
  if (slot === null || !Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) return undefined;
  const item = inv.slots[slot]?.item;
  return item && isHoldable(item) ? item : undefined;
}
