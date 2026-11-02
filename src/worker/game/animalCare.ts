// Petting, feeding and adopting, applied to one player's AnimalSave and inventory. Shared by the
// village (ZoneRoom) and the yard (HomeRoom). Synchronous: the item is taken in the same step the
// affection is given, with no await in between.
import {
  adopt,
  adoptRefusal,
  animalView,
  bondWith,
  feedBond,
  feedPtsOf,
  petBond,
  petPtsOf,
  type AnimalSave,
  type AnimalView,
  type Chicken,
  type VillageAnimal,
} from "../../shared/animals";
import { worldDay } from "../../shared/calendar";
import { removeFromSlot } from "../../shared/engine";
import { getItem } from "../../shared/items";
import { boltLine, rollsAway, rollsSnatch } from "../../shared/mischief";
import type { Inventory } from "../../shared/types";

/** `ran`: the animal bolts (a getaway) instead of the love pose. */
export type CareOutcome = { ok: true; view: AnimalView; delta: number; text: string; ran?: boolean } | { ok: false; reason: string };

/**
 * A pet: loved, with affection only from the day's first. A mischievous animal may bolt instead:
 * no affection and today's pet isn't used up, so you can chase it and try again.
 */
export function petAnimal(save: AnimalSave, def: VillageAnimal, entity: string, now: number, yours = false, rand: () => number = Math.random): CareOutcome {
  if (rollsAway(def, yours, rand)) {
    return { ok: true, view: animalView(save, def, entity, now, yours), delta: 0, text: boltLine(def.name, rand()), ran: true };
  }
  const r = petBond(bondWith(save, def.id), now, petPtsOf(def));
  const text = r.counted ? `${def.name} loves the attention!` : `${def.name} leans into your hand.`;
  return { ok: true, view: animalView(save, def, entity, now, yours), delta: r.delta, text };
}

/** Feeds one of the item in `slot`; refused (nothing used) when it isn't food this animal eats. */
export function feedAnimal(
  save: AnimalSave,
  inv: Inventory,
  slot: number,
  def: VillageAnimal,
  entity: string,
  now: number,
  yours = false,
  rand: () => number = Math.random,
): CareOutcome {
  const s = inv.slots[slot];
  const item = s ? getItem(s.item) : undefined;
  if (!s || !item) return { ok: false, reason: "Pick some food in your bag first." };
  const b = bondWith(save, def.id);
  const before = { ...b };
  const r = feedBond(b, def.species, item.id, now, feedPtsOf(def));
  if (!r) return { ok: false, reason: `${def.name} sniffs the ${item.name} and turns away.` };
  if (!removeFromSlot(inv, slot, 1)) {
    Object.assign(b, before);
    return { ok: false, reason: "Nothing in that slot." };
  }
  const how = r.taste === "loved" ? "gobbles up" : r.taste === "liked" ? "happily eats" : "nibbles";
  const full = r.counted ? "" : " (Already had a proper meal today.)";
  // A snatch still counts as the meal: the food is eaten, just somewhere else.
  if (rollsSnatch(def, yours, rand)) {
    const text = `${def.name} snatches the ${item.name} and runs off with it!${full}`;
    return { ok: true, view: animalView(save, def, entity, now, yours), delta: r.delta, text, ran: true };
  }
  return { ok: true, view: animalView(save, def, entity, now, yours), delta: r.delta, text: `${def.name} ${how} the ${item.name}!${full}` };
}

/** Adopts a village cat or dog: your own copy will live in your yard. */
export function adoptAnimal(save: AnimalSave, def: VillageAnimal, entity: string, now: number): CareOutcome {
  const why = adoptRefusal(save, def.id);
  if (why === "already") return { ok: false, reason: `${def.name} already lives with you.` };
  if (why === "notYet") return { ok: false, reason: `${def.name} doesn't know you well enough yet.` };
  if (why === "full") return { ok: false, reason: "Your home has all the pets it can look after." };
  if (why || !adopt(save, def.id)) return { ok: false, reason: "You can't adopt that." };
  return {
    ok: true,
    view: animalView(save, def, entity, now),
    delta: 0,
    text: `You adopted ${def.name}! Your new friend will be waiting in your yard at home.`,
  };
}

/** A hen's card: no affection to grow, just whether she was petted today. */
export function henView(hen: Chicken, entity: string, now: number): AnimalView {
  const today = hen.petDay === worldDay(now);
  return { entity, name: "Hen", species: "chicken", hearts: 0, maxHearts: 0, pts: 0, pettedToday: today, fedToday: false, yours: true };
}

export function petHen(hen: Chicken, entity: string, now: number): CareOutcome {
  hen.petDay = worldDay(now);
  return { ok: true, view: henView(hen, entity, now), delta: 0, text: "The hen clucks happily." };
}
