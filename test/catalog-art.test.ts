// Cut-off audit for the art pack: every rect in the catalog lies inside its image, and every
// placeable item has art for each rotation it allows, stands on its feet point, fits its
// footprint and is not sliced off by a rect that is too small.
import { describe, expect, it } from "vitest";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import { allowedRotations, ITEMS } from "../src/shared/items";
import { getMap } from "../src/shared/maps";
import type { MapId } from "../src/shared/types";
import { asPoint, asRect, furnitureView, viewAnchorPx } from "../src/client/art/slice";
import type { RectTuple, SpriteEntry } from "../src/client/art/catalog-types";
import { pngSize, readPng, type Png } from "./png";

const ROOT = "src/client/public/assets/lpc/";
const cat = catalog as unknown as Record<string, unknown> & { furniture: Record<string, SpriteEntry>; props: Record<string, SpriteEntry> };

const isRect = (v: unknown): v is RectTuple => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number");

/** Every [x, y, w, h] in the catalog with the image it cuts from (the nearest enclosing `file`). */
function allRects(): { where: string; file: string; rect: RectTuple }[] {
  const out: { where: string; file: string; rect: RectTuple }[] = [];
  const walk = (v: unknown, file: string | null, where: string): void => {
    if (isRect(v)) {
      if (file) out.push({ where, file, rect: v });
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, file, `${where}[${i}]`));
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const f = typeof o.file === "string" && o.file.endsWith(".png") ? o.file : file;
    for (const [k, x] of Object.entries(o)) walk(x, f, where ? `${where}.${k}` : k);
  };
  walk(cat, null, "");
  return out;
}

const pngs = new Map<string, Png>();
const png = (file: string): Png => {
  if (!pngs.has(file)) pngs.set(file, readPng(ROOT + file));
  return pngs.get(file)!;
};

/** Sides where opaque art runs on past the rect edge (2+ touching pixels), i.e. a clipped sprite. */
function bleeds(img: Png, [x, y, w, h]: RectTuple): string[] {
  const sides: [string, [number, number, number, number][]][] = [
    ["top", Array.from({ length: w }, (_, i) => [x + i, y, x + i, y - 1])],
    ["bottom", Array.from({ length: w }, (_, i) => [x + i, y + h - 1, x + i, y + h])],
    ["left", Array.from({ length: h }, (_, j) => [x, y + j, x - 1, y + j])],
    ["right", Array.from({ length: h }, (_, j) => [x + w - 1, y + j, x + w, y + j])],
  ];
  return sides.filter(([, pts]) => pts.filter(([a, b, c, d]) => img.alpha(a, b) > 0 && img.alpha(c, d) > 0).length >= 2).map(([s]) => s);
}

/** Opaque bounds of a rect, relative to the rect's origin. */
function opaqueBox(img: Png, [x, y, w, h]: RectTuple): { x0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (img.alpha(x + i, y + j) > 0) {
        x0 = Math.min(x0, i);
        x1 = Math.max(x1, i + 1);
        y1 = Math.max(y1, j + 1);
      }
  return x1 < 0 ? null : { x0, x1, y1 };
}

/**
 * Rect edges where the art next door is a different sprite packed tight against this one, not a
 * clipped part of it (each checked by eye on the sheet).
 */
const PACKED_NEIGHBOURS: Record<string, string> = {
  "chair_wood|0": "the chair rows above and below on the dining-chair sheet",
  "chair_wood|1": "the chair rows above and below on the dining-chair sheet",
  "chair_wood|3": "the chair rows above and below (mirrored left view)",
  "bed_simple|1": "the right-facing bed starts on the next column",
  "bed_simple|3": "its own left view sits just before it",
  "crate|0": "the next crate on the crate sheet",
  "flower_pot|0": "the vase flower overlays on the planter sheet's top row",
  "table_round|0": "the long table's side view next to it",
  "rug|0": "the red rug variant directly below",
};

/** Legacy pieces whose art is a little wider than their footprint (changing it would move saved objects). */
const LEGACY_OVERHANG_PX: Record<string, number> = {
  table_wood: 8,
  bed_simple: 10,
  bellows: 6,
  // The barn's roof eaves reach 8px past each wall; its walls match the footprint, and it's built on a fixed lot.
  barn: 8,
};

/** Drawn from `pieces` per neighbour (posts and rails), not from the single rect. */
const PIECEWISE = new Set(["fence"]);

const T = 32;
const placeables = Object.values(ITEMS).filter((d) => d.kind === "furniture");

const entryFor = (id: string): SpriteEntry | undefined =>
  (Object.hasOwn(cat.furniture, id) ? cat.furniture[id] : undefined) ?? (Object.hasOwn(cat.props, id) ? cat.props[id] : undefined);

describe("catalog art bounds", () => {
  it("every rect in the catalog lies inside its image", () => {
    const rects = allRects();
    expect(rects.length).toBeGreaterThan(500);
    const bad = rects.filter(({ file, rect: [x, y, w, h] }) => {
      const { w: W, h: H } = pngSize(ROOT + file);
      return x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > W || y + h > H;
    });
    expect(bad.map((b) => `${b.where} ${b.file} ${b.rect}`)).toEqual([]);
  });
});

describe("placeable furniture art", () => {
  it("every placeable item has catalog art and a footprint", () => {
    const missing = placeables.filter((d) => !entryFor(d.id) || !d.footprint || d.footprint.w < 1 || d.footprint.h < 1);
    expect(missing.map((d) => d.id)).toEqual([]);
  });

  it("turns only to views that exist (left and back need their own art)", () => {
    const bad: string[] = [];
    for (const d of placeables) {
      const e = entryFor(d.id)!;
      const v = (e.variants && !Array.isArray(e.variants) ? e.variants : {}) as Record<string, unknown>;
      for (const r of allowedRotations(d.id)) {
        if (r === 1 && !asRect(v.left)) bad.push(`${d.id} r1`);
        if (r === 2 && !asRect(v.back)) bad.push(`${d.id} r2`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every view stands on a feet point inside its rect, with no art hanging below it", () => {
    const bad: string[] = [];
    for (const d of placeables) {
      const e = entryFor(d.id)!;
      const base = asRect(e.rect)!;
      for (const r of allowedRotations(d.id)) {
        const view = furnitureView(e, r)!;
        const a = view.anchor ?? viewAnchorPx(base, asPoint(e.anchor), view.rect);
        if (a[0] < 0 || a[1] < 0 || a[0] > view.rect[2] || a[1] > view.rect[3]) bad.push(`${d.id} r${r}: anchor ${a} outside ${view.rect}`);
        const box = opaqueBox(png(e.file!), view.rect);
        if (!box) bad.push(`${d.id} r${r}: empty art`);
        else if (box.y1 - a[1] > 2) bad.push(`${d.id} r${r}: ${box.y1 - a[1]}px of art below the feet point`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no view is cut off by its rect", () => {
    const bad: string[] = [];
    for (const d of placeables) {
      if (PIECEWISE.has(d.id)) continue;
      const e = entryFor(d.id)!;
      for (const r of allowedRotations(d.id)) {
        const cut = bleeds(png(e.file!), furnitureView(e, r)!.rect);
        if (cut.length && !Object.hasOwn(PACKED_NEIGHBOURS, `${d.id}|${r}`)) bad.push(`${d.id} r${r}: ${cut.join(",")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the neighbour allowlist only names views that still need it", () => {
    const stale = Object.keys(PACKED_NEIGHBOURS).filter((k) => {
      const [id, r] = k.split("|") as [string, string];
      const e = entryFor(id);
      return !e || bleeds(png(e.file!), furnitureView(e, Number(r) as 0 | 1 | 2 | 3)!.rect).length === 0;
    });
    expect(stale).toEqual([]);
  });

  it("solid floor art stays within its footprint (a few px of lip allowed)", () => {
    const bad: string[] = [];
    for (const d of placeables) {
      if (d.walkable || d.placeOn === "wall" || PIECEWISE.has(d.id)) continue;
      const e = entryFor(d.id)!;
      const base = asRect(e.rect)!;
      for (const r of allowedRotations(d.id)) {
        const view = furnitureView(e, r)!;
        let a = view.anchor ?? viewAnchorPx(base, asPoint(e.anchor), view.rect);
        if (view.mirror) a = [view.rect[2] - a[0], a[1]];
        const box = opaqueBox(png(e.file!), view.rect)!;
        const lo = view.mirror ? view.rect[2] - box.x1 : box.x0;
        const hi = view.mirror ? view.rect[2] - box.x0 : box.x1;
        const half = ((r % 2 === 1 ? d.footprint!.h : d.footprint!.w) * T) / 2;
        const over = Math.max(a[0] - lo, hi - a[0]) - half;
        if (over > (LEGACY_OVERHANG_PX[d.id] ?? 4)) bad.push(`${d.id} r${r}: ${over}px past its footprint`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("animation and lid frames match the front cell and are not cut off", () => {
    const bad: string[] = [];
    for (const d of placeables) {
      const e = entryFor(d.id)! as SpriteEntry & { frames?: unknown };
      if (!e.frames) continue;
      const base = asRect(e.rect)!;
      const frames = Array.isArray(e.frames) ? e.frames : Object.values(e.frames as Record<string, unknown>);
      for (const f of frames) {
        const rect = asRect(f);
        if (!rect || rect[2] !== base[2] || rect[3] !== base[3]) bad.push(`${d.id}: frame ${f} differs from ${base}`);
        else if (bleeds(png(e.file!), rect).length) bad.push(`${d.id}: frame ${f} cut off`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the fridge has closed, opening and open frames", () => {
    const e = entryFor("fridge") as SpriteEntry & { frames?: Record<string, unknown> };
    expect(Object.keys(e.frames ?? {})).toEqual(["closed", "opening", "open"]);
  });
});

/**
 * Props whose rect edge touches neighbouring art in a packed sheet, or tiles that join up on the
 * map (bench halves, fence runs, cliff and dock pieces). Checked by eye; nothing is cut off.
 */
const PROP_NEIGHBOURS: Readonly<Record<string, string>> = {
  bench_left: "joins bench_right",
  bench_right: "joins bench_left",
  well: "stone wall packed to the left",
  fence_deco: "fence pieces tile vertically",
  crate: "crates packed on every side",
  hay_bale: "the next bale's strap touches the right edge",
  bush: "bushes packed below and right",
  dock: "dock planks tile",
  cliff_face: "cliff tiles join",
  cliff_vines: "cliff tiles join",
  cave_mouth: "cliff tiles join",
  shipping_bin: "lid frames packed below and right",
};

describe("map prop art", () => {
  it("no prop placed on a map is cut off at its rect edge", () => {
    const used = new Set<string>();
    const maps: MapId[] = ["village", "riverside", "caves", "quarry", "home", "home_in"];
    for (const id of maps) for (const p of getMap(id).props) used.add(p.type);
    const props = (catalog as unknown as { props: Record<string, SpriteEntry> }).props;
    const bad: string[] = [];
    for (const t of used) {
      const e = props[t];
      const rect = e && asRect(e.rect);
      if (!e?.file || !rect) continue;
      const cut = bleeds(png(e.file), rect);
      if (cut.length && !Object.hasOwn(PROP_NEIGHBOURS, t)) bad.push(`${t}: ${cut.join(",")}`);
    }
    expect(bad).toEqual([]);
  });

  it("the hay bale stack is whole, top bale included", () => {
    const e = (catalog as unknown as { props: Record<string, SpriteEntry> }).props.hay_bale!;
    const [x, y, w] = asRect(e.rect)!;
    const img = png(e.file!);
    // Nothing of the stack sits just above the rect: the top bale is inside it.
    let above = 0;
    for (let i = 0; i < w; i++) if (img.alpha(x + i, y - 1) > 0) above++;
    expect(above).toBe(0);
  });
});
