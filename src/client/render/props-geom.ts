// Pure geometry for map props (no Pixi), so it can be unit-tested.
import type { MapProp, Vec2 } from "../../shared/types";
import { SRC_TILE, TILE } from "../contracts";
import { SURFACE_PROPS, TABLETOP_PROPS, WALL_DECOR_PROPS } from "../../shared/maps/interiors/props";

/** Prop types the player can click/interact with; the server decides what each one does. */
export const INTERACTABLE_TYPES: ReadonlySet<string> = new Set([
  "shipping_bin",
  "mailbox",
  "notice_board",
  "market_stall",
  "shrine",
  "well",
  "fountain",
  "fishing_spot",
  "herb_patch",
  "bridge_broken",
  "mine_cart",
  "dock",
  "campfire",
  // Seats: interact to sit down.
  "chair_down",
  "chair_up",
  "chair_left",
  "chair_right",
  "bar_stool",
]);

/** Walls seen from inside stand flush on the floor edge: a blob shadow under them reads as a hole. */
export function castsShadow(p: MapProp): boolean {
  return !p.walkable && !p.type.startsWith("iwall_") && p.type !== "stairs_up";
}

export const SWAY_TYPES: ReadonlySet<string> = new Set(["tree", "bush"]);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Feet point (tile coords): bottom-center of the footprint. */
export function propFeet(p: MapProp): Vec2 {
  return { x: p.x + p.w / 2, y: p.y + p.h };
}

/** Art bounds in tiles relative to the feet point, from texture size (source px) and anchor. */
export interface ArtExtent {
  /** Tiles the art reaches above the feet point. */
  up: number;
  /** Half-width in tiles. */
  halfW: number;
}

export const HIT_PAD = 0.15;
/** The click rect never extends more than this many tiles above the footprint (tall roofs). */
export const MAX_ART_REACH = 2;

/**
 * Click rect: the footprint padded a little, grown upward to the visible art (capped) and
 * sideways when the art is wider than the footprint.
 */
export function hitRect(p: MapProp, art?: ArtExtent): Rect {
  const feet = propFeet(p);
  const top = art ? Math.max(feet.y - art.up, p.y - MAX_ART_REACH) : p.y;
  const halfW = Math.max(p.w / 2, art ? Math.min(art.halfW, p.w / 2 + 0.5) : 0);
  const y0 = Math.min(p.y, top) - HIT_PAD;
  const y1 = p.y + p.h + HIT_PAD;
  return { x: feet.x - halfW - HIT_PAD, y: y0, w: halfW * 2 + HIT_PAD * 2, h: y1 - y0 };
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export interface HitEntry {
  id: string;
  footprint: Rect;
  hit: Rect;
}

/**
 * Prop under a float tile position. Exact footprint hits win over tolerance hits; among equals
 * the front-most (larger bottom edge), then the smaller one.
 */
export function pickProp(entries: readonly HitEntry[], tile: Vec2): string | null {
  let best: HitEntry | null = null;
  let bestScore = -Infinity;
  for (const e of entries) {
    if (!inRect(e.hit, tile.x, tile.y)) continue;
    const exact = inRect(e.footprint, tile.x, tile.y) ? 1e6 : 0;
    const bottom = e.footprint.y + e.footprint.h;
    const score = exact + bottom * 100 - e.footprint.w * e.footprint.h;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best ? best.id : null;
}

/** Deterministic phase 0..2π from a prop's tile position. */
export function phaseOf(x: number, y: number): number {
  const h = Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}

/** Soft shadow size in tiles for a prop, from its footprint and art width. */
export function shadowSize(p: MapProp, art?: ArtExtent): { w: number; h: number } {
  const artW = art ? art.halfW * 2 : p.w;
  // Fence tiles join up: a wide blob under each one reads as a row of holes along the fence.
  if (p.type === "fence_deco") return { w: 0.9, h: 0.2 };
  if (SWAY_TYPES.has(p.type) || p.w * p.h === 1) {
    const w = Math.min(Math.max(p.w, artW * 0.7), 2.2);
    return { w, h: w * 0.38 };
  }
  const w = Math.max(p.w, artW * 0.85) * 1.04;
  return { w, h: Math.min(Math.max(p.h * 0.35, 0.45), 1) };
}

/**
 * Tables and counters sort a little after other things on their row: a seated character (row
 * bottom + 0.5) is drawn above its chair (+0) but below a table on its row or further south.
 */
export const TABLE_SORT_BIAS = 0.75;

/** Sort key for a solid prop whose feet are at `fy` (world px). */
export function propSortZ(p: MapProp, fy: number): number {
  return SURFACE_PROPS.has(p.type) ? fy + TABLE_SORT_BIAS : fy;
}

/** The table, desk or counter a tabletop item stands on. */
export function surfaceUnder(p: MapProp, props: readonly MapProp[]): MapProp | undefined {
  return props.find((q) => !q.walkable && SURFACE_PROPS.has(q.type) && p.x >= q.x && p.x < q.x + q.w && p.y >= q.y && p.y < q.y + q.h);
}

/** A rect in source px relative to a sprite's anchor (feet) point. */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a tabletop item's anchor goes, in source px relative to its table's feet point: over its
 * own tile, but moved so the whole item lies on the table's top surface. An item taller than the
 * surface is deep (a candle) stands with its base on the surface's front edge.
 */
export function placeOnSurface(
  item: MapProp,
  table: MapProp,
  surface: PxRect,
  art: { w: number; h: number; ax: number; ay: number },
): { x: number; y: number } {
  const tx = (item.x + 0.5 - (table.x + table.w / 2)) * SRC_TILE;
  const ty = surface.y + ((item.y - table.y + 0.5) / table.h) * surface.h + art.ay - art.h / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? hi : Math.min(hi, Math.max(lo, v)));
  return {
    x: clamp(tx, surface.x + art.ax, surface.x + surface.w - (art.w - art.ax)),
    y: clamp(ty, surface.y + art.ay, surface.y + surface.h - (art.h - art.ay)),
  };
}

/**
 * Wall hangings and tabletop clutter are walkable but must not lie flat under everyone: a
 * hanging sorts just in front of the north wall it hangs on, a tabletop item just in front of
 * the table under it (but behind anyone standing south of it). Null for flat props (rugs, mats).
 */
export function raisedZ(p: MapProp, props: readonly MapProp[]): number | null {
  if (WALL_DECOR_PROPS.has(p.type)) return (p.y + 2) * TILE + 0.5;
  if (TABLETOP_PROPS.has(p.type)) {
    const t = surfaceUnder(p, props);
    return (t ? t.y + t.h : p.y + 1) * TILE + TABLE_SORT_BIAS + 0.1;
  }
  return null;
}

/** Shipping bin lid: frames per second while opening or closing (closed → opening → open). */
export const LID_FPS = 14;
export const LID_BUMP_MS = 260;

/**
 * Squash of the bin when something lands in it, at `t` (0..1 of LID_BUMP_MS): scale x, y about
 * the feet. A quick dip, a small overshoot, then rest.
 */
export function lidBump(t: number): { x: number; y: number } {
  if (t <= 0 || t >= 1) return { x: 1, y: 1 };
  const k = Math.sin(t * Math.PI * 2) * (1 - t);
  return { x: 1 + 0.06 * k, y: 1 - 0.1 * k };
}
