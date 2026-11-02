// Timeline of a meal eaten at the bar counter (EntityState.meal, shared/counterMeal.ts), seen from
// any client. The sitter keeps the seated frame; each bite is a lean toward the plate while a
// morsel rises from it to the mouth, the bite itself, then a lean back and a chew. Pure, so the
// timing is tested; counter-meals.ts draws the plate and morsel and entities.ts leans the body.
import type { Facing } from "../../shared/types";
import { MEAL_BITES, MEAL_MS } from "../../shared/counterMeal";

/** One bite cycle: the server's whole meal is MEAL_BITES of these. */
export const BITE_CYCLE_MS = MEAL_MS / MEAL_BITES;
/** Within a cycle: leaning in and lifting the morsel, at the mouth, leaning back. */
const REACH_END = 0.35;
const MOUTH_END = 0.5;
const BACK_END = 0.78;
/** The bite lands while the morsel is at the mouth. */
const BITE_AT = 0.42;
/** Source px the body leans toward the counter at the deepest point. */
export const LEAN_PX = 3;

export interface MealMotion {
  /** Still eating (false once every bite is taken). */
  eating: boolean;
  /** 0..1: how far the sitter leans toward the plate. */
  lean: number;
  /** 0..1 from the plate to the mouth while a morsel is lifted, else null. */
  morsel: number | null;
  /** Bites taken so far (0..MEAL_BITES): the food on the plate loses one per bite. */
  bites: number;
}

const ease = (t: number): number => t * t * (3 - 2 * t);

/** Where the meal is `ageMs` after it was first seen. */
export function mealMotion(ageMs: number): MealMotion {
  if (!(ageMs >= 0)) return { eating: false, lean: 0, morsel: null, bites: 0 };
  const bites = mealBitesAt(ageMs);
  if (ageMs >= MEAL_MS) return { eating: false, lean: 0, morsel: null, bites };
  const u = (ageMs % BITE_CYCLE_MS) / BITE_CYCLE_MS;
  let lean = 0;
  let morsel: number | null = null;
  if (u < REACH_END) {
    lean = ease(u / REACH_END);
    morsel = ease(u / REACH_END);
  } else if (u < MOUTH_END) {
    lean = 1;
    morsel = u < BITE_AT ? 1 : null;
  } else if (u < BACK_END) {
    lean = 1 - ease((u - MOUTH_END) / (BACK_END - MOUTH_END));
  }
  return { eating: true, lean, morsel, bites };
}

/** Bites taken by `ageMs`: one per cycle, at its BITE_AT point. */
export function mealBitesAt(ageMs: number): number {
  if (!(ageMs >= 0)) return 0;
  let n = 0;
  for (let i = 0; i < MEAL_BITES; i++) if (ageMs >= (i + BITE_AT) * BITE_CYCLE_MS) n++;
  return n;
}

/** Bite moments crossed going from `fromMs` to `toMs` (crumbs and the chewing sound). */
export function mealBitesBetween(fromMs: number, toMs: number): number {
  return Math.max(0, mealBitesAt(toMs) - mealBitesAt(fromMs));
}

/** The lean as a body offset in source px: toward the counter the seat faces. */
export function leanOffset(facing: Facing, lean: number): { dx: number; dy: number } {
  const d = LEAN_PX * lean;
  switch (facing) {
    case "up":
      return { dx: 0, dy: -d };
    case "down":
      return { dx: 0, dy: d };
    case "left":
      return { dx: -d, dy: 0 };
    case "right":
      return { dx: d, dy: 0 };
  }
}
