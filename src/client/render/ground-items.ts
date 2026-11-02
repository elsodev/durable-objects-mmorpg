// Items lying on the ground: your own loot that didn't fit the bag, and forage to pick. Icons
// y-sorted with everything else, bobbing gently; forage glints so it can be spotted.
import { Container, Graphics, Sprite, Ticker } from "pixi.js";
import type { Art, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import type { GroundItemView } from "../../shared/protocol";
import type { Vec2 } from "../../shared/types";

interface View {
  item: GroundItemView;
  root: Container;
  icon: Sprite;
  glint: Graphics | null;
  phase: number;
}

export interface GroundItemsLayer {
  /** Replaces everything shown (welcome). */
  set(items: readonly GroundItemView[]): void;
  update(upd: readonly GroundItemView[], del: readonly string[]): void;
  /** Forage on (or right next to) a tile, for click-to-pick. */
  forageAt(tile: Vec2): GroundItemView | null;
  /** Nearest forage within `reach` of a point. */
  nearestForage(p: Vec2, reach: number): GroundItemView | null;
  list(): GroundItemView[];
  destroy(): void;
}

export function createGroundItems(art: Art, layers: Layers): GroundItemsLayer {
  const views = new Map<string, View>();
  let clock = 0;

  const make = (g: GroundItemView): View => {
    const root = new Container();
    const shadow = new Graphics().ellipse(0, 0, 5 * SCALE, 2 * SCALE).fill({ color: 0x1b1424, alpha: 0.2 });
    const icon = new Sprite(art.icon(g.item));
    icon.anchor.set(0.5, 1);
    icon.scale.set(SCALE * 0.6);
    root.addChild(shadow, icon);
    let glint: Graphics | null = null;
    if (g.forage) {
      glint = new Graphics().star(0, 0, 4, 2.2 * SCALE, 0.8 * SCALE).fill({ color: 0xfff6c8 });
      root.addChild(glint);
    }
    root.position.set(g.x * TILE, g.y * TILE);
    // Lying on the ground: anyone standing on the same tile is drawn over it.
    root.zIndex = (g.y - 0.45) * TILE;
    layers.sorted.addChild(root);
    return { item: g, root, icon, glint, phase: (g.x * 7.3 + g.y * 3.1) % 6.28 };
  };

  const remove = (id: string): void => {
    const v = views.get(id);
    if (!v) return;
    v.root.destroy({ children: true });
    views.delete(id);
  };

  const tick = (t: Ticker): void => {
    clock += Math.min(100, t.deltaMS);
    for (const v of views.values()) {
      const a = clock / 320 + v.phase;
      v.icon.y = -Math.abs(Math.sin(a)) * 2 * SCALE;
      if (v.glint) {
        const g = (Math.sin(clock / 500 + v.phase * 2) + 1) / 2;
        v.glint.alpha = g * g;
        v.glint.position.set(4 * SCALE, -10 * SCALE + v.icon.y);
        v.glint.rotation = clock / 900;
      }
    }
  };
  Ticker.shared.add(tick);

  const nearest = (p: Vec2, reach: number): GroundItemView | null => {
    let best: GroundItemView | null = null;
    let bd = reach;
    for (const v of views.values()) {
      if (!v.item.forage) continue;
      const d = Math.hypot(v.item.x - p.x, v.item.y - p.y);
      if (d <= bd) {
        bd = d;
        best = v.item;
      }
    }
    return best;
  };

  return {
    set(items) {
      for (const id of [...views.keys()]) remove(id);
      for (const g of items) views.set(g.id, make(g));
    },
    update(upd, del) {
      for (const id of del) remove(id);
      for (const g of upd) {
        remove(g.id);
        views.set(g.id, make(g));
      }
    },
    forageAt(tile) {
      return nearest({ x: tile.x + 0.5, y: tile.y + 0.5 }, 0.8);
    },
    nearestForage: nearest,
    list: () => [...views.values()].map((v) => v.item),
    destroy() {
      Ticker.shared.remove(tick);
      for (const id of [...views.keys()]) remove(id);
    },
  };
}
