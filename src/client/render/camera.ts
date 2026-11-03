// Camera: keeps the followed tile position centred by offsetting layers.world.
// All math lives in pure helpers (exported for tests); createCamera only holds state and
// writes the snapped offset to the world container.
import { shakeOffset } from "./hit-fx-logic";
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

/**
 * The centre to draw with: the smoothed centre moved by under half a pixel so it sits a whole
 * number of pixels from the target. The player sprite and the world offset are both rounded to
 * pixels; without this their rounding errors differ frame to frame and the walking player
 * wobbles by a pixel on screen.
 */
export function pixelLocked(center: number, target: number): number {
  return target - Math.round(target - center);
}

/** World container offset (px, integer) that puts `center` (world px) in the middle of the viewport. */
export function offsetFor(center: Vec2, viewport: { w: number; h: number }): Vec2 {
  // Round each part on its own, like a sprite at `center` would be, so both move in step.
  return { x: Math.round(viewport.w / 2) - Math.round(center.x), y: Math.round(viewport.h / 2) - Math.round(center.y) };
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

/**
 * How far to zoom out on a small screen. 1 on anything roomy; on a phone about 0.7, picked so a
 * source pixel still covers a whole number of device pixels (crisp pixel art) where it can.
 */
export function viewZoom(cssW: number, cssH: number, dpr: number, scale: number): number {
  if (Math.min(cssW, cssH) >= 600) return 1;
  const devicePerSource = Math.round(scale * dpr * 0.7);
  const z = devicePerSource / (scale * dpr);
  return z >= 0.6 && z <= 0.85 ? z : 0.75;
}

/** Screen position of the world container: the world offset zoomed, on a whole device pixel. */
export function zoomedOffset(offset: number, zoom: number, dpr: number): number {
  const d = Math.max(1, dpr);
  return Math.round(offset * zoom * d) / d;
}

export const createCamera: CreateCamera = (layers, initialViewport) => {
  // Screen px. The world is drawn at `zoom`, so the camera works on a view of viewport / zoom.
  const viewport = { w: initialViewport.w, h: initialViewport.h };
  let zoom = 1;
  let dpr = 1;
  const worldView = () => ({ w: viewport.w / zoom, h: viewport.h / zoom });
  let bounds: { w: number; h: number } | null = null;
  const target: Vec2 = { x: 0, y: 0 }; // world px, unclamped
  const center: Vec2 = { x: 0, y: 0 }; // world px, clamped
  let offset: Vec2 = { x: 0, y: 0 };
  const quake = { t: 0, ms: 0, amp: 0 };

  const clamped = (p: Vec2): Vec2 => {
    const v = worldView();
    return {
      x: clampAxis(p.x, v.w, bounds ? bounds.w * TILE : null),
      y: clampAxis(p.y, v.h, bounds ? bounds.h * TILE : null),
    };
  };

  const apply = (): void => {
    const c = clamped(target);
    offset = offsetFor({ x: pixelLocked(center.x, c.x), y: pixelLocked(center.y, c.y) }, worldView());
    // The shake moves only what is drawn, never the tile maths (clicks still land true).
    const sx = Math.round(shakeOffset(quake.t, quake.ms, quake.amp));
    const sy = Math.round(shakeOffset(quake.t + 37, quake.ms + 37, quake.amp * 0.6));
    const px = zoomedOffset(offset.x, zoom, dpr) + sx;
    const py = zoomedOffset(offset.y, zoom, dpr) + sy;
    for (const layer of [layers.world, layers.overlay]) {
      layer.scale.set(zoom);
      layer.position.set(px, py);
    }
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
      if (quake.t < quake.ms) quake.t += dtMs;
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
    setZoom(z, devicePixelRatio) {
      if (z === zoom && devicePixelRatio === dpr) return;
      zoom = z > 0 ? z : 1;
      dpr = devicePixelRatio;
      const c = clamped(target);
      center.x = c.x;
      center.y = c.y;
      apply();
    },
    zoom: () => zoom,
    screenToTile: (sx, sy) => screenToTileAt(offset, sx / zoom, sy / zoom),
    tileToScreen: (x, y) => {
      const p = tileToScreenAt(offset, x, y);
      return { x: p.x * zoom, y: p.y * zoom };
    },
    view: () => viewRect(offset, worldView(), bounds),
    shake(ms, amp) {
      // A bigger or fresher hit replaces a dying one.
      if (quake.t < quake.ms && quake.amp > amp && quake.ms - quake.t > ms) return;
      quake.t = 0;
      quake.ms = Math.max(0, ms);
      quake.amp = amp;
    },
  };
  apply();
  return camera;
};
