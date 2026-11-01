// 32x32 ground tiles. Every detail wraps around the edges so tiles repeat seamlessly.
import { Ground } from "../../../shared/types";
import { P, rng, type Rgb } from "../palette";
import { PixelGrid } from "./grid";

export const GROUND_VARIANTS = 4;
const S = 32;

/** Tilled variants >= GROUND_VARIANTS are the watered (darker) look; see placeholders.ts. */
export function drawGround(kind: Ground, variant: number): PixelGrid {
  const v = ((variant % (GROUND_VARIANTS * 2)) + GROUND_VARIANTS * 2) % (GROUND_VARIANTS * 2);
  const wet = v >= GROUND_VARIANTS;
  const rand = rng(kind * 7919 + (v % GROUND_VARIANTS) * 104729 + 17);
  const g = new PixelGrid(S, S);
  switch (kind) {
    case Ground.Grass:
      grass(g, rand);
      break;
    case Ground.Dirt:
      speckled(g, rand, P.dirt, P.dirtDark, P.dirtLight, 26, true);
      break;
    case Ground.Sand:
      speckled(g, rand, P.sand, P.sandDark, 0xf0dcaa, 30, false);
      break;
    case Ground.Water:
      water(g, rand);
      break;
    case Ground.Stone:
      stone(g, rand);
      break;
    case Ground.Wood:
      planks(g, rand, v % GROUND_VARIANTS);
      break;
    case Ground.Tilled:
      tilled(g, rand, wet);
      break;
    case Ground.CaveWall:
      caveWall(g, rand);
      break;
    case Ground.Wall:
      bricks(g, rand, v % GROUND_VARIANTS);
      break;
    default:
      g.rect(0, 0, S, S, P.void);
      for (let i = 0; i < 6; i++) wpx(g, rand() * S, rand() * S, 0x221d2b);
  }
  return g;
}

function wpx(g: PixelGrid, x: number, y: number, c: Rgb, a = 255): void {
  g.px(((Math.floor(x) % S) + S) % S, ((Math.floor(y) % S) + S) % S, c, a);
}

function grass(g: PixelGrid, rand: () => number): void {
  g.rect(0, 0, S, S, P.grass);
  // Soft mottling so large fields are not flat.
  for (let i = 0; i < 5; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const c = rand() < 0.5 ? P.grassDark : P.grassLight;
    for (let k = 0; k < 14; k++) wpx(g, cx + (rand() - 0.5) * 8, cy + (rand() - 0.5) * 5, c, 120);
  }
  // Little "v" tufts like the LPC grass.
  const tufts = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < tufts; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    wpx(g, x, y + 1, P.grassDark);
    wpx(g, x + 2, y + 1, P.grassDark);
    wpx(g, x, y, P.grassTuft);
    wpx(g, x + 2, y, P.grassTuft);
    wpx(g, x + 1, y + 1, P.grassLight);
  }
  if (rand() < 0.35) {
    // A tiny flower now and then.
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    const c = rand() < 0.5 ? 0xf2e6c4 : 0xf0a3b5;
    wpx(g, x, y - 1, c);
    wpx(g, x - 1, y, c);
    wpx(g, x + 1, y, c);
    wpx(g, x, y + 1, c);
    wpx(g, x, y, P.gold);
  }
}

function speckled(g: PixelGrid, rand: () => number, base: Rgb, dark: Rgb, light: Rgb, n: number, pebbles: boolean): void {
  g.rect(0, 0, S, S, base);
  for (let i = 0; i < n; i++) wpx(g, rand() * S, rand() * S, rand() < 0.6 ? dark : light);
  if (!pebbles) return;
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    wpx(g, x, y, light);
    wpx(g, x + 1, y, light);
    wpx(g, x, y + 1, dark);
    wpx(g, x + 1, y + 1, dark);
  }
}

function water(g: PixelGrid, rand: () => number): void {
  g.rect(0, 0, S, S, P.water);
  for (let i = 0; i < 4; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    for (let k = 0; k < 18; k++) wpx(g, cx + (rand() - 0.5) * 10, cy + (rand() - 0.5) * 6, P.waterDark, 160);
  }
  // Ripples: short light dashes with a darker trough under them.
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    const len = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < len; k++) {
      wpx(g, x + k, y, k === 0 || k === len - 1 ? P.waterLight : P.foam, k === 0 || k === len - 1 ? 200 : 230);
      wpx(g, x + k, y + 1, P.waterDark);
    }
  }
  for (let i = 0; i < 3; i++) wpx(g, rand() * S, rand() * S, P.waterLight);
}

function stone(g: PixelGrid, rand: () => number): void {
  g.rect(0, 0, S, S, P.stone);
  for (let i = 0; i < 30; i++) wpx(g, rand() * S, rand() * S, rand() < 0.5 ? P.stoneDark : P.stoneLight, 150);
  // Branching cracks with a lit lip.
  for (let c = 0; c < 2; c++) {
    let x = rand() * S;
    let y = rand() * S;
    const steps = 5 + Math.floor(rand() * 6);
    for (let k = 0; k < steps; k++) {
      wpx(g, x, y, P.stoneDark);
      wpx(g, x, y + 1, P.stoneLight, 140);
      x += rand() < 0.7 ? 1 : 0;
      y += rand() < 0.5 ? 1 : rand() < 0.5 ? -1 : 0;
    }
  }
  if (rand() < 0.6) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    wpx(g, x, y, P.stoneLight);
    wpx(g, x + 1, y, P.stoneLight);
    wpx(g, x, y + 1, P.stoneDark);
    wpx(g, x + 1, y + 1, P.stoneDark);
  }
}

function planks(g: PixelGrid, rand: () => number, v: number): void {
  const plankH = 8;
  for (let row = 0; row < S / plankH; row++) {
    const y0 = row * plankH;
    g.rect(0, y0, S, plankH, P.wood);
    g.hline(0, y0, S, P.woodLight);
    g.hline(0, y0 + plankH - 1, S, P.woodDark);
    // grain
    for (let i = 0; i < 3; i++) {
      const gx = Math.floor(rand() * S);
      const gy = y0 + 2 + Math.floor(rand() * (plankH - 4));
      for (let k = 0; k < 4 + rand() * 6; k++) wpx(g, gx + k, gy, 0x8e5f30, 150);
    }
    // Plank joints are staggered per row and per variant.
    const joint = (row * 13 + v * 7 + 5) % S;
    g.vline(joint, y0 + 1, plankH - 2, P.woodDark);
    wpx(g, joint + 2, y0 + 2, 0x4d331d);
    wpx(g, joint - 2, y0 + plankH - 3, 0x4d331d);
  }
}

function tilled(g: PixelGrid, rand: () => number, wet: boolean): void {
  const base = wet ? P.wetTilled : P.tilled;
  const dark = wet ? P.wetTilledDark : P.tilledDark;
  const light = wet ? P.wetTilledLight : P.tilledLight;
  g.rect(0, 0, S, S, base);
  // Three furrows per tile: ridge (lit) over trench (shadow).
  for (let f = 0; f < 3; f++) {
    const y = 3 + f * 11;
    for (let x = 0; x < S; x++) {
      const wob = Math.sin((x + f * 5) * 0.6) > 0.7 ? 1 : 0;
      wpx(g, x, y + wob, light);
      wpx(g, x, y + 4 + wob, dark);
      wpx(g, x, y + 5 + wob, dark);
      if (rand() < 0.3) wpx(g, x, y + 1 + wob, light, 140);
    }
  }
  for (let i = 0; i < 14; i++) wpx(g, rand() * S, rand() * S, rand() < 0.5 ? dark : light);
  if (wet) for (let i = 0; i < 4; i++) wpx(g, rand() * S, rand() * S, 0x7a6a8a, 120);
}

function caveWall(g: PixelGrid, rand: () => number): void {
  g.rect(0, 0, S, S, 0x3a302d);
  // Chunky boulders stacked into the wall, each lit from the top-left.
  const blocks = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < blocks; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const rx = 5 + rand() * 6;
    const ry = 4 + rand() * 4;
    for (let ox = -S; ox <= S; ox += S) {
      for (let oy = -S; oy <= S; oy += S) {
        g.ellipse(cx + ox, cy + oy + 1, rx, ry, 0x2a2220);
        g.ellipse(cx + ox, cy + oy, rx - 0.5, ry - 0.5, P.caveWall);
        g.ellipse(cx + ox - rx * 0.3, cy + oy - ry * 0.35, rx * 0.5, ry * 0.35, P.caveWallLight);
      }
    }
  }
  for (let i = 0; i < 10; i++) wpx(g, rand() * S, rand() * S, 0x80706a, 140);
}

function bricks(g: PixelGrid, rand: () => number, v: number): void {
  const mortar = 0x6e4634;
  g.rect(0, 0, S, S, mortar);
  const bw = 16;
  const bh = 8;
  for (let row = 0; row < S / bh; row++) {
    const off = row % 2 === 0 ? 0 : bw / 2;
    for (let col = 0; col < S / bw; col++) {
      const x = col * bw + off + (v % 2);
      const tone = rand();
      const base = tone < 0.25 ? 0x8f5a42 : tone < 0.5 ? 0xa86e50 : 0x9c6448;
      for (let yy = 1; yy < bh; yy++) {
        for (let xx = 1; xx < bw; xx++) {
          const c = yy === 1 ? 0xbb8466 : yy === bh - 1 || xx === bw - 1 ? 0x7d4d38 : base;
          wpx(g, x + xx, row * bh + yy, c);
        }
      }
    }
  }
  for (let i = 0; i < 6; i++) wpx(g, rand() * S, rand() * S, 0x6a3f2e);
}
