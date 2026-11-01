// Pack icons sit in 32x32 cells, often with a small sprite in the middle (seed piles are ~12 px).
// The HUD shows every icon at 32 CSS px, so we crop the cell to its opaque pixels and blow the
// sprite up by the largest WHOLE factor that fits: icons look the same size everywhere and stay crisp.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of pixels with alpha above `minAlpha` in RGBA data, or null if fully transparent. */
export function opaqueBox(rgba: ArrayLike<number>, width: number, height: number, minAlpha = 8): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) <= minAlpha) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Where to draw a cropped sprite of `box` size inside a `size` square: whole-number scale (at
 * least 1) leaving `pad` px clear on each side when possible, centred on pixel boundaries.
 */
export function fitIcon(box: { w: number; h: number }, size = 32, pad = 1): { scale: number; x: number; y: number; w: number; h: number } {
  const room = Math.max(1, size - pad * 2);
  const scale = Math.max(1, Math.floor(room / Math.max(box.w, box.h, 1)));
  const w = Math.min(size, box.w * scale);
  const h = Math.min(size, box.h * scale);
  return { scale, x: Math.floor((size - w) / 2), y: Math.floor((size - h) / 2), w, h };
}
