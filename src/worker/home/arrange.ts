// Server rules for the house edit mode's group messages (moveObjects, pickupObjects): which
// pieces must stay, and taking several pieces back into the bag all or nothing. HomeRoom calls
// these; the geometry is checkArrange in shared/engine/arrange.ts.
import type { Inventory, ItemId, PlacedObject } from "../../shared/types";
import { addItem } from "../../shared/engine";
import { getItem, WARDROBE_ID } from "../../shared/items";
import { BARN_ID } from "../../shared/ranch";
import { BED_ID } from "./migrate";
import { containerEmpty, type Containers } from "./containers";
import { cloneInventory } from "../game/sanitize";

export { WARDROBE_ID };

/** Why `obj` may not move at all (null: it may). */
export function moveRefusal(obj: PlacedObject): string | null {
  return obj.id === BARN_ID ? "The barn stays where it was built." : null;
}

/** Why `obj` may not go back into the bag (null: it may). */
export function pickupRefusal(obj: PlacedObject, containers: Containers): string | null {
  if (obj.id === BED_ID) return "Your bed stays. You can move it instead.";
  if (obj.id === WARDROBE_ID) return "Your wardrobe stays. You can move it instead.";
  if (obj.id === BARN_ID) return "The barn stays where it was built.";
  if (!containerEmpty(containers, obj.id)) return `Empty the ${getItem(obj.item)?.name.toLowerCase() ?? "storage"} first.`;
  return null;
}

/**
 * The bag with every item added, or null if any one doesn't fit (the bag passed in is untouched,
 * so a refused pickup changes nothing).
 */
export function addAllOrNothing(inv: Inventory, items: readonly ItemId[]): Inventory | null {
  const next = cloneInventory(inv);
  for (const item of items) if (!addItem(next, item, 1)) return null;
  return next;
}
