// How a dash (and a worn-out walk) looks, as pure numbers for entities.ts and dash-fx.ts. No run
// frames are drawn per body: a dash plays the look's own walk cycle faster and without the
// standing frame, leans the body into the run, lifts it a pixel between foot strikes and kicks up
// a dust puff at each strike. So every body type, outfit and held tool gets it for free.
import type { EntityState, Facing } from "../../shared/types";

type Pace = EntityState["pace"];

export const DASH_LOOK = {
  /**
   * Walk cycle speed while dashing (x the walk fps). The run covers 1.8x the ground on 8 frames
   * instead of 9, so 1.6x keeps the stride length of the walk and the feet don't skate.
   */
  fpsMult: 1.6,
  /** Worn out: the walk at half speed, so the steps match the slower movement. */
  tiredFpsMult: 0.5,
  /** Forward lean as a horizontal skew (radians) facing left or right: the head leads the feet. */
  lean: 0.12,
  /** Lift in source px on the frames between foot strikes. */
  bob: 1,
  /** Dust puff: life, frames, how far it drifts up (source px) and its starting alpha. */
  dustLifeMs: 420,
  dustFrames: 4,
  dustRise: 3,
  dustAlpha: 0.9,
} as const;

/** Walk-cycle speed for a pace, relative to the profile's fps. */
export function strideRate(pace: Pace): number {
  return pace === "dash" ? DASH_LOOK.fpsMult : pace === "tired" ? DASH_LOOK.tiredFpsMult : 1;
}

/** Walk frame for an accumulated stride. A dash skips frame 0 (standing) so the run never pauses. */
export function strideFrame(stride: number, frames: number, pace: Pace): number {
  if (frames <= 0) return 0;
  const n = Math.max(0, Math.floor(stride));
  if (pace === "dash" && frames > 2) return 1 + (n % (frames - 1));
  return n % frames;
}

/** The two foot strikes of a cycle: frame 1 and the frame half a cycle later (5 of 9 on LPC). */
export function isFootStrike(frame: number, frames: number): boolean {
  return frames > 2 && (frame === 1 || frame === 1 + Math.floor((frames - 1) / 2));
}

/** Horizontal skew for the lean; up and down runs don't lean (the body would tilt sideways). */
export function dashLean(facing: Facing): number {
  // Pixi skew.x shifts the top of a feet-anchored sprite to the left when positive.
  return facing === "right" ? -DASH_LOOK.lean : facing === "left" ? DASH_LOOK.lean : 0;
}

/** Lift (source px) for a dash frame: up in the air between the strikes, down on them. */
export function dashBob(frame: number, frames: number): number {
  if (frames <= 2) return 0;
  const half = Math.floor((frames - 1) / 2);
  const phase = (frame - 1 + (frames - 1)) % half;
  return phase === 1 || phase === 2 ? DASH_LOOK.bob : 0;
}

/**
 * Where strike `n`'s puff starts, in source px from the feet: by the striking foot (left and
 * right in turn), a little behind the runner. It stays where it was kicked up, so moving on
 * leaves a trail (behind the body when running down, in front of it when running up).
 */
export function dustSpot(facing: Facing, n: number): { x: number; y: number } {
  const side = n % 2 === 0 ? -1 : 1;
  switch (facing) {
    case "right":
      return { x: -6, y: side };
    case "left":
      return { x: 6, y: side };
    case "down":
      return { x: side * 5, y: -2 };
    default:
      return { x: side * 5, y: 1 };
  }
}

/** A puff `age` ms after the strike: its frame, alpha and drift up (source px); null once gone. */
export function dustAt(age: number): { frame: number; alpha: number; rise: number } | null {
  const life = DASH_LOOK.dustLifeMs;
  if (age < 0 || age >= life) return null;
  const t = age / life;
  const frame = Math.min(DASH_LOOK.dustFrames - 1, Math.floor(t * DASH_LOOK.dustFrames));
  const alpha = DASH_LOOK.dustAlpha * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
  return { frame, alpha, rise: Math.round(t * DASH_LOOK.dustRise) };
}
