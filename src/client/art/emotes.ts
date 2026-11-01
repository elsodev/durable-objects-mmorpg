// Renders the code-drawn emote pixel maps to canvases (DOM picker) and Pixi textures (bubbles).
import { Texture } from "pixi.js";
import type { EmoteCode } from "../../shared/emotes";
import { EMOTE_PALETTE, EMOTE_PIXELS } from "./emote-pixels";

export function emoteCanvas(code: EmoteCode, scale = 2): HTMLCanvasElement {
  const rows = EMOTE_PIXELS[code];
  const c = document.createElement("canvas");
  c.width = 12 * scale;
  c.height = 12 * scale;
  const g = c.getContext("2d");
  if (!g) return c;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = EMOTE_PALETTE[row[x]!];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return c;
}

const urls = new Map<string, string>();
export function emoteDataUrl(code: EmoteCode, scale = 3): string {
  const k = `${code}@${scale}`;
  let u = urls.get(k);
  if (!u) {
    u = emoteCanvas(code, scale).toDataURL("image/png");
    urls.set(k, u);
  }
  return u;
}

const textures = new Map<EmoteCode, Texture>();
/** Drawn at 2x and scaled with nearest filtering, so pixels stay crisp at any zoom. */
export function emoteTexture(code: EmoteCode): Texture {
  let t = textures.get(code);
  if (!t) {
    t = Texture.from(emoteCanvas(code, 2));
    t.source.scaleMode = "nearest";
    textures.set(code, t);
  }
  return t;
}
