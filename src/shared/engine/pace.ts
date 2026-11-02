// How fast a player moves and what dashing costs. Shared so the server's Motion and the client's
// predictor pick the same speed for the same input (any mismatch shows up as rubber-banding).
//
// Exhaustion: once stamina reaches 0 (dashing, tools, wrong-tool hits) the player is worn out
// until the home day resets (sleeping, or the day ending). Worn out means half walk speed, no
// dash and no farm work. Eating still restores stamina points (for mining and chopping) but
// doesn't lift the exhaustion: only rest does.
import type { ToolEffect } from "./toolRules";

/** Walk speed in tiles per second. */
export const PLAYER_SPEED = 4.5;
/** Dashing runs this much faster than walking. */
export const DASH_MULT = 1.8;
/** Worn out: this fraction of walk speed. */
export const TIRED_MULT = 0.5;
export const DASH_SPEED = PLAYER_SPEED * DASH_MULT;
export const TIRED_SPEED = PLAYER_SPEED * TIRED_MULT;
/**
 * Dashing costs one stamina point per this much time spent actually moving: 2.5 points a second,
 * so a full bar lasts 40 s of dashing. Tools cost 2 a swing, so a dash tires you faster than work.
 */
export const DASH_DRAIN_MS = 400;

/** Absent on an entity means walking. */
export type Pace = "walk" | "dash" | "tired";

/** The pace for an input: worn out beats everything, and dashing must be allowed here. */
export function pickPace(o: { dash: boolean; tired: boolean; canDash?: boolean }): Pace {
  if (o.tired) return "tired";
  return o.dash && o.canDash !== false ? "dash" : "walk";
}

export function paceSpeed(p: Pace): number {
  return p === "dash" ? DASH_SPEED : p === "tired" ? TIRED_SPEED : PLAYER_SPEED;
}

/** Click-to-move never dashes; it only slows down when worn out. */
export function pathSpeed(tired: boolean): number {
  return tired ? TIRED_SPEED : PLAYER_SPEED;
}

export interface DashDrain {
  stamina: number;
  /** Dash time not yet worth a whole point, carried to the next tick. */
  carryMs: number;
  /** Points spent this time. */
  spent: number;
}

/** Spends stamina for `dashedMs` of dashing (plus the carried remainder), never below 0. */
export function drainDash(stamina: number, carryMs: number, dashedMs: number): DashDrain {
  const total = Math.max(0, carryMs) + Math.max(0, dashedMs);
  const points = Math.floor(total / DASH_DRAIN_MS);
  const spent = Math.min(Math.max(0, stamina), points);
  return { stamina: Math.max(0, stamina) - spent, carryMs: total - points * DASH_DRAIN_MS, spent };
}

/** Worn out: the save says so, or stamina is already empty. */
export function isExhausted(stamina: number, flag: boolean | undefined): boolean {
  return flag === true || stamina <= 0;
}

/** Tool outcomes that count as farm work, locked while worn out (refilling the can is not). */
const FARM_WORK: ReadonlySet<ToolEffect> = new Set<ToolEffect>(["till", "water", "plant", "harvest", "clear"]);

export function farmLocked(exhausted: boolean, effect: ToolEffect): boolean {
  return exhausted && FARM_WORK.has(effect);
}

export const EXHAUSTED_NOTICE = "You're worn out! You'll walk slowly and can't farm until you sleep or the day ends.";
export const FARM_LOCKED_NOTICE = "You're too worn out to farm. Sleep in your bed to recover.";
export const NO_DASH_NOTICE = "You're too worn out to dash. Get some sleep.";
export const RESTED_EATING_NOTICE = "You're still worn out. Food helps, but only sleep will fix it.";
