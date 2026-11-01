// Procedural pixel-art fallbacks for any art key the LPC catalog does not cover.
// Drawing happens on pure PixelGrids (art/draw/*); this file only turns grids into Pixi textures
// (Graphics -> renderer.generateTexture, nearest filtering) and caches them per key.
// Ground: Tilled variants 4..7 are the watered (darker) look; other kinds use variant % 4.
import { Graphics, Rectangle, Texture, type Application } from "pixi.js";
import { Ground, type Facing, type ItemId } from "../../shared/types";
import type { CharacterArt, MakePlaceholders, SpriteArt } from "../contracts";
import type { CropLook } from "../../shared/engine";
import { ATTACK_FRAMES, drawCharacter, FACINGS, WALK_FRAMES } from "./draw/characters";
import { drawCrop, drawRock, type Ore, type Stage } from "./draw/farm";
import { drawFurniture, type Rotation } from "./draw/furniture";
import { PixelGrid } from "./draw/grid";
import { drawGround, GROUND_VARIANTS } from "./draw/ground";
import { drawIcon } from "./draw/icons";
import { drawProp } from "./draw/props";

/** Add to a Tilled variant (0..3) to get the watered look. */
export const WET_TILLED_OFFSET = GROUND_VARIANTS;

/** Grid -> Graphics of merged same-colour rectangles. */
function toGraphics(grid: PixelGrid): Graphics {
  const g = new Graphics();
  for (const r of grid.runs()) g.rect(r.x, r.y, r.w, r.h).fill({ color: r.color, alpha: r.alpha });
  return g;
}

export const makePlaceholders: MakePlaceholders = (app: Application) => {
  const textures = new Map<string, Texture>();
  const sprites = new Map<string, SpriteArt>();
  const characters = new Map<string, CharacterArt>();

  const bake = (grid: PixelGrid): Texture => {
    const g = toGraphics(grid);
    const tex = app.renderer.generateTexture({
      target: g,
      frame: new Rectangle(0, 0, grid.w, grid.h),
      resolution: 1,
      antialias: false,
      textureSourceOptions: { scaleMode: "nearest" },
    });
    g.destroy();
    tex.source.scaleMode = "nearest";
    return tex;
  };

  const texture = (key: string, draw: () => PixelGrid): Texture => {
    let t = textures.get(key);
    if (!t) {
      t = bake(draw());
      textures.set(key, t);
    }
    return t;
  };

  const sprite = (key: string, draw: () => PixelGrid, anchor = { x: 0.5, y: 1 }): SpriteArt => {
    let s = sprites.get(key);
    if (!s) {
      s = { texture: texture(key, draw), anchor };
      sprites.set(key, s);
    }
    return s;
  };

  return {
    ground(kind: Ground, variant: number): Texture {
      const v = Number.isFinite(variant) ? Math.abs(Math.floor(variant)) % (GROUND_VARIANTS * 2) : 0;
      const norm = kind === Ground.Tilled ? v : v % GROUND_VARIANTS; // only Tilled has wet variants
      return texture(`ground:${kind}:${norm}`, () => drawGround(kind, norm));
    },

    prop(type: string): SpriteArt {
      const key = `prop:${type}`;
      const cached = sprites.get(key);
      if (cached) return cached;
      const d = drawProp(type);
      return sprite(key, () => d.grid, d.anchor);
    },

    character(key: string): CharacterArt {
      const cached = characters.get(key);
      if (cached) return cached;
      const frames = drawCharacter(key);
      const size = frames.size;
      // One sheet per character: rows = facings, cols = walk | idle | attack.
      const cols = WALK_FRAMES + 1 + (frames.attack ? ATTACK_FRAMES : 0);
      const sheetGrid = new PixelGrid(size * cols, size * FACINGS.length);
      FACINGS.forEach((f, row) => {
        frames.walk[f].forEach((fr, i) => sheetGrid.blit(fr, i * size, row * size));
        sheetGrid.blit(frames.idle[f], WALK_FRAMES * size, row * size);
        frames.attack?.[f].forEach((fr, i) => sheetGrid.blit(fr, (WALK_FRAMES + 1 + i) * size, row * size));
      });
      const sheet = bake(sheetGrid);
      const sub = (col: number, row: number) =>
        new Texture({ source: sheet.source, frame: new Rectangle(col * size, row * size, size, size) });
      const walk = {} as Record<Facing, Texture[]>;
      const idle = {} as Record<Facing, Texture>;
      const attack = {} as Record<Facing, Texture[]>;
      FACINGS.forEach((f, row) => {
        walk[f] = Array.from({ length: WALK_FRAMES }, (_, i) => sub(i, row));
        idle[f] = sub(WALK_FRAMES, row);
        if (frames.attack) attack[f] = Array.from({ length: ATTACK_FRAMES }, (_, i) => sub(WALK_FRAMES + 1 + i, row));
      });
      const art: CharacterArt = {
        walk,
        idle,
        ...(frames.attack ? { attack } : {}),
        anchor: { x: frames.feet.x / size, y: frames.feet.y / size },
      };
      characters.set(key, art);
      return art;
    },

    crop(crop: ItemId, stage: 0 | 1 | 2 | 3, look: CropLook = "normal"): SpriteArt {
      const s = Math.max(0, Math.min(3, Math.floor(stage))) as Stage;
      return sprite(`crop:${crop}:${s}:${look}`, () => drawCrop(crop, s, look));
    },

    rock(ore: Ore): SpriteArt {
      return sprite(`rock:${ore}`, () => drawRock(ore));
    },

    furniture(item: ItemId, rotation: 0 | 1 | 2 | 3): SpriteArt {
      const r = ((Math.floor(rotation) % 4) + 4) % 4 as Rotation;
      return sprite(`furniture:${item}:${r}`, () => drawFurniture(item, r));
    },

    icon(item: ItemId): Texture {
      return texture(`icon:${item}`, () => drawIcon(item));
    },
  };
};

const iconUrls = new Map<string, string>();

/**
 * Placeholder icon as a PNG data URL for DOM UI, drawn on a 2D canvas (no GPU readback).
 * `scale` enlarges pixels crisply. Returns "" where no DOM canvas exists.
 */
export function placeholderIconUrl(item: ItemId, scale = 2): string {
  const key = `${item}@${scale}`;
  const hit = iconUrls.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return "";
  const grid = drawIcon(item);
  const canvas = document.createElement("canvas");
  canvas.width = grid.w * scale;
  canvas.height = grid.h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  for (const r of grid.runs()) {
    ctx.globalAlpha = r.alpha;
    ctx.fillStyle = `#${r.color.toString(16).padStart(6, "0")}`;
    ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
  }
  const url = canvas.toDataURL("image/png");
  iconUrls.set(key, url);
  return url;
}
