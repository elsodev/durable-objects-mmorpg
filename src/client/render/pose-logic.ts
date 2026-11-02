// Pure parts of the /sleep and /piss poses (render/poses.ts): where the pieces go and which frame
// shows when. Offsets are source pixels relative to the feet point (multiply by SCALE).
import { PEE_MS, PUDDLE_MS } from "../../shared/poses";
import type { Facing, Vec2 } from "../../shared/types";

/**
 * Lying down: the back-view standing frame turned a quarter left, so the head lies to the west.
 * A standing LPC frame is ~50 px tall above its feet point, so turned on its side the body runs
 * from about 49 px left of the feet to the feet; shifting it right by half of that centres it on
 * the player's tile, and up a little keeps it on their tile rather than the one below.
 */
export const LIE = {
  rotation: -Math.PI / 2,
  body: { x: 24, y: -6 },
  /** Quilt from the shoulders to the feet, pillow under the head (centres). */
  quilt: { x: 9, y: -6 },
  pillow: { x: -22, y: -6 },
  /** Where the Z's start (above the head) and how far they rise. */
  zzz: { x: -16, y: -24, rise: 22 },
  /** The name tag sits just above the lying body. */
  head: 26,
} as const;

export const ZZZ_EVERY_MS = 900;
export const ZZZ_LIFE_MS = 1800;

/** One rising Z, `age` ms after it appeared: offset from the start, frame (small to big) and alpha. */
export function zzzAt(age: number, index: number): { dx: number; dy: number; frame: number; alpha: number } | null {
  if (age < 0 || age >= ZZZ_LIFE_MS) return null;
  const f = age / ZZZ_LIFE_MS;
  return {
    dx: Math.round(Math.sin(f * Math.PI * 2 + index) * 3 + f * 6),
    dy: -Math.round(f * LIE.zzz.rise),
    frame: Math.min(2, Math.floor(f * 3)),
    alpha: f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3,
  };
}

/** Pee stream placement by facing; null facing up (the body hides it). `flip` mirrors the side arc. */
export function streamPlacement(facing: Facing): { kind: "side" | "front"; x: number; y: number; flip: boolean; front: boolean } | null {
  switch (facing) {
    case "right":
      return { kind: "side", x: 6, y: -26, flip: false, front: true };
    case "left":
      return { kind: "side", x: -6, y: -26, flip: true, front: true };
    case "down":
      return { kind: "front", x: 0, y: -22, flip: false, front: true };
    case "up":
      return null;
  }
}

/** Where the puddle forms, from the feet point. */
export function puddleOffset(facing: Facing): Vec2 {
  switch (facing) {
    case "right":
      return { x: 20, y: -1 };
    case "left":
      return { x: -20, y: -1 };
    case "down":
      return { x: 0, y: 3 };
    case "up":
      return { x: 0, y: -8 };
  }
}

/** The stream's height in source px is stretched to reach the ground from the hip. */
export const STREAM_STRETCH = 1.6;
export const STREAM_FRAME_MS = 90;

/** Puddle frame (0 small .. 2 full) and alpha `age` ms after the pee started; null once dried up. */
export function puddleAt(age: number): { frame: number; alpha: number } | null {
  if (age < 0) return { frame: 0, alpha: 1 };
  const total = PEE_MS + PUDDLE_MS;
  if (age >= total) return null;
  const frame = age < PEE_MS * 0.3 ? 0 : age < PEE_MS * 0.7 ? 1 : 2;
  const fadeFrom = total - 3000;
  return { frame, alpha: age < fadeFrom ? 0.9 : 0.9 * (1 - (age - fadeFrom) / 3000) };
}
