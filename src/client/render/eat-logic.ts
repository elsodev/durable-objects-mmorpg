// The eat act (EntityState.act { k: "eat", item }) for every body type and facing. Pure, so the
// timeline and the hand positions are tested; entities.ts draws the food in the hand and
// item-poses.ts drops crumbs and plays the bites.
//
// The body plays the look's own "eat" action (custom.json): generator thrust frame 2 (the hand
// coming up) and frame 3 (forearm folded, fist under the chin), in EAT_FRAMES order. The food is
// the item's own 32 px icon drawn at screen scale 1, so it reads at half the character's pixel
// size: about a fist and a half. Every number below is in source px of the 64 px frame.

import type { Facing } from "../../shared/types";

/** Thrust frame per step: reach, three at the mouth, lower a little, and so on; ends lowered. */
export const EAT_FRAMES: readonly number[] = [2, 3, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3, 2];
export const EAT_FRAME_MS = 100;
/** Whole act; matches EAT_COOLDOWN_MS on the server, so a new bite never cuts one short. */
export const EAT_MS = EAT_FRAMES.length * EAT_FRAME_MS;
/** One bite in the middle of each stretch at the mouth: crumbs, the sound, a bite out of the food. */
export const EAT_BITES: readonly number[] = [200, 600, 1000];

/** Feet point of every LPC frame. */
const FEET = { x: 32, y: 60 };

/**
 * Where the middle of the food sits for each thrust frame, per facing. Measured on the male,
 * male_slim and female generator sheets, whose hands land on the same pixels in these frames
 * (the fist at about y 41-46, the chin at y 34). Facing up the head hides the food.
 */
const GRIP: Readonly<Record<Exclude<Facing, "up">, Readonly<Record<number, { x: number; y: number }>>>> = {
  down: { 2: { x: 28, y: 40 }, 3: { x: 28, y: 37 } },
  left: { 2: { x: 22, y: 42 }, 3: { x: 25, y: 37 } },
  right: { 2: { x: 42, y: 42 }, 3: { x: 39, y: 37 } },
};

/** How the held food tips toward the mouth on the frames at the mouth. */
export type Tip = "none" | "dish" | "cup";
const TIP: Readonly<Record<Tip, { hold: number; sip: number }>> = {
  none: { hold: 0, sip: 0 },
  dish: { hold: 0.1, sip: 0.25 },
  cup: { hold: 0.3, sip: 0.55 },
};

export interface FoodPose {
  /** Thrust frame the body shows. */
  frame: number;
  /** Food centre from the feet point, in source px (y up is negative). */
  dx: number;
  dy: number;
  /** Bites taken so far (0..EAT_BITES.length). */
  bites: number;
  /** Tilt in radians toward the mouth: a cup tips on each sip, a bowl a little. */
  tilt: number;
  /** False while the head hides it (facing up). */
  visible: boolean;
}

/** Bites taken by `ageMs`. */
export function bitesAt(ageMs: number): number {
  let n = 0;
  for (const b of EAT_BITES) if (ageMs >= b) n++;
  return n;
}

/** Index into EAT_FRAMES at `ageMs`, or -1 outside the act. */
export function eatStep(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= EAT_MS) return -1;
  return Math.floor(ageMs / EAT_FRAME_MS);
}

/**
 * The food `ageMs` into an eat act facing `facing`, or null once the act is over. On each bite
 * frame the food is pushed one pixel up into the mouth, and a cup or bowl tips toward the face.
 */
export function foodPose(facing: Facing, ageMs: number, tip: Tip = "none"): FoodPose | null {
  const step = eatStep(ageMs);
  if (step < 0) return null;
  const frame = EAT_FRAMES[step]!;
  const bites = bitesAt(ageMs);
  const biting = EAT_BITES.some((b) => ageMs >= b && ageMs < b + EAT_FRAME_MS);
  if (facing === "up") return { frame, dx: 0, dy: 0, bites, tilt: 0, visible: false };
  const g = GRIP[facing][frame] ?? GRIP[facing][3]!;
  const toward = mouthSide(facing);
  const t = TIP[tip];
  const tilt = frame === 3 ? toward * (biting ? t.sip : t.hold) : 0;
  return { frame, dx: g.x - FEET.x, dy: g.y - FEET.y - (biting ? 1 : 0), bites, tilt, visible: true };
}

/**
 * Which way the mouth is from the food: +1 to the right, -1 to the left. Facing down the fist is
 * left of the chin; sideways the food is held out in front of the face.
 */
export function mouthSide(facing: Facing): 1 | -1 {
  return facing === "right" ? -1 : 1;
}

/** Moments crossed between two ages: one per bite. */
export function bitesBetween(fromMs: number, toMs: number): number[] {
  return EAT_BITES.filter((b) => b > fromMs && b <= toMs);
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Pixels to clear from a `w` x `h` food icon after `bites` bites (1 = removed), as round bites
 * taken from the top edge of the food's own box (`box`, inclusive): the first from the top
 * right, the second from the top left, the third lower in the middle. `side` mirrors them, so a
 * side-facing body bites from the edge nearest its face.
 */
export function biteMask(w: number, h: number, box: Box, bites: number, side: 1 | -1 = 1): Uint8Array {
  const out = new Uint8Array(w * h);
  if (bites <= 0) return out;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const cx = (box.x0 + box.x1 + 1) / 2;
  const r = Math.max(2, Math.min(bw, bh) * 0.24);
  const holes = [
    { x: cx + side * bw * 0.24, y: box.y0 + r * 0.3, r },
    { x: cx - side * bw * 0.16, y: box.y0 + r * 0.2, r: r * 0.95 },
    { x: cx + side * bw * 0.04, y: box.y0 + bh * 0.28, r: r * 1.1 },
  ].slice(0, bites);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (const c of holes) {
        if ((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 <= c.r * c.r) {
          out[y * w + x] = 1;
          break;
        }
      }
    }
  }
  return out;
}
