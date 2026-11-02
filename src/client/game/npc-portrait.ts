// Head-and-shoulders of a villager for the conversation window: their idle frame facing you,
// copied from the sprite sheet with a 2D canvas (no GPU readback). Null for generated art.
import type { Texture } from "pixi.js";
import type { Art } from "../contracts";

const SIZE = 64;
/** LPC-style frames have the head in the upper middle: keep that part. */
const CROP = { x: 0.2, y: 0.08, w: 0.6, h: 0.6 } as const;

function drawable(res: unknown): res is CanvasImageSource {
  return (
    (typeof ImageBitmap !== "undefined" && res instanceof ImageBitmap) ||
    (typeof HTMLImageElement !== "undefined" && res instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== "undefined" && res instanceof HTMLCanvasElement)
  );
}

export function textureHead(tex: Texture | undefined): HTMLCanvasElement | null {
  const res = tex?.source?.resource as unknown;
  if (!tex || tex.rotate || !drawable(res)) return null;
  const f = tex.frame;
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(res, f.x + f.width * CROP.x, f.y + f.height * CROP.y, f.width * CROP.w, f.height * CROP.h, 0, 0, SIZE, SIZE);
  return c;
}

export function npcPortrait(art: Pick<Art, "character">, sprite: string | undefined): HTMLCanvasElement | null {
  if (!sprite) return null;
  try {
    return textureHead(art.character(sprite).idle.down);
  } catch {
    return null;
  }
}
