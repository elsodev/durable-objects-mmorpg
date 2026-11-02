// Night lights sit on the lit part of their art: every lamp, lantern and fire glows from its
// glass, bulb or flame (not from its footprint), and lit house windows match the panes pixel for
// pixel.
import { describe, expect, it } from "vitest";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import type { SpriteEntry } from "../src/client/art/catalog-types";
import { asPoint, asRect } from "../src/client/art/slice";
import { SCALE, TILE } from "../src/client/contracts";
import { glowAlpha, LIGHT_SOURCES, LIT_WINDOWS, lightSpots, litWindowsAt, windowGlow } from "../src/client/render/light-points";
import { allowedRotations, getItem, ITEMS } from "../src/shared/items";
import { getMap } from "../src/shared/maps";
import { PROP_FOOTPRINTS } from "../src/shared/maps/props";
import { readPng, type Png } from "./png";

const ROOT = "src/client/public/assets/lpc/";
type Section = Record<string, SpriteEntry & { light?: string }>;
const cat = catalog as unknown as { furniture: Section; props: Section; buildings: Section };
const ALIASES: Record<string, string> = { home_house: "cottage" };

const pngs = new Map<string, Png>();
const png = (file: string): Png => {
  if (!pngs.has(file)) pngs.set(file, readPng(ROOT + file));
  return pngs.get(file)!;
};

/** The art a name draws with: a placed item prefers its furniture entry, a map prop its prop entry. */
function artOf(name: string, as: "furniture" | "prop"): SpriteEntry | undefined {
  if (as === "furniture") return cat.furniture[name] ?? cat.props[name];
  return cat.props[name] ?? cat.buildings[name] ?? cat.buildings[ALIASES[name] ?? ""];
}

/** Things that give off light, by name: lamps, lanterns, candles, torches, fires and stoves. */
const GLOWS = /lamp|lantern|candle|torch|fire|sconce|hearth|stove/;
/** Named like a light, but dark. */
const NOT_LIGHTS = new Set(["lantern_post_unlit"]);

function lightNames(): Set<string> {
  const names = new Set<string>();
  for (const id of Object.keys(PROP_FOOTPRINTS)) if (GLOWS.test(id)) names.add(id);
  for (const d of Object.values(ITEMS)) if (d.kind === "furniture" && (GLOWS.test(d.id) || /lamp/i.test(d.desc ?? ""))) names.add(d.id);
  for (const [k, e] of Object.entries(cat.props)) if (e.light) names.add(k);
  for (const id of ["home", "home_in", "village", "riverside", "caves", "quarry"] as const)
    for (const p of getMap(id).props) if (GLOWS.test(p.type)) names.add(p.type);
  for (const n of NOT_LIGHTS) names.delete(n);
  return names;
}

const lum = ([r, g, b]: number[]) => 0.3 * r! + 0.59 * g! + 0.11 * b!;

describe("light points", () => {
  it("covers every lamp, lantern, candle and fire", () => {
    const missing = [...lightNames()].filter((n) => !LIGHT_SOURCES[n]);
    expect(missing).toEqual([]);
  });

  it("puts every light point on opaque, bright pixels of its art, in every frame", () => {
    const bad: string[] = [];
    for (const [name, src] of Object.entries(LIGHT_SOURCES)) {
      const uses = [getItem(name)?.kind === "furniture" ? "furniture" : null, artOf(name, "prop") ? "prop" : null].filter(Boolean);
      expect(uses.length, `${name} has art`).toBeGreaterThan(0);
      for (const use of uses as ("furniture" | "prop")[]) {
        const e = artOf(name, use)!;
        const rect = asRect(e.rect)!;
        const [ax, ay] = asPoint(e.anchor) ?? [rect[2] / 2, rect[3]];
        const cells = Array.isArray(e.frames) ? e.frames.map((f) => asRect(f)!) : [rect];
        for (const [dx, dy] of src.points) {
          for (const [cx, cy] of cells) {
            const px = Math.floor(cx + ax + dx);
            const py = Math.floor(cy + ay + dy);
            const img = png(e.file);
            if (img.alpha(px, py) < 200) bad.push(`${name} (${use}): (${dx}, ${dy}) is not on the art`);
            // The lit part: a bright pixel (glass, bulb, flame) within 2 px.
            let bright = 0;
            for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) bright = Math.max(bright, img.alpha(px + i, py + j) > 200 ? lum(img.rgba(px + i, py + j)) : 0);
            if (bright < 150) bad.push(`${name} (${use}): (${dx}, ${dy}) is not near a lit pixel (${bright.toFixed(0)})`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("lights the lamp post at its lantern head, not the middle of the post", () => {
    const e = cat.props.lantern_post!;
    const [, ay] = asPoint(e.anchor)!;
    const [, dy] = LIGHT_SOURCES.lantern_post!.points[0]!;
    // The head is the top quarter of the sprite.
    expect(ay + dy).toBeLessThan(asRect(e.rect)![3] / 4);
  });

  it("only uses front-view points, so lamps never turn", () => {
    for (const name of Object.keys(LIGHT_SOURCES)) if (getItem(name)) expect(allowedRotations(name), name).toEqual([0]);
  });

  it("places glows from the sprite's anchor in world px, scaled and mirrored", () => {
    const [s] = lightSpots("lantern_post", 8.5 * TILE, 12 * TILE);
    expect(s).toEqual({ x: 8.5, y: 12 - (60 * SCALE) / TILE, radius: LIGHT_SOURCES.lantern_post!.radius });
    const pair = lightSpots("wall_lamp_double", 0, 0);
    expect(pair.map((p) => p.x)).toEqual([(-11 * SCALE) / TILE, (11 * SCALE) / TILE]);
    expect(lightSpots("wall_lamp_double", 0, 0, true).map((p) => p.x)).toEqual([(11 * SCALE) / TILE, (-11 * SCALE) / TILE]);
    expect(lightSpots("chair_wood", 0, 0)).toEqual([]);
  });

  it("glows the home yard's lamp post well above its footprint", () => {
    const post = getMap("home").props.find((p) => p.type === "lantern_post")!;
    const [s] = lightSpots(post.type, (post.x + post.w / 2) * TILE, (post.y + post.h) * TILE);
    expect(s!.x).toBe(post.x + 0.5);
    expect(s!.y).toBeLessThan(post.y - 0.8);
  });
});

describe("lit windows", () => {
  it("overlays exactly the building's black panes, on the building's own rect and anchor", () => {
    for (const [type, lit] of Object.entries(LIT_WINDOWS)) {
      const b = artOf(type, "prop")!;
      const o = cat.props[lit.art]!;
      expect(o.rect, type).toEqual(b.rect);
      expect(o.anchor, type).toEqual(b.anchor);
      const house = png(b.file);
      const over = png(o.file);
      expect([over.w, over.h]).toEqual([house.w, house.h]);
      const [rx, ry, rw, rh] = asRect(b.rect)!;
      const [ax, ay] = asPoint(b.anchor)!;
      const inWindow = (x: number, y: number) =>
        lit.windows.some(([wx, wy, w, h]) => x >= rx + ax + wx && x < rx + ax + wx + w && y >= ry + ay + wy && y < ry + ay + wy + h);
      const wrong: string[] = [];
      for (let y = 0; y < house.h; y++) {
        for (let x = 0; x < house.w; x++) {
          const pane = house.rgba(x, y).join() === "0,0,0,255";
          const glows = over.alpha(x, y) > 0;
          if (pane !== glows) wrong.push(`${x},${y}: pane ${pane}, lit ${glows}`);
          if (glows && !inWindow(x, y)) wrong.push(`${x},${y}: lit outside the window rects`);
          if (glows && lum(over.rgba(x, y)) < 150) wrong.push(`${x},${y}: lit pane too dark`);
        }
      }
      expect(wrong.slice(0, 5), type).toEqual([]);
      // Each window rect is tight around its panes: its corners are lit.
      for (const [wx, wy, w, h] of lit.windows) {
        const x0 = rx + ax + wx;
        const y0 = ry + ay + wy;
        expect([over.alpha(x0, y0), over.alpha(x0 + w - 1, y0 + h - 1)].every((a) => a > 0), `${type} window ${wx},${wy}`).toBe(true);
      }
    }
  });

  it("covers the yard house's two windows", () => {
    expect(getMap("home").props.some((p) => p.type === "home_house")).toBe(true);
    expect(LIT_WINDOWS.home_house!.windows).toHaveLength(2);
  });

  it("places the windows in world px and spills a glow from each centre", () => {
    const v = litWindowsAt("home_house", 512, 704, 704)!;
    expect(v.windows[0]).toEqual({ x: 512 - 10 * SCALE, y: 704 - 109 * SCALE, w: 22 * SCALE, h: 14 * SCALE });
    const g = windowGlow(v.windows[0]!, 1.5);
    expect(g).toEqual({ x: (512 - 10 * SCALE + 11 * SCALE) / TILE, y: (704 - 109 * SCALE + 7 * SCALE) / TILE, radius: 1.5 });
    expect(litWindowsAt("tree", 0, 0, 0)).toBeNull();
  });
});

describe("glow brightness", () => {
  it("indoor lamps glow softer than outdoor ones", () => {
    expect(glowAlpha(1, 1, true)).toBeLessThan(glowAlpha(1, 1, false));
  });
  it("many lamps share the light instead of washing the room out", () => {
    expect(glowAlpha(1, 12, true)).toBeLessThan(glowAlpha(1, 3, true));
    // The total stays bounded: twelve lamps are at most twice as bright as three.
    expect(12 * glowAlpha(1, 12, true)).toBeLessThanOrEqual(2 * 3 * glowAlpha(1, 3, true) + 1e-9);
  });
  it("is off when the lamps are off", () => {
    expect(glowAlpha(0, 5, false)).toBe(0);
  });
});
