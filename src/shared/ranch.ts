// Barn, hens and eggs. The barn is bought at the town hall and goes up at BARN_SPOT in the yard (its owner may move it later);
// hens are bought there too (only with a barn, up to BARN_CAPACITY). Pure rules: the zone buys,
// HomeRoom lays and collects, both on the same AnimalSave.
//
// Eggs come from the home clock, never a running timer: each morning (home day) a hen who has
// lived through a whole day lays one egg near the barn. A hen that arrives today starts laying
// tomorrow, and eggs left lying around stay until picked up (up to MAX_EGGS).
import { addItem, canAdd } from "./engine/inventory";
import type { ShopOffer } from "./protocol";
import type { Inventory, ItemId, Vec2 } from "./types";
import { CHICKEN_SPRITES, MAX_EGGS, type AnimalSave, type Chicken, type Egg } from "./animals";

export const BARN_PRICE = 1500;
export const CHICKEN_PRICE = 300;
export const PET_TREAT_PRICE = 15;
export const BARN_CAPACITY = 4;

/** The town hall's counter for permits and livestock (the mayor's desk), as a shop id. */
export const TOWNHALL_SHOP = "townhall";
export const TOWNHALL_DESK = "mayor_desk";
export const TOWNHALL_NAME = "Town Hall: Farm Permits & Livestock";

/**
 * Pseudo-items the town hall sells: they never go in the bag. "barn" is also the placed object's
 * item at home (furniture art and footprint), "chicken" only names the offer.
 */
export const BARN_ITEM = "barn";
export const CHICKEN_ITEM = "chicken";
export const EGG_ITEM = "egg";
/** The placed barn's object id in the yard. */
export const BARN_ID = "barn";

/** Where the barn stands in the yard (top-left of its 4x2 footprint): south of the road, by the pond. */
export const BARN_SPOT: Vec2 = { x: 6, y: 16 };
export const BARN_SIZE = { w: 4, h: 2 } as const;
/** Hens scratch about in front of the barn (top-left `barn`, wherever its owner moved it), and lay there. */
export function coopCentre(barn: Vec2): Vec2 {
  return { x: barn.x + 2, y: barn.y + 3 };
}
export const COOP_CENTRE: Vec2 = coopCentre(BARN_SPOT);
export const COOP_RADIUS = 3;

/** What the town hall counter offers you right now: the barn first, then hens; treats always. */
export function townhallOffers(save: AnimalSave): ShopOffer[] {
  const offers: ShopOffer[] = [];
  if (!save.barn) offers.push({ item: BARN_ITEM, price: BARN_PRICE });
  else if (save.chickens.length < BARN_CAPACITY) offers.push({ item: CHICKEN_ITEM, price: CHICKEN_PRICE });
  offers.push({ item: "pet_treat", price: PET_TREAT_PRICE });
  return offers;
}
/** The counter buys eggs (the shipping bin at home takes them too). */
export const TOWNHALL_BUYS: readonly ItemId[] = [EGG_ITEM];

export type RanchBuy = { ok: true; text: string } | { ok: false; reason: string };

/** Buys the barn (once). Takes the coins; HomeRoom builds it when you next go home. */
export function buyBarn(save: AnimalSave, inv: Inventory): RanchBuy {
  if (save.barn) return { ok: false, reason: "You already have a barn." };
  if (inv.coins < BARN_PRICE) return { ok: false, reason: "Not enough coins." };
  inv.coins -= BARN_PRICE;
  save.barn = true;
  return { ok: true, text: `Bought a barn for ${BARN_PRICE} coins. It's waiting for you at home!` };
}

/** Buys `qty` hens: needs a barn with room for all of them. */
export function buyChickens(save: AnimalSave, inv: Inventory, qty: number): RanchBuy {
  if (!save.barn) return { ok: false, reason: "Hens need a barn. Buy one here first." };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: "Invalid amount." };
  const room = BARN_CAPACITY - save.chickens.length;
  if (room <= 0) return { ok: false, reason: `Your barn is full (${BARN_CAPACITY} hens).` };
  if (qty > room) return { ok: false, reason: `Your barn has room for ${room} more.` };
  const cost = CHICKEN_PRICE * qty;
  if (inv.coins < cost) return { ok: false, reason: "Not enough coins." };
  inv.coins -= cost;
  for (let i = 0; i < qty; i++) {
    const n = ++save.seq;
    save.chickens.push({ id: `hen_${n}`, sprite: CHICKEN_SPRITES[n % CHICKEN_SPRITES.length]!, day: 0, laid: 0, petDay: 0 });
  }
  return { ok: true, text: qty === 1 ? `Bought a hen for ${cost} coins. She'll be at your barn.` : `Bought ${qty} hens for ${cost} coins. They'll be at your barn.` };
}

/** Small stable hash for picking a laying spot. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Settles hens and lays the eggs due on home day `day`. `spots` are free tile centres near the
 * barn (the caller checks they are walkable). Returns the new eggs. Idempotent per day.
 */
export function layEggs(save: AnimalSave, day: number, spots: readonly Vec2[]): Egg[] {
  const laid: Egg[] = [];
  for (const hen of save.chickens) {
    // A new hen settles in on the day the home first sees her and lays from the next morning.
    if (hen.day === 0) {
      hen.day = day;
      continue;
    }
    if (hen.day >= day || hen.laid >= day) continue;
    hen.laid = day;
    if (save.eggs.length >= MAX_EGGS) continue;
    const spot = freeSpot(save.eggs, spots, hash(`${hen.id}:${day}`));
    if (!spot) continue;
    const egg: Egg = { id: `egg_${++save.seq}`, x: spot.x, y: spot.y };
    save.eggs.push(egg);
    laid.push(egg);
  }
  return laid;
}

function freeSpot(eggs: readonly Egg[], spots: readonly Vec2[], seed: number): Vec2 | null {
  if (spots.length === 0) return null;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[(seed + i) % spots.length]!;
    if (!eggs.some((e) => Math.abs(e.x - s.x) < 0.5 && Math.abs(e.y - s.y) < 0.5)) return s;
  }
  return null;
}

/** Picks up one egg into the bag. False (egg left lying) when it's gone or the bag is full. */
export function collectEgg(save: AnimalSave, inv: Inventory, id: string): "ok" | "gone" | "full" {
  const i = save.eggs.findIndex((e) => e.id === id);
  if (i < 0) return "gone";
  if (!canAdd(inv, EGG_ITEM, 1)) return "full";
  addItem(inv, EGG_ITEM, 1);
  save.eggs.splice(i, 1);
  return "ok";
}

/** Hen ids are `hen_<n>`; the entity is "a:hen_<n>". */
export function chickenById(save: AnimalSave, id: string): Chicken | undefined {
  return save.chickens.find((c) => c.id === id);
}
