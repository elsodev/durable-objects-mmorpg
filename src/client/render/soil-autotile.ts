// Pure planning for tilled soil (no Pixi, unit-tested). Each tilled tile reads which of its
// eight neighbours are tilled too, so a row of hoed tiles reads as one patch with a soft
// fringe only on its outside. Watered tiles get a second, darker patch planned the same way
// over the watered neighbours only, so wet and dry soil meet with a soft edge.
import { blobPieces, QUADRANTS, type BlobPiece, type Quadrant } from "./ground-autotile";

/** Neighbour bits: cardinals first (N, E, S, W), then diagonals (NE, SE, SW, NW). */
export const SOIL_N = 1;
export const SOIL_E = 2;
export const SOIL_S = 4;
export const SOIL_W = 8;
export const SOIL_NE = 16;
export const SOIL_SE = 32;
export const SOIL_SW = 64;
export const SOIL_NW = 128;

const NEIGHBOURS: readonly [number, number, number][] = [
  [0, -1, SOIL_N],
  [1, 0, SOIL_E],
  [0, 1, SOIL_S],
  [-1, 0, SOIL_W],
  [1, -1, SOIL_NE],
  [1, 1, SOIL_SE],
  [-1, 1, SOIL_SW],
  [-1, -1, SOIL_NW],
];

export type TileTest = (x: number, y: number) => boolean;

/** 8-bit mask of the neighbours of (x, y) for which `has` is true. */
export function soilMask(has: TileTest, x: number, y: number): number {
  let m = 0;
  for (const [dx, dy, bit] of NEIGHBOURS) if (has(x + dx, y + dy)) m |= bit;
  return m;
}

/** True when the neighbour at (dx, dy) is set in `mask`. */
export function maskHas(mask: number, dx: number, dy: number): boolean {
  for (const [nx, ny, bit] of NEIGHBOURS) if (nx === dx && ny === dy) return (mask & bit) !== 0;
  return false;
}

/** Blob pieces per quadrant (NW, NE, SW, SE); null = that quadrant is fully inside the patch. */
export function soilPieces(mask: number): (BlobPiece | null)[] {
  return blobPieces((dx, dy) => !maskHas(mask, dx, dy)) ?? QUADRANTS.map(() => null);
}

export interface SoilPlan {
  /** Tilled neighbours. */
  mask: number;
  dry: (BlobPiece | null)[];
  /** Watered neighbours, or null when this tile is dry. */
  wetMask: number | null;
  wet: (BlobPiece | null)[] | null;
}

export function planSoil(tilled: TileTest, watered: TileTest, x: number, y: number): SoilPlan {
  const mask = soilMask(tilled, x, y);
  const wet = watered(x, y);
  const wetMask = wet ? soilMask(watered, x, y) : null;
  return { mask, dry: soilPieces(mask), wetMask, wet: wetMask === null ? null : soilPieces(wetMask) };
}

/**
 * LPC blob sheets draw the patch inset by about a third of the edge tile, which would leave a
 * hoed tile mostly grass (a lone tile only a dot). Edge quadrants therefore sample their piece
 * this far (fraction of a tile) toward the patch centre, so the fringe sits on the tile's border
 * and the soil covers the tile. Stays inside the piece's own 3x3 block.
 */
export const SOIL_FRINGE_SHIFT = 0.25;

/** Source shift for one quadrant's piece (tile fractions); zero for inner corners and the plain tile. */
export function soilShift(piece: BlobPiece | null, q: Quadrant): { x: number; y: number } {
  if (!piece || piece.block !== "outer") return { x: 0, y: 0 };
  const east = (q & 1) !== 0;
  const south = (q & 2) !== 0;
  // Column 0/2 = west/east edge outside; row 0/2 = north/south edge outside.
  const x = piece.col === 0 && !east ? SOIL_FRINGE_SHIFT : piece.col === 2 && east ? -SOIL_FRINGE_SHIFT : 0;
  const y = piece.row === 0 && !south ? SOIL_FRINGE_SHIFT : piece.row === 2 && south ? -SOIL_FRINGE_SHIFT : 0;
  return { x, y };
}

/** Equal signatures draw identical soil. */
export function soilSig(plan: SoilPlan): string {
  return `${plan.mask}|${plan.wetMask ?? "-"}`;
}
