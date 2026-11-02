// Pure maths for the feedback screenshot: the rectangle a drag makes, mapping it from CSS pixels
// to the captured image's pixels, and the downscale/encode plan that keeps the upload small.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Smaller drags are taken as a stray tap, not a selection. */
export const MIN_CAPTURE_SIDE = 24;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The rectangle between two drag points, either direction, clamped to the view. */
export function dragRect(a: Point, b: Point, view: Size): Rect {
  const x1 = clamp(Math.min(a.x, b.x), 0, view.w);
  const y1 = clamp(Math.min(a.y, b.y), 0, view.h);
  const x2 = clamp(Math.max(a.x, b.x), 0, view.w);
  const y2 = clamp(Math.max(a.y, b.y), 0, view.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function usableRect(r: Rect | null): r is Rect {
  return !!r && r.w >= MIN_CAPTURE_SIDE && r.h >= MIN_CAPTURE_SIDE;
}

/**
 * A rectangle in view (CSS) pixels -> whole pixels of a capture of that view at another size
 * (device pixel ratio, or a capped capture). Never empty, never outside the source.
 */
export function toSourceRect(r: Rect, view: Size, source: Size): Rect {
  const sx = view.w > 0 ? source.w / view.w : 1;
  const sy = view.h > 0 ? source.h / view.h : 1;
  const x = clamp(Math.floor(r.x * sx), 0, Math.max(0, source.w - 1));
  const y = clamp(Math.floor(r.y * sy), 0, Math.max(0, source.h - 1));
  const x2 = clamp(Math.ceil((r.x + r.w) * sx), x + 1, source.w);
  const y2 = clamp(Math.ceil((r.y + r.h) * sy), y + 1, source.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Scales a size down (never up) so its long side is at most `maxSide`. */
export function fitWithin(size: Size, maxSide: number): Size {
  const long = Math.max(size.w, size.h);
  if (long <= maxSide || long <= 0) return { w: Math.max(1, Math.round(size.w)), h: Math.max(1, Math.round(size.h)) };
  const k = maxSide / long;
  return { w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) };
}

export interface EncodeStep {
  type: "image/webp" | "image/jpeg";
  quality: number;
  /** Long side in pixels for this attempt. */
  maxSide: number;
}

/**
 * Attempts in order until one fits the byte cap: WebP at falling quality, then smaller. JPEG
 * steps follow for browsers whose canvas can't write WebP (toBlob falls back to PNG there).
 */
export function encodePlan(maxSide: number): EncodeStep[] {
  const steps: EncodeStep[] = [];
  for (const side of [maxSide, Math.round(maxSide * 0.75), Math.round(maxSide * 0.5)]) {
    for (const q of [0.9, 0.75, 0.6]) steps.push({ type: "image/webp", quality: q, maxSide: side });
  }
  for (const side of [maxSide, Math.round(maxSide * 0.6)]) {
    for (const q of [0.85, 0.65]) steps.push({ type: "image/jpeg", quality: q, maxSide: side });
  }
  return steps;
}
