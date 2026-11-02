// Fence autotiling: each fence tile picks its piece from which neighbours are fences too, so a
// north-south run draws posts joined by vertical rails instead of stacked horizontal segments.
// Pure (no Pixi) so it is unit-testable.
import type { Vec2 } from "../../shared/types";

export const FENCE_N = 1;
export const FENCE_E = 2;
export const FENCE_S = 4;
export const FENCE_W = 8;

const key = (x: number, y: number) => `${x},${y}`;

/** Neighbour mask (FENCE_N | FENCE_E | FENCE_S | FENCE_W) for every fence tile, keyed "x,y". */
export function fenceMasks(tiles: Iterable<Vec2>): Map<string, number> {
  const set = new Set<string>();
  const list: Vec2[] = [];
  for (const t of tiles) {
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    if (!set.has(key(x, y))) list.push({ x, y });
    set.add(key(x, y));
  }
  const out = new Map<string, number>();
  for (const { x, y } of list) {
    let m = 0;
    if (set.has(key(x, y - 1))) m |= FENCE_N;
    if (set.has(key(x + 1, y))) m |= FENCE_E;
    if (set.has(key(x, y + 1))) m |= FENCE_S;
    if (set.has(key(x - 1, y))) m |= FENCE_W;
    out.set(key(x, y), m);
  }
  return out;
}

export const fenceKey = key;

/**
 * Which way a gate is drawn: across a north-south run it shows its side view (rotation 1), in an
 * east-west run its front (0); a gate on its own keeps the way its owner turned it.
 */
export function gateTurn(mask: number, rotation: 0 | 1 | 2 | 3): 0 | 1 {
  if (mask & (FENCE_E | FENCE_W)) return 0;
  if (mask & (FENCE_N | FENCE_S)) return 1;
  return rotation % 2 === 1 ? 1 : 0;
}

/** Sheet rect [x, y, w, h] and where to draw it in a 32 x 36 fence tile (tile = top 32 rows). */
export interface FencePart {
  src: [number, number, number, number];
  dx: number;
  dy: number;
}

/**
 * Pieces of the LPC plain fence sheet (props/plain_fence_a.png, 32 px cells). Posts are 10 px
 * wide at x 11..20; rails fill the 11 px either side; vertical rails are a 4 px stripe at x 14..17.
 */
export const FENCE_SHEET = {
  railsWest: [128, 64, 11, 32],
  railsEast: [149, 64, 11, 32],
  post: [128, 96, 32, 32],
  /** Post with the vertical rail running out of its bottom. */
  postSouth: [96, 0, 32, 32],
  /** A bit of vertical rail to bridge the 2 px gap to the post of the tile below. */
  railSouth: [110, 40, 4, 4],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export const FENCE_TILE = { w: 32, h: 36, feetY: 32 } as const;

/** Draw list (back to front) for one fence tile with neighbour mask `mask`. */
export function fenceParts(mask: number): FencePart[] {
  const parts: FencePart[] = [];
  const p = (src: readonly [number, number, number, number], dx: number, dy: number) =>
    parts.push({ src: [src[0], src[1], src[2], src[3]], dx, dy });
  if (mask & FENCE_W) p(FENCE_SHEET.railsWest, 0, 0);
  if (mask & FENCE_E) p(FENCE_SHEET.railsEast, 21, 0);
  if (mask & FENCE_S) {
    p(FENCE_SHEET.postSouth, 0, 0);
    p(FENCE_SHEET.railSouth, 14, 32);
  } else {
    p(FENCE_SHEET.post, 0, 0);
  }
  return parts;
}
