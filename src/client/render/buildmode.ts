// Home build mode: a translucent furniture ghost snapped to tiles with a green/red footprint,
// validated client-side with the same engine canPlace the HomeRoom uses.
import { Container, Graphics, Sprite } from "pixi.js";
import type { BuildMode, CreateBuildMode } from "../contracts";
import { SCALE, TILE } from "../contracts";
import { footprint } from "../../shared/engine";
import { wallLift } from "./farm";
import type { Vec2 } from "../../shared/types";
import { normalizeRotation, stepRotation } from "../../shared/items";
import {
  buildMessage,
  evaluate,
  furnitureInSlot,
  type BuildTarget,
  type Placement,
  type Rotation,
} from "./buildmode-logic";

const OK_COLOR = 0x5ad17a;
const BAD_COLOR = 0xe2524a;
const GHOST_ALPHA = 0.75;
/** The ghost sprite itself is tinted too, so validity reads even where the tiles are covered. */
const OK_TINT = 0xb4f5c4;
const BAD_TINT = 0xff9a90;

let reqCounter = 0;
const nextReq = () => `b${Date.now().toString(36)}${(reqCounter++).toString(36)}`;

export const createBuildMode: CreateBuildMode = (art, layers, deps) => {
  const root = new Container();
  root.label = "buildmode";
  root.visible = false;
  const tiles = new Graphics();
  const ghost = new Sprite();
  ghost.alpha = GHOST_ALPHA;
  ghost.scale.set(SCALE);
  root.addChild(tiles, ghost);
  layers.overlay.addChild(root);

  let target: BuildTarget | null = null;
  let rotation: Rotation = 0;
  let lastTile: Vec2 | null = null;
  let last: Placement | null = null;

  const world = () => ({ map: deps.map(), objects: deps.objects(), farm: deps.farm(), occupied: deps.occupied() });

  function refreshSprite(): void {
    if (!target) return;
    const s = art.furniture(target.item, rotation);
    ghost.texture = s.texture;
    ghost.anchor.set(s.anchor.x, s.anchor.y);
  }

  function redraw(): void {
    if (!target || !lastTile) {
      root.visible = false;
      return;
    }
    last = evaluate(target, rotation, lastTile, world());
    const color = last.ok ? OK_COLOR : BAD_COLOR;
    tiles.clear();
    for (let ty = 0; ty < last.h; ty++) {
      for (let tx = 0; tx < last.w; tx++) {
        tiles
          .rect((last.x + tx) * TILE + 1, (last.y + ty) * TILE + 1, TILE - 2, TILE - 2)
          .fill({ color, alpha: 0.28 })
          .stroke({ color, alpha: 0.9, width: 2 });
      }
    }
    // Same base point the farm layer uses for furniture: bottom-centre of the footprint.
    const lift = wallLift({ id: "", item: target.item, x: last.x, y: last.y, rotation }, deps.map()) * SCALE;
    ghost.position.set((last.x + last.w / 2) * TILE, (last.y + last.h) * TILE - lift);
    ghost.tint = last.ok ? OK_TINT : BAD_TINT;
    root.visible = true;
  }

  function start(t: BuildTarget, rot: Rotation): void {
    target = t;
    rotation = normalizeRotation(t.item, rot);
    refreshSprite();
    redraw();
  }

  const api: BuildMode = {
    active: () => target !== null,

    enter(slot) {
      const r = furnitureInSlot(deps.inventory(), slot);
      if ("reason" in r) {
        deps.notice(r.reason);
        return;
      }
      start({ kind: "place", slot, item: r.item }, 0);
    },

    pick(objectId) {
      const obj = deps.objects().find((o) => o.id === objectId);
      if (!obj) {
        deps.notice("That isn't here any more.");
        return;
      }
      // Until the pointer moves, show the ghost where the object already stands.
      const fp = footprint(obj.item, obj.rotation);
      lastTile = { x: obj.x + (fp.w - 1) / 2, y: obj.y + (fp.h - 1) / 2 };
      start({ kind: "move", id: obj.id, item: obj.item }, obj.rotation);
    },

    exit() {
      target = null;
      last = null;
      tiles.clear();
      root.visible = false;
    },

    rotate(dir = 1) {
      if (!target) return;
      const next = stepRotation(target.item, rotation, dir);
      if (next === rotation) {
        deps.notice("This piece only goes one way round.");
        return;
      }
      rotation = next;
      refreshSprite();
      redraw();
    },

    pointer(tile) {
      lastTile = { x: tile.x, y: tile.y };
      redraw();
    },

    click(tile) {
      if (!target) return null;
      if (target.kind === "place") {
        // The slot may have changed since enter() (e.g. last chair already placed).
        const r = furnitureInSlot(deps.inventory(), target.slot);
        if ("reason" in r || r.item !== target.item) {
          deps.notice("You don't have that any more.");
          api.exit();
          return null;
        }
      } else {
        const id = target.id;
        if (!deps.objects().some((o) => o.id === id)) {
          deps.notice("That isn't here any more.");
          api.exit();
          return null;
        }
      }
      api.pointer(tile);
      if (!last || !last.ok) {
        deps.notice(last?.reason ?? "Can't place that here.");
        return null;
      }
      return buildMessage(target, last, rotation, nextReq());
    },

    destroy() {
      api.exit();
      root.destroy({ children: true });
    },
  };
  return api;
};
