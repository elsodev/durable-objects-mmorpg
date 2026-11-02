// House edit mode, drawn: a soft outline on the piece under the pointer, a gold outline on the
// selection, the drag box, and the dragged (or new) pieces as tinted ghosts with their footprint
// tiles in green (fits) or red (blocked). Drawn in the overlay layer, above the room's lighting.
import { Container, Graphics, Sprite } from "pixi.js";
import type { Art, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import { footprint, type Rect } from "../../shared/engine";
import type { ItemId, MapData } from "../../shared/types";
import { wallLift } from "./farm";

export interface EditGhost {
  item: ItemId;
  x: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
  ok: boolean;
}

export interface EditScene {
  /** Art box of the piece under the pointer (tiles). */
  hover: Rect | null;
  /** Art boxes and footprints of the selected pieces (tiles). */
  selected: { art: Rect; foot: Rect }[];
  ghosts: EditGhost[];
  /** Drag box (tiles). */
  box: Rect | null;
}

export interface EditView {
  draw(scene: EditScene, map: MapData | null): void;
  destroy(): void;
}

const OK = 0x5ad17a;
const BAD = 0xe2524a;
const OK_TINT = 0xb4f5c4;
const BAD_TINT = 0xff9a90;
const HOVER = 0xfff6d8;
const SELECT = 0xf2c14e;
const BOX = 0x8ec5ff;

const px = (r: Rect) => ({ x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE });

export function createEditView(art: Art, layers: Layers): EditView {
  const root = new Container();
  root.label = "editmode";
  const under = new Graphics();
  const ghosts = new Container();
  const over = new Graphics();
  root.addChild(under, ghosts, over);
  layers.overlay.addChild(root);
  const pool: Sprite[] = [];

  function ghostSprite(i: number): Sprite {
    let s = pool[i];
    if (!s) {
      s = new Sprite();
      s.scale.set(SCALE);
      s.alpha = 0.8;
      pool[i] = s;
      ghosts.addChild(s);
    }
    s.visible = true;
    return s;
  }

  return {
    draw(scene, map) {
      under.clear();
      over.clear();
      for (const sel of scene.selected) {
        const f = px(sel.foot);
        under.rect(f.x + 2, f.y + 2, f.w - 4, f.h - 4).fill({ color: SELECT, alpha: 0.18 });
        const a = px(sel.art);
        over.roundRect(a.x - 3, a.y - 3, a.w + 6, a.h + 6, 6).stroke({ color: 0x3b2a14, alpha: 0.55, width: 5 });
        over.roundRect(a.x - 3, a.y - 3, a.w + 6, a.h + 6, 6).stroke({ color: SELECT, alpha: 1, width: 2.5 });
      }
      if (scene.hover) {
        const a = px(scene.hover);
        over.roundRect(a.x - 2, a.y - 2, a.w + 4, a.h + 4, 6).stroke({ color: HOVER, alpha: 0.85, width: 2 });
      }
      scene.ghosts.forEach((g, i) => {
        const fp = footprint(g.item, g.rotation);
        const color = g.ok ? OK : BAD;
        for (let ty = 0; ty < fp.h; ty++) {
          for (let tx = 0; tx < fp.w; tx++) {
            under
              .rect((g.x + tx) * TILE + 1, (g.y + ty) * TILE + 1, TILE - 2, TILE - 2)
              .fill({ color, alpha: 0.28 })
              .stroke({ color, alpha: 0.9, width: 2 });
          }
        }
        const look = art.furniture(g.item, g.rotation);
        const s = ghostSprite(i);
        s.texture = look.texture;
        s.anchor.set(look.anchor.x, look.anchor.y);
        const lift = wallLift({ id: "", item: g.item, x: g.x, y: g.y, rotation: g.rotation }, map) * SCALE;
        s.position.set((g.x + fp.w / 2) * TILE, (g.y + fp.h) * TILE - lift);
        s.tint = g.ok ? OK_TINT : BAD_TINT;
      });
      for (let i = scene.ghosts.length; i < pool.length; i++) pool[i]!.visible = false;
      if (scene.box) {
        const b = px(scene.box);
        over.rect(b.x, b.y, b.w, b.h).fill({ color: BOX, alpha: 0.14 }).stroke({ color: BOX, alpha: 0.95, width: 2 });
      }
    },
    destroy() {
      root.destroy({ children: true });
    },
  };
}
