// Ladders between cave floors: stepping onto one plays a short climb that everyone sees (act
// "climb_down" into a hole in the floor, "climb_up" a ladder on the wall), then the zone changes.
// Pure; the server owns the clock.
import type { EntityState, MapExit, Vec2 } from "./types";

/** How long the climb plays before the zone changes. */
export const CLIMB_MS = 800;

export type ClimbAct = "climb_down" | "climb_up";
export const CLIMB_ACTS: ReadonlySet<string> = new Set<ClimbAct>(["climb_down", "climb_up"]);

export function climbAct(dir: NonNullable<MapExit["climb"]>): ClimbAct {
  return dir === "down" ? "climb_down" : "climb_up";
}

/**
 * Where the climber's feet go: over the middle of the hole (its pit sits a little below the tile
 * centre), or just in front of the foot of the ladder on the wall, so the climber is drawn over
 * the ladder rather than behind it.
 */
export function climbPoint(exit: Pick<MapExit, "x" | "y" | "w" | "h" | "climb">): Vec2 {
  return { x: exit.x + exit.w / 2, y: exit.climb === "down" ? exit.y + 0.58 : exit.y + exit.h + 0.02 };
}

/** Is a climb act still playing at `now`? */
export function climbing(act: { k: string; at: number } | undefined, now: number): boolean {
  return !!act && CLIMB_ACTS.has(act.k) && now - act.at < CLIMB_MS + 400;
}

/**
 * Puts `e` on the ladder of `exit` at `now`: feet on the climb point, facing the wall, the climb
 * act for everyone to see. Returns when the zone change is due.
 */
export function beginClimb(e: Pick<EntityState, "x" | "y" | "facing" | "moving" | "act">, exit: MapExit, now: number): number {
  const at = climbPoint(exit);
  e.x = at.x;
  e.y = at.y;
  e.facing = "up";
  e.moving = false;
  e.act = { k: climbAct(exit.climb ?? "down"), at: now };
  return now + CLIMB_MS;
}
