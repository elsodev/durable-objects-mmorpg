// Character-creator seam. A creator can attach `appearance` to the SessionUser it returns; the session
// applies it to YOUR entity locally. Other players see the server-chosen sprite until the server
// accepts and broadcasts appearance (not in the protocol yet).
import type { EntityState } from "../../shared/types";

export interface PlayerAppearance {
  /** Character sprite key to use for you (must exist in art.character, e.g. "player_3"). */
  sprite?: string;
  /** Free-form layer choices for a future layered LPC renderer (body, hair, outfit...). */
  layers?: Record<string, string>;
}

/** A SessionUser (ui/index.ts) may carry this optional field; typed structurally to keep this module DOM-free. */
export interface WithAppearance {
  appearance?: PlayerAppearance | null;
}

const SPRITE_KEY = /^[a-z0-9_]{1,40}$/;

export function appearanceOf(user: object): PlayerAppearance | null {
  const a = (user as WithAppearance).appearance;
  return a && typeof a === "object" ? a : null;
}

export function applyAppearance(state: EntityState, appearance: PlayerAppearance | null): EntityState {
  const sprite = appearance?.sprite;
  if (!sprite || !SPRITE_KEY.test(sprite) || sprite === state.sprite) return state;
  return { ...state, sprite };
}
