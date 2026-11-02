// Every map prop type. Sprites are footprint-wide (trees wider) and taller than the footprint
// where it makes sense; the bottom edge of the texture is the bottom edge of the footprint.
import { PROP_FOOTPRINTS } from "../../../shared/maps/props";
import type { InteriorPropType } from "../../../shared/maps/interiors/props";
import { drawInteriorProp } from "./interior";
import { hashStr, P, rng, shade, type Rgb } from "../palette";
import { blacksmith, cottage, houseLarge, houseSmall, houseWide, inn, townHall } from "./buildings";
import { PixelGrid } from "./grid";

const T = 32;

export interface PropDrawing {
  grid: PixelGrid;
  /** Anchor 0..1 (bottom centre of the footprint). */
  anchor: { x: number; y: number };
}

function canvas(wTiles: number, hTiles: number, extraTop: number, extraSide = 0): PixelGrid {
  return new PixelGrid(wTiles * T + extraSide * 2, hTiles * T + extraTop);
}

/** Leafy clump made of overlapping lit balls, dithered with leaf noise. */
function foliage(g: PixelGrid, cx: number, cy: number, rx: number, ry: number, seed: number, base: Rgb = P.leaf): void {
  const r = rng(seed);
  const dark = shade(base, -0.35);
  const light = shade(base, 0.22);
  const top = shade(base, 0.4);
  g.ellipse(cx, cy + 2, rx, ry, dark);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    blobs.push([cx + Math.cos(a) * rx * 0.55, cy + Math.sin(a) * ry * 0.5, Math.min(rx, ry) * 0.5]);
  }
  for (const [bx, by, br] of blobs) g.ellipse(bx, by + 1, br + 1, br, dark);
  for (const [bx, by, br] of blobs) g.ellipse(bx - 1, by - 1, br, br - 1, base);
  g.ellipse(cx - 1, cy - 1, rx * 0.7, ry * 0.65, base);
  for (const [bx, by, br] of blobs) if (by < cy + 2) g.ellipse(bx - br * 0.35, by - br * 0.4, br * 0.5, br * 0.4, light);
  g.ellipse(cx - rx * 0.35, cy - ry * 0.45, rx * 0.25, ry * 0.18, top);
  // Leaf texture: small dark/light flecks inside the canopy.
  for (let i = 0; i < rx * ry * 0.35; i++) {
    const x = Math.round(cx + (r() - 0.5) * rx * 1.8);
    const y = Math.round(cy + (r() - 0.5) * ry * 1.8);
    const c = g.get(x, y);
    if (c === null) continue;
    g.px(x, y, r() < 0.55 ? shade(c, -0.2) : shade(c, 0.15));
    if (r() < 0.5) g.px(x + 1, y, shade(c, -0.25));
  }
}

function tree(): PixelGrid {
  const g = canvas(1, 1, 64, 16); // 64 x 96
  const cx = 32;
  // Trunk with root flare.
  g.rect(cx - 5, 62, 10, 32, P.bark);
  g.vline(cx - 5, 62, 32, shade(P.bark, 0.2));
  g.rect(cx + 2, 62, 3, 32, shade(P.bark, -0.25));
  g.poly([[cx - 9, 95], [cx - 5, 86], [cx - 5, 95]], P.bark);
  g.poly([[cx + 9, 95], [cx + 5, 86], [cx + 5, 95]], shade(P.bark, -0.2));
  g.vline(cx - 1, 70, 8, shade(P.bark, -0.3));
  foliage(g, cx, 38, 28, 30, 11);
  g.outline("self");
  return g;
}

function bush(seed = 3): PixelGrid {
  const g = canvas(1, 1, 4);
  foliage(g, 16, 22, 13, 11, seed, 0x4f9a3a);
  const r = rng(seed + 9);
  for (let i = 0; i < 5; i++) {
    const x = Math.round(8 + r() * 16);
    const y = Math.round(14 + r() * 12);
    if (g.get(x, y) === null) continue;
    g.px(x, y, 0xf27a9a);
    g.px(x + 1, y, 0xf6b0c4);
  }
  g.outline("self");
  return g;
}

function boulder(g: PixelGrid, cx: number, base: number, rx: number, ry: number, c: Rgb = P.stone): void {
  const cy = base - ry;
  g.ellipse(cx, cy + 1, rx, ry, shade(c, -0.3));
  g.ellipse(cx - 1, cy - 1, rx - 1.5, ry - 1.5, c);
  g.ellipse(cx - rx * 0.35, cy - ry * 0.4, rx * 0.45, ry * 0.35, shade(c, 0.25));
  g.line(cx + rx * 0.1, cy - ry * 0.2, cx + rx * 0.4, cy + ry * 0.4, shade(c, -0.3));
  g.hline(Math.round(cx - rx + 2), base - 1, Math.round(rx * 2 - 4), shade(c, -0.4));
}

function rockDeco(): PixelGrid {
  const g = canvas(1, 1, 0);
  boulder(g, 16, 31, 13, 11);
  g.px(9, 25, 0x7fb04a);
  g.px(10, 26, 0x5f9a3a);
  g.outline("self");
  return g;
}

function fountain(): PixelGrid {
  const g = canvas(3, 3, 20); // 96 x 116
  const cx = 48;
  const by = 84;
  // Outer basin rim (stone ring) and water inside.
  g.ellipse(cx, by + 4, 46, 26, shade(P.stone, -0.35));
  g.ellipse(cx, by, 46, 26, P.stoneLight);
  g.ellipse(cx, by + 2, 40, 21, P.stone);
  g.ellipse(cx, by + 3, 38, 19, P.water);
  g.ellipse(cx - 8, by - 4, 22, 8, P.waterLight, 140);
  for (const [x, y] of [[cx - 22, by + 8], [cx + 14, by + 12], [cx + 24, by - 2]]) {
    g.hline(x, y, 6, P.foam);
    g.hline(x + 1, y + 1, 4, P.waterDark);
  }
  // Front lip of the basin in front of the water.
  g.rect(cx - 46, by + 4, 92, 8, P.stone);
  g.ellipse(cx, by + 12, 46, 18, shade(P.stone, -0.15));
  g.ellipse(cx, by + 4, 40, 15, P.water);
  g.ellipse(cx, by + 2, 40, 13, P.water);
  // Pedestal and two tiers.
  g.rect(cx - 5, 42, 10, by - 38, P.stoneLight);
  g.vline(cx + 4, 42, by - 38, P.stoneDark);
  g.ellipse(cx, 60, 20, 7, shade(P.stone, -0.3));
  g.ellipse(cx, 58, 20, 7, P.stoneLight);
  g.ellipse(cx, 58, 16, 5, P.water);
  g.ellipse(cx, 36, 11, 4.5, shade(P.stone, -0.3));
  g.ellipse(cx, 34, 11, 4.5, P.stoneLight);
  g.ellipse(cx, 34, 8, 3, P.water);
  // Water spout and falling streams.
  g.rect(cx - 2, 16, 4, 18, P.foam);
  g.ellipse(cx, 16, 4, 3, 0xffffff);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 10; i++) g.px(cx + s * (12 + i * 0.4), 38 + i * 2, P.foam, 200);
    for (let i = 0; i < 12; i++) g.px(cx + s * (21 + i * 0.6), 62 + i * 2, P.foam, 200);
  }
  g.outline("self");
  return g;
}

function noticeBoard(): PixelGrid {
  const g = canvas(2, 1, 30); // 64 x 62
  for (const x of [8, 52]) {
    g.rect(x, 18, 5, 44, P.woodDark);
    g.vline(x, 18, 44, P.woodLight);
  }
  g.box(4, 10, 56, 32, P.wood);
  g.rect(6, 12, 52, 28, 0xc29a62);
  g.poly([[2, 10], [32, 2], [62, 10]], P.roofBrown);
  g.hline(2, 10, 61, shade(P.roofBrown, -0.4));
  const notes: [number, number, Rgb][] = [[10, 15, P.cream], [24, 18, 0xf2e6a0], [40, 14, P.white], [14, 27, 0xd8e8f0], [34, 28, P.cream]];
  for (const [x, y, c] of notes) {
    g.rect(x, y, 11, 10, c);
    g.hline(x + 2, y + 3, 7, 0x8a8070);
    g.hline(x + 2, y + 5, 5, 0x8a8070);
    g.px(x + 5, y, P.cloth);
  }
  g.outline("self");
  return g;
}

function well(): PixelGrid {
  const g = canvas(2, 2, 36); // 64 x 100
  const cx = 32;
  // Posts and roof.
  for (const x of [6, 53]) {
    g.rect(x, 18, 5, 60, P.woodDark);
    g.vline(x, 18, 60, P.woodLight);
  }
  g.rect(8, 30, 48, 3, P.woodDark); // crossbar
  g.vline(cx, 33, 18, 0x9a8a6a); // rope
  g.box(cx - 4, 50, 8, 7, P.wood); // bucket
  g.poly([[0, 22], [cx, 2], [64, 22], [64, 26], [0, 26]], P.roofRed);
  for (let y = 6; y < 26; y += 4) g.tint(0, y, 64, 1, shade(P.roofRed, -0.25), 160);
  g.hline(0, 26, 64, shade(P.roofRed, -0.5));
  // Stone ring.
  g.ellipse(cx, 76, 26, 10, P.stoneDark);
  g.ellipse(cx, 76, 20, 6, 0x1c2a36);
  g.rect(6, 76, 52, 22, P.stone);
  g.ellipse(cx, 98, 26, 4, P.stone);
  for (let y = 80; y < 98; y += 6) {
    for (let x = 6 + ((y / 6) % 2) * 5; x < 58; x += 10) g.vline(x, y, 6, P.stoneDark);
    g.hline(6, y, 52, P.stoneDark);
  }
  g.hline(6, 77, 52, P.stoneLight);
  g.outline("self");
  return g;
}

function shippingBin(): PixelGrid {
  const g = canvas(2, 1, 14); // 64 x 46
  g.box(4, 16, 56, 30, P.wood);
  for (let y = 22; y < 44; y += 6) g.hline(5, y, 54, P.woodDark);
  g.rect(4, 8, 56, 10, P.woodLight);
  g.hline(4, 8, 56, shade(P.woodLight, 0.25));
  g.hline(4, 17, 56, P.woodDark);
  for (const x of [6, 54]) g.rect(x, 8, 4, 38, P.iron);
  g.rect(28, 20, 8, 6, P.gold);
  g.px(31, 23, P.woodDark);
  // A crop peeking out.
  g.ellipse(46, 8, 5, 4, 0xf08a2a);
  g.vline(46, 2, 3, 0x4a8a2a);
  g.outline("self");
  return g;
}

/** Wooden post with a rounded tin mailbox; the red flag is drawn by render/mailbox.ts. */
export function mailbox(): PixelGrid {
  const g = canvas(1, 1, 18); // 32 x 50
  g.rect(13, 24, 6, 26, P.wood);
  g.vline(13, 24, 26, P.woodLight);
  g.vline(18, 24, 26, P.woodDark);
  const tin = 0x5b86b4;
  g.box(4, 12, 24, 14, tin);
  g.ellipse(16, 12, 12, 6, tin);
  g.hline(6, 9, 20, shade(tin, 0.3));
  g.hline(5, 24, 22, shade(tin, -0.3));
  // Front door of the box with its latch.
  g.box(4, 12, 6, 13, shade(tin, -0.15));
  g.px(8, 18, P.gold);
  g.outline("self");
  return g;
}

function fenceSegment(g: PixelGrid, x0: number, w: number, base: number): void {
  for (const y of [base - 18, base - 9]) {
    g.rect(x0, y, w, 4, P.wood);
    g.hline(x0, y, w, P.woodLight);
    g.hline(x0, y + 3, w, P.woodDark);
  }
}

function fencePost(g: PixelGrid, x: number, base: number): void {
  g.rect(x, base - 24, 6, 24, P.wood);
  g.vline(x, base - 24, 24, P.woodLight);
  g.vline(x + 5, base - 24, 24, P.woodDark);
  g.rect(x, base - 25, 6, 2, P.woodLight);
}

function fenceDeco(): PixelGrid {
  const g = canvas(1, 1, 4);
  fenceSegment(g, 0, 32, 30);
  fencePost(g, 3, 32);
  fencePost(g, 23, 32);
  g.outline("self");
  return g;
}

function boat(g: PixelGrid, cx: number, cy: number, len: number): void {
  const half = len / 2;
  g.poly([[cx - half, cy - 4], [cx + half, cy - 4], [cx + half - 6, cy + 6], [cx - half + 6, cy + 6]], 0x7a4a2a);
  g.poly([[cx - half + 3, cy - 3], [cx + half - 3, cy - 3], [cx + half - 7, cy + 3], [cx - half + 7, cy + 3]], 0xa86a3a);
  g.hline(Math.round(cx - half), cy - 4, len, 0xc48d55);
  for (const x of [cx - 8, cx + 8]) g.rect(x - 2, cy - 3, 4, 6, P.woodDark);
  g.line(cx - 4, cy - 1, cx + 10, cy + 2, 0xc8b080); // oar
}

function dock(): PixelGrid {
  const g = canvas(4, 1, 16); // 128 x 48
  boat(g, 64, 34, 44);
  for (const x of [4, 118]) {
    g.rect(x, 10, 7, 36, 0x6b4428);
    g.ellipse(x + 3.5, 10, 3.5, 2, 0x8a5a33);
    g.vline(x, 12, 34, 0x8a5a33);
  }
  g.line(10, 18, 44, 30, 0xc8b080);
  g.ellipse(14, 44, 5, 2, 0xc8b080);
  g.outline("self");
  return g;
}

function shrine(): PixelGrid {
  const g = canvas(3, 2, 52); // 96 x 116
  const cx = 48;
  // Stepped stone base.
  g.rect(4, 96, 88, 20, P.stone);
  g.hline(4, 96, 88, P.stoneLight);
  g.rect(14, 84, 68, 13, P.stoneLight);
  g.hline(14, 84, 68, 0xb0acb4);
  for (let x = 10; x < 90; x += 14) g.vline(x, 97, 19, P.stoneDark);
  // Small wooden shrine house.
  g.rect(28, 46, 40, 38, 0x9a3a2a);
  g.rect(32, 50, 32, 34, 0x3a2420);
  g.vline(cx, 50, 34, 0x9a3a2a);
  g.poly([[18, 46], [cx, 22], [78, 46]], P.roofSlate);
  g.poly([[14, 48], [82, 48], [78, 42], [18, 42]], shade(P.roofSlate, -0.2));
  for (let y = 28; y < 46; y += 4) g.tint(20, y, 56, 1, shade(P.roofSlate, 0.15), 120);
  // Stone lantern on the steps: the gem quest's empty socket glows faintly.
  for (const lx of [10, 78]) {
    g.rect(lx + 2, 70, 4, 14, P.stoneLight);
    g.box(lx, 60, 8, 10, P.stone);
    g.rect(lx + 2, 63, 4, 4, 0xc8a8f0);
    g.poly([[lx - 2, 60], [lx + 4, 55], [lx + 10, 60]], P.stoneDark);
  }
  g.ellipse(cx, 70, 5, 5, P.gem, 90);
  g.outline("self");
  return g;
}

function bridgeBroken(): PixelGrid {
  const g = canvas(4, 3, 0); // 128 x 96
  const r = rng(41);
  // Deck slats run across the river; the middle ones are missing, the ones next to the gap are snapped short.
  for (let x = 0; x < 128; x += 7) {
    const gapDist = Math.min(Math.abs(x - 50), Math.abs(x - 78));
    if (x > 50 && x < 78) continue;
    const broken = gapDist < 10;
    const top = 26 + (broken ? Math.floor(r() * 10) : 0);
    const bottom = 78 - (broken ? Math.floor(r() * 12) : 0);
    g.rect(x, top, 6, bottom - top, P.wood);
    g.vline(x, top, bottom - top, P.woodLight);
    g.vline(x + 5, top, bottom - top, P.woodDark);
    g.hline(x, top, 6, broken ? P.woodLight : shade(P.wood, 0.1));
    if (broken) for (let i = 0; i < 3; i++) g.px(x + i * 2, bottom, P.wood);
  }
  // Support beams under the deck and rails with posts; one rail dangles into the gap.
  for (const y of [22, 78]) {
    g.rect(0, y, 52, 4, P.woodDark);
    g.rect(78, y, 50, 4, P.woodDark);
    for (const x of [2, 40, 82, 120]) {
      g.rect(x, y - 10, 5, 14, 0x6b4428);
      g.vline(x, y - 10, 14, 0x8a5a33);
    }
  }
  g.line(52, 23, 60, 40, P.woodDark);
  g.line(52, 24, 60, 41, P.woodDark);
  g.line(78, 80, 70, 92, 0xc8b080);
  g.outline("self");
  return g;
}

function lanternPost(): PixelGrid {
  const g = canvas(1, 1, 64); // 32 x 96
  const cx = 16;
  g.ellipse(cx, 26, 14, 14, P.flameHot, 40);
  g.rect(cx - 2, 30, 4, 62, P.iron);
  g.vline(cx - 2, 30, 62, P.ironLight);
  g.rect(cx - 5, 88, 10, 6, P.iron);
  g.rect(cx - 6, 14, 12, 3, P.iron);
  g.rect(cx - 5, 17, 10, 12, P.flameHot);
  g.rect(cx - 3, 19, 6, 8, 0xfffbe0);
  g.vline(cx - 5, 17, 12, P.iron);
  g.vline(cx + 4, 17, 12, P.iron);
  g.rect(cx - 6, 29, 12, 3, P.iron);
  g.poly([[cx - 7, 14], [cx, 7], [cx + 7, 14]], P.iron);
  g.px(cx, 5, P.iron);
  g.outline("self");
  return g;
}

function signPost(): PixelGrid {
  const g = canvas(1, 1, 8); // 32 x 40
  g.rect(14, 12, 4, 26, P.woodDark);
  g.vline(14, 12, 26, P.woodLight);
  g.box(3, 8, 26, 9, P.wood);
  g.rect(4, 9, 24, 2, P.woodLight);
  g.poly([[29, 8], [31, 12], [29, 16]], P.wood);
  g.outline("self");
  return g;
}

function ladder(): PixelGrid {
  const g = canvas(1, 1, 24); // 32 x 56
  g.ellipse(16, 44, 14, 9, 0x14101a); // hole in the ground
  g.ellipse(16, 43, 11, 6, 0x0a0810);
  for (const x of [8, 22]) {
    g.rect(x, 0, 3, 48, P.wood);
    g.vline(x, 0, 48, P.woodLight);
  }
  for (let y = 4; y < 46; y += 7) g.rect(10, y, 12, 2, P.woodDark);
  g.outline("self");
  return g;
}

/** Fallback for props/ladder_hole.png: a pit in the floor with the ladder's top showing. */
function ladderHole(): PixelGrid {
  const g = canvas(1, 1, 0); // 32 x 32
  g.ellipse(16, 18, 14, 11, 0x666d8c);
  g.ellipse(16, 19, 11, 8, 0x100e18);
  for (const x of [9, 19]) g.rect(x, 4, 4, 22, P.wood);
  for (let y = 7; y < 26; y += 6) g.rect(13, y, 6, 2, P.woodDark);
  g.outline("self");
  return g;
}

/** Rock face with a grass lip, optionally with a dark cave opening in its lower part. */
function cliff(wTiles: number, mouth: boolean): PixelGrid {
  const g = canvas(wTiles, 4, 0);
  const w = wTiles * T;
  const rock = 0x7f4c31;
  g.rect(0, 0, w, 12, P.grass);
  g.rect(0, 12, w, 4, shade(rock, -0.35));
  g.rect(0, 16, w, 4 * T - 16, rock);
  for (let y = 24; y < 4 * T; y += 10) g.hline(0, y + ((y / 10) % 2) * 3, w, shade(rock, -0.2));
  g.rect(0, 4 * T - 4, w, 4, P.grass);
  if (mouth) {
    g.rect(3, 48, w - 6, 4 * T - 48, 0x2e1f1c);
    g.ellipse(w / 2, 48, w / 2 - 3, 18, 0x2e1f1c);
  }
  return g;
}

function mineCart(): PixelGrid {
  const g = canvas(2, 1, 20); // 64 x 52
  // Rails.
  g.rect(0, 44, 64, 2, P.ironLight);
  g.rect(0, 50, 64, 2, P.ironLight);
  for (let x = 2; x < 64; x += 10) g.rect(x, 43, 4, 10, P.woodDark);
  // Cart body (trapezoid) with ore heap.
  g.ellipse(32, 14, 22, 8, P.stoneDark);
  for (const [x, y, c] of [[22, 10, P.copper], [36, 8, P.ironOre], [42, 13, P.copper], [28, 14, P.gemLight]] as const) {
    g.rect(x, y, 4, 3, c);
    g.px(x, y, 0xffffff);
  }
  g.poly([[8, 16], [56, 16], [50, 40], [14, 40]], 0x6a5a52);
  g.rect(8, 16, 48, 3, P.ironLight);
  for (const x of [16, 30, 44]) g.vline(x, 19, 20, shade(0x6a5a52, -0.3));
  g.hline(12, 30, 40, P.iron);
  for (const x of [18, 46]) {
    g.ellipse(x, 43, 5, 5, P.iron);
    g.ellipse(x, 43, 2, 2, P.ironLight);
  }
  g.outline("self");
  return g;
}

function campfire(): PixelGrid {
  const g = canvas(1, 1, 12); // 32 x 44
  g.ellipse(16, 36, 15, 10, P.flame, 50);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.ball(16 + Math.cos(a) * 11, 37 + Math.sin(a) * 5, 3, 2.5, P.stone, P.stoneDark, P.stoneLight);
  }
  g.line(9, 39, 23, 33, P.bark);
  g.line(9, 38, 23, 32, shade(P.bark, 0.2));
  g.line(9, 33, 23, 39, P.bark);
  g.poly([[9, 36], [16, 16], [23, 36]], P.flame);
  g.poly([[11, 36], [14, 22], [17, 30], [19, 20], [21, 36]], 0xf8c040);
  g.poly([[13, 36], [16, 26], [19, 36]], P.flameHot);
  g.px(12, 14, P.flameHot);
  g.px(20, 12, P.flame);
  g.outline("self");
  return g;
}

function herbPatch(): PixelGrid {
  const g = canvas(1, 1, 4);
  const r = rng(77);
  for (let i = 0; i < 9; i++) {
    const x = 5 + r() * 22;
    const y = 12 + r() * 18;
    const c = i % 2 ? 0x5fae4a : 0x7cc85a;
    g.line(x, y + 4, x, y - 1, 0x3a7a2a);
    g.ellipse(x - 2, y, 2.5, 1.6, c);
    g.ellipse(x + 2, y - 1, 2.5, 1.6, shade(c, 0.12));
    g.ellipse(x, y - 3, 1.8, 1.8, shade(c, 0.2));
  }
  for (const [x, y] of [[8, 10], [22, 14], [15, 20]]) {
    g.px(x, y, 0xd8b0f0);
    g.px(x + 1, y, 0xb88ae0);
  }
  g.outline("self");
  return g;
}

function fishingSpot(): PixelGrid {
  const g = new PixelGrid(T, T);
  g.ellipse(16, 18, 6, 2.5, P.waterDark, 220); // fish shadow
  g.poly([[21, 18], [25, 15], [25, 21]], P.waterDark, 220);
  for (const [rx, ry, a] of [[13, 7, 200], [9, 5, 230]] as const) {
    for (let t = 0; t < 64; t++) {
      const ang = (t / 64) * Math.PI * 2;
      if (Math.sin(ang * 3) < -0.3) continue; // broken rings look like moving water
      g.px(16 + Math.cos(ang) * rx, 16 + Math.sin(ang) * ry, P.foam, a);
    }
  }
  g.px(10, 10, 0xffffff);
  g.px(22, 22, 0xffffff);
  return g;
}

function crate(seed: number): PixelGrid {
  const g = canvas(1, 1, 6);
  const tone = rng(seed)() < 0.5 ? P.wood : 0x9a6a3a;
  g.box(3, 8, 26, 24, tone);
  g.rect(4, 9, 24, 3, P.woodLight);
  g.line(5, 13, 26, 30, P.woodDark);
  g.rect(3, 19, 26, 2, P.woodDark);
  g.outline("self");
  return g;
}

/** Two-tile wooden load: a hay bale or a barrow, told apart by tone. */
function wideLoad(tone: Rgb, wheel: boolean): PixelGrid {
  const g = canvas(2, 1, 6);
  g.box(4, 10, 56, 20, tone);
  g.rect(5, 11, 54, 3, shade(tone, 0.25));
  g.rect(4, 20, 56, 2, shade(tone, -0.3));
  if (wheel) g.ball(52, 30, 4, 4, P.woodDark, P.woodDark, P.wood);
  g.outline("self");
  return g;
}

function benchHalf(left: boolean): PixelGrid {
  const g = canvas(1, 1, 4);
  const x = left ? 2 : 0;
  g.box(x, 10, 30, 8, P.wood);
  g.box(x, 19, 30, 6, P.woodLight);
  g.rect(left ? 5 : 25, 25, 3, 7, P.woodDark);
  return g;
}

function lilyPad(r: number, bloom?: Rgb): PixelGrid {
  const g = canvas(1, 1, 0);
  g.ball(16, 22, r, r * 0.6, 0x4f9a3a, 0x2f6a2a, 0x7cc05a);
  if (bloom !== undefined) g.ball(17, 20, 3, 2, bloom, shade(bloom, -0.3), shade(bloom, 0.3));
  return g;
}

function reedClump(): PixelGrid {
  const g = canvas(1, 1, 18);
  for (const x of [10, 13, 16, 19, 22]) g.vline(x, 14 + (x % 3) * 3, 34 - (x % 3) * 3, 0x7a9a3a);
  return g;
}

type Drawer = () => PixelGrid;

type OutdoorPropType = Exclude<keyof typeof PROP_FOOTPRINTS, InteriorPropType>;

const DRAWERS: Record<OutdoorPropType, Drawer> = {
  tree,
  bush: () => bush(),
  rock_deco: rockDeco,
  house_small: () => withOutline(houseSmall()),
  house_large: () => withOutline(houseLarge()),
  town_hall: () => withOutline(townHall()),
  police_station: () => withOutline(houseLarge()),
  inn: () => withOutline(inn()),
  blacksmith: () => withOutline(blacksmith()),
  market_stall: marketStall,
  fountain,
  notice_board: noticeBoard,
  well,
  shipping_bin: shippingBin,
  fence_deco: fenceDeco,
  dock,
  shrine,
  bridge_broken: bridgeBroken,
  lantern_post: lanternPost,
  sign_post: signPost,
  ladder,
  ladder_hole: ladderHole,
  cave_mouth: () => cliff(3, true),
  cliff_face: () => cliff(2, false),
  cliff_vines: () => cliff(3, false),
  mine_cart: mineCart,
  campfire,
  cottage,
  home_house: () => withOutline(houseSmall()),
  mailbox,
  herb_patch: herbPatch,
  fishing_spot: fishingSpot,
  house_iris: () => withOutline(houseSmall()),
  house_fenwick: () => withOutline(houseSmall()),
  house_tess: () => withOutline(houseLarge()),
  house_odette: () => withOutline(houseLarge()),
  house_marlo: () => withOutline(houseLarge()),
  house_bram: () => withOutline(houseLarge()),
  house_grumm: () => withOutline(houseLarge()),
  house_pip: () => withOutline(houseWide()),
  bench_left: () => benchHalf(true),
  bench_right: () => benchHalf(false),
  lilypad: () => lilyPad(9),
  lilypad_small: () => lilyPad(6),
  lily_pink: () => lilyPad(8, 0xf27a9a),
  lily_white: () => lilyPad(8, 0xf4f0e0),
  water_reeds: reedClump,
  reeds: reedClump,
  tall_grass: reedClump,
  flower_bush_pink: () => bush(5),
  flower_bush_red: () => bush(7),
  flower_bush_yellow: () => bush(11),
  garden_cabbage: () => bush(13),
  garden_pumpkin: () => bush(17),
  garden_carrot: () => bush(19),
  garden_lettuce: () => bush(23),
  woodpile: () => crate(29),
  hay_bale: () => wideLoad(0xd8b452, false),
  wheelbarrow: () => wideLoad(P.wood, true),
};

function withOutline(g: PixelGrid): PixelGrid {
  g.outline("self");
  return g;
}

function marketStall(): PixelGrid {
  const g = canvas(3, 2, 40); // 96 x 104
  // Posts.
  for (const x of [6, 86]) {
    g.rect(x, 20, 5, 82, P.woodDark);
    g.vline(x, 20, 82, P.woodLight);
  }
  // Counter with produce crates.
  g.box(2, 70, 92, 32, P.wood);
  for (let y = 76; y < 100; y += 6) g.hline(3, y, 90, P.woodDark);
  g.rect(2, 66, 92, 6, P.woodLight);
  g.hline(2, 71, 92, P.woodDark);
  const goods: Rgb[] = [0xd8402c, 0xf08a2a, 0x8ac040, 0xe8d050];
  goods.forEach((c, i) => {
    const x = 8 + i * 21;
    g.box(x, 58, 18, 10, 0x8a5a2e);
    for (let k = 0; k < 4; k++) g.ball(x + 4 + k * 3.5, 57 - (k % 2), 2.5, 2.5, c, shade(c, -0.3), shade(c, 0.35));
  });
  // Striped awning with scalloped edge.
  const stripeA = 0xd04a3a;
  const stripeB = P.cream;
  g.poly([[0, 22], [10, 4], [86, 4], [96, 22]], stripeA);
  for (let x = 0; x < 96; x++) {
    for (let y = 4; y < 23; y++) {
      if (!g.opaque(x, y)) continue;
      const band = Math.floor((x - (y - 4) * 0.5 + 100) / 12) % 2;
      g.px(x, y, band ? stripeB : stripeA);
    }
  }
  for (let x = 0; x < 96; x += 12) {
    g.ellipse(x + 6, 23, 6, 4, Math.floor(x / 12) % 2 ? stripeB : stripeA);
  }
  g.hline(0, 22, 96, 0x000000, 50);
  g.hline(10, 4, 76, shade(stripeA, 0.3));
  g.outline("self");
  return g;
}

export function drawProp(type: string): PropDrawing {
  const drawer = Object.hasOwn(DRAWERS, type) ? DRAWERS[type as keyof typeof DRAWERS] : null;
  // Unknown prop types still get something sensible: a crate, sized to one tile.
  const grid = drawer ? drawer() : (drawInteriorProp(type) ?? crate(hashStr(type)));
  return { grid, anchor: { x: 0.5, y: 1 } };
}

export const PROP_TYPES = Object.keys(PROP_FOOTPRINTS) as (keyof typeof PROP_FOOTPRINTS)[];
