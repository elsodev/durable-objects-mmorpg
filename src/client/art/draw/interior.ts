// Building interiors. The north wall of a room is a row of 1x3 tile pieces seen from inside (the
// LPC pack only has outside facades), drawn here so styles join seamlessly: a beam/eave band on
// top, the wall face, a skirting board, and an optional window, shelf or wall hanging.
// Furniture normally comes from the LPC atlas; the boxes below only stand in when it fails to load.
import {
  INTERIOR_PROP_FOOTPRINTS,
  WALL_FEATURES,
  WALL_STYLES,
  wallPiece,
  type InteriorPropType,
  type WallFeature,
  type WallStyle,
} from "../../../shared/maps/interiors/props";
import { P, hashStr, mix, shade, type Rgb } from "../palette";
import { material, window } from "./buildings";
import { PixelGrid } from "./grid";

const T = 32;
/** Wall pieces reach this far above the map's top edge (the room's ceiling line). */
const WALL_EXTRA = 16;
const EAVE = 30;

interface WallLook {
  base: Rgb;
  pattern: "brick" | "plank" | "stone" | "log";
  band: Rgb;
  bandPattern: "shingle" | "plank" | "slate";
  skirting: Rgb;
  /** Lower wall panelling (wainscot) colour, or null. */
  wainscot: Rgb | null;
  curtain: Rgb | null;
}

const LOOKS: Record<WallStyle, WallLook> = {
  plaster: { base: P.plaster, pattern: "plank", band: 0x5e3b22, bandPattern: "plank", skirting: 0x6e4a2c, wainscot: 0x8a5a34, curtain: 0x9a2f3a },
  timber: { base: 0x9a6538, pattern: "plank", band: 0x4a2e1c, bandPattern: "plank", skirting: 0x3e2616, wainscot: null, curtain: 0x2f6a4a },
  stone: { base: 0x6e6a74, pattern: "stone", band: 0x3a3640, bandPattern: "slate", skirting: 0x45414c, wainscot: null, curtain: null },
  log: { base: 0xb48455, pattern: "log", band: P.roofRed, bandPattern: "shingle", skirting: 0x6e4a2c, wainscot: null, curtain: P.cloth },
};

function wallBase(g: PixelGrid, look: WallLook): void {
  const W = g.w;
  const H = g.h;
  g.rect(0, 0, W, EAVE, look.band);
  material(g, 0, 0, W, EAVE, look.bandPattern === "plank" ? "plank" : look.bandPattern, look.band);
  g.rect(0, EAVE, W, 4, shade(look.band, -0.5));
  const top = EAVE + 4;
  g.rect(0, top, W, H - top, look.base);
  // Plaster stays smooth with a faint texture; the others use their material.
  if (look.pattern === "plank" && look.wainscot) {
    for (let y = top; y < H; y += 9) for (let x = (y * 7) % 13; x < W; x += 13) g.px(x, y, shade(look.base, -0.06));
  } else {
    material(g, 0, top, W, H - top, look.pattern, look.base);
  }
  if (look.wainscot) {
    const wy = H - 34;
    g.rect(0, wy, W, 24, look.wainscot);
    material(g, 0, wy, W, 24, "plank", look.wainscot);
    g.hline(0, wy, W, shade(look.wainscot, 0.3));
    g.rect(0, wy - 2, W, 2, shade(look.wainscot, -0.35));
  }
  g.rect(0, H - 10, W, 10, look.skirting);
  g.hline(0, H - 10, W, shade(look.skirting, 0.25));
  g.rect(0, top, W, 3, 0x000000, 70); // shadow under the beam
  // Timber walls get a post every tile so a long wall reads as framed.
  if (look.pattern === "plank" && !look.wainscot) {
    g.rect(0, top, 3, H - top - 10, shade(look.base, -0.35));
    g.vline(1, top, H - top - 10, shade(look.base, -0.15));
  }
}

function hanging(g: PixelGrid, style: WallStyle, seed: number): void {
  const cy = EAVE + 30;
  if (style === "stone") {
    // Crossed hammers on a wooden plaque.
    g.box(6, cy - 10, 20, 20, 0x6e4a2c);
    g.line(9, cy + 7, 22, cy - 7, P.iron);
    g.line(9, cy - 7, 22, cy + 7, P.iron);
    g.rect(19, cy - 9, 6, 4, P.ironLight);
    g.rect(7, cy - 9, 6, 4, P.ironLight);
    return;
  }
  if (style === "timber") {
    // Mounted antlers on a shield.
    g.box(10, cy - 6, 12, 14, 0x6e4a2c);
    for (const [a, b] of [[4, 8], [28, 24]] as const) {
      g.line(16, cy - 4, a, cy - 14, 0xe8dcc0);
      g.line(b, cy - 10, a + (a < 16 ? 2 : -2), cy - 18, 0xe8dcc0);
    }
    return;
  }
  // Framed painting: sky, hills, sun (colours vary per seed).
  const frame = mix(P.gold, P.woodDark, 0.45);
  g.box(4, cy - 12, 24, 20, frame);
  g.rect(6, cy - 10, 20, 16, [0x8ac0e0, 0xe0b080, 0x9ab8d8][seed % 3]!);
  g.rect(6, cy - 1, 20, 7, [0x5a9a4a, 0x7a8a3a, 0x4a7a9a][seed % 3]!);
  g.ellipse(11 + (seed % 3) * 4, cy - 5, 2.5, 2.5, 0xf2e070);
}

function shelf(g: PixelGrid, style: WallStyle, seed: number): void {
  const sy = EAVE + 34;
  g.rect(1, sy, 30, 3, P.woodDark);
  g.hline(1, sy, 30, P.woodLight);
  g.rect(4, sy + 3, 2, 4, P.woodDark);
  g.rect(26, sy + 3, 2, 4, P.woodDark);
  const items: Rgb[] =
    style === "timber"
      ? [0x2f6a3a, 0x6a2a2a, 0x2f4a6a, 0x8a6a2a] // bottles
      : style === "stone"
        ? [P.iron, P.ironLight, P.iron, P.copper]
        : style === "plaster"
          ? [0x7a2a2a, 0x2a4a7a, 0x3a6a3a, 0x8a6a3a] // books
          : [0x7fc8d8, 0xe0a050, 0x9ad070, 0xd06a6a]; // jars
  for (let i = 0; i < 4; i++) {
    const c = items[(i + seed) % 4]!;
    const x = 3 + i * 7;
    if (style === "plaster") {
      g.rect(x, sy - 10, 5, 10, c);
      g.hline(x, sy - 9, 5, shade(c, 0.35));
    } else if (style === "timber") {
      g.rect(x + 1, sy - 9, 4, 9, c);
      g.rect(x + 2, sy - 12, 2, 3, c);
      g.px(x + 2, sy - 7, shade(c, 0.5));
    } else {
      g.rect(x, sy - 8, 5, 8, c);
      g.hline(x, sy - 8, 5, shade(c, 0.3));
      g.hline(x, sy - 9, 5, P.woodDark);
    }
  }
}

function wallPieceDrawing(style: WallStyle, feature: WallFeature): PixelGrid {
  const g = new PixelGrid(T, 3 * T + WALL_EXTRA);
  const look = LOOKS[style];
  wallBase(g, look);
  const seed = hashStr(`${style}_${feature}`);
  switch (feature) {
    case "window": {
      const top = EAVE + 14;
      window(g, 6, top, 20, 22, style === "stone" ? 0x9a9aa6 : 0xe8d6ae);
      if (look.curtain) {
        g.rect(2, top - 4, 28, 3, look.curtain);
        g.rect(2, top - 2, 4, 24, look.curtain);
        g.rect(26, top - 2, 4, 24, look.curtain);
        g.vline(3, top - 2, 24, shade(look.curtain, 0.25));
      }
      break;
    }
    case "shelf":
      shelf(g, style, seed);
      break;
    case "art":
      hanging(g, style, seed);
      break;
    case "plain":
      break;
  }
  return g;
}

/** Staircase climbing north into the wall (2 tiles wide), timber banister on the east side. */
function stairsUp(): PixelGrid {
  const W = 2 * T;
  const H = 3 * T + WALL_EXTRA;
  const g = new PixelGrid(W, H);
  wallBase(g, LOOKS.timber);
  // Dark landing opening at the top of the flight.
  g.rect(4, EAVE + 4, W - 12, 18, 0x1e1410);
  const steps = 7;
  const stepH = Math.floor((H - EAVE - 24) / steps);
  for (let i = 0; i < steps; i++) {
    const y = H - (i + 1) * stepH;
    const tread = shade(P.wood, 0.1 - i * 0.05);
    g.rect(4, y, W - 12, stepH, tread);
    g.hline(4, y, W - 12, shade(tread, 0.3));
    g.hline(4, y + stepH - 1, W - 12, shade(tread, -0.35));
  }
  // Banister.
  g.rect(W - 8, EAVE + 4, 4, H - EAVE - 4, P.woodDark);
  g.vline(W - 8, EAVE + 4, H - EAVE - 4, P.woodLight);
  for (let y = EAVE + 12; y < H - 4; y += 10) g.rect(W - 10, y, 2, 6, P.woodDark);
  g.rect(W - 9, H - 18, 6, 18, P.woodDark);
  return g;
}

function doormat(): PixelGrid {
  const g = new PixelGrid(T, T);
  g.rect(3, 9, 26, 18, 0x8a6a3a);
  for (let y = 10; y < 26; y += 2) g.hline(4, y, 24, 0x6e5230);
  g.rect(3, 9, 26, 1, 0xa8844c);
  g.rect(5, 11, 22, 14, 0x9a3a2a, 90);
  return g;
}

/** Stand-in furniture when the atlas is missing: a wood block the size of the footprint. */
function furnitureBox(type: InteriorPropType): PixelGrid {
  const fp = INTERIOR_PROP_FOOTPRINTS[type];
  const W = fp.w * T;
  const extra = 12;
  const H = fp.h * T + extra;
  const g = new PixelGrid(W, H);
  const flat = type.startsWith("rug_") || type === "doormat";
  if (flat) {
    const c = type === "rug_red" ? 0x9a2f3a : 0x6a8a4a;
    g.rect(2, extra + 2, W - 4, H - extra - 4, c);
    g.rect(5, extra + 5, W - 10, H - extra - 10, shade(c, 0.2));
    return g;
  }
  const bed = type.startsWith("bed_");
  const base: Rgb = bed ? 0xc8402f : type === "forge" ? P.stone : type === "smith_anvil" ? P.iron : P.wood;
  g.box(2, 2, W - 4, H - 4, base);
  g.rect(3, 3, W - 6, 4, shade(base, 0.25));
  if (bed) g.rect(6, 6, W - 12, 10, P.cream);
  g.outline("self");
  return g;
}

const DRAWERS = new Map<string, () => PixelGrid>();
for (const s of WALL_STYLES) for (const f of WALL_FEATURES) DRAWERS.set(wallPiece(s, f), () => wallPieceDrawing(s, f));
DRAWERS.set("stairs_up", stairsUp);
DRAWERS.set("doormat", doormat);
for (const type of Object.keys(INTERIOR_PROP_FOOTPRINTS) as InteriorPropType[]) {
  if (!DRAWERS.has(type)) DRAWERS.set(type, () => furnitureBox(type));
}

/** Procedural drawing for an interior prop type, or null for other types. */
export function drawInteriorProp(type: string): PixelGrid | null {
  return DRAWERS.get(type)?.() ?? null;
}

/**
 * Interior props that are always procedural. None since the art kit landed (walls, stairs and
 * the doormat have LPC art); the drawers above remain the fallback when the catalog lacks a key.
 */
export const PROCEDURAL_INTERIOR_PROPS: ReadonlySet<string> = new Set();
