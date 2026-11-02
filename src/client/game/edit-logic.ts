// Pure rules of the house edit mode (no Pixi, no DOM), so they can be unit tested: what is under
// the pointer, what a drag box selects, where a dragged group lands, how a turn moves a piece,
// and where the floating toolbar fits on screen.
import { checkArrange, footprint, isRug, MAX_ARRANGE, rectsOverlap, turnInPlace, type ArrangeMove, type ArrangeResult, type Rect } from "../../shared/engine";
import { getItem, stepRotation } from "../../shared/items";
import type { FarmTile, Inventory, ItemId, MapData, PlacedObject, Vec2 } from "../../shared/types";

export type Rotation = 0 | 1 | 2 | 3;

/** A placed piece as edit mode sees it: its footprint and the box its art covers (tiles). */
export interface PieceShape {
  id: string;
  /** Footprint tiles. */
  foot: Rect;
  /** Where the art is drawn (float tiles); taller than the footprint for bookcases and beds. */
  art: Rect;
  /** Draw order: larger is in front. */
  z: number;
  rug: boolean;
}

/** Art size and anchor in source px (from Art.furniture), and how many source px it is raised. */
export interface ArtLook {
  w: number;
  h: number;
  ax: number;
  ay: number;
  lift?: number;
}

/** Source px per tile (contracts SRC_TILE): art sizes are in source px. */
const SRC_PX = 32;

/** The art box of a piece with top-left (x, y): anchored at the bottom-centre of its footprint. */
export function artRect(item: ItemId, x: number, y: number, rotation: Rotation, look: ArtLook): Rect {
  const fp = footprint(item, rotation);
  const w = look.w / SRC_PX;
  const h = look.h / SRC_PX;
  const baseX = x + fp.w / 2;
  const baseY = y + fp.h - (look.lift ?? 0) / SRC_PX;
  return { x: baseX - look.ax * w, y: baseY - look.ay * h, w, h };
}

export function shapeOf(o: PlacedObject, look: ArtLook): PieceShape {
  const fp = footprint(o.item, o.rotation);
  return {
    id: o.id,
    foot: { x: o.x, y: o.y, w: fp.w, h: fp.h },
    art: artRect(o.item, o.x, o.y, o.rotation, look),
    // Wall pieces hang behind whoever stands below them; rugs lie under everything.
    z: isRug(o.item) ? -1 : getItem(o.item)?.placeOn === "wall" ? o.y : o.y + fp.h,
    rug: isRug(o.item),
  };
}

const inside = (r: Rect, p: Vec2) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

/**
 * The piece under a (float tile) point: anything whose footprint or art covers it, the front-most
 * first. A rug only answers where nothing stands on it.
 */
export function pieceAt(shapes: readonly PieceShape[], p: Vec2): string | null {
  let best: PieceShape | null = null;
  for (const s of shapes) {
    if (!inside(s.foot, p) && !inside(s.art, p)) continue;
    if (!best || (best.rug && !s.rug) || (best.rug === s.rug && s.z > best.z)) best = s;
  }
  return best?.id ?? null;
}

/** The rectangle between two corners, whichever way round they are. */
export function boxBetween(a: Vec2, b: Vec2): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/**
 * Pieces a drag box touches (footprint or art), front-most first, at most MAX_ARRANGE. A rug is
 * only taken when the box covers all of it, so sweeping over the furniture on a rug leaves it.
 */
export function boxSelect(shapes: readonly PieceShape[], box: Rect): string[] {
  const covers = (r: Rect) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
  return shapes
    .filter((s) => (s.rug ? covers(s.foot) : rectsOverlap(s.foot, box) || rectsOverlap(s.art, box)))
    .sort((a, b) => b.z - a.z)
    .slice(0, MAX_ARRANGE)
    .map((s) => s.id);
}

/** Click selection: a plain click selects just that piece; an added click (Shift) toggles it in. */
export function toggleSelect(sel: readonly string[], id: string, add: boolean): string[] {
  if (!add) return [id];
  if (sel.includes(id)) return sel.filter((x) => x !== id);
  return sel.length >= MAX_ARRANGE ? [...sel] : [...sel, id];
}

/** Whole tiles the pointer has travelled since the drag began (the group snaps to tiles). */
export function snapDelta(from: Vec2, to: Vec2): Vec2 {
  return { x: Math.round(to.x - from.x) || 0, y: Math.round(to.y - from.y) || 0 };
}

/** Every piece moved by the same offset, so the group keeps its layout. */
export function groupMoves(pieces: readonly PlacedObject[], delta: Vec2): ArrangeMove[] {
  return pieces.map((o) => ({ id: o.id, x: o.x + delta.x, y: o.y + delta.y, rotation: o.rotation }));
}

/**
 * Each piece turned to its next allowed rotation, centred where it stood. Pieces with no turned
 * art stay as they are; `turned` says how many actually turn.
 */
export function turnMoves(pieces: readonly PlacedObject[], dir: 1 | -1): { moves: ArrangeMove[]; turned: number } {
  let turned = 0;
  const moves = pieces.map((o) => {
    const rotation = stepRotation(o.item, o.rotation, dir);
    if (rotation === o.rotation) return { id: o.id, x: o.x, y: o.y, rotation };
    turned++;
    const at = turnInPlace(o.item, o.x, o.y, o.rotation, rotation);
    return { id: o.id, x: at.x, y: at.y, rotation };
  });
  return { moves, turned };
}

export interface ArrangeWorld {
  map: MapData | null;
  objects: PlacedObject[];
  farm: FarmTile[];
  occupied: Vec2[];
}

/** The same all-or-nothing check the HomeRoom runs on moveObjects. */
export function checkMoves(w: ArrangeWorld, moves: readonly ArrangeMove[]): ArrangeResult {
  if (!w.map) return { ok: false, reason: "Not loaded yet." };
  return checkArrange(w.map, w.objects, w.farm, moves, { occupied: w.occupied });
}

/** True when a move list leaves every piece where it already is. */
export function isNoop(pieces: readonly PlacedObject[], moves: readonly ArrangeMove[]): boolean {
  const byId = new Map(pieces.map((o) => [o.id, o]));
  return moves.every((m) => {
    const o = byId.get(m.id);
    return !!o && o.x === m.x && o.y === m.y && o.rotation === m.rotation;
  });
}

/** One furniture stack in the bag that goes on this map (the edit mode tray). */
export interface TrayEntry {
  slot: number;
  item: ItemId;
  qty: number;
}

/** Furniture in the bag that belongs indoors (floor and wall pieces), in bag order. */
export function trayEntries(inv: Inventory, indoor: boolean): TrayEntry[] {
  const out: TrayEntry[] = [];
  inv.slots.forEach((s, slot) => {
    const def = s && s.qty > 0 ? getItem(s.item) : undefined;
    if (!s || !def || def.kind !== "furniture" || !def.footprint || def.id === "barn") return;
    const inside = def.placeOn === "floor" || def.placeOn === "wall";
    if (inside === indoor) out.push({ slot, item: s.item, qty: s.qty });
  });
  return out;
}

/**
 * Where the floating toolbar goes (screen px, top-left): centred above the selection's box, or
 * below it when there's no room above, and always fully on screen inside `margin`.
 */
export function toolbarSpot(sel: Rect, bar: { w: number; h: number }, view: { w: number; h: number }, margin = 8, gap = 10): Vec2 {
  let x = sel.x + sel.w / 2 - bar.w / 2;
  let y = sel.y - gap - bar.h;
  if (y < margin) y = sel.y + sel.h + gap;
  x = Math.min(Math.max(x, margin), Math.max(margin, view.w - margin - bar.w));
  y = Math.min(Math.max(y, margin), Math.max(margin, view.h - margin - bar.h));
  return { x, y };
}

/** A rectangle around several (union); null for none. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Pan speed of the edit camera (tiles per second) for held keys and edge scrolling. */
export const PAN_SPEED = 8;
/** Screen px from the edge where a drag starts scrolling the view. */
export const EDGE_PX = 48;

/** Which way to scroll while dragging near the screen edge (each axis in {-1, 0, 1}). */
export function edgeScroll(p: Vec2, view: { w: number; h: number }, edge = EDGE_PX): Vec2 {
  const axis = (v: number, size: number) => (v < edge ? -1 : v > size - edge ? 1 : 0);
  return { x: axis(p.x, view.w), y: axis(p.y, view.h) };
}

/**
 * The edit camera's centre (tiles), kept where the camera can actually go: half a view in from
 * each edge, or the middle when the map is smaller than the view (as render/camera.ts clamps).
 */
export function clampFocus(f: Vec2, map: { width: number; height: number }, view: { w: number; h: number }): Vec2 {
  const axis = (v: number, size: number, viewSize: number) =>
    size <= viewSize ? size / 2 : Math.min(Math.max(v, viewSize / 2), size - viewSize / 2);
  return { x: axis(f.x, map.width, view.w), y: axis(f.y, map.height, view.h) };
}

/**
 * The free spot nearest `center` (ring by ring out to `radius` tiles), for a piece just taken
 * from the tray; null when nothing nearby fits.
 */
export function nearestFree(center: Vec2, radius: number, fits: (x: number, y: number) => boolean): Vec2 | null {
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  for (let r = 0; r <= radius; r++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !fits(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return null;
}
