// Farm layer: tilled/watered soil, crops by stage, mining rocks and placed furniture.
// Soil is autotiled (soil-autotile.ts): connected tilled tiles merge into one patch, and watered
// tiles lay a darker patch of the same shape on top.
// Every set* call diffs against what is on screen by a per-item signature, so the store can
// call them on each change event without rebuilding sprites. See ../contracts.ts.
import { Container, Graphics, GraphicsContext, Sprite, Ticker, type Texture } from "pixi.js";
import { cropLook, cropView, objectRect, footprint, pointInRect, wallFaceRow } from "../../shared/engine";
import { getItem } from "../../shared/items";
import { Ground, type FarmTile, type MapData, type PlacedObject, type Vec2 } from "../../shared/types";
import { hashXY } from "../art/slice";
import { fenceKey, fenceMasks } from "./fence";
import { BlobTextures, type GroundEdgeArt } from "./ground";
import { QUADRANTS, type BlobPiece, type BlobSet, type Quadrant } from "./ground-autotile";
import { planSoil, soilShift, soilSig, type SoilPlan } from "./soil-autotile";
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
  return `${tile.crop ?? ""}|${v.stage}|${v.wateredToday ? 1 : 0}|${v.ready ? 1 : 0}|${cropLook(v)}`;
}

/**
 * Sort depth of a piece hung on a wall: just in front of the wall it hangs on (whose art sorts at
 * the first floor row below it), behind anyone standing on that floor row.
 */
export function wallObjectZ(o: PlacedObject, map: MapData | null): number {
  const fp = footprint(o.item, o.rotation);
  const bottom = Math.floor(o.y) + fp.h - 1;
  const row = map ? wallFaceRow(map, Math.floor(o.x), bottom) : null;
  return (row ?? bottom + 2) * TILE + 0.5;
}

/**
 * Per-tile variety so a row of the same crop doesn't look stamped: a mirror flip and a nudge of up
 * to 2 source px sideways and 1 px down/up, fixed by tile position (same on every client).
 */
export function cropJitter(x: number, y: number): { flip: boolean; dx: number; dy: number } {
  const h = hashXY(x, y);
  return { flip: (h & 1) === 1, dx: ((h >>> 1) % 5) - 2, dy: ((h >>> 4) % 3) - 1 };
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

/** Soil plans for every tile at once: each tile's edges depend on its neighbours. */
export function planFarmSoil(tiles: readonly FarmTile[], now: number): Map<string, SoilPlan> {
  const tilled = new Set<string>();
  const wet = new Set<string>();
  for (const t of tiles) {
    const k = tileKey(t.x, t.y);
    tilled.add(k);
    if (cropView(t, now).wateredToday) wet.add(k);
  }
  const out = new Map<string, SoilPlan>();
  for (const t of tiles) {
    out.set(
      tileKey(t.x, t.y),
      planSoil((x, y) => tilled.has(tileKey(x, y)), (x, y) => wet.has(tileKey(x, y)), t.x, t.y),
    );
  }
  return out;
}

/** Wet soil without wet art: the dry texture darkened; works the same for LPC art and placeholders. */
const WET_TINT = 0x8a7466;
/** The pack's wet soil is only a shade darker than dry; deepen it so watered tiles read at a glance. */
const WET_OVERLAY_TINT = 0xa08878;
/** Crops sit slightly above the tile's bottom edge so they look planted in the soil mound. */
const CROP_BASE = 0.82;
const ROCK_BASE = 0.92;
/** A ripe crop sways gently (stretch at its base) so it reads as harvestable at a glance. */
const READY_BOB = 0.035;

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
  soil: Container;
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

function destroyView(v: { sprite?: Sprite; soil?: Container; crop?: Sprite; shadow?: Graphics; sparkle?: Graphics }): void {
  // Soil quadrants use the art's (and BlobTextures') cached textures: free only the nodes.
  v.soil?.destroy({ children: true });
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

  const blobs = new BlobTextures(art as Art & GroundEdgeArt);
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
  /** Map the objects stand on (wall pieces sort by the wall they hang on). */
  let objMap: MapData | null = null;

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
      if (v.crop) v.crop.scale.y = SCALE * (1 + READY_BOB * Math.sin(t * 2.2 + v.phase));
    }
  };
  function updateTicker(): void {
    let any = false;
    for (const v of farmViews.values()) if (v.sparkle) any = true;
    if (any && !ticking) Ticker.shared.add(tick);
    if (!any && ticking) Ticker.shared.remove(tick);
    ticking = any;
  }

  /** One soil quadrant: the blob piece at the patch's edge, else the plain tile's quarter. */
  function soilQuad(c: Container, set: BlobSet, piece: BlobPiece | null, full: Texture, q: Quadrant, tint?: number): void {
    const tex = piece ? blobs.quad(set, piece, q, soilShift(piece, q)) : blobs.quadOf(full, q);
    if (!tex) return;
    const half = TILE / 2;
    const s = new Sprite(tex);
    s.position.set(q & 1 ? half : 0, q & 2 ? half : 0);
    s.width = half;
    s.height = half;
    if (tint !== undefined) s.tint = tint;
    c.addChild(s);
  }

  function buildSoil(tile: FarmTile, plan: SoilPlan): Container {
    const c = new Container();
    c.position.set(tile.x * TILE, tile.y * TILE);
    const dry = art.ground(Ground.Tilled, tile.x, tile.y);
    if (!blobs.has("tilled")) {
      // No blob sheet (placeholder art): plain square tiles, wet ones darkened.
      const s = new Sprite(plan.wet ? art.tilledWet?.(tile.x, tile.y) ?? dry : dry);
      s.width = TILE;
      s.height = TILE;
      if (plan.wet && !art.tilledWet) s.tint = WET_TINT;
      c.addChild(s);
      return c;
    }
    const wetArt = plan.wet && blobs.has("tilled_wet") && art.tilledWet ? art.tilledWet(tile.x, tile.y) : null;
    // Without a wet sheet, tint the dry patch instead of overlaying.
    const dryTint = plan.wet && !wetArt ? WET_TINT : undefined;
    for (const q of QUADRANTS) soilQuad(c, "tilled", plan.dry[q] ?? null, dry, q, dryTint);
    if (wetArt && plan.wet) for (const q of QUADRANTS) soilQuad(c, "tilled_wet", plan.wet[q] ?? null, wetArt, q, WET_OVERLAY_TINT);
    return c;
  }

  function buildFarm(tile: FarmTile, now: number, plan: SoilPlan): FarmView {
    const v = cropView(tile, now);
    const px = tile.x * TILE;
    const py = tile.y * TILE;
    const soil = buildSoil(tile, plan);
    soilRoot.addChild(soil);
    const view: FarmView = { soil, phase: ((tile.x * 7 + tile.y * 13) % 17) * 0.37 };
    if (tile.crop) {
      const cx = px + TILE / 2;
      const by = py + TILE * CROP_BASE;
      // The dead plant is drawn from the small stage, so its shadow matches that.
      view.shadow = makeShadow(cx, by, TILE * (0.18 + (v.dead ? 1 : v.stage) * 0.06));
      shadowRoot.addChild(view.shadow);
      const j = cropJitter(tile.x, tile.y);
      view.crop = makeSprite(art.crop(tile.crop, v.stage, cropLook(v)), cx + j.dx * SCALE, by + j.dy * SCALE);
      if (j.flip) view.crop.scale.x = -SCALE;
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
    const def = getItem(o.item);
    if (def?.placeOn === "wall") {
      sprite.zIndex = wallObjectZ(o, objMap);
      layers.sorted.addChild(sprite);
    }
    // Walkable furniture (rugs) lies flat under everyone instead of y-sorting.
    else if (def?.walkable) floorRoot.addChild(sprite);
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
      const plans = planFarmSoil(list, now);
      const planOf = (f: FarmTile) => plans.get(byKey(f))!;
      // A neighbour being tilled or watered changes this tile's edges, so the soil is in the signature.
      const d = diffKeyed(farmSigs, list, byKey, (f) => `${farmSig(f, now)}|${soilSig(planOf(f))}`);
      for (const k of d.removed) {
        const v = farmViews.get(k);
        if (v) destroyView(v);
        farmViews.delete(k);
      }
      for (const f of [...d.changed, ...d.added]) {
        const k = byKey(f);
        const old = farmViews.get(k);
        if (old) destroyView(old);
        farmViews.set(k, buildFarm(f, now, planOf(f)));
      }
      updateTicker();
    },

    rockSprite(id) {
      return rockViews.get(id)?.sprite ?? null;
    },

    setRocks(map, broken, ores) {
      if (map !== rockMap) {
        clearRocks();
        rockMap = map;
      }
      const visible = (map.rocks ?? []).filter((r) => !broken.has(r.id)).map((r) => {
        const ore = ores?.get(r.id);
        return ore && ore !== r.ore ? { ...r, ore } : r;
      });
      // Rocks never move, so the signature is just the ore (a cave rock may come back as another);
      // broken rocks drop out as "removed".
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

    setObjects(list, map) {
      if (map !== undefined) objMap = map;
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
      blobs.destroy();
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
