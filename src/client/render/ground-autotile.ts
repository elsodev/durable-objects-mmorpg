// Pure terrain-transition planning for render/ground.ts (no Pixi, unit-tested).
//
// Transitions use LPC "blob" sheets: a 3x3 block showing a patch of terrain T (centre fully T,
// ring fading out) plus a 2x2 block showing a hole in T (inner corners). Every tile is split into
// four quadrants; each quadrant picks the matching quadrant of one blob piece from its two
// orthogonal neighbours and the diagonal between them. This composes for any neighbour pattern
// (1-wide strips, peninsulas) without a 47-tile table.
import { Ground, type MapData } from "../../shared/types";

/** 0 = NW, 1 = NE, 2 = SW, 3 = SE. Bit 0 = east half, bit 1 = south half. */
export type Quadrant = 0 | 1 | 2 | 3;
export const QUADRANTS: readonly Quadrant[] = [0, 1, 2, 3];

/** A 32 px tile inside a blob sheet: outer = the 3x3 patch block, inner = the 2x2 hole block. */
export interface BlobPiece {
  block: "outer" | "inner";
  col: number;
  row: number;
}

/**
 * Blob sets the ground layer asks the art for (see GroundEdgeArt in ground.ts):
 * - grass: grass patch, transparent outside (catalog terrain.grass.edges outer3x3/inner2x2)
 * - tilled: tilled soil patch, transparent outside (terrain.tilled.edges)
 * - tilled_wet: the same patch watered (terrain.tilled_wet.edges), drawn over dry soil by farm.ts
 * - water.grass / water.dirt: pond with a grass / dirt bank ring, transparent centre
 *   (terrain.water.edges grassBankOverlay3x3 + grassInner2x2, dirtBankOverlay3x3 + dirtInner2x2)
 */
export type BlobSet = "grass" | "tilled" | "tilled_wet" | "water.grass" | "water.dirt";

/**
 * Piece for one quadrant of a tile whose own terrain is the blob's patch terrain.
 * `other(dx, dy)` is true when the neighbour at that offset is "outside" the patch.
 * Returns null when the quadrant is fully inside (draw the plain tile).
 */
export function blobPiece(other: (dx: number, dy: number) => boolean, q: Quadrant): BlobPiece | null {
  const sx = q & 1 ? 1 : -1;
  const sy = q & 2 ? 1 : -1;
  const v = other(0, sy);
  const h = other(sx, 0);
  const outerCol = sx < 0 ? 0 : 2;
  const outerRow = sy < 0 ? 0 : 2;
  if (v && h) return { block: "outer", col: outerCol, row: outerRow };
  if (v) return { block: "outer", col: 1, row: outerRow };
  if (h) return { block: "outer", col: outerCol, row: 1 };
  // The hole sits at the centre of the 2x2, so a NW notch is the hole block's bottom-right tile.
  if (other(sx, sy)) return { block: "inner", col: sx < 0 ? 1 : 0, row: sy < 0 ? 1 : 0 };
  return null;
}

/**
 * Source rect of one quadrant of a blob piece, given the sheet block's rect (3x3 outer or 2x2
 * inner block of square tiles). `shift` moves the window by that fraction of a tile.
 */
export function pieceQuadRect(
  block: { x: number; y: number; width: number },
  piece: BlobPiece,
  q: Quadrant,
  shift: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number; w: number; h: number } {
  const tile = block.width / (piece.block === "outer" ? 3 : 2);
  const half = tile / 2;
  return {
    x: block.x + piece.col * tile + (q & 1 ? half : 0) + Math.round(shift.x * tile),
    y: block.y + piece.row * tile + (q & 2 ? half : 0) + Math.round(shift.y * tile),
    w: half,
    h: half,
  };
}

/** Four quadrant pieces, or null when the tile needs no transition at all. */
export function blobPieces(other: (dx: number, dy: number) => boolean): (BlobPiece | null)[] | null {
  const pieces = QUADRANTS.map((q) => blobPiece(other, q));
  return pieces.some((p) => p !== null) ? pieces : null;
}

// ---------------------------------------------------------------- map helpers

/** Ground at (x, y); out of bounds reads as `fallback` so map borders never draw edges. */
export function groundAt(map: MapData, x: number, y: number, fallback: Ground): Ground {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fallback;
  return map.ground[y * map.width + x] ?? fallback;
}

export const isWallKind = (g: Ground): boolean => g === Ground.CaveWall || g === Ground.Wall;

/** Terrains grass blends over (grass is drawn on top with a soft fringe exposing these). */
const UNDER_GRASS: readonly Ground[] = [Ground.Dirt, Ground.Sand, Ground.Stone];
/** Neighbours that do not get a bank around water (docks/bridges sit on water; void is off-map). */
const NO_BANK: readonly Ground[] = [Ground.Water, Ground.Wood, Ground.Void];

export interface BlobLayer {
  set: BlobSet;
  pieces: (BlobPiece | null)[];
}

export interface TilePlan {
  /** Ground drawn first as a full tile; null draws nothing (void). */
  base: Ground | null;
  /** Transition quadrants drawn over the base, when the art provides blob sheets. */
  blob: BlobLayer | null;
  /** Kind the blob represents, drawn instead when no blob art exists (plain tile, no edge). */
  blobKind: Ground | null;
}

const N8: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Most common neighbour kind among `candidates` (ties go to the earlier candidate). */
function dominantNeighbour(map: MapData, x: number, y: number, self: Ground, candidates: readonly Ground[]): Ground | null {
  let best: Ground | null = null;
  let bestCount = 0;
  for (const c of candidates) {
    let n = 0;
    for (const [dx, dy] of N8) if (groundAt(map, x + dx, y + dy, self) === c) n++;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export function planTile(map: MapData, x: number, y: number): TilePlan {
  const self = groundAt(map, x, y, Ground.Void);
  const at = (dx: number, dy: number) => groundAt(map, x + dx, y + dy, self);

  if (self === Ground.Grass) {
    const under = dominantNeighbour(map, x, y, self, UNDER_GRASS);
    if (under !== null) {
      const pieces = blobPieces((dx, dy) => UNDER_GRASS.includes(at(dx, dy)));
      if (pieces) return { base: under, blob: { set: "grass", pieces }, blobKind: Ground.Grass };
    }
  } else if (self === Ground.Tilled) {
    const under = dominantNeighbour(map, x, y, self, [Ground.Grass, Ground.Dirt, Ground.Sand, Ground.Stone]);
    if (under !== null) {
      const pieces = blobPieces((dx, dy) => at(dx, dy) !== Ground.Tilled);
      if (pieces) return { base: under, blob: { set: "tilled", pieces }, blobKind: Ground.Tilled };
    }
  } else if (self === Ground.Water) {
    const isLand = (g: Ground) => !NO_BANK.includes(g);
    const pieces = blobPieces((dx, dy) => isLand(at(dx, dy)));
    if (pieces) {
      // Water's bank sheet comes in grass and dirt; everything that isn't grass reads as dirt/sand.
      let grass = 0;
      let land = 0;
      for (const [dx, dy] of N8) {
        const g = at(dx, dy);
        if (!isLand(g)) continue;
        land++;
        if (g === Ground.Grass) grass++;
      }
      const set: BlobSet = grass * 2 > land ? "water.grass" : "water.dirt";
      return { base: Ground.Water, blob: { set, pieces }, blobKind: null };
    }
  }
  return { base: self === Ground.Void ? null : self, blob: null, blobKind: null };
}

// ---------------------------------------------------------------- walls & shading

export interface Sides {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

export type WallShade =
  /** Walkable tile touching walls: soft contact shadow on those sides. */
  | { kind: "floor"; walls: Sides }
  /** Wall tile. `open` = sides facing a non-wall tile. top = not the visible face (south is wall too). */
  | { kind: "wall"; wall: Ground; open: Sides; top: boolean }
  | null;

export function wallShade(map: MapData, x: number, y: number): WallShade {
  const self = groundAt(map, x, y, Ground.Void);
  if (self === Ground.Void) return null;
  const at = (dx: number, dy: number) => groundAt(map, x + dx, y + dy, self);
  if (isWallKind(self)) {
    const open = (g: Ground) => !isWallKind(g) && g !== Ground.Void;
    const sides = { n: open(at(0, -1)), e: open(at(1, 0)), s: open(at(0, 1)), w: open(at(-1, 0)) };
    return { kind: "wall", wall: self, open: sides, top: !sides.s };
  }
  if (self === Ground.Water) return null;
  const walls = { n: isWallKind(at(0, -1)), e: isWallKind(at(1, 0)), s: isWallKind(at(0, 1)), w: isWallKind(at(-1, 0)) };
  return walls.n || walls.e || walls.s || walls.w ? { kind: "floor", walls } : null;
}

/** Sides of a water tile that touch land (for the procedural shoreline fallback). */
export function shoreSides(map: MapData, x: number, y: number): Sides & { nw: boolean; ne: boolean; sw: boolean; se: boolean } {
  const at = (dx: number, dy: number) => !NO_BANK.includes(groundAt(map, x + dx, y + dy, Ground.Water));
  return {
    n: at(0, -1), e: at(1, 0), s: at(0, 1), w: at(-1, 0),
    nw: at(-1, -1), ne: at(1, -1), sw: at(-1, 1), se: at(1, 1),
  };
}

// ---------------------------------------------------------------- chunk bands

export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Splits a chunk [x0, x1) x [y0, y1) into bands of consecutive rows that have something to draw,
 * each trimmed to the columns that do. Rows of open animated water drop out, so the cached ground
 * never paints a transparent quad over them (that overdraw costs real fill rate on big rivers).
 */
export function chunkBands(need: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number): TileRect[] {
  const out: TileRect[] = [];
  let band: TileRect | null = null;
  for (let y = y0; y < y1; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = x0; x < x1; x++) {
      if (!need(x, y)) continue;
      if (lo < 0) lo = x;
      hi = x + 1;
    }
    if (lo < 0) {
      band = null;
      continue;
    }
    if (band) {
      band.x0 = Math.min(band.x0, lo);
      band.x1 = Math.max(band.x1, hi);
      band.y1 = y + 1;
    } else {
      band = { x0: lo, y0: y, x1: hi, y1: y + 1 };
      out.push(band);
    }
  }
  return out;
}
