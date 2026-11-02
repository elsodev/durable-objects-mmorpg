// The cat that wanders along the bottom of the start screen: a small state machine (walk, sit,
// groom) stepped by the caller. Pure, so it runs under tests; ui/login-cat.ts draws it.

export type CatMode = "walk" | "sit" | "groom";
export type Facing = "left" | "right";

export interface CatState {
  /** Left edge of the sprite in CSS px; may be off screen while it turns round. */
  x: number;
  facing: Facing;
  mode: CatMode;
  /** Seconds until the current mode ends. */
  left: number;
  /** Seconds spent in the current mode, for the frame clock. */
  t: number;
}

/** Frame size in the village cat sheets (assets/lpc/animals/cat_*.png, 4 columns). */
export const CAT_FRAME = 32;
export const CAT_SHEET = { w: 128, h: 576 } as const;
/** Sheet rows per mode and facing (catalog.json: walk, rest, scratch). */
export const CAT_ROWS: Readonly<Record<CatMode, Record<Facing, number>>> = {
  walk: { left: 1, right: 3 },
  sit: { left: 5, right: 7 },
  groom: { left: 14, right: 15 },
};
const FPS: Readonly<Record<CatMode, number>> = { walk: 6, sit: 3, groom: 5 };
/** Sheet pixels per second: the village cat's 8 fps at 1.5 tiles/s, slowed to 6 fps so paws still don't slide. */
const WALK_SPEED = CAT_FRAME * 1.125;

type Rand = () => number;

const between = (rand: Rand, lo: number, hi: number) => lo + rand() * (hi - lo);

/** A fresh cat somewhere on the left third, walking right. */
export function initialCat(width: number, scale: number, rand: Rand): CatState {
  return { x: between(rand, 0, Math.max(0, width / 3 - CAT_FRAME * scale)), facing: "right", mode: "walk", left: between(rand, 3, 7), t: 0 };
}

/** The pose a reduced-motion viewer sees: sitting still near the bottom left. */
export function stillCat(width: number, scale: number): CatState {
  return { x: Math.max(0, Math.min(width * 0.12, width - CAT_FRAME * scale)), facing: "right", mode: "sit", left: Infinity, t: 0 };
}

/** Advance `dt` seconds. `width` is the viewport width, `scale` the CSS px per sheet px. */
export function stepCat(s: CatState, dt: number, width: number, scale: number, rand: Rand): CatState {
  const size = CAT_FRAME * scale;
  let { x, facing, mode, left, t } = s;
  t += dt;
  left -= dt;

  if (mode === "walk") {
    x += (facing === "right" ? 1 : -1) * WALK_SPEED * scale * dt;
    // Past either edge: turn round and wander back in.
    if (facing === "right" && x > width + size * 0.5) facing = "left";
    else if (facing === "left" && x < -size * 1.5) facing = "right";
  }

  const onScreen = x > size * 0.25 && x < width - size * 1.25;
  if (left <= 0) {
    if (mode !== "walk") {
      mode = "walk";
      left = between(rand, 4, 9);
      if (rand() < 0.35) facing = facing === "left" ? "right" : "left";
    } else if (onScreen) {
      const r = rand();
      mode = r < 0.55 ? "sit" : r < 0.85 ? "groom" : "walk";
      left = mode === "sit" ? between(rand, 2.5, 5) : mode === "groom" ? between(rand, 2, 3.5) : between(rand, 3, 6);
      if (mode === "walk" && rand() < 0.5) facing = facing === "left" ? "right" : "left";
    } else {
      // Only stop where the viewer can see it.
      left = 0.5;
    }
    if (mode !== s.mode) t = 0;
  }
  return { x, facing, mode, left, t };
}

/** Sheet row and column to show for a state. */
export function catFrame(s: CatState): { row: number; col: number } {
  const row = CAT_ROWS[s.mode][s.facing];
  return { row, col: Math.floor(s.t * FPS[s.mode]) % 4 };
}
