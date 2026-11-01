// Server rules for the character creator's `setLook` intent, shared by HomeRoom and ZoneRoom.
import { DEFAULT_LOOK, validateLook } from "../../shared/look";
import type { Look } from "../../shared/types";

/** One look change per second is plenty for a wardrobe and keeps saves/broadcasts cheap. */
export const LOOK_COOLDOWN_MS = 1000;

export function canChangeLook(lastAt: number, now: number): boolean {
  return now - lastAt >= LOOK_COOLDOWN_MS;
}

/** The look stored in a save, if it is still valid (saves may predate the creator or an option rename). */
export function savedLook(v: unknown): Look | undefined {
  return validateLook(v) ?? undefined;
}

/** What other players see: the saved look, or the default one until the player picks theirs. */
export function shownLook(v: unknown): Look {
  return savedLook(v) ?? { ...DEFAULT_LOOK };
}
