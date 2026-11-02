// 32x32 inventory icons for every item id. Unknown ids get a tinted sack so nothing is ever blank.
import { getItem, ITEMS } from "../../../shared/items";
import { hashStr, P, shade, type Rgb } from "../palette";
import { crystal, leaf } from "./farm";
import { drawFurniture } from "./furniture";
import { PixelGrid } from "./grid";

const S = 32;

function handle(g: PixelGrid, x0: number, y0: number, x1: number, y1: number): void {
  g.line(x0, y0, x1, y1, P.bark);
  g.line(x0 + 1, y0, x1 + 1, y1, P.woodLight);
  g.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1, P.woodDark);
}

function hoe(g: PixelGrid): void {
  handle(g, 5, 28, 22, 6);
  g.poly([[19, 4], [28, 6], [28, 12], [24, 10], [20, 8]], P.ironLight);
  g.line(20, 4, 28, 6, 0xe0e4ea);
  g.rect(19, 4, 4, 5, P.iron);
}

function wateringCan(g: PixelGrid): void {
  const c = 0x4a9a8a;
  g.ball(14, 19, 9, 8, c, shade(c, -0.3), shade(c, 0.35));
  g.rect(5, 18, 18, 9, c);
  g.hline(5, 26, 18, shade(c, -0.35));
  g.line(22, 20, 29, 11, c);
  g.line(22, 21, 29, 12, shade(c, -0.3));
  g.rect(27, 9, 4, 3, shade(c, 0.3));
  g.line(8, 11, 14, 6, P.iron);
  g.line(14, 6, 20, 11, P.iron);
  g.px(29, 14, P.waterLight);
  g.px(30, 16, P.waterLight);
}

function pickaxe(g: PixelGrid, head: Rgb): void {
  handle(g, 6, 28, 21, 10);
  g.poly([[6, 10], [12, 5], [20, 4], [28, 8], [30, 14], [24, 10], [18, 8], [11, 9]], head);
  g.line(12, 5, 20, 4, shade(head, 0.4));
  g.line(24, 10, 30, 14, shade(head, -0.3));
  g.rect(18, 7, 4, 4, P.woodDark);
}

function axe(g: PixelGrid): void {
  handle(g, 6, 28, 22, 8);
  g.poly([[17, 4], [24, 5], [29, 11], [28, 17], [22, 13], [19, 10]], 0x9a9aa4);
  g.line(24, 5, 29, 11, 0xd8dce4);
  g.line(22, 13, 28, 17, shade(0x9a9aa4, -0.35));
  g.rect(19, 7, 4, 4, P.woodDark);
}

function sword(g: PixelGrid, blade: Rgb): void {
  g.poly([[8, 22], [24, 6], [27, 5], [26, 8], [10, 24]], blade);
  g.line(9, 22, 25, 6, shade(blade, 0.4));
  g.line(10, 24, 26, 8, shade(blade, -0.3));
  g.line(5, 19, 13, 27, P.gold);
  g.line(6, 19, 14, 27, shade(P.gold, -0.2));
  g.line(4, 28, 8, 24, P.bark);
  g.line(5, 28, 9, 24, P.woodDark);
  g.rect(3, 28, 2, 2, P.gold);
}

function seedPacket(g: PixelGrid, crop: string): void {
  const c = CROP_COLOR[crop] ?? 0x8ab040;
  g.box(6, 4, 20, 25, 0xe8dcc0);
  g.rect(7, 5, 18, 4, shade(c, -0.1));
  g.hline(7, 9, 18, shade(c, -0.4));
  g.ball(16, 17, 5, 4.5, c, shade(c, -0.3), shade(c, 0.35));
  leaf(g, 16, 13, -3, -3, 1.2);
  leaf(g, 16, 13, 3, -3, 1.2);
  for (const x of [10, 14, 18, 22]) g.px(x, 25, 0x8a6a3a);
  g.hline(7, 27, 18, shade(0xe8dcc0, -0.2));
}

/** Placeholder looks for the larger crop list: body colour, then shape (round, long or cluster). */
type CropShape = "round" | "long" | "cluster" | "leafy";
const MORE_CROPS: Record<string, [Rgb, CropShape]> = {
  radish: [0xd8344a, "round"],
  lettuce: [0x8ccc4a, "leafy"],
  potato: [0xb07a44, "round"],
  beet: [0x8a2050, "round"],
  onion: [0xd8a050, "round"],
  bell_pepper: [0x3a9a2a, "round"],
  green_bean: [0x5ab040, "long"],
  tomato: [0xe0302a, "round"],
  eggplant: [0x6a2a8a, "long"],
  cabbage: [0x6aa84a, "leafy"],
  cauliflower: [0xf0ead0, "leafy"],
  blueberry: [0x3a4ac8, "cluster"],
  corn: [0xf0d040, "long"],
  grape: [0x7a2a8a, "cluster"],
  watermelon: [0x2a7a2a, "round"],
  pineapple: [0xc8902a, "long"],
  moonberry: [0xc8b8f0, "cluster"],
  golden_melon: [0xf0c030, "round"],
  starfruit: [0xf8e048, "cluster"],
};

function moreCrop(g: PixelGrid, c: Rgb, shape: CropShape): void {
  if (shape === "round") {
    g.ball(16, 18, 10, 9, c, shade(c, -0.3), shade(c, 0.3));
    leaf(g, 16, 10, -5, -4, 1.8);
    leaf(g, 16, 10, 5, -4, 1.8);
  } else if (shape === "long") {
    g.poly([[9, 26], [7, 20], [17, 6], [23, 8], [24, 13], [14, 27]], c);
    g.line(10, 22, 19, 9, shade(c, 0.35));
    leaf(g, 21, 7, 4, -3, 1.6);
  } else if (shape === "cluster") {
    for (const [x, y] of [[12, 12], [20, 12], [16, 16], [11, 20], [21, 20], [16, 24]]) g.ball(x, y, 4, 4, c, shade(c, -0.3), shade(c, 0.35));
    g.vline(16, 4, 6, 0x3a8a2a);
  } else {
    g.ball(16, 18, 12, 9, shade(c, -0.15), shade(c, -0.4), c);
    g.ball(16, 18, 7, 6, c, shade(c, -0.25), shade(c, 0.35));
  }
}

const CROP_COLOR: Record<string, Rgb> = {
  turnip: 0xf2ece0,
  carrot: 0xf0842a,
  strawberry: 0xd83030,
  pumpkin: 0xf08a24,
  ...Object.fromEntries(Object.entries(MORE_CROPS).map(([k, [c]]) => [k, c])),
};

function turnip(g: PixelGrid): void {
  leaf(g, 16, 13, -7, -9, 2.5);
  leaf(g, 16, 13, 0, -11, 2.5, 0x6ab848);
  leaf(g, 16, 13, 7, -9, 2.5);
  g.ball(16, 20, 8, 7, 0xf2ece0, 0xc8b8c8, 0xffffff);
  g.ellipse(16, 15, 7, 3, 0x9a4aa8);
  g.hline(12, 16, 9, 0xc070c8);
  g.line(16, 26, 17, 30, 0xc8b8c8);
}

function carrot(g: PixelGrid): void {
  g.poly([[9, 10], [18, 9], [27, 27], [24, 28]], 0xf0842a);
  g.line(10, 10, 24, 27, 0xf8a850);
  for (const [x, y] of [[13, 14], [17, 18], [20, 22]]) g.hline(x, y, 3, 0xc0601a);
  leaf(g, 12, 9, -6, -6, 1.5, 0x6ab848);
  leaf(g, 13, 9, -1, -8, 1.5, 0x5aa83e);
  leaf(g, 14, 9, 4, -7, 1.5, 0x6ab848);
}

function strawberry(g: PixelGrid): void {
  g.poly([[6, 12], [26, 12], [24, 20], [16, 29], [8, 20]], 0xd83030);
  g.ellipse(16, 13, 10, 4, 0xd83030);
  g.ellipse(12, 14, 3, 2, 0xff7a7a);
  for (const [x, y] of [[11, 18], [16, 16], [21, 18], [13, 22], [19, 22], [16, 25]]) g.px(x, y, 0xf2e070);
  for (const dx of [-6, -2, 2, 6]) leaf(g, 16, 10, dx, 3, 1.3, 0x3a8a2a);
  g.vline(16, 4, 6, 0x3a8a2a);
}

function pumpkin(g: PixelGrid): void {
  const c = 0xf08a24;
  g.ball(16, 19, 13, 10, c, shade(c, -0.3), shade(c, 0.3));
  for (const x of [10, 16, 22]) g.vline(x, 11, 16, shade(c, -0.2));
  g.rect(15, 6, 3, 5, 0x6a5a2a);
  leaf(g, 17, 8, 7, -2, 2.2);
}

function ore(g: PixelGrid, base: Rgb, fleck: Rgb | null): void {
  g.poly([[5, 22], [9, 11], [18, 7], [26, 12], [28, 22], [21, 28], [10, 28]], base);
  g.poly([[9, 11], [18, 7], [26, 12], [17, 15]], shade(base, 0.22));
  g.poly([[17, 15], [26, 12], [28, 22], [21, 28]], shade(base, -0.22));
  if (fleck) {
    for (const [x, y] of [[11, 18], [19, 11], [22, 20], [14, 24]]) {
      g.rect(x, y, 3, 3, fleck);
      g.px(x, y, shade(fleck, 0.45));
    }
  }
}

function gem(g: PixelGrid): void {
  crystal(g, 10, 28, 3.5, 14, P.gem);
  crystal(g, 22, 28, 3.5, 13, 0xd070e0);
  crystal(g, 16, 28, 5, 23, 0x7fd8e8);
  g.px(14, 8, 0xffffff);
}

/** A cut stone: a crown of facets over a point, with a glint. */
function diamond(g: PixelGrid): void {
  const c = 0xd8f4ff;
  g.poly([[6, 12], [11, 6], [21, 6], [26, 12], [16, 28]], c);
  g.poly([[6, 12], [26, 12], [16, 28]], shade(c, -0.12));
  g.poly([[16, 12], [26, 12], [16, 28]], shade(c, -0.28));
  g.poly([[11, 6], [16, 12], [6, 12]], 0xffffff);
  g.hline(7, 12, 19, shade(c, -0.35));
  g.px(13, 8, 0xffffff);
  g.px(24, 4, 0xffffff);
  g.px(25, 5, 0xffffff);
  g.px(23, 5, 0xffffff);
  g.px(24, 6, 0xffffff);
}

function wood(g: PixelGrid): void {
  for (const [x, y] of [[4, 16], [14, 16], [9, 7]] as const) {
    g.rect(x, y, 14, 9, P.bark);
    g.hline(x, y, 14, shade(P.bark, 0.25));
    g.ellipse(x + 14, y + 4.5, 3, 4.5, P.woodLight);
    g.ellipse(x + 14, y + 4.5, 1.5, 2, P.wood);
  }
}

function slimeGel(g: PixelGrid): void {
  const c = 0x5cc24a;
  g.ellipse(16, 21, 11, 8, c, 230);
  g.poly([[10, 18], [16, 4], [22, 18]], c, 230);
  g.ellipse(12, 17, 3, 3, 0xb6f08a);
  g.px(11, 15, 0xffffff);
  g.hline(10, 27, 12, shade(c, -0.3));
}

function batWing(g: PixelGrid): void {
  const c = 0x5a3e7a;
  g.poly([[4, 8], [28, 12], [26, 18], [21, 16], [18, 22], [13, 18], [8, 24], [6, 16]], c);
  g.line(4, 8, 28, 12, shade(c, 0.35));
  for (const x of [13, 20]) g.line(x, 10, x - 1, 19, shade(c, 0.2));
}

function crabShell(g: PixelGrid): void {
  const c = 0xb85a3a;
  g.ellipse(16, 18, 13, 10, shade(c, -0.3));
  g.ellipse(16, 17, 12, 9, c);
  g.ellipse(12, 13, 5, 3, shade(c, 0.35));
  for (const x of [10, 16, 22]) g.line(x, 11, x, 25, shade(c, -0.25));
  g.rect(9, 24, 14, 2, P.stone);
}

function mint(g: PixelGrid): void {
  g.line(16, 29, 16, 6, 0x3a7a2a);
  for (let i = 0; i < 4; i++) {
    const y = 24 - i * 5;
    leaf(g, 16, y, -7 + i, -3, 2.4, 0x6ac868);
    leaf(g, 16, y - 2, 7 - i, -3, 2.4, 0x58b858);
  }
}

function mushroom(g: PixelGrid): void {
  g.rect(12, 16, 8, 12, P.cream);
  g.vline(19, 16, 12, shade(P.cream, -0.25));
  g.ellipse(16, 15, 13, 9, 0xd04a3a);
  g.rect(3, 15, 26, 3, 0xd04a3a);
  g.hline(4, 17, 24, shade(0xd04a3a, -0.35));
  for (const [x, y, r] of [[10, 10, 2], [19, 8, 2.5], [23, 13, 1.5], [14, 14, 1.5]]) g.ellipse(x, y, r, r, P.white);
}

function fish(g: PixelGrid): void {
  const c = 0xa8b8c0;
  g.ellipse(14, 16, 11, 6, c);
  g.ellipse(14, 18, 9, 3, 0xe8a0a0);
  g.poly([[24, 16], [30, 10], [30, 22]], shade(c, -0.15));
  g.ellipse(14, 12, 8, 2, shade(c, 0.3));
  for (const [x, y] of [[10, 14], [15, 13], [18, 16], [12, 17]]) g.px(x, y, 0x4a5a6a);
  g.px(6, 15, P.black);
  g.poly([[12, 10], [18, 6], [20, 11]], shade(c, -0.2));
}

function sack(g: PixelGrid, h: number): void {
  const c: Rgb = [0xc8a870, 0xa87a5a, 0x8aa86a, 0x8a7ab8][h % 4];
  g.ball(16, 20, 10, 9, c, shade(c, -0.3), shade(c, 0.3));
  g.poly([[12, 11], [20, 11], [22, 5], [10, 5]], c);
  g.hline(11, 11, 10, 0x6a3a22);
  g.px(16, 20, shade(c, -0.4));
}

/** Fallback flashlight (the catalog icon is used when it loads): yellow barrel, steel head, lit lens. */
function flashlight(g: PixelGrid): void {
  const body = 0xe09a2a;
  g.poly([[5, 24], [9, 28], [20, 17], [16, 13]], body);
  g.line(6, 24, 17, 13, shade(body, 0.35));
  g.line(9, 27, 20, 16, shade(body, -0.35));
  for (const t of [0, 3, 6]) g.line(9 + t, 22 - t, 12 + t, 25 - t, 0x4a3a32);
  g.poly([[16, 13], [20, 17], [27, 14], [18, 5]], 0xb8bcc4);
  g.line(17, 9, 23, 15, 0xe8ecf0);
  g.line(18, 5, 27, 14, 0xfff4b0);
  g.line(19, 5, 27, 13, 0xffffff);
  g.outline();
  g.px(29, 6, 0xffe870);
  g.px(25, 2, 0xffe870);
  g.px(30, 10, 0xffe870);
}

const ICONS: Record<string, (g: PixelGrid) => void> = {
  flashlight,
  hoe,
  watering_can: wateringCan,
  pickaxe: (g) => pickaxe(g, 0x8a8a92),
  pickaxe_iron: (g) => pickaxe(g, 0xb8c8dc),
  axe,
  sword_wood: (g) => sword(g, P.woodLight),
  sword_copper: (g) => sword(g, P.copper),
  turnip,
  carrot,
  strawberry,
  pumpkin,
  stone: (g) => ore(g, P.stone, null),
  ore_copper: (g) => ore(g, 0x6a6460, P.copper),
  ore_iron: (g) => ore(g, 0x5e5c68, 0xc8d0dc),
  ore_silver: (g) => ore(g, 0x5e5c68, 0xe8eef4),
  ore_gold: (g) => ore(g, 0x6a6460, 0xf2c230),
  gem_crystal: gem,
  gem_diamond: diamond,
  wood,
  slime_gel: slimeGel,
  bat_wing: batWing,
  crab_shell: crabShell,
  herb_mint: mint,
  mushroom,
  fish_trout: fish,
  ...Object.fromEntries(Object.entries(MORE_CROPS).map(([k, [c, shape]]) => [k, (g: PixelGrid) => moreCrop(g, c, shape)])),
};

/** Quality crops: the normal crop's icon with a silver or gold star in the corner. */
function qualityStar(g: PixelGrid, quality: 1 | 2): void {
  const fill = quality === 2 ? 0xf2c230 : 0xc9d2dc;
  const rim = quality === 2 ? 0x8a5a10 : 0x5a6470;
  const star: [number, number][] = [[5, 19], [7, 23], [11, 23], [8, 26], [9, 30], [5, 28], [1, 30], [2, 26], [-1, 23], [3, 23]];
  g.poly(star.map(([x, y]) => [x + 2, y] as [number, number]), rim);
  g.poly(star.map(([x, y]) => [x + 2 + (x < 5 ? 1 : x > 5 ? -1 : 0), y + (y < 25 ? 1 : y > 27 ? -1 : 0)] as [number, number]), fill);
}

export function drawIcon(item: string): PixelGrid {
  const g = new PixelGrid(S, S);
  const def = getItem(item);
  if (def?.base && def.quality && Object.hasOwn(ICONS, def.base)) {
    ICONS[def.base](g);
    g.outline("self");
    qualityStar(g, def.quality);
    return g;
  }
  if (Object.hasOwn(ICONS, item)) ICONS[item](g);
  else if (item.startsWith("seed_")) seedPacket(g, item.slice(5));
  else if (def?.kind === "furniture") return furnitureIcon(item);
  else sack(g, hashStr(item));
  g.outline("self");
  return g;
}

/** Furniture icon: the rotation-0 sprite shrunk to fit and centred, re-outlined. */
function furnitureIcon(item: string): PixelGrid {
  const src = drawFurniture(item, 0);
  const f = Math.max(1, Math.ceil(Math.max(src.w, src.h) / 32));
  const small = f > 1 ? src.downscale(f) : src;
  const g = new PixelGrid(S, S);
  g.blit(small, Math.floor((S - small.w) / 2), Math.floor((S - small.h) / 2));
  if (f > 1) g.outline("self");
  return g;
}

/** Every item id with a hand-drawn (non-fallback) icon; used by tests. */
export function iconCoverage(): { item: string; custom: boolean }[] {
  return Object.keys(ITEMS).map((item) => ({
    item,
    custom:
      Object.hasOwn(ICONS, item) ||
      item.startsWith("seed_") ||
      getItem(item)?.kind === "furniture" ||
      Object.hasOwn(ICONS, getItem(item)?.base ?? ""),
  }));
}
