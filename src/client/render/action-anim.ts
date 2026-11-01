// Tool action animations (EntityState.act). No-op by default: the art pack can install a hook
// that swaps in tool frames for the body sprite while an action plays.
import type { Sprite } from "pixi.js";
import type { EntityState } from "../../shared/types";

/**
 * Called every frame for every entity. `act` is the entity's last action (or undefined) and
 * `ageMs` how long ago it happened by the local clock; return true if the hook drew the frame
 * (the walk/idle texture is then left alone).
 */
export type ActionHook = (body: Sprite, state: EntityState, act: NonNullable<EntityState["act"]>, ageMs: number) => boolean;

let hook: ActionHook | null = null;

export function setActionHook(fn: ActionHook | null): void {
  hook = fn;
}

/** Remembers when each action was first seen locally, so server/client clock skew doesn't matter. */
const seen = new WeakMap<object, number>();

export function runActionHook(body: Sprite, state: EntityState, nowMs: number): boolean {
  const act = state.act;
  if (!hook || !act) return false;
  let at = seen.get(act);
  if (at === undefined) seen.set(act, (at = nowMs));
  return hook(body, state, act, nowMs - at);
}
