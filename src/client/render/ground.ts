// Terrain renderer: one sprite per tile (plus transition quadrants and wall shading), grouped
// into 16x16-tile chunks that are cached as textures, so the whole map costs ~20 quads per frame.
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { Ground, type MapData } from "../../shared/types";
import { TILE, type Art, type CreateGroundLayer } from "../contracts";
import {
  QUADRANTS,
  planTile,
  shoreSides,
  wallShade,
  type BlobPiece,
  type BlobSet,
  type Quadrant,
} from "./ground-autotile";

export type { BlobSet } from "./ground-autotile";

/** LPC blob sheet slices: a 3x3 patch block and a 2x2 inner-corner (hole) block, square tiles. */
export interface GroundBlob {
  outer3x3: Texture;
  inner2x2: Texture;
}

/**
 * Optional Art extension (not in the Art contract). When the art module implements it, the
 * ground layer draws LPC autotile transitions; otherwise it draws plain tiles plus procedural
 * shorelines. See BlobSet in ground-autotile.ts for which catalog rects each set maps to.
 */
export interface GroundEdgeArt {
  groundBlob?(set: BlobSet): GroundBlob | null;
}

export const CHUNK_TILES = 16;

const SHORE_SAND = 0xd8c08a;
const SHORE_FOAM = 0xeaf4f0;
const CAVE_SHADOW = 0x120c18;
const WALL_SHADOW = 0x1c1410;

class BlobTextures {
  private blobs = new Map<BlobSet, GroundBlob | null>();
  private quads = new Map<string, Texture | null>();
  constructor(private art: Art & GroundEdgeArt) {}

  /** The quadrant of a blob piece as its own texture, or null when the art has no such sheet. */
  quad(set: BlobSet, piece: BlobPiece, q: Quadrant): Texture | null {
    const key = `${set}|${piece.block}|${piece.col}|${piece.row}|${q}`;
    const cached = this.quads.get(key);
    if (cached !== undefined) return cached;
    const blob = this.blob(set);
    let tex: Texture | null = null;
    if (blob) {
      const sheet = piece.block === "outer" ? blob.outer3x3 : blob.inner2x2;
      const tile = sheet.frame.width / (piece.block === "outer" ? 3 : 2);
      const half = tile / 2;
      const frame = new Rectangle(
        sheet.frame.x + piece.col * tile + (q & 1 ? half : 0),
        sheet.frame.y + piece.row * tile + (q & 2 ? half : 0),
        half,
        half,
      );
      tex = new Texture({ source: sheet.source, frame });
    }
    this.quads.set(key, tex);
    return tex;
  }

  /** One quadrant of any tile texture (cached per texture). */
  quadOf(tex: Texture, q: Quadrant): Texture {
    const key = `uid${tex.uid}|${q}`;
    let t = this.quads.get(key);
    if (!t) {
      const half = tex.frame.width / 2;
      const frame = new Rectangle(tex.frame.x + (q & 1 ? half : 0), tex.frame.y + (q & 2 ? half : 0), half, tex.frame.height / 2);
      t = new Texture({ source: tex.source, frame });
      this.quads.set(key, t);
    }
    return t;
  }

  has(set: BlobSet): boolean {
    return this.blob(set) !== null;
  }

  private blob(set: BlobSet): GroundBlob | null {
    let b = this.blobs.get(set);
    if (b === undefined) {
      try {
        b = this.art.groundBlob?.(set) ?? null;
      } catch {
        b = null;
      }
      this.blobs.set(set, b);
    }
    return b;
  }

  destroy(): void {
    // Sub-textures share the art's sources; free only our frames.
    for (const t of this.quads.values()) t?.destroy(false);
    this.quads.clear();
    this.blobs.clear();
  }
}

function tileSprite(tex: Texture, px: number, py: number, size: number): Sprite {
  const s = new Sprite(tex);
  s.position.set(px, py);
  s.width = size;
  s.height = size;
  return s;
}

/** Banded rect: darkest next to `edge`, fading inward. */
function shadowBands(
  g: Graphics,
  px: number,
  py: number,
  side: "n" | "e" | "s" | "w",
  depth: number,
  alpha: number,
  color: number,
): void {
  const bands = 3;
  const step = Math.max(1, Math.round((TILE * depth) / bands));
  for (let i = 0; i < bands; i++) {
    const a = alpha * (1 - i / bands);
    const o = i * step;
    if (side === "n") g.rect(px, py + o, TILE, step);
    else if (side === "s") g.rect(px, py + TILE - o - step, TILE, step);
    else if (side === "w") g.rect(px + o, py, step, TILE);
    else g.rect(px + TILE - o - step, py, step, TILE);
    g.fill({ color, alpha: a });
  }
}

function drawWallShade(g: Graphics, map: MapData, x: number, y: number, px: number, py: number): void {
  const shade = wallShade(map, x, y);
  if (!shade) return;
  if (shade.kind === "floor") {
    const color = map.ambient === "cave" ? CAVE_SHADOW : WALL_SHADOW;
    if (shade.walls.n) shadowBands(g, px, py, "n", 0.36, 0.42, color);
    if (shade.walls.w) shadowBands(g, px, py, "w", 0.2, 0.3, color);
    if (shade.walls.e) shadowBands(g, px, py, "e", 0.2, 0.3, color);
    if (shade.walls.s) shadowBands(g, px, py, "s", 0.12, 0.18, color);
    return;
  }
  const rim = Math.max(2, Math.round(TILE / 16));
  const cave = shade.wall === Ground.CaveWall;
  if (shade.top) {
    // Wall top (the face is further south): darker flat cap with a light rim where it meets open floor.
    g.rect(px, py, TILE, TILE).fill({ color: cave ? 0x000000 : 0x2a2024, alpha: cave ? 0.38 : 0.45 });
    if (shade.open.n) g.rect(px, py, TILE, rim).fill({ color: 0xffffff, alpha: 0.16 });
    if (shade.open.w) g.rect(px, py, rim, TILE).fill({ color: 0xffffff, alpha: 0.12 });
    if (shade.open.e) g.rect(px + TILE - rim, py, rim, TILE).fill({ color: 0xffffff, alpha: 0.12 });
  } else {
    // Visible face: light lip at the top, darker foot where it meets the ground.
    if (shade.open.n) g.rect(px, py, TILE, rim).fill({ color: 0xffffff, alpha: 0.16 });
    shadowBands(g, px, py, "s", 0.18, 0.35, 0x000000);
    if (shade.open.w) g.rect(px, py, rim, TILE).fill({ color: 0x000000, alpha: 0.2 });
    if (shade.open.e) g.rect(px + TILE - rim, py, rim, TILE).fill({ color: 0x000000, alpha: 0.2 });
  }
}

/** Procedural shoreline for water tiles when the art has no bank sheets. */
function drawShore(g: Graphics, map: MapData, x: number, y: number, px: number, py: number): void {
  const s = shoreSides(map, x, y);
  const band = Math.round(TILE * 0.2);
  const foam = Math.max(2, Math.round(TILE / 16));
  const sand = (rx: number, ry: number, w: number, h: number) => g.rect(rx, ry, w, h).fill({ color: SHORE_SAND });
  const froth = (rx: number, ry: number, w: number, h: number) => g.rect(rx, ry, w, h).fill({ color: SHORE_FOAM, alpha: 0.7 });
  if (s.n) {
    sand(px, py, TILE, band);
    froth(px, py + band, TILE, foam);
  }
  if (s.s) {
    sand(px, py + TILE - band, TILE, band);
    froth(px, py + TILE - band - foam, TILE, foam);
  }
  if (s.w) {
    sand(px, py, band, TILE);
    froth(px + band, py, foam, TILE);
  }
  if (s.e) {
    sand(px + TILE - band, py, band, TILE);
    froth(px + TILE - band - foam, py, foam, TILE);
  }
  if (s.nw && !s.n && !s.w) sand(px, py, band, band);
  if (s.ne && !s.n && !s.e) sand(px + TILE - band, py, band, band);
  if (s.sw && !s.s && !s.w) sand(px, py + TILE - band, band, band);
  if (s.se && !s.s && !s.e) sand(px + TILE - band, py + TILE - band, band, band);
}

/**
 * Interior rooms: the room's floor art on floor tiles, and the wall tops seen from above on the
 * side and south walls (the north wall is drawn by its wall-piece props). Null: use the terrain.
 */
function interiorTile(art: Art, map: MapData, x: number, y: number, base: Ground): Texture | null {
  const room = map.interior;
  if (!room || map.ambient !== "indoor") return null;
  if (base === Ground.Wall) {
    if (y < 3) return null;
    const last = map.width - 1;
    const bottom = y === map.height - 1;
    const piece = bottom ? (x === 0 ? "corner_sw" : x === last ? "corner_se" : "wall_s_cap") : x === 0 ? "wall_w" : x === last ? "wall_e" : null;
    return piece ? art.wallBorder?.(room.wall, piece) ?? null : null;
  }
  return room.floor ? art.floor?.(room.floor, x, y) ?? null : null;
}

function buildChunk(art: Art, blobs: BlobTextures, map: MapData, cx: number, cy: number): Container | null {
  const x0 = cx * CHUNK_TILES;
  const y0 = cy * CHUNK_TILES;
  const x1 = Math.min(map.width, x0 + CHUNK_TILES);
  const y1 = Math.min(map.height, y0 + CHUNK_TILES);
  const chunk = new Container();
  chunk.position.set(x0 * TILE, y0 * TILE);
  const tiles = new Container();
  const shade = new Graphics();
  const half = TILE / 2;
  let any = false;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const plan = planTile(map, x, y);
      if (plan.base === null) continue;
      any = true;
      const px = (x - x0) * TILE;
      const py = (y - y0) * TILE;
      const blob = plan.blob && blobs.has(plan.blob.set) ? plan.blob : null;
      // Without blob art, a blended tile is drawn as its own kind with a hard edge.
      const base = plan.blob && !blob && plan.blobKind !== null ? plan.blobKind : plan.base;
      const indoorTex = interiorTile(art, map, x, y, base);
      tiles.addChild(tileSprite(indoorTex ?? art.ground(base, x, y), px, py, TILE));

      if (blob) {
        for (const q of QUADRANTS) {
          const piece = blob.pieces[q];
          // Fully-inside quadrants of an overlay terrain (grass, tilled) still need that terrain
          // over the base; use the regular tile so variants match the neighbouring plain tiles.
          const tex = piece
            ? blobs.quad(blob.set, piece, q)
            : plan.blobKind !== null
              ? blobs.quadOf(art.ground(plan.blobKind, x, y), q)
              : null;
          if (tex) tiles.addChild(tileSprite(tex, px + (q & 1 ? half : 0), py + (q & 2 ? half : 0), half));
        }
      } else if (plan.base === Ground.Water && plan.blob) {
        drawShore(shade, map, x, y, px, py);
      }
      drawWallShade(shade, map, x, y, px, py);
    }
  }
  if (!any) {
    chunk.destroy({ children: true });
    tiles.destroy();
    shade.destroy();
    return null;
  }
  chunk.addChild(tiles, shade);
  chunk.cullable = true;
  chunk.cullArea = new Rectangle(0, 0, (x1 - x0) * TILE, (y1 - y0) * TILE);
  chunk.cacheAsTexture({ scaleMode: "nearest", antialias: false });
  return chunk;
}

export const createGroundLayer: CreateGroundLayer = (art, map, layers) => {
  const blobs = new BlobTextures(art as Art & GroundEdgeArt);
  const root = new Container();
  root.label = "ground";
  if (map.ambient === "indoor") {
    // Rooms are smaller than the screen: the camera centres them on darkness, not on the
    // outdoor background colour.
    const pad = 40 * TILE;
    root.addChild(new Graphics().rect(-pad, -pad, map.width * TILE + 2 * pad, map.height * TILE + 2 * pad).fill({ color: 0x15121b }));
  }
  const cols = Math.ceil(map.width / CHUNK_TILES);
  const rows = Math.ceil(map.height / CHUNK_TILES);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const chunk = buildChunk(art, blobs, map, cx, cy);
      if (chunk) root.addChild(chunk);
    }
  }
  layers.ground.addChild(root);

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (!root.destroyed) {
        for (const c of root.children) c.cacheAsTexture(false);
        root.removeFromParent();
        root.destroy({ children: true });
      }
      blobs.destroy();
    },
  };
};
