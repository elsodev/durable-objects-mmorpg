// Shape of /assets/lpc/catalog.json as produced by the art pack. Every section and field is optional:
// the loader must survive a partial or older catalog, so nothing here is trusted to exist.

/** [x, y, w, h] in pixels of the referenced PNG. */
export type RectTuple = [number, number, number, number];
/** [px, py] relative to a rect's origin. */
export type PointTuple = [number, number];

export interface AnimRow {
  row: number;
  frames: number;
  /** First column of the row (default 0). */
  col?: number;
}
export type DirRows = Partial<Record<"up" | "left" | "down" | "right", AnimRow>>;

export interface CharacterEntry {
  file: string;
  frameW?: number;
  frameH?: number;
  /** Feet point in px within one frame. */
  anchor?: PointTuple;
  shadow?: string;
  flying?: boolean;
  /** Flying: source px the sprite floats above its anchor. */
  hover?: number;
  animations?: {
    walk?: DirRows;
    idle?: DirRows;
    slash?: DirRows;
    attack?: DirRows;
    /** Animals: poses held in place (rest = sit or peck, nap = curled up, love = happy). */
    rest?: DirRows;
    nap?: DirRows;
    love?: DirRows;
    /** Cats: scratching behind an ear, batting a ball of yarn. Dogs: sniffing the grass. */
    scratch?: DirRows;
    play?: DirRows;
    sniff?: DirRows;
  };
}

export interface TerrainEntry {
  file: string;
  tile?: RectTuple;
  variants?: RectTuple[];
  /** Autotile blob rects (outer3x3, inner2x2, grassBankOverlay3x3, ...); values are RectTuples or notes. */
  edges?: Record<string, unknown>;
  /** Animated terrain (water_anim): frame rects per sheet; parseWaterAnim reads these and the rest. */
  frames?: Record<string, RectTuple[]>;
  /** Animated terrain: per-style timing and drift ({ ms, flow: [x, y] }). */
  styles?: Record<string, unknown>;
}

export interface SpriteEntry {
  file: string;
  rect?: RectTuple;
  anchor?: PointTuple;
  footprintTiles?: { w: number; h: number };
  shadow?: string;
  /**
   * Animation frames (rects in the same PNG): a list loops (campfire); named closed/opening/open
   * frames make a lid that opens and closes (shipping bin).
   */
  frames?: RectTuple[] | Record<string, RectTuple>;
  /** Furniture: named alternative rects (left, right, back, ...). Ores: array of variants. */
  variants?: Record<string, RectTuple> | RectTuple[];
  /** Furniture: feet point of each named variant when it differs in size from `rect`. */
  variantAnchors?: Record<string, PointTuple>;
  /** Market stall: shopkeeper feet point relative to rect origin. */
  keeper?: PointTuple;
  /** Signpost: centre of the destination label plate, relative to rect origin. */
  labelAnchor?: PointTuple;
  /** Market stall: absolute rect (same PNG) drawn above the keeper. */
  frontOverlay?: RectTuple;
  /** The overlay is the same size as rect and drawn exactly over it (chair backrests). */
  frontAligned?: boolean;
  /** Tables and counters: top surface rect (relative to rect origin) tabletop things stand on. */
  surface?: RectTuple;
}

export interface CropEntry {
  file: string;
  /** seedling, small, medium, ready */
  stages?: RectTuple[];
  /** Wilted art for the seedling, small and medium stages (ready crops don't wilt). */
  wilted?: RectTuple[];
  /** The dead plant. */
  dead?: RectTuple;
  anchor?: PointTuple;
  shadow?: string;
}

export interface IconEntry {
  file: string;
  rect?: RectTuple;
}

export interface ShadowsEntry {
  file?: string;
  rects?: Record<string, RectTuple>;
  [size: string]: unknown;
}

export interface Catalog {
  characters?: Record<string, CharacterEntry>;
  monsters?: Record<string, CharacterEntry>;
  /** Village pets and farm animals: walk rows plus pose rows (see docs/guides/animated-sprites.md). */
  animals?: Record<string, CharacterEntry>;
  terrain?: Record<string, TerrainEntry>;
  props?: Record<string, SpriteEntry>;
  buildings?: Record<string, SpriteEntry>;
  plants?: Record<string, SpriteEntry>;
  ores?: Record<string, SpriteEntry>;
  furniture?: Record<string, SpriteEntry>;
  crops?: Record<string, CropEntry>;
  icons?: Record<string, IconEntry>;
  shadows?: ShadowsEntry;
  /** Interior kit: floors ({file, tile, variants}) and walls.styles.<style>.pieces. */
  interior?: Record<string, unknown>;
  /** Array or {key: reason}; informational only. */
  missing?: unknown;
  substitutions?: unknown;
}
