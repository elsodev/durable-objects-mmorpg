// Pure geometry and timing for the admin halo (render/halo.ts): a pixel-art golden ring floating
// over an admin's head, bobbing gently, with a soft pulsing glow and two sparkles orbiting it.
// Sizes are in source pixels (the renderer multiplies by SCALE). No Pixi imports: unit-tested.

/** Ring half-width and half-height (an ellipse seen from slightly above). */
export const HALO_RX = 9;
export const HALO_RY = 4;
/** Ring centre above the top of the head (body top), so it floats clear of hair and hats. */
export const HALO_LIFT = 3;
/** Bob: a slow float up and down. */
export const HALO_BOB_AMP = 1.25;
export const HALO_BOB_HZ = 0.5;
/** Glow pulse rate. */
export const HALO_PULSE_HZ = 0.8;
/** Sparkles: how many orbit the ring and how long one lap takes. */
export const HALO_SPARKLES = 2;
export const HALO_ORBIT_MS = 2600;
/** Room the name tag leaves above the head for the halo and its glow (source px). */
export const HALO_CLEARANCE = HALO_LIFT + HALO_RY + HALO_BOB_AMP + 3;

export type HaloTone = "front" | "back" | "shine";

export interface HaloCell {
  x: number;
  y: number;
  tone: HaloTone;
}

/**
 * The ring's outline as whole-pixel cells around (0, 0), each once, with no gaps between
 * neighbours. The near (lower) half is "front" (bright), the far half "back" (deeper gold), and a
 * short arc on the upper left catches the light ("shine").
 */
export function haloRingCells(rx = HALO_RX, ry = HALO_RY): HaloCell[] {
  // One quarter, bridged so the outline stays closed at pixel scale, then mirrored: the ring is
  // exactly symmetric whatever the rounding does.
  const quarter: [number, number][] = [];
  const steps = Math.max(16, Math.ceil(rx * 4));
  let prev: [number, number] | null = null;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    const x = Math.round(Math.cos(a) * rx);
    const y = Math.round(Math.sin(a) * ry);
    if (prev && prev[0] - x > 1) for (let cx: number = prev[0] - 1; cx > x; cx--) quarter.push([cx, prev[1]]);
    quarter.push([x, y]);
    prev = [x, y];
  }
  const seen = new Set<string>();
  const cells: HaloCell[] = [];
  for (const [qx, qy] of quarter) {
    for (const [x, y] of [[qx, qy], [-qx, qy], [qx, -qy], [-qx, -qy]] as const) {
      const k = `${x},${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const tone: HaloTone = y > 0 || (y === 0 && Math.abs(x) >= rx) ? "front" : x < -rx * 0.25 && x > -rx * 0.85 && y < 0 ? "shine" : "back";
      cells.push({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, tone });
    }
  }
  return cells;
}

/** Vertical float offset (source px; negative = up) at time `ms`. Each admin gets a phase. */
export function haloBob(ms: number, phase = 0): number {
  return -HALO_BOB_AMP * Math.sin((ms / 1000) * HALO_BOB_HZ * Math.PI * 2 + phase);
}

/** Glow strength 0..1 (eased so it lingers at the bright end). */
export function haloPulse(ms: number, phase = 0): number {
  const s = 0.5 + 0.5 * Math.sin((ms / 1000) * HALO_PULSE_HZ * Math.PI * 2 + phase);
  return s * s * (3 - 2 * s);
}

export interface Sparkle {
  x: number;
  y: number;
  /** In front of the ring (lower half) or behind it. */
  front: boolean;
  alpha: number;
}

/** Sparkle `i` of `n` orbiting the ring: brightest at the front, faint at the back. */
export function haloSparkle(ms: number, i: number, n = HALO_SPARKLES, phase = 0): Sparkle {
  const a = ((ms / HALO_ORBIT_MS) * Math.PI * 2 + (i / Math.max(1, n)) * Math.PI * 2 + phase) % (Math.PI * 2);
  const y = Math.sin(a) * HALO_RY;
  return { x: Math.cos(a) * HALO_RX, y, front: y >= 0, alpha: 0.35 + 0.65 * ((Math.sin(a) + 1) / 2) };
}

/** Halo centre relative to the entity's feet (screen px), from the head top the renderer reports. */
export function haloCentreY(headTopY: number, scale: number, ms: number, phase = 0): number {
  return headTopY - (HALO_LIFT - haloBob(ms, phase)) * scale;
}
