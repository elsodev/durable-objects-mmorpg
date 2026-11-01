// Farm layer: tilled/watered soil, crops by stage, mining rocks and placed furniture.
// Every set* call diffs against what is on screen by a per-item signature, so the store can
// call them on each change event without rebuilding sprites. See ../contracts.ts.
import { Container, Graphics, GraphicsContext, Sprite, Ticker } from "pixi.js";
import { cropView, objectRect, footprint, pointInRect } from "../../shared/engine";
import { getItem } from "../../shared/items";
import { Ground, type FarmTile, type MapData, type PlacedObject, type Vec2 } from "../../shared/types";
import { fenceKey, fenceMasks } from "./fence";
import { SCALE, TILE, type Art, type CreateFarmLayer, type SpriteArt } from "../contracts";

// ---------------------------------------------------------------- pure helpers (tested)

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export interface Diff<T> {
  added: T[];
  changed: T[];
  removed: string[];
}

/**
 * Compares items against the last-seen signatures and updates `prev` in place.
 * An item whose signature differs is "changed"; keys no longer present are "removed".
 */
export function diffKeyed<T>(
  prev: Map<string, string>,
  items: Iterable<T>,
  key: (t: T) => string,
  sig: (t: T) => string,
): Diff<T> {
  const out: Diff<T> = { added: [], changed: [], removed: [] };
  const seen = new Set<string>();
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    const s = sig(it);
    const old = prev.get(k);
    if (old === undefined) out.added.push(it);
    else if (old !== s) out.changed.push(it);
    else continue;
    prev.set(k, s);
  }
  for (const k of prev.keys()) {
    if (!seen.has(k)) out.removed.push(k);
  }
  for (const k of out.removed) prev.delete(k);
  return out;
}

/** What a farm tile looks like right now; equal signatures render identically. */
export function farmSig(tile: FarmTile, now: number): string {
  const v = cropView(tile, now);
  return `${tile.crop ?? ""}|${v.stage}|${v.wateredToday ? 1 : 0}|${v.ready ? 1 : 0}`;
}

export function objectSig(o: PlacedObject): string {
  return `${o.item}|${o.x}|${o.y}|${o.rotation}`;
}

/** Id of the placed object covering the tile containing the (float) point, else null. */
export function findObjectAt(objects: Iterable<PlacedObject>, tile: Vec2): string | null {
  const tx = Math.floor(tile.x);
  const ty = Math.floor(tile.y);
  for (const o of objects) {
    if (pointInRect(objectRect(o.item, o.x, o.y, o.rotation), tx, ty)) return o.id;
  }
  return null;
}

// ---------------------------------------------------------------- rendering

/** Wet soil is the dry texture darkened; works the same for LPC art and placeholders. */
const WET_TINT = 0x8a7466;
/** Crops sit slightly above the tile's bottom edge so they look planted in the soil mound. */
const CROP_BASE = 0.82;
const ROCK_BASE = 0.92;

/** Soft shadow: stacked translucent ellipses, unit radius, scaled per object. Shared geometry. */
let shadowCtx: GraphicsContext | null = null;
function shadowContext(): GraphicsContext {
  if (!shadowCtx) {
    shadowCtx = new GraphicsContext();
    for (const [r, a] of [
      [1, 0.07],
      [0.82, 0.08],
      [0.62, 0.09],
    ] as const) {
      shadowCtx.ellipse(0, 0, r, r * 0.42).fill({ color: 0x1a1210, alpha: a });
    }
  }
  return shadowCtx;
}

function makeShadow(cx: number, cy: number, radiusPx: number): Graphics {
  const g = new Graphics(shadowContext());
  g.position.set(cx, cy);
  g.scale.set(radiusPx);
  return g;
}

/** Four-point star, drawn once and shared by all sparkles. */
let sparkleCtx: GraphicsContext | null = null;
function sparkleContext(): GraphicsContext {
  if (!sparkleCtx) {
    const s = SCALE;
    sparkleCtx = new GraphicsContext()
      .poly([0, -4 * s, s, -s, 4 * s, 0, s, s, 0, 4 * s, -s, s, -4 * s, 0, -s, -s])
      .fill({ color: 0xfff6c8, alpha: 0.95 })
      .circle(0, 0, s * 0.8)
      .fill({ color: 0xffffff });
  }
  return sparkleCtx;
}

function makeSprite(a: SpriteArt, x: number, y: number): Sprite {
  const sp = new Sprite(a.texture);
  sp.anchor.set(a.anchor.x, a.anchor.y);
  sp.scale.set(SCALE);
  sp.position.set(x, y);
  sp.zIndex = y;
  return sp;
}

interface FarmView {
  soil: Sprite;
  crop?: Sprite;
  shadow?: Graphics;
  sparkle?: Graphics;
  /** Per-tile phase so ready crops don't twinkle in lockstep. */
  phase: number;
}

interface PlacedView {
  sprite: Sprite;
  shadow?: Graphics;
}

function destroyView(v: { sprite?: Sprite; soil?: Sprite; crop?: Sprite; shadow?: Graphics; sparkle?: Graphics }): void {
  v.soil?.destroy();
  v.crop?.destroy();
  v.sprite?.destroy();
  // Graphics built from a shared context: destroy the node, keep the context.
  v.shadow?.destroy({ context: false });
  v.sparkle?.destroy({ context: false });
}

export const createFarmLayer: CreateFarmLayer = (art: Art, layers) => {
  // Own containers inside the shared layers, so destroy() cleans exactly what we added.
  const soilRoot = new Container();
  const floorRoot = new Container();
  const shadowRoot = new Container();
  layers.groundOverlay.addChild(soilRoot, floorRoot, shadowRoot);
  // Sorted things must be direct children of layers.sorted to y-sort against entities.
  const sparkleRoot = new Container();
  layers.overlay.addChild(sparkleRoot);

  const farmSigs = new Map<string, string>();
  const farmViews = new Map<string, FarmView>();
  const rockSigs = new Map<string, string>();
  const rockViews = new Map<string, PlacedView>();
  let rockMap: MapData | null = null;
  const objSigs = new Map<string, string>();
  const fenceMask = new Map<string, number>();
  const maskOf = (o: PlacedObject) => fenceMask.get(fenceKey(Math.floor(o.x), Math.floor(o.y))) ?? 0;
  const objViews = new Map<string, PlacedView>();
  const objects = new Map<string, PlacedObject>();

  // ---- sparkle animation runs only while some crop is ready
  let t = 0;
  let ticking = false;
  const tick = (ticker: Ticker) => {
    t += ticker.deltaMS / 1000;
    for (const v of farmViews.values()) {
      const s = v.sparkle;
      if (!s) continue;
      const w = Math.sin(t * 3 + v.phase);
      s.alpha = Math.max(0, w) * 0.9;
      s.scale.set(0.5 + 0.35 * Math.max(0, w));
      s.rotation = t * 0.6 + v.phase;
    }
  };
  function updateTicker(): void {
    let any = false;
    for (const v of farmViews.values()) if (v.sparkle) any = true;
    if (any && !ticking) Ticker.shared.add(tick);
    if (!any && ticking) Ticker.shared.remove(tick);
    ticking = any;
  }

  function buildFarm(tile: FarmTile, now: number): FarmView {
    const v = cropView(tile, now);
    const px = tile.x * TILE;
    const py = tile.y * TILE;
    const soil = new Sprite(art.ground(Ground.Tilled, tile.x, tile.y));
    soil.position.set(px, py);
    soil.width = TILE;
    soil.height = TILE;
    if (v.wateredToday) soil.tint = WET_TINT;
    soilRoot.addChild(soil);
    const view: FarmView = { soil, phase: ((tile.x * 7 + tile.y * 13) % 17) * 0.37 };
    if (tile.crop) {
      const cx = px + TILE / 2;
      const by = py + TILE * CROP_BASE;
      view.shadow = makeShadow(cx, by, TILE * (0.18 + v.stage * 0.06));
      shadowRoot.addChild(view.shadow);
      view.crop = makeSprite(art.crop(tile.crop, v.stage), cx, by);
      layers.sorted.addChild(view.crop);
      if (v.ready) {
        view.sparkle = new Graphics(sparkleContext());
        view.sparkle.position.set(cx + TILE * 0.22, py + TILE * 0.1);
        view.sparkle.alpha = 0;
        sparkleRoot.addChild(view.sparkle);
      }
    }
    return view;
  }

  function buildRock(r: NonNullable<MapData["rocks"]>[number]): PlacedView {
    const cx = (r.x + 0.5) * TILE;
    const by = (r.y + ROCK_BASE) * TILE;
    const shadow = makeShadow(cx, by, TILE * 0.42);
    shadowRoot.addChild(shadow);
    const sprite = makeSprite(art.rock(r.ore), cx, by);
    layers.sorted.addChild(sprite);
    return { sprite, shadow };
  }

  function buildObject(o: PlacedObject): PlacedView {
    const fp = footprint(o.item, o.rotation);
    const x = Math.floor(o.x);
    const y = Math.floor(o.y);
    const mask = o.item === "fence" ? maskOf(o) : 0;
    const look = (mask && art.fence?.(mask)) || art.furniture(o.item, o.rotation);
    const sprite = makeSprite(look, (x + fp.w / 2) * TILE, (y + fp.h) * TILE);
    // Walkable furniture (rugs) lies flat under everyone instead of y-sorting.
    if (getItem(o.item)?.walkable) floorRoot.addChild(sprite);
    else layers.sorted.addChild(sprite);
    return { sprite };
  }

  function clearRocks(): void {
    for (const v of rockViews.values()) destroyView(v);
    rockViews.clear();
    rockSigs.clear();
  }

  return {
    setFarm(tiles, now) {
      const list = [...tiles];
      const byKey = (f: FarmTile) => tileKey(f.x, f.y);
      const d = diffKeyed(farmSigs, list, byKey, (f) => farmSig(f, now));
      for (const k of d.removed) {
        const v = farmViews.get(k);
        if (v) destroyView(v);
        farmViews.delete(k);
      }
      for (const f of [...d.changed, ...d.added]) {
        const k = byKey(f);
        const old = farmViews.get(k);
        if (old) destroyView(old);
        farmViews.set(k, buildFarm(f, now));
      }
      updateTicker();
    },

    setRocks(map, broken) {
      if (map !== rockMap) {
        clearRocks();
        rockMap = map;
      }
      const visible = (map.rocks ?? []).filter((r) => !broken.has(r.id));
      // Rocks never move, so the signature is just the ore; broken rocks drop out as "removed".
      const d = diffKeyed(rockSigs, visible, (r) => r.id, (r) => `${r.ore}|${r.x}|${r.y}`);
      for (const k of d.removed) {
        const v = rockViews.get(k);
        if (v) destroyView(v);
        rockViews.delete(k);
      }
      for (const r of [...d.changed, ...d.added]) {
        const old = rockViews.get(r.id);
        if (old) destroyView(old);
        rockViews.set(r.id, buildRock(r));
      }
    },

    setObjects(list) {
      const all = [...list];
      objects.clear();
      for (const o of all) objects.set(o.id, o);
      // Placed fences join their neighbours (render/fence.ts); a lone fence keeps its rotated piece.
      fenceMask.clear();
      for (const [k, m] of fenceMasks(all.filter((o) => o.item === "fence"))) fenceMask.set(k, m);
      const sig = (o: PlacedObject) => (o.item === "fence" ? `${objectSig(o)}|${maskOf(o)}` : objectSig(o));
      const d = diffKeyed(objSigs, all, (o) => o.id, sig);
      for (const k of d.removed) {
        const v = objViews.get(k);
        if (v) destroyView(v);
        objViews.delete(k);
      }
      for (const o of [...d.changed, ...d.added]) {
        const old = objViews.get(o.id);
        if (old) destroyView(old);
        objViews.set(o.id, buildObject(o));
      }
    },

    objectAt(tile) {
      return findObjectAt(objects.values(), tile);
    },

    destroy() {
      if (ticking) Ticker.shared.remove(tick);
      ticking = false;
      for (const v of farmViews.values()) destroyView(v);
      for (const v of objViews.values()) destroyView(v);
      clearRocks();
      farmViews.clear();
      objViews.clear();
      farmSigs.clear();
      objSigs.clear();
      objects.clear();
      soilRoot.destroy({ children: true });
      floorRoot.destroy({ children: true });
      shadowRoot.destroy({ children: true, context: false });
      sparkleRoot.destroy({ children: true, context: false });
    },
  };
};
