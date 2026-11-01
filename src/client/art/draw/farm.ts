// Crops (4 growth stages) and mining rocks, each on a 32x32 tile with the base at the bottom.
import { hashStr, P, rng, shade, type Rgb } from "../palette";
import { PixelGrid } from "./grid";

export type Ore = "stone" | "copper" | "iron" | "gem";
export type Stage = 0 | 1 | 2 | 3;

const LEAF = 0x5aa83e;
const LEAF_DARK = 0x3a7a2a;
const BASE_Y = 28;

/** Pointed leaf from (x, y) toward (x+dx, y+dy). */
export function leaf(g: PixelGrid, x: number, y: number, dx: number, dy: number, w: number, c: Rgb = LEAF): void {
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  g.poly([[x, y], [x + dx * 0.5 + nx, y + dy * 0.5 + ny], [x + dx, y + dy], [x + dx * 0.5 - nx, y + dy * 0.5 - ny]], c);
  g.line(x, y, x + dx * 0.8, y + dy * 0.8, shade(c, -0.25));
}

function mound(g: PixelGrid): void {
  g.ellipse(16, BASE_Y + 1, 7, 2.5, 0x5c3c22);
  g.ellipse(16, BASE_Y, 6, 2, 0x8f6440);
}

function sprout(g: PixelGrid, c: Rgb = LEAF): void {
  mound(g);
  g.vline(16, BASE_Y - 5, 5, LEAF_DARK);
  leaf(g, 16, BASE_Y - 4, -5, -3, 1.5, c);
  leaf(g, 16, BASE_Y - 5, 5, -3, 1.5, shade(c, 0.12));
}

function rosette(g: PixelGrid, n: number, len: number, w: number, c: Rgb, cy = BASE_Y): void {
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    leaf(g, 16, cy, Math.cos(a) * len, Math.sin(a) * len * 0.9, w, i % 2 ? c : shade(c, 0.12));
  }
}

function turnip(g: PixelGrid, s: Stage): void {
  if (s === 0) return sprout(g);
  mound(g);
  if (s === 3) {
    g.ball(16, BASE_Y - 3, 6, 5, 0xf2ece0, 0xc8b8c8, 0xffffff);
    g.ellipse(16, BASE_Y - 7, 5, 2.5, 0x9a4aa8);
    g.hline(13, BASE_Y - 6, 6, 0xc070c8);
  }
  rosette(g, s === 1 ? 3 : 5, s === 1 ? 7 : 10, s === 1 ? 2 : 3, LEAF, s === 3 ? BASE_Y - 7 : BASE_Y);
}

function carrot(g: PixelGrid, s: Stage): void {
  if (s === 0) return sprout(g, 0x6ab848);
  mound(g);
  if (s === 3) {
    g.poly([[11, BASE_Y - 6], [21, BASE_Y - 6], [16, BASE_Y + 1]], 0xf0842a);
    g.hline(11, BASE_Y - 6, 10, 0xf8a850);
    g.hline(13, BASE_Y - 3, 3, 0xc0601a);
  }
  // Feathery fronds: thin stems with tiny leaflets.
  const fronds = s === 1 ? 3 : 6;
  const h = s === 1 ? 9 : s === 2 ? 15 : 17;
  for (let i = 0; i < fronds; i++) {
    const t = i / (fronds - 1);
    const tx = 16 + (t - 0.5) * (s === 1 ? 10 : 18);
    const ty = BASE_Y - 4 - h + Math.abs(t - 0.5) * 6;
    g.line(16, BASE_Y - 5, tx, ty, LEAF_DARK);
    for (let k = 1; k < 4; k++) {
      const x = 16 + (tx - 16) * (k / 4);
      const y = BASE_Y - 5 + (ty - BASE_Y + 5) * (k / 4);
      g.px(x - 1, y, 0x6ab848);
      g.px(x + 1, y - 1, 0x86cc5a);
    }
    g.px(tx, ty - 1, 0x86cc5a);
  }
}

function strawberry(g: PixelGrid, s: Stage): void {
  if (s === 0) return sprout(g);
  mound(g);
  const r = rng(5 + s);
  const leaves = s === 1 ? 3 : 7;
  for (let i = 0; i < leaves; i++) {
    const x = 16 + (r() - 0.5) * (s === 1 ? 8 : 18);
    const y = BASE_Y - 4 - r() * (s === 1 ? 4 : 10);
    g.line(16, BASE_Y - 1, x, y, LEAF_DARK);
    for (const [ox, oy] of [[-2, -1], [2, -1], [0, -3]]) g.ball(x + ox, y + oy, 2.5, 2, LEAF, LEAF_DARK, 0x86cc5a);
  }
  if (s === 2) {
    for (const [x, y] of [[10, 18], [21, 16], [15, 13]]) {
      g.rect(x - 1, y, 3, 1, P.white);
      g.rect(x, y - 1, 1, 3, P.white);
      g.px(x, y, P.gold);
    }
  }
  if (s === 3) {
    for (const [x, y] of [[9, 22], [20, 20], [14, 15], [23, 25], [12, 26]]) {
      g.poly([[x - 2.5, y - 1], [x + 2.5, y - 1], [x, y + 4]], 0xd83030);
      g.px(x - 1, y, 0xff8a8a);
      g.px(x + 1, y + 1, 0xf2e070);
      g.hline(x - 1, y - 2, 3, 0x3a8a2a);
    }
  }
}

function pumpkin(g: PixelGrid, s: Stage): void {
  if (s === 0) return sprout(g);
  // Curling vine with broad leaves.
  g.line(4, BASE_Y, 28, BASE_Y - 2, LEAF_DARK);
  g.line(6, BASE_Y - 1, 10, BASE_Y - 4, LEAF_DARK);
  const leaves: [number, number, number][] = s === 1 ? [[16, BASE_Y - 3, 4]] : [[7, BASE_Y - 6, 5], [24, BASE_Y - 7, 5], [16, BASE_Y - 10, 4.5]];
  for (const [x, y, rr] of leaves) {
    g.ball(x, y, rr, rr * 0.8, LEAF, LEAF_DARK, 0x86cc5a);
    g.px(x, y, LEAF_DARK);
  }
  if (s >= 2) {
    const big = s === 3;
    const c = big ? 0xf08a24 : 0x8ab040;
    const rx = big ? 9 : 4.5;
    const ry = big ? 7 : 3.5;
    const cy = BASE_Y - ry + 1;
    g.ball(16, cy, rx, ry, c, shade(c, -0.3), shade(c, 0.3));
    g.vline(16, Math.round(cy - ry + 2), Math.round(ry * 2 - 3), shade(c, -0.25));
    if (big) {
      g.vline(11, Math.round(cy - ry + 3), Math.round(ry * 2 - 5), shade(c, -0.2));
      g.vline(21, Math.round(cy - ry + 3), Math.round(ry * 2 - 5), shade(c, -0.2));
    }
    g.rect(15, Math.round(cy - ry - 2), 3, 3, 0x6a5a2a);
  }
}

const CROPS: Record<string, (g: PixelGrid, s: Stage) => void> = { turnip, carrot, strawberry, pumpkin };

export function drawCrop(crop: string, stage: Stage): PixelGrid {
  const g = new PixelGrid(32, 32);
  const id = crop.startsWith("seed_") ? crop.slice(5) : crop;
  const draw = Object.hasOwn(CROPS, id) ? CROPS[id] : null;
  if (draw) draw(g, stage);
  else genericCrop(g, stage, hashStr(id));
  g.outline("self");
  return g;
}

function genericCrop(g: PixelGrid, s: Stage, h: number): void {
  if (s === 0) return sprout(g);
  mound(g);
  rosette(g, 3 + s, 4 + s * 3, 1.5 + s * 0.5, LEAF);
  if (s === 3) {
    const c = [0xd83030, 0xf0c030, 0x9a4aa8, 0xf08a24][h % 4];
    g.ball(16, BASE_Y - 8, 3.5, 3.5, c, shade(c, -0.3), shade(c, 0.35));
  }
}

const ORE_FLECK: Record<Ore, [Rgb, Rgb] | null> = {
  stone: null,
  copper: [P.copper, P.copperLight],
  iron: [0xa8b0bc, 0xe8eef4],
  gem: null,
};

export function drawRock(ore: Ore): PixelGrid {
  const g = new PixelGrid(32, 32);
  const base = ore === "iron" ? 0x6a6874 : ore === "gem" ? 0x5e5866 : P.stone;
  // Two-lobed boulder: big back rock + smaller front rock.
  g.ellipse(16, 18, 14, 11, shade(base, -0.35));
  g.ellipse(15, 17, 12.5, 9.5, base);
  g.ellipse(11, 12, 6, 4, shade(base, 0.22));
  g.ellipse(22, 25, 8, 5, shade(base, -0.35));
  g.ellipse(21, 24, 7, 4, shade(base, 0.05));
  g.line(14, 18, 19, 22, shade(base, -0.35));
  g.line(8, 20, 11, 22, shade(base, -0.3));
  const fleck = ORE_FLECK[ore];
  if (fleck) {
    const r = rng(hashStr(ore));
    for (let i = 0; i < 6; i++) {
      const x = Math.round(6 + r() * 20);
      const y = Math.round(9 + r() * 16);
      if (g.get(x, y) === null || g.get(x + 1, y + 1) === null) continue;
      g.rect(x, y, 2, 2, fleck[0]);
      g.px(x, y, fleck[1]);
      g.px(x + 1, y + 1, shade(fleck[0], -0.3));
    }
  }
  if (ore === "gem") {
    crystal(g, 12, 16, 3, 9, P.gem);
    crystal(g, 18, 14, 3.5, 11, 0x7fd8e8);
    crystal(g, 23, 20, 2.5, 7, 0xd070e0);
  }
  g.outline("self");
  return g;
}

export function crystal(g: PixelGrid, x: number, base: number, hw: number, h: number, c: Rgb): void {
  g.poly([[x - hw, base], [x - hw, base - h + hw], [x, base - h], [x + hw, base - h + hw], [x + hw, base]], c);
  g.poly([[x, base], [x, base - h], [x + hw, base - h + hw], [x + hw, base]], shade(c, -0.25));
  g.line(x - hw + 1, base - 1, x - hw + 1, base - h + hw + 1, shade(c, 0.45));
}
