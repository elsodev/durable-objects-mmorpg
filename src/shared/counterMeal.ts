// A meal served across a bar counter: order while sitting on a stool at the counter and the food
// goes on a plate on the counter in front of you, where you eat it seated. Everyone in the room
// sees the plate (EntityState.meal) and the eating; when the meal is eaten the plate goes. Pure:
// the caller passes `now`.
import type { CounterMeal, EntityState, Facing, ItemId, MapProp, Seat, Vec2 } from "./types";
import { EAT_COOLDOWN_MS } from "./engine/eating";

export type { CounterMeal };

/** Prop types you can be served across. */
export const COUNTER_TYPES: ReadonlySet<string> = new Set(["bar_counter"]);

/** Bites in a counter meal; each takes one eat act's time (the client's hand-to-mouth cycle). */
export const MEAL_BITES = 3;
/** How long eating a counter meal lasts. */
export const MEAL_MS = MEAL_BITES * EAT_COOLDOWN_MS;
/** The empty plate stays this long after the last bite, then it's cleared away. */
export const PLATE_LINGER_MS = 1200;

const STEP: Readonly<Record<Facing, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** The counter the seat faces (the tile in front of it is inside the counter), or null. */
export function counterAhead(seat: Seat, props: readonly MapProp[]): MapProp | null {
  const [dx, dy] = STEP[seat.facing];
  const tx = seat.x + dx;
  const ty = seat.y + dy;
  return props.find((p) => COUNTER_TYPES.has(p.type) && tx >= p.x && tx < p.x + p.w && ty >= p.y && ty < p.y + p.h) ?? null;
}

/**
 * True when the entity is sitting on `seat` and that seat faces the counter `counterId`: only then
 * does the counter open the bar menu, and only then is an order served in front of them.
 */
export function seatedAtCounter(
  seat: Seat | undefined,
  e: Pick<EntityState, "act">,
  counterId: string,
  props: readonly MapProp[],
): boolean {
  return !!seat && e.act?.k === "sit" && counterAhead(seat, props)?.id === counterId;
}

/** Where the plate goes: the centre of the counter tile right in front of the seat. */
export function plateSpot(seat: Seat): Vec2 {
  const [dx, dy] = STEP[seat.facing];
  return { x: seat.x + dx + 0.5, y: seat.y + dy + 0.5 };
}

/** A plate of `item` set down in front of `seat`, or null when the seat isn't at a counter. */
export function serveMeal(seat: Seat, props: readonly MapProp[], item: ItemId, now: number): CounterMeal | null {
  if (!counterAhead(seat, props)) return null;
  const at = plateSpot(seat);
  return { item, at: now, x: at.x, y: at.y, seat: seat.id };
}

export interface MealStage {
  /** Still eating (the seated eat cycle plays). */
  eating: boolean;
  /** Bites taken so far (0..MEAL_BITES): the food on the plate shrinks with each. */
  bites: number;
  /** The plate is still on the counter (eating, or the empty plate lingering). */
  shown: boolean;
}

/** How far along a meal is `ageMs` after it was served. A bite lands at the end of each cycle. */
export function mealStage(ageMs: number): MealStage {
  if (!(ageMs >= 0)) return { eating: false, bites: 0, shown: false };
  const bites = Math.min(MEAL_BITES, Math.floor(ageMs / EAT_COOLDOWN_MS));
  return { eating: ageMs < MEAL_MS, bites, shown: ageMs < MEAL_MS + PLATE_LINGER_MS };
}

/** True once a meal served at `meal.at` is over and its plate cleared away. */
export function mealOver(meal: Pick<CounterMeal, "at">, now: number): boolean {
  return now - meal.at >= MEAL_MS + PLATE_LINGER_MS;
}

/** Why a seated entity can't be served now, or null when a plate may be set in front of them. */
export function serveRefusal(e: Pick<EntityState, "act" | "meal">, now: number): string | null {
  if (e.act?.k !== "sit") return "Sit at the counter first.";
  if (e.meal && !mealOver(e.meal, now)) return "Finish your plate first.";
  return null;
}

/**
 * Why an order from a stool can't be served and eaten now, or null when it can. Checked before
 * any coins change hands. `gain` is the energy the food would give (0: not hungry).
 */
export function counterOrderRefusal(
  e: Pick<EntityState, "act" | "meal">,
  now: number,
  lastEatAt: number,
  gain: number,
): string | null {
  const why = serveRefusal(e, now);
  if (why) return why;
  if (now - lastEatAt < EAT_COOLDOWN_MS) return "Still chewing.";
  if (gain <= 0) return "You're not hungry right now.";
  return null;
}
