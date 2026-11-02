// Where night light comes from, in art space. Pure data and math (no Pixi), so tests can check
// every point against the pixels. Glows centre on the lit part of the art (a lantern's glass, a
// bulb, a flame), never on the footprint, so a tall lamp post glows at its head.
import { SCALE, TILE, type LightSpot, type LitWindowsView } from "../contracts";

export interface LightSource {
  /** Lit points in source px relative to the sprite's anchor (feet), front view. */
  points: readonly (readonly [number, number])[];
  /** Glow radius in tiles at full strength. */
  radius: number;
}

const LANTERN = 3.2;
const LAMP = 2.6;
const SMALL = 1.8;
const FLAME = 1.4;
const FIRE = 3.6;

/**
 * Every prop type and furniture item that glows at night. Keyed by art name: a placed item uses
 * its furniture art, a map prop its prop art, and both share these names. test/fe-light-points.test.ts
 * checks each point lands on lit pixels of its sprite.
 */
export const LIGHT_SOURCES: Readonly<Record<string, LightSource>> = {
  // Outdoor lamp post: the lantern glass, 60 px up the post.
  lantern_post: { points: [[0, -60]], radius: LANTERN },
  // Shaded lamps: the bulb inside the shade.
  lamp: { points: [[0, -37]], radius: LAMP },
  floor_lamp: { points: [[0, -38]], radius: LAMP },
  table_lamp: { points: [[0, -20]], radius: SMALL },
  nightstand: { points: [[0, -26]], radius: SMALL },
  wall_sconce: { points: [[0, -19]], radius: LAMP },
  // One glow per bulb.
  wall_lamp_double: { points: [[-11, -4], [11, -4]], radius: SMALL },
  crystal_lamp: { points: [[0, -30]], radius: LAMP },
  // Flames.
  candle: { points: [[0, -16]], radius: FLAME },
  wall_torch: { points: [[0, -24]], radius: SMALL },
  campfire: { points: [[0, -13]], radius: FIRE },
  fireplace: { points: [[1, -23]], radius: FIRE },
  hearth: { points: [[-2, -29]], radius: LAMP },
  stove: { points: [[0, -14]], radius: SMALL },
};

/**
 * Glow spots for a sprite of art `type` whose anchor sits at world px (`x`, `y`). `flip` mirrors
 * the points (a sprite drawn with a negative x scale).
 */
export function lightSpots(type: string, x: number, y: number, flip = false): LightSpot[] {
  const src = LIGHT_SOURCES[type];
  if (!src) return [];
  const sx = flip ? -SCALE : SCALE;
  return src.points.map(([dx, dy]) => ({ x: (x + dx * sx) / TILE, y: (y + dy * SCALE) / TILE, radius: src.radius }));
}

/** A building whose windows light up at night: an overlay of its window panes, lit. */
export interface LitWindowsArt {
  /** Prop art name of the overlay: same size and anchor as the building, only the panes opaque. */
  art: string;
  /** Each window's panes, source px relative to the building's anchor: [x, y, w, h]. */
  windows: readonly (readonly [number, number, number, number])[];
}

/** Buildings with lit windows, by map prop type. */
export const LIT_WINDOWS: Readonly<Record<string, LitWindowsArt>> = {
  // The yard house (cottage art): the gable window and the window beside the door.
  home_house: {
    art: "cottage_lit",
    windows: [
      [-10, -109, 22, 14],
      [-42, -56, 22, 31],
    ],
  },
};

export function litWindowsAt(type: string, x: number, y: number, z: number): LitWindowsView | null {
  const lit = LIT_WINDOWS[type];
  if (!lit) return null;
  const windows = lit.windows.map(([wx, wy, w, h]) => ({ x: x + wx * SCALE, y: y + wy * SCALE, w: w * SCALE, h: h * SCALE }));
  return { art: lit.art, x, y, z, windows };
}

/** Centre of a window rect in tile coords: where its glow spills from. */
export function windowGlow(r: { x: number; y: number; w: number; h: number }, radius: number): LightSpot {
  return { x: (r.x + r.w / 2) / TILE, y: (r.y + r.h / 2) / TILE, radius };
}

/** Indoors the lamps sit close together in a small room, so each one glows softer. */
export const INDOOR_GLOW = 0.55;
/** Beyond this many glows the room would wash out, so each one dims as more are added. */
export const GLOW_CROWD = 3;

/**
 * Alpha for each lamp glow at lamp strength `k` with `count` glows on screen. Glows overlap and
 * add up, so many lamps share a light budget instead of each adding its full brightness.
 */
export function glowAlpha(k: number, count: number, indoor: boolean): number {
  const crowd = count > GLOW_CROWD ? Math.sqrt(GLOW_CROWD / count) : 1;
  return k * crowd * (indoor ? INDOOR_GLOW : 1);
}
