// Choppable trees on screen: big trees drawn a bit larger, stumps and cleared tiles from the
// store, and the chop/fall/regrow effects for "tree" messages.
import type { Sprite, Texture } from "pixi.js";
import type { Art, PropsLayer } from "../contracts";
import { SCALE } from "../contracts";
import { treeSize } from "../../shared/engine/toolRules";
import type { ItemId, MapData, MapProp, Vec2 } from "../../shared/types";
import type { HitFx } from "./hit-fx";

type Stage = "tree" | "stump" | "gone";
const LARGE_SCALE = 1.18;

export interface TreeView {
  /** Shows every tree at its stored stage, without effects. */
  sync(trees: Map<string, "stump" | "gone">): void;
  /** A server "tree" message: hit, fell, clear or regrow, with effects. */
  update(id: string, stage: Stage, hits: number, drops: readonly ItemId[] | undefined, from?: Vec2 | null): void;
  /** Just the wobble and leaves of a hit (your own swing landing, before the server answers). */
  hit(id: string): void;
}

export function createTreeView(art: Art, map: MapData, props: PropsLayer, fx: HitFx): TreeView {
  const trees = new Map<string, MapProp>(map.props.filter((p) => p.type === "tree").map((p) => [p.id, p]));
  const shown = new Map<string, Stage>();
  const original = new Map<string, { texture: Texture; ax: number; ay: number }>();
  const stump = art.prop("tree_stump");

  const view = (id: string) => props.spriteOf?.(id) ?? null;

  function draw(id: string, stage: Stage): void {
    const v = view(id);
    if (!v) return;
    const body: Sprite = v.body;
    if (!original.has(id)) original.set(id, { texture: body.texture, ax: body.anchor.x, ay: body.anchor.y });
    const o = original.get(id)!;
    const large = treeSize(id) === "large";
    if (stage === "stump") {
      body.texture = stump.texture;
      body.anchor.set(stump.anchor.x, stump.anchor.y);
      body.scale.set(SCALE);
    } else {
      body.texture = o.texture;
      body.anchor.set(o.ax, o.ay);
      body.scale.set(SCALE * (large ? LARGE_SCALE : 1));
    }
    body.visible = stage !== "gone";
    body.rotation = 0;
    body.alpha = 1;
    if (v.shadow) {
      v.shadow.visible = stage === "tree";
    }
    shown.set(id, stage);
  }

  function wobble(id: string, stage: Stage): void {
    const t = trees.get(id);
    if (!t || stage === "gone") return;
    const at = { x: t.x, y: t.y };
    // A hit that didn't finish it: wobble and shed some leaves (or splinters off a stump).
    fx.shake(view(id)?.body, stage === "tree" ? 1.2 : 0.8);
    if (stage === "tree") fx.chips(at, "leaf", 7, 1.8);
    fx.chips(at, "wood", 3, 0.35);
  }

  return {
    hit(id) {
      wobble(id, shown.get(id) ?? "tree");
    },

    sync(stages) {
      for (const id of trees.keys()) {
        const want = stages.get(id) ?? "tree";
        if (shown.get(id) !== want || !shown.has(id)) draw(id, want);
      }
    },

    update(id, stage, hits, drops, from) {
      const t = trees.get(id);
      if (!t) return;
      const at = { x: t.x, y: t.y };
      const v = view(id);
      const before = shown.get(id) ?? "tree";
      if (stage === before && hits > 0) return wobble(id, stage);
      if (stage === "stump" && before === "tree" && v) {
        // Topple away from whoever chopped it, then leave the stump.
        const dir: 1 | -1 = from && from.x > t.x + 0.5 ? -1 : 1;
        fx.chips(at, "leaf", 14, 1.8);
        fx.fall(v.body, dir, () => {
          draw(id, "stump");
          fx.chips({ x: at.x + dir * 1.2, y: at.y }, "leaf", 12, 0.4);
          if (drops?.length) fx.drops({ x: at.x + 0.5 + dir * 0.6, y: at.y + 0.9 }, drops);
        });
        return;
      }
      draw(id, stage);
      if (stage === "gone") {
        fx.chips(at, "wood", 10, 0.3);
        if (drops?.length) fx.drops({ x: at.x + 0.5, y: at.y + 0.9 }, drops);
      } else if (stage === "tree") {
        fx.chips(at, "leaf", 8, 1.2);
      }
    },
  };
}
