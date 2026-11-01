// Timing for the item drawn with an eat or hold-up act (EntityState.act { k: "eat" | "holdUp", item }).
// Pure so the timeline is tested; render/item-poses.ts draws it. Offsets are screen px from the
// entity's head point (entities.headOf), y down. The body frames (custom.json "eat" / "hold_up")
// run on the same clock.

/** Eating: raise 300 ms, at the mouth 450 ms, then four chews; the item is gone at the end. */
export const EAT_MS = 1800;
/** Bites, each one shrinking the item and dropping crumbs. */
export const EAT_BITES: readonly number[] = [750, 1050, 1350, 1650];
/** Holding a new item over the head. */
export const HOLD_MS = 2500;
/** When the fanfare plays during a hold-up. */
export const HOLD_SOUND_AT = 300;

/** Where the mouth sits below the head point, and where the hand starts. */
const MOUTH_DY = 46;
const CHEST_DY = 62;
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

const ease = (t: number): number => 1 - (1 - t) * (1 - t);

/** Bites taken by `ageMs`. */
export function bitesAt(ageMs: number): number {
  let n = 0;
  for (const b of EAT_BITES) if (ageMs >= b) n++;
  return n;
}

/** The eaten item `ageMs` into the act, or null when it isn't drawn. */
export function eatPose(ageMs: number): ItemPose | null {
  if (ageMs < 0 || ageMs >= EAT_MS) return null;
  if (ageMs < 300) {
    const t = ease(ageMs / 300);
    // A little arc up to the mouth.
    return { dx: 4 * (1 - t), dy: CHEST_DY + (MOUTH_DY - CHEST_DY) * t - Math.sin(t * Math.PI) * 4, scale: 0.75, alpha: 1 };
  }
  const left = 1 - bitesAt(ageMs) / (EAT_BITES.length + 1);
  // Chewing bobs the item with each bite.
  const sinceBite = ageMs - (EAT_BITES.filter((b) => ageMs >= b).pop() ?? ageMs);
  const bob = sinceBite < 120 ? -2 * Math.sin((sinceBite / 120) * Math.PI) : 0;
  return { dx: 0, dy: MOUTH_DY + bob, scale: 0.75 * left, alpha: 1 };
}

/** The held item `ageMs` into a hold-up, or null when it isn't drawn. */
export function holdPose(ageMs: number): ItemPose | null {
  if (ageMs < 150 || ageMs >= HOLD_MS) return null;
  const t = (ageMs - 150) / (HOLD_MS - 150);
  const alpha = Math.min(1, (ageMs - 150) / 150, (HOLD_MS - ageMs) / 250);
  return { dx: 0, dy: HOLD_DY - HOLD_RISE * t, scale: 1, alpha: Math.max(0, alpha) };
}

export function poseAt(kind: PoseKind, ageMs: number): ItemPose | null {
  return kind === "eat" ? eatPose(ageMs) : holdPose(ageMs);
}

/** Moments crossed between two ages (bites for eating, the fanfare for a hold-up). */
export function beatsBetween(kind: PoseKind, fromMs: number, toMs: number): number[] {
  const beats = kind === "eat" ? EAT_BITES : [HOLD_SOUND_AT];
  return beats.filter((b) => b > fromMs && b <= toMs);
}
