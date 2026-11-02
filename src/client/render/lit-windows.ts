// Lit house windows at night. The night tint multiplies everything in the world, so a window can
// only look lit if it is drawn above the tint, in the overlay. Anything standing in front of the
// building would then vanish behind the glowing panes; so each frame the sprites sorted in front
// of the building that reach its windows are drawn again over the panes, clipped to the window
// rects and tinted with the night tint, which is exactly how the screen tint draws them below.
import { Container, Graphics, Matrix, Sprite } from "pixi.js";
import { SCALE, TILE, type LitWindowsView, type SpriteArt } from "../contracts";

export interface LitWindows {
  /** k: how lit (0 = dark, 1 = fully lit); tint: the night tint the screen applies right now. */
  update(k: number, tint: number): void;
  destroy(): void;
}

/** How far around the windows (tiles) a sprite's feet may stand and still reach a pane. */
const REACH_X = 2;
const REACH_DOWN = 3;

interface Building {
  view: LitWindowsView;
  overlay: Sprite;
  /** Copies of what stands in front, clipped to the window rects. */
  front: Container;
  /** Window union bounds, world px. */
  x0: number;
  x1: number;
  y1: number;
}

function multiplyRgb(a: number, b: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function createLitWindows(sorted: Container, parent: Container, list: readonly { view: LitWindowsView; art: SpriteArt }[]): LitWindows {
  const root = new Container({ label: "fx-lit-windows" });
  root.eventMode = "none";
  parent.addChild(root);
  const pool: Sprite[] = [];
  const inv = new Matrix();
  const m = new Matrix();

  const buildings: Building[] = list.map(({ view, art }) => {
    const overlay = new Sprite(art.texture);
    overlay.anchor.set(art.anchor.x, art.anchor.y);
    overlay.scale.set(SCALE);
    overlay.position.set(view.x, view.y);
    const front = new Container();
    const clip = new Graphics();
    for (const r of view.windows) clip.rect(r.x, r.y, r.w, r.h);
    clip.fill(0xffffff);
    front.addChild(clip);
    front.mask = clip;
    root.addChild(overlay, front);
    return {
      view,
      overlay,
      front,
      x0: Math.min(...view.windows.map((r) => r.x)),
      x1: Math.max(...view.windows.map((r) => r.x + r.w)),
      y1: Math.max(...view.windows.map((r) => r.y + r.h)),
    };
  });

  let used = 0;
  /** Draws every visible sprite under `node` again in `into`, at the same place, tinted. */
  function copy(node: Container, into: Container, tint: number): void {
    if (!node.visible || !node.renderable) return;
    if (node instanceof Sprite) {
      let s = pool[used];
      if (!s) {
        s = new Sprite();
        pool.push(s);
      }
      used++;
      s.texture = node.texture;
      s.anchor.copyFrom(node.anchor);
      node.getGlobalTransform(m);
      s.setFromMatrix(inv.clone().append(m));
      s.alpha = node.getGlobalAlpha();
      s.tint = multiplyRgb(node.getGlobalTint(), tint);
      s.visible = true;
      into.addChild(s);
    }
    for (const c of node.children) copy(c, into, tint);
  }

  function occlude(b: Building, tint: number): void {
    b.front.getGlobalTransform(inv);
    inv.invert();
    const z = b.view.z;
    const near = sorted.children
      .filter((c) => c.zIndex > z && c.x > b.x0 - REACH_X * TILE && c.x < b.x1 + REACH_X * TILE && c.y < b.y1 + REACH_DOWN * TILE)
      .sort((a, c) => a.zIndex - c.zIndex);
    for (const c of near) copy(c, b.front, tint);
  }

  return {
    update(k, tint) {
      root.visible = k > 0 && buildings.length > 0;
      for (const s of pool) {
        s.visible = false;
        s.removeFromParent();
      }
      used = 0;
      if (!root.visible) return;
      for (const b of buildings) {
        b.overlay.alpha = k;
        occlude(b, tint);
      }
    },
    destroy() {
      // Copies share the world's textures: free only the sprites.
      for (const s of pool) s.destroy();
      pool.length = 0;
      root.destroy({ children: true });
    },
  };
}
