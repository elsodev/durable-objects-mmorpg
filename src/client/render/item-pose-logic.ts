// Timing for the item drawn with an eat or hold-up act (EntityState.act { k: "eat" | "holdUp", item }).
// Pure so the timeline is tested; render/item-poses.ts draws it. Offsets are screen px from the
// entity's head point (entities.headOf), y down. The body frames (custom.json "eat" / "hold_up")
// run on the same clock. Eating is drawn in the hand by entities.ts (eat-logic.ts); here it only
// has its length and its bites.
import { bitesBetween, EAT_MS } from "./eat-logic";

export { bitesAt, EAT_BITES, EAT_MS } from "./eat-logic";

/** Holding a new item over the head. */
export const HOLD_MS = 2500;
/** When the fanfare plays during a hold-up. */
export const HOLD_SOUND_AT = 300;

/** The held item floats this far above the head point and drifts up by HOLD_RISE over the hold. */
const HOLD_DY = -4;
const HOLD_RISE = 8;

export interface ItemPose {
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
}

export type PoseKind = "eat" | "hold";

export function poseKindOf(act: { k: string; item?: string } | undefined): PoseKind | null {
  if (!act?.item) return null;
  if (act.k === "eat") return "eat";
  if (act.k === "holdUp") return "hold";
  return null;
}

export function poseLength(kind: PoseKind): number {
  return kind === "eat" ? EAT_MS : HOLD_MS;
}

/** The held item `ageMs` into a hold-up, or null when it isn't drawn. */
export function holdPose(ageMs: number): ItemPose | null {
  if (ageMs < 150 || ageMs >= HOLD_MS) return null;
  const t = (ageMs - 150) / (HOLD_MS - 150);
  const alpha = Math.min(1, (ageMs - 150) / 150, (HOLD_MS - ageMs) / 250);
  return { dx: 0, dy: HOLD_DY - HOLD_RISE * t, scale: 1, alpha: Math.max(0, alpha) };
}

/** The item drawn over the head; eating draws none here (it's in the hand). */
export function poseAt(kind: PoseKind, ageMs: number): ItemPose | null {
  return kind === "hold" ? holdPose(ageMs) : null;
}

/** Moments crossed between two ages (bites for eating, the fanfare for a hold-up). */
export function beatsBetween(kind: PoseKind, fromMs: number, toMs: number): number[] {
  if (kind === "eat") return bitesBetween(fromMs, toMs);
  return [HOLD_SOUND_AT].filter((b) => b > fromMs && b <= toMs);
}
