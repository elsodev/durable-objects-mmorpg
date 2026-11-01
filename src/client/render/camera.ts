// Camera: keeps the followed tile position centred by offsetting layers.world.
// All math lives in pure helpers (exported for tests); createCamera only holds state and
// writes the snapped offset to the world container.
import type { Camera, CreateCamera } from "../contracts";
import { TILE } from "../contracts";
import type { Vec2 } from "../../shared/types";

/** Time constant (ms) of the exponential follow: ~63% of the gap closes every FOLLOW_TAU_MS. */
export const FOLLOW_TAU_MS = 90;
/** Extra tiles around the visible rect so sprites taller than a tile don't pop at the edges. */
export const VIEW_MARGIN = 2;
/** Below this many px of error the camera just lands on the target (avoids endless sub-pixel drift). */
const SETTLE_PX = 0.05;
/** Long frames (tab switch) shouldn't overshoot or stall the math. */
const MAX_DT_MS = 250;

/**
 * Clamp one axis of the camera centre (px) so the view stays inside [0, mapPx].
 * When the map is smaller than the viewport, centre the map instead.
 */
export function clampAxis(center: number, viewPx: number, mapPx: number | null): number {
  if (mapPx === null) return center;
  if (mapPx <= viewPx) return mapPx / 2;
  const half = viewPx / 2;
  return Math.min(Math.max(center, half), mapPx - half);
}

/** Frame-rate independent exponential approach of `current` toward `target`. */
export function approach(current: number, target: number, dtMs: number, tauMs = FOLLOW_TAU_MS): number {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS);
  const next = target + (current - target) * Math.exp(-dt / tauMs);
  return Math.abs(target - next) < SETTLE_PX ? target : next;
}

/** World container offset (px, integer) that puts `center` (world px) in the middle of the viewport. */
export function offsetFor(center: Vec2, viewport: { w: number; h: number }): Vec2 {
  return { x: Math.round(viewport.w / 2 - center.x), y: Math.round(viewport.h / 2 - center.y) };
}

export function screenToTileAt(offset: Vec2, sx: number, sy: number): Vec2 {
  return { x: (sx - offset.x) / TILE, y: (sy - offset.y) / TILE };
}

export function tileToScreenAt(offset: Vec2, x: number, y: number): Vec2 {
  return { x: x * TILE + offset.x, y: y * TILE + offset.y };
}

/** Visible whole-tile rect (with margin), clipped to the map when bounds are known. */
export function viewRect(
  offset: Vec2,
  viewport: { w: number; h: number },
  bounds: { w: number; h: number } | null,
  margin = VIEW_MARGIN,
): { x: number; y: number; w: number; h: number } {
  let x0 = Math.floor(-offset.x / TILE) - margin;
  let y0 = Math.floor(-offset.y / TILE) - margin;
  let x1 = Math.ceil((viewport.w - offset.x) / TILE) + margin;
  let y1 = Math.ceil((viewport.h - offset.y) / TILE) + margin;
  if (bounds) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(bounds.w, x1);
    y1 = Math.min(bounds.h, y1);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export const createCamera: CreateCamera = (layers, initialViewport) => {
  const viewport = { w: initialViewport.w, h: initialViewport.h };
  let bounds: { w: number; h: number } | null = null;
  const target: Vec2 = { x: 0, y: 0 }; // world px, unclamped
  const center: Vec2 = { x: 0, y: 0 }; // world px, clamped
  let offset: Vec2 = { x: 0, y: 0 };

  const clamped = (p: Vec2): Vec2 => ({
    x: clampAxis(p.x, viewport.w, bounds ? bounds.w * TILE : null),
    y: clampAxis(p.y, viewport.h, bounds ? bounds.h * TILE : null),
  });

  const apply = (): void => {
    offset = offsetFor(center, viewport);
    layers.world.position.set(offset.x, offset.y);
    layers.overlay.position.set(offset.x, offset.y);
  };

  const snapToTarget = (): void => {
    const c = clamped(target);
    center.x = c.x;
    center.y = c.y;
    apply();
  };

  const camera: Camera = {
    setBounds(mapW, mapH) {
      bounds = { w: mapW, h: mapH };
      snapToTarget();
    },
    follow(x, y, snap) {
      target.x = x * TILE;
      target.y = y * TILE;
      if (snap) snapToTarget();
    },
    update(dtMs) {
      const c = clamped(target);
      center.x = approach(center.x, c.x, dtMs);
      center.y = approach(center.y, c.y, dtMs);
      apply();
    },
    resize(w, h) {
      viewport.w = w;
      viewport.h = h;
      // Re-clamp immediately so a resize never shows space outside the map.
      const c = clamped(center);
      center.x = c.x;
      center.y = c.y;
      apply();
    },
    screenToTile: (sx, sy) => screenToTileAt(offset, sx, sy),
    tileToScreen: (x, y) => tileToScreenAt(offset, x, y),
    view: () => viewRect(offset, viewport, bounds),
  };
  apply();
  return camera;
};
