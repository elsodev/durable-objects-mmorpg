// Eating one item from a bag slot: the same rules at home and in the shared zones. Pure and
// synchronous, so the caller reads and writes the inventory without an await in between.
import type { Inventory, ItemId } from "../types";
import { getItem } from "../items";
import { eatGain } from "./homeday";
import { removeFromSlot } from "./inventory";

/**
 * One bite at a time: a new eat is refused until the last one's animation is over (the client's
 * eat act lasts this long too), so food can't be spammed.
 */
export const EAT_COOLDOWN_MS = 1300;

export type EatResult =
  | { ok: true; item: ItemId; name: string; gain: number; stamina: number }
  | { ok: false; reason: string };

/**
 * Eats one of the item in `slot`: checks the slot, that it's edible, the cooldown since
 * `lastEatAt` and that stamina isn't already full, then takes one from the stack. Returns the new
 * stamina (capped at the max); `inv` is changed only on success.
 */
export function eatFrom(inv: Inventory, slot: number, stamina: number, now: number, lastEatAt: number): EatResult {
  if (now - lastEatAt < EAT_COOLDOWN_MS) return { ok: false, reason: "Still chewing." };
  const s = Number.isInteger(slot) && slot >= 0 && slot < inv.slots.length ? inv.slots[slot] : undefined;
  if (!s) return { ok: false, reason: "Nothing in that slot." };
  const def = getItem(s.item);
  if (!def?.eat) return { ok: false, reason: "You can't eat that." };
  const gain = eatGain(def.id, stamina);
  if (gain <= 0) return { ok: false, reason: "You're not hungry." };
  if (!removeFromSlot(inv, slot, 1)) return { ok: false, reason: "Nothing in that slot." };
  return { ok: true, item: def.id, name: def.name, gain, stamina: stamina + gain };
}

/** The notice after eating: "Ate Fish Pie (+60 energy)", "Drank Coffee (+12 energy)". */
export function eatNotice(r: Extract<EatResult, { ok: true }>): string {
  const verb = getItem(r.item)?.food === "drink" ? "Drank" : "Ate";
  return `${verb} ${r.name} (+${r.gain} energy)`;
}
