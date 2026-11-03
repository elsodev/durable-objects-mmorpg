import { describe, expect, it } from "vitest";
import type { Layers } from "../src/client/contracts";
import { TILE } from "../src/client/contracts";
import { approach, clampAxis, createCamera, offsetFor, pixelLocked, viewRect, viewZoom, zoomedOffset } from "../src/client/render/camera";

function fakeLayers() {
  const pos = () => ({ x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } });
  const world = { position: pos(), scale: pos() };
  const overlay = { position: pos(), scale: pos() };
  return { world, overlay } as unknown as Layers & { world: { position: { x: number; y: number } }; overlay: { position: { x: number; y: number } } };
}

describe("camera math", () => {
  it("clamps to map edges and centres small maps", () => {
    expect(clampAxis(10, 800, 3200)).toBe(400);
    expect(clampAxis(3100, 800, 3200)).toBe(2800);
    expect(clampAxis(1000, 800, 3200)).toBe(1000);
    expect(clampAxis(50, 800, 600)).toBe(300);
    expect(clampAxis(-99, 800, null)).toBe(-99);
  });

  it("approaches frame-rate independently and settles", () => {
    const oneStep = approach(0, 100, 32);
    const twoSteps = approach(approach(0, 100, 16), 100, 16);
    expect(oneStep).toBeCloseTo(twoSteps, 6);
    expect(oneStep).toBeGreaterThan(0);
    expect(oneStep).toBeLessThan(100);
    let v = 0;
    for (let i = 0; i < 200; i++) v = approach(v, 100, 16);
    expect(v).toBe(100);
    expect(approach(0, 100, 0)).toBe(0);
  });

  it("produces integer offsets", () => {
    const o = offsetFor({ x: 100.4, y: 33.6 }, { w: 801, h: 600 });
    expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
  });

  it("keeps a walking target at a fixed screen pixel while the camera trails it", () => {
    let center = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const target = i * 1.37; // ~4.5 tiles/s at 60 fps, never pixel aligned
      center = approach(center, target, 1000 / 60);
      const off = offsetFor({ x: pixelLocked(center, target), y: 0 }, { w: 801, h: 600 });
      if (i > 60) seen.add(Math.round(target) + off.x); // sprite px (roundPixels) + world offset
    }
    expect(seen.size).toBe(1);
  });

  it("view rect covers the viewport plus margin, clipped to bounds", () => {
    const r = viewRect({ x: -10 * TILE, y: -5 * TILE }, { w: 4 * TILE, h: 2 * TILE }, null, 1);
    expect(r).toEqual({ x: 9, y: 4, w: 6, h: 4 });
    const c = viewRect({ x: 0, y: 0 }, { w: 4 * TILE, h: 2 * TILE }, { w: 3, h: 10 }, 2);
    expect(c).toEqual({ x: 0, y: 0, w: 3, h: 4 });
  });
});

describe("createCamera", () => {
  const vp = { w: 10 * TILE, h: 6 * TILE };

  it("centres the target on snap and round-trips screen/tile", () => {
    const layers = fakeLayers();
    const cam = createCamera(layers, vp);
    cam.setBounds(50, 40);
    cam.follow(20.5, 15.25, true);
    const s = cam.tileToScreen(20.5, 15.25);
    expect(s.x).toBeCloseTo(vp.w / 2, 0);
    expect(s.y).toBeCloseTo(vp.h / 2, 0);
    const t = cam.screenToTile(s.x, s.y);
    expect(t.x).toBeCloseTo(20.5);
    expect(t.y).toBeCloseTo(15.25);
    expect(layers.world.position.x).toBe(Math.round(vp.w / 2 - 20.5 * TILE));
    expect(layers.overlay.position).toMatchObject({ x: layers.world.position.x, y: layers.world.position.y });
  });

  it("clamps at the map corner and centres a small map", () => {
    const layers = fakeLayers();
    const cam = createCamera(layers, vp);
    cam.setBounds(50, 40);
    cam.follow(0, 0, true);
    expect(layers.world.position.x).toBe(0);
    expect(layers.world.position.y).toBe(0);
    expect(cam.view().x).toBe(0);

    cam.setBounds(4, 3);
    cam.follow(1, 1, true);
    expect(layers.world.position.x).toBe((vp.w - 4 * TILE) / 2);
    expect(layers.world.position.y).toBe((vp.h - 3 * TILE) / 2);
    expect(cam.view()).toEqual({ x: 0, y: 0, w: 4, h: 3 });
  });

  it("follows smoothly and reaches the target", () => {
    const layers = fakeLayers();
    const cam = createCamera(layers, vp);
    cam.setBounds(100, 100);
    cam.follow(30, 30, true);
    cam.follow(32, 30);
    cam.update(16);
    const mid = cam.screenToTile(vp.w / 2, vp.h / 2).x;
    expect(mid).toBeGreaterThan(30);
    expect(mid).toBeLessThan(32);
    for (let i = 0; i < 120; i++) cam.update(16);
    expect(cam.screenToTile(vp.w / 2, vp.h / 2).x).toBeCloseTo(32, 1);
    expect(Number.isInteger(layers.world.position.x)).toBe(true);
  });

  it("re-clamps on resize", () => {
    const layers = fakeLayers();
    const cam = createCamera(layers, vp);
    cam.setBounds(12, 8);
    cam.follow(11, 7, true);
    cam.resize(20 * TILE, 10 * TILE);
    expect(layers.world.position.x).toBe((20 * TILE - 12 * TILE) / 2);
    expect(layers.world.position.y).toBe((10 * TILE - 8 * TILE) / 2);
  });
});

describe("phone zoom", () => {
  it("leaves roomy screens alone", () => {
    expect(viewZoom(1280, 800, 2, 2)).toBe(1);
    expect(viewZoom(800, 600, 1, 2)).toBe(1);
  });
  it("zooms out on phones, keeping whole device pixels per source pixel", () => {
    expect(viewZoom(390, 844, 3, 2)).toBeCloseTo(4 / 6);
    expect(viewZoom(390, 844, 2, 2)).toBe(0.75);
    expect(viewZoom(844, 390, 3, 2)).toBeCloseTo(4 / 6);
    // No whole-pixel choice near 0.7 at DPR 1: fall back to 0.75.
    expect(viewZoom(390, 700, 1, 2)).toBe(0.75);
  });
  it("puts the zoomed world offset on a device pixel", () => {
    expect(zoomedOffset(-101, 2 / 3, 3)).toBeCloseTo(Math.round(-101 * 2) / 3);
    expect(zoomedOffset(-101, 0.75, 2)).toBe(-75.5);
  });
  it("round-trips screen and tile at a zoom, and sees more tiles", () => {
    const layers = fakeLayers();
    const vp = { w: 390, h: 844 };
    const cam = createCamera(layers, vp);
    cam.setBounds(100, 100);
    cam.follow(50, 50, true);
    const before = cam.view();
    cam.setZoom!(0.75, 2);
    const s = cam.tileToScreen(50, 50);
    expect(s.x).toBeCloseTo(vp.w / 2, 0);
    const t = cam.screenToTile(s.x, s.y);
    expect(t.x).toBeCloseTo(50);
    expect(t.y).toBeCloseTo(50);
    expect(cam.view().w).toBeGreaterThan(before.w);
    expect(cam.zoom!()).toBe(0.75);
  });
});
