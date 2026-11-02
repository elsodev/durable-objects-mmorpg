// Server side of the held tool, shared by ZoneRoom and HomeRoom: the entity shows what is in the
// selected hotbar slot of the server's inventory. Re-run after every inventory change, so a tool
// moved, sold or given away leaves the hand on the next tick.
import { heldItemAt } from "../../shared/held";
import type { EntityState, Inventory } from "../../shared/types";

/** Sets or clears `entity.held` from hotbar `slot` of `inv`. True when it changed. */
export function applyHeld(entity: EntityState, inv: Inventory, slot: number | null): boolean {
  const item = heldItemAt(inv, slot);
  if (item === entity.held) return false;
  if (item === undefined) delete entity.held;
  else entity.held = item;
  return true;
}
