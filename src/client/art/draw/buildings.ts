// Buildings: a facade standing on the bottom of the footprint with a roof drawn above it.
// The texture is footprint width x (footprint height + roof overhang); feet anchor = bottom centre.
import { P, mix, outlineOf, shade, type Rgb } from "../palette";
import { PixelGrid } from "./grid";

const T = 32;

export type WallStyle = "brick" | "plank" | "stone" | "log";

/** Fills a mask region (pixels opaque in `mask`) with a repeating material pattern. */
export function material(g: PixelGrid, x0: number, y0: number, w: number, h: number, style: WallStyle | "shingle" | "slate", base: Rgb): void {
  const dark = shade(base, -0.28);
  const light = shade(base, 0.16);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!g.opaque(x, y)) continue;
      const lx = x - x0;
      const ly = y - y0;
      let c = base;
      switch (style) {
        case "brick": {
          const row = Math.floor(ly / 5);
          const off = row % 2 ? 5 : 0;
          if (ly % 5 === 4 || (lx + off) % 10 === 9) c = dark;
          else if (ly % 5 === 0) c = light;
          else if (((row * 7 + Math.floor((lx + off) / 10) * 3) % 5) === 0) c = shade(base, -0.08);
          break;
        }
        case "plank":
          if (ly % 5 === 4) c = dark;
          else if (ly % 5 === 0) c = light;
          else if ((lx + Math.floor(ly / 5) * 13) % 37 === 0) c = dark;
          break;
        case "log":
          if (ly % 7 === 6) c = shade(base, -0.4);
          else if (ly % 7 === 0 || ly % 7 === 1) c = light;
          else if (ly % 7 === 5) c = dark;
          break;
        case "stone": {
          const row = Math.floor(ly / 7);
          const off = (row * 5) % 11;
          if (ly % 7 === 6 || (lx + off) % 11 === 10) c = dark;
          else if (ly % 7 === 0 || (lx + off) % 11 === 0) c = light;
          else if ((row + Math.floor((lx + off) / 11)) % 3 === 0) c = shade(base, -0.07);
          break;
        }
        case "shingle":
        case "slate": {
          const rh = style === "slate" ? 4 : 5;
          const row = Math.floor(ly / rh);
          const off = row % 2 ? 4 : 0;
          if (ly % rh === rh - 1) c = dark;
          else if ((lx + off) % 8 === 0) c = shade(base, -0.18);
          else if (ly % rh === 0) c = light;
          break;
        }
      }
      g.px(x, y, c);
    }
  }
}

export function window(g: PixelGrid, x: number, y: number, w = 14, h = 14, frame: Rgb = P.cream, lit = false): void {
  g.rect(x - 1, y - 1, w + 2, h + 2, outlineOf(frame));
  g.rect(x, y, w, h, frame);
  const glass = lit ? 0xf2c766 : P.glass;
  const mid = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  for (const [px, py, pw, ph] of [
    [x + 1, y + 1, mid - 1, midY - 1],
    [x + mid + 1, y + 1, w - mid - 2, midY - 1],
    [x + 1, y + midY + 1, mid - 1, h - midY - 2],
    [x + mid + 1, y + midY + 1, w - mid - 2, h - midY - 2],
  ]) {
    g.rect(px, py, pw, ph, glass);
    g.px(px, py, lit ? 0xfff3c0 : P.glassLight);
    g.px(px + 1, py, lit ? 0xfff3c0 : shade(P.glassLight, -0.3));
  }
  g.rect(x - 2, y + h + 1, w + 4, 2, shade(frame, -0.25)); // sill
}

function door(g: PixelGrid, x: number, bottom: number, w = 16, h = 26, color: Rgb = P.woodDark, arch = false): void {
  const y = bottom - h;
  g.rect(x - 2, y - 2, w + 4, h + 2, shade(color, -0.45));
  g.rect(x, y, w, h, color);
  if (arch) g.ellipse(x + w / 2, y, w / 2, 4, color);
  for (let i = 3; i < w; i += 4) g.vline(x + i, y + 1, h - 1, shade(color, -0.22));
  g.vline(x, y, h, shade(color, 0.15));
  g.rect(x + w - 4, y + Math.floor(h / 2), 2, 2, P.gold);
  g.rect(x - 3, bottom - 2, w + 6, 2, P.stoneLight); // doorstep
  g.hline(x - 3, bottom - 1, w + 6, P.stone);
}

/** y of a gable roof's top edge at column x (chimneys stand on it). */
function gableRoofY(W: number, wallTop: number, x: number): number {
  const apex = 2;
  const eave = wallTop + 6;
  return apex + (Math.abs(x + 5 - W / 2) / (W / 2)) * (eave - apex);
}

function chimney(g: PixelGrid, x: number, y: number, h: number, color: Rgb, smoke = false): void {
  g.rect(x, y, 10, h, color);
  material(g, x, y, 10, h, "brick", color);
  g.rect(x - 1, y - 2, 12, 3, shade(color, -0.3));
  if (smoke) {
    g.ellipse(x + 6, y - 6, 3, 2.5, 0xc8c4cc, 200);
    g.ellipse(x + 9, y - 11, 3.5, 3, 0xd8d4dc, 170);
    g.ellipse(x + 7, y - 17, 3, 2.5, 0xe4e0e8, 130);
  }
}

interface Gable {
  W: number;
  H: number;
  wallH: number;
  wall: Rgb;
  wallStyle: WallStyle;
  roof: Rgb;
  band?: number;
}

/** Front-gable house: two thick shingled roof slopes framing a triangular gable wall. */
function gableHouse(o: Gable): { g: PixelGrid; wallTop: number } {
  const { W, H, wallH } = o;
  const g = new PixelGrid(W, H);
  const wallTop = H - wallH;
  const inset = 6;
  // Facade wall.
  g.rect(inset, wallTop, W - inset * 2, wallH, o.wall);
  material(g, inset, wallTop, W - inset * 2, wallH, o.wallStyle, o.wall);
  g.vline(inset, wallTop, wallH, shade(o.wall, -0.3));
  g.vline(W - inset - 1, wallTop, wallH, shade(o.wall, -0.3));
  g.rect(inset, H - 4, W - inset * 2, 4, shade(P.stone, 0.05)); // foundation
  g.hline(inset, H - 4, W - inset * 2, P.stoneLight);

  // Roof, drawn in its own grid so the shingle pattern only covers roof pixels.
  const apex = 2;
  const eave = wallTop + 6;
  const band = o.band ?? Math.round(W * 0.2);
  const roof = new PixelGrid(W, H);
  roof.poly([[W / 2, apex], [W, eave], [W - band, eave], [W / 2, apex + band * 0.9]], o.roof);
  roof.poly([[W / 2, apex], [W / 2, apex + band * 0.9], [band, eave], [0, eave]], shade(o.roof, 0.08));
  material(roof, 0, 0, W, H, "shingle", o.roof);
  // Gable triangle between the slopes, same material as the wall.
  const gable = new PixelGrid(W, H);
  gable.poly([[W / 2, apex + band * 0.9], [W - band, eave], [band, eave]], o.wall);
  material(gable, 0, 0, W, H, o.wallStyle, shade(o.wall, -0.06));
  g.blit(gable, 0, 0);
  // Shadow the roof casts on the wall.
  g.rect(inset, wallTop, W - inset * 2, 3, shade(o.wall, -0.35), 160);
  g.blit(roof, 0, 0);
  // Ridge cap and barge boards.
  g.line(W / 2, apex, 0, eave, shade(o.roof, -0.45));
  g.line(W / 2, apex, W - 1, eave, shade(o.roof, -0.45));
  g.line(W / 2, apex + 1, 1, eave, shade(o.roof, 0.3));
  g.line(W / 2, apex + band * 0.9, band, eave, shade(o.roof, -0.35));
  g.line(W / 2, apex + band * 0.9, W - band, eave, shade(o.roof, -0.35));
  g.hline(0, eave, band + 1, shade(o.roof, -0.45));
  g.hline(W - band - 1, eave, band + 1, shade(o.roof, -0.45));
  return { g, wallTop };
}

/** Front-facing hip roof (a trapezoid) over a wide wall. */
function hipHall(W: number, H: number, wallH: number, wall: Rgb, style: WallStyle, roof: Rgb): { g: PixelGrid; wallTop: number } {
  const g = new PixelGrid(W, H);
  const wallTop = H - wallH;
  g.rect(4, wallTop, W - 8, wallH, wall);
  material(g, 4, wallTop, W - 8, wallH, style, wall);
  g.rect(4, H - 5, W - 8, 5, P.stoneDark);
  g.hline(4, H - 5, W - 8, P.stoneLight);
  g.rect(4, wallTop, W - 8, 3, shade(wall, -0.35), 160);
  const eave = wallTop + 5;
  const r = new PixelGrid(W, H);
  r.poly([[W * 0.2, 6], [W * 0.8, 6], [W, eave], [0, eave]], roof);
  material(r, 0, 6, W, eave, "slate", roof);
  g.blit(r, 0, 0);
  g.hline(Math.round(W * 0.2), 6, Math.round(W * 0.6), shade(roof, 0.35));
  g.line(W * 0.2, 6, 0, eave, shade(roof, 0.2));
  g.line(W * 0.8, 6, W - 1, eave, shade(roof, -0.4));
  g.hline(0, eave, W, shade(roof, -0.5));
  return { g, wallTop };
}

export function houseSmall(): PixelGrid {
  const W = 4 * T;
  const H = 3 * T + 48;
  const { g, wallTop } = gableHouse({ W, H, wallH: 58, wall: P.brick, wallStyle: "brick", roof: P.roofBrown });
  window(g, 22, wallTop + 16);
  window(g, 58, wallTop - 26, 12, 10);
  door(g, 78, H - 4, 18, 30);
  g.rect(20, wallTop + 34, 20, 4, 0x6a3a22); // flower box
  for (let i = 0; i < 5; i++) g.px(21 + i * 4, wallTop + 33, i % 2 ? 0xf06a8a : 0xf2e070);
  return g;
}

export function houseLarge(): PixelGrid {
  const W = 6 * T;
  const H = 4 * T + 64;
  const { g, wallTop } = gableHouse({ W, H, wallH: 74, wall: P.brickTan, wallStyle: "brick", roof: 0x5e3f2a });
  chimney(g, W - 50, 30, gableRoofY(W, wallTop, W - 50) + 4 - 30, P.brickDark, true);
  window(g, 24, wallTop + 20);
  window(g, 52, wallTop + 20);
  window(g, W - 40, wallTop + 20);
  window(g, W / 2 - 8, wallTop - 34, 16, 14);
  door(g, W / 2 + 18, H - 4, 18, 32);
  return g;
}

export function townHall(): PixelGrid {
  const W = 8 * T;
  const H = 5 * T + 80;
  const wall = 0x8a7f86;
  const { g, wallTop } = hipHall(W, H, 110, wall, "stone", P.roofSlate);
  // Central gable porch.
  const pw = 72;
  const px = W / 2 - pw / 2;
  const porch = new PixelGrid(W, H);
  porch.poly([[W / 2, wallTop - 40], [px + pw + 8, wallTop + 4], [px - 8, wallTop + 4]], P.roofSlate);
  material(porch, 0, 0, W, H, "slate", shade(P.roofSlate, 0.06));
  g.blit(porch, 0, 0);
  g.poly([[W / 2, wallTop - 24], [px + pw - 8, wallTop + 2], [px + 8, wallTop + 2]], P.cream);
  g.ellipse(W / 2, wallTop - 8, 7, 7, P.cream);
  g.ellipse(W / 2, wallTop - 8, 5, 5, 0xf4f0e4);
  g.line(W / 2, wallTop - 8, W / 2, wallTop - 12, P.black);
  g.line(W / 2, wallTop - 8, W / 2 + 3, wallTop - 8, P.black);
  for (const wx of [18, 46, W - 64, W - 36]) {
    window(g, wx, wallTop + 18, 16, 18);
    window(g, wx, wallTop + 62, 16, 18);
  }
  // Columns and double door.
  for (const cx of [px + 4, px + pw - 10]) {
    g.rect(cx, wallTop + 8, 6, H - wallTop - 16, P.cream);
    g.vline(cx + 5, wallTop + 8, H - wallTop - 16, shade(P.cream, -0.25));
    g.rect(cx - 1, wallTop + 6, 8, 3, shade(P.cream, -0.1));
  }
  door(g, W / 2 - 14, H - 10, 28, 40, 0x5a3220, true);
  // Steps.
  for (let i = 0; i < 3; i++) {
    g.rect(W / 2 - 22 - i * 4, H - 10 + i * 3, 44 + i * 8, 3, i % 2 ? P.stone : P.stoneLight);
  }
  // Red banners.
  for (const bx of [px - 18, px + pw + 8]) {
    g.rect(bx, wallTop + 14, 10, 34, P.cloth);
    g.vline(bx + 9, wallTop + 14, 34, shade(P.cloth, -0.3));
    g.poly([[bx, wallTop + 48], [bx + 10, wallTop + 48], [bx + 5, wallTop + 53]], P.cloth);
    g.rect(bx - 2, wallTop + 12, 14, 2, P.woodDark);
    g.rect(bx + 3, wallTop + 24, 4, 4, P.gold);
  }
  return g;
}

export function inn(): PixelGrid {
  const W = 7 * T;
  const H = 5 * T + 64;
  const { g, wallTop } = gableHouse({ W, H, wallH: 100, wall: 0x3f4a66, wallStyle: "plank", roof: P.roofRed, band: 60 });
  chimney(g, 44, 40, gableRoofY(W, wallTop, 44) + 4 - 40, P.brickDark, true);
  for (const wx of [22, 52, W - 68, W - 38]) window(g, wx, wallTop + 22, 16, 16, P.cream, true);
  window(g, W / 2 - 9, wallTop - 40, 18, 16, P.cream, true);
  // Porch roof over the door.
  const dx = W / 2 - 12;
  door(g, dx, H - 4, 24, 34, 0x6a3a22, true);
  for (const cx of [dx - 12, dx + 30]) {
    g.rect(cx, H - 44, 5, 40, P.cream);
    g.vline(cx + 4, H - 44, 40, shade(P.cream, -0.25));
  }
  const porch = new PixelGrid(W, H);
  porch.poly([[dx - 18, H - 44], [dx + 42, H - 44], [dx + 36, H - 54], [dx - 12, H - 54]], P.roofRed);
  material(porch, 0, 0, W, H, "shingle", P.roofRed);
  g.blit(porch, 0, 0);
  // Hanging sign "INN".
  const sx = 20;
  const sy = wallTop + 50;
  g.hline(sx, sy - 6, 22, P.iron);
  g.vline(sx + 4, sy - 6, 6, P.iron);
  g.vline(sx + 17, sy - 6, 6, P.iron);
  g.box(sx, sy, 22, 14, 0x8a5a2e);
  const letters: Record<string, string[]> = { I: ["111", "010", "010", "010", "111"], N: ["101", "111", "111", "111", "101"] };
  let lx = sx + 3;
  for (const ch of "INN") {
    letters[ch].forEach((row, ry) => {
      for (let i = 0; i < 3; i++) if (row[i] === "1") g.px(lx + i, sy + 4 + ry, P.gold);
    });
    lx += 6;
  }
  return g;
}

export function blacksmith(): PixelGrid {
  const W = 6 * T;
  const H = 4 * T + 48;
  const { g, wallTop } = hipHall(W, H, 80, 0x7d7470, "stone", 0x4a3a3a);
  chimney(g, Math.round(W * 0.68), 19, 12, 0x8a7a72, true);
  // Open workshop bay on the right: dark interior, forge glow, anvil.
  const bx = W - 92;
  const by = wallTop + 14;
  g.rect(bx, by, 80, H - by - 5, 0x2e2420);
  g.rect(bx, by, 80, 4, 0x1e1614);
  g.rect(bx + 50, by + 18, 24, 26, 0x5a4a44);
  g.rect(bx + 54, by + 24, 16, 12, P.flame);
  g.rect(bx + 57, by + 27, 10, 6, P.flameHot);
  g.ellipse(bx + 62, by + 30, 16, 12, P.flame, 50);
  for (const cx of [bx - 4, bx + 78]) {
    g.rect(cx, by - 2, 6, H - by - 3, P.woodDark);
    g.vline(cx, by - 2, H - by - 3, P.woodLight);
  }
  // Anvil.
  const ax = bx + 18;
  const ay = H - 22;
  g.rect(ax, ay, 22, 5, P.iron);
  g.hline(ax, ay, 22, P.ironLight);
  g.poly([[ax + 22, ay], [ax + 28, ay + 1], [ax + 22, ay + 4]], P.iron);
  g.rect(ax + 7, ay + 5, 8, 7, shade(P.iron, -0.2));
  g.rect(ax + 4, ay + 12, 14, 4, P.woodDark);
  window(g, 24, wallTop + 22);
  door(g, 52, H - 5, 18, 30);
  // Sign with crossed hammer.
  g.box(20, wallTop + 48, 18, 14, 0x8a5a2e);
  g.line(23, wallTop + 59, 34, wallTop + 51, P.iron);
  g.rect(31, wallTop + 50, 5, 3, P.ironLight);
  return g;
}

export function cottage(): PixelGrid {
  // Seen from inside the home: eaves along the top, the cottage's north wall below it.
  const W = 14 * T;
  const H = 3 * T + 16;
  const g = new PixelGrid(W, H);
  const eave = 34;
  g.rect(0, 0, W, eave, P.roofRed);
  material(g, 0, 0, W, eave, "shingle", P.roofRed);
  g.rect(0, eave, W, 4, shade(P.roofRed, -0.5));
  g.rect(0, eave + 4, W, H - eave - 4, 0xb48455);
  material(g, 0, eave + 4, W, H - eave - 4, "log", 0xb48455);
  g.rect(0, H - 10, W, 10, 0x6e4a2c); // skirting board
  g.hline(0, H - 10, W, 0x8f6440);
  g.rect(0, eave + 4, W, 3, 0x000000, 70);
  for (let x = 40; x < W - 40; x += 112) {
    window(g, x, eave + 14, 22, 20, 0xe8d6ae);
    g.rect(x - 4, eave + 10, 30, 3, P.cloth); // curtain rod + valance
    g.rect(x - 4, eave + 12, 4, 22, P.cloth);
    g.rect(x + 22, eave + 12, 4, 22, P.cloth);
  }
  // Shelf with jars and a wall clock to make the room feel lived in.
  const sx = 96;
  g.rect(sx, eave + 22, 40, 3, P.woodDark);
  for (let i = 0; i < 4; i++) {
    const c = [0x7fc8d8, 0xe0a050, 0x9ad070, 0xd06a6a][i];
    g.rect(sx + 3 + i * 9, eave + 14, 6, 8, c);
    g.hline(sx + 3 + i * 9, eave + 14, 6, shade(c, 0.3));
    g.hline(sx + 3 + i * 9, eave + 13, 6, P.woodDark);
  }
  g.ellipse(W - 120, eave + 22, 8, 8, P.woodDark);
  g.ellipse(W - 120, eave + 22, 6, 6, P.cream);
  g.vline(W - 121, eave + 17, 5, P.black);
  g.hline(W - 121, eave + 22, 4, P.black);
  g.box(W / 2 - 14, eave + 12, 28, 22, mix(P.gold, P.woodDark, 0.5));
  g.rect(W / 2 - 11, eave + 15, 22, 16, 0x8ac0e0);
  g.rect(W / 2 - 11, eave + 25, 22, 6, 0x5a9a4a);
  g.ellipse(W / 2 + 5, eave + 19, 3, 3, 0xf2e070);
  return g;
}
