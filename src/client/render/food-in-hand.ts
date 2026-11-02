// The food drawn in the hand during an eat act: the item's own icon at screen scale 1 (half the
// character's pixel size), with a bite taken out of it for each bite and nothing of its drop
// shadow. One Sprite per entity rides the body (entities.ts); textures are cut once per item,
// bite count and side, then shared. Geometry and timing are in eat-logic.ts.
import { Rectangle, Sprite, Texture } from "pixi.js";
import type { Art } from "../contracts";
import type { EntityState, ItemId } from "../../shared/types";
import { getItem } from "../../shared/items";
import { biteMask, carryPose, foodPose, mouthSide, type Box, type Tip } from "./eat-logic";

/** Shadows and glows under icons are fainter than this; they'd float under a hand. */
const SOLID_ALPHA = 128;

export interface FoodHand {
  /**
   * Shows the food on `sprite` for an eat act `ageMs` old (null: not eating) and lines it up
   * with `body` (same anchor point, scale and alpha). Returns true while it's drawn.
   */
  draw(sprite: Sprite, body: Sprite, s: EntityState, ageMs: number | null): boolean;
  /** Shows selected food (`item`) carried at the side, lined up with `body`. False when hidden. */
  carry(sprite: Sprite, body: Sprite, s: EntityState, item: ItemId | null): boolean;
  destroy(): void;
}

export function isDrink(item: ItemId | undefined): boolean {
  return !!item && getItem(item)?.food === "drink";
}

/** Food you hold and bite (bread, pie, a tomato); meals come in a bowl or on a plate, drinks in a cup. */
export function isBiteable(item: ItemId | undefined): boolean {
  const def = item ? getItem(item) : undefined;
  return !!def?.eat && def.food !== "meal" && def.food !== "drink";
}

/** How a held dish tips toward the mouth: a cup a lot, a bowl or plate a little, a snack not at all. */
export function tipOf(item: ItemId | undefined): Tip {
  const food = item ? getItem(item)?.food : undefined;
  return food === "drink" ? "cup" : food === "meal" ? "dish" : "none";
}

export function createFoodHand(art: Art): FoodHand {
  const cache = new Map<string, Texture | null>();

  function icon(item: ItemId): Texture | null {
    try {
      return art.icon(item);
    } catch {
      return null;
    }
  }

  /** The icon with faint pixels dropped and `bites` bites cut out; null without canvas or art. */
  function cut(item: ItemId, bites: number, side: 1 | -1): Texture | null {
    const key = `${item}:${bites}:${side}`;
    if (cache.has(key)) return cache.get(key)!;
    let out: Texture | null = null;
    const tex = icon(item);
    const res = tex?.source.resource as CanvasImageSource | undefined;
    if (tex && res && typeof document !== "undefined" && !tex.rotate) {
      const { x, y, width: w, height: h } = tex.frame;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(res, x, y, w, h, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const px = img.data;
        const box: Box = { x0: w, y0: h, x1: -1, y1: -1 };
        for (let i = 0; i < w * h; i++) {
          if (px[i * 4 + 3]! < SOLID_ALPHA) {
            px[i * 4 + 3] = 0;
            continue;
          }
          const cx = i % w;
          const cy = Math.floor(i / w);
          box.x0 = Math.min(box.x0, cx);
          box.y0 = Math.min(box.y0, cy);
          box.x1 = Math.max(box.x1, cx);
          box.y1 = Math.max(box.y1, cy);
        }
        if (box.x1 >= 0) {
          const mask = biteMask(w, h, box, bites, side);
          for (let i = 0; i < w * h; i++) {
            if (mask[i]) {
              px[i * 4 + 3] = 0;
              continue;
            }
            // The bitten edge gets a darker rim, like the icon's own outline.
            const cx = i % w;
            const edge = (cx > 0 && mask[i - 1]) || (cx < w - 1 && mask[i + 1]) || (i >= w && mask[i - w]) || (i + w < w * h && mask[i + w]);
            if (edge && px[i * 4 + 3]) for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(px[i * 4 + c]! * 0.55);
          }
          ctx.putImageData(img, 0, 0);
          // Upload from a plain canvas: the willReadFrequently one is CPU-backed, and a software
          // WebGPU backend showed it with red and blue swapped.
          const plain = document.createElement("canvas");
          plain.width = w;
          plain.height = h;
          plain.getContext("2d")?.drawImage(canvas, 0, 0);
          const source = Texture.from(plain).source;
          source.scaleMode = "nearest";
          out = new Texture({ source, frame: new Rectangle(0, 0, w, h) });
        }
      }
    }
    // Without a canvas (tests) fall back to the plain icon, unbitten.
    out ??= tex;
    cache.set(key, out);
    return out;
  }

  return {
    draw(sprite, body, s, ageMs) {
      const item = s.act?.k === "eat" ? s.act.item : undefined;
      const pose = item && ageMs !== null ? foodPose(s.facing, ageMs, tipOf(item)) : null;
      const tex = pose?.visible ? cut(item!, isBiteable(item) ? pose.bites : 0, mouthSide(s.facing)) : null;
      if (!pose || !tex) {
        sprite.visible = false;
        return false;
      }
      if (sprite.texture !== tex) sprite.texture = tex;
      sprite.anchor.set(0.5);
      // The body sprite is anchored on the feet point; the grip is in source px at its scale.
      sprite.position.set(body.position.x + pose.dx * Math.abs(body.scale.x), body.position.y + pose.dy * Math.abs(body.scale.y));
      sprite.rotation = pose.tilt;
      sprite.scale.set(1);
      sprite.alpha = body.alpha;
      sprite.visible = true;
      return true;
    },
    carry(sprite, body, s, item) {
      const pose = item ? carryPose(s.facing) : null;
      const tex = pose?.visible ? cut(item!, 0, mouthSide(s.facing)) : null;
      if (!pose || !tex) {
        sprite.visible = false;
        return false;
      }
      if (sprite.texture !== tex) sprite.texture = tex;
      sprite.anchor.set(0.5);
      sprite.position.set(body.position.x + pose.dx * Math.abs(body.scale.x), body.position.y + pose.dy * Math.abs(body.scale.y));
      sprite.rotation = 0;
      sprite.scale.set(1);
      sprite.alpha = body.alpha;
      sprite.visible = true;
      return true;
    },
    destroy() {
      for (const t of new Set(cache.values())) {
        // Only the cut copies are ours; plain icons belong to the art pack.
        if (t && typeof HTMLCanvasElement !== "undefined" && t.source.resource instanceof HTMLCanvasElement) t.destroy(true);
      }
      cache.clear();
    },
  };
}
