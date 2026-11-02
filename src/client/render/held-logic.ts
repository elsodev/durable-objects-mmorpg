// When and how the held tool (EntityState.held) is drawn on a character. Pure, so the rules are
// tested; entities.ts applies them to the two layer sprites around the body.
import type { EntityState } from "../../shared/types";

/** What else the body is doing this frame. */
export interface BodyPose {
  /** An action animation drew the body (a swing, harvest, hurt, faint, eating, a hold-up, sitting). */
  acting: boolean;
  seated: boolean;
  /** Fading out after death. */
  dying: boolean;
}

/**
 * The item to draw in the hand, or null. Only players hold things. While an action plays, its own
 * frames take over: a swing draws the tool from the action sheet, and harvesting, eating, hurting,
 * fainting or sitting leaves the hands busy.
 */
export function heldToShow(s: Pick<EntityState, "kind" | "held">, pose: BodyPose): string | null {
  if (s.kind !== "player" || !s.held) return null;
  if (pose.acting || pose.seated || pose.dying) return null;
  return s.held;
}

/**
 * The held frame to show on top of walk frame `walkIndex` (0 when standing). Held sheets have one
 * frame per walk frame, so the tool rides each step with the hand; a shorter sheet falls back to
 * its first (standing) frame rather than showing nothing.
 */
export function heldFrameIndex(walkIndex: number, frames: number): number {
  if (frames <= 0) return -1;
  return walkIndex >= 0 && walkIndex < frames ? walkIndex : 0;
}
