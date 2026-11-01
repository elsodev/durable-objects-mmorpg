// Placeable furniture. Rotation 0..3 = facing down, left, up, right; 1 and 3 swap the footprint.
import { getItem } from "../../../shared/items";
import { hashStr, P, shade, type Rgb } from "../palette";
import { PixelGrid } from "./grid";

export type Rotation = 0 | 1 | 2 | 3;
const T = 32;

export function rotatedFootprint(item: string, rotation: Rotation): { w: number; h: number } {
  const fp = getItem(item)?.footprint ?? { w: 1, h: 1 };
  return rotation % 2 === 1 ? { w: fp.h, h: fp.w } : { w: fp.w, h: fp.h };
}

/** Pixels drawn above the footprint for tall pieces. */
const EXTRA: Record<string, number> = { rug: 0, chair_wood: 14, table_wood: 8, bed_simple: 8, lamp: 36, flower_pot: 10, fence: 8, scarecrow: 34 };

function chair(g: PixelGrid, r: Rotation): void {
  const wood = P.wood;
  const H = g.h;
  const seatY = H - 18;
  const legs = () => {
    for (const x of [8, 22]) g.rect(x, seatY + 4, 3, 13, P.woodDark);
  };
  const back = (x: number, y: number, w: number, h: number) => {
    g.rect(x, y, w, h, P.woodDark);
    g.rect(x + 1, y + 1, w - 2, h - 2, wood);
    for (let i = x + 3; i < x + w - 2; i += 4) g.vline(i, y + 4, h - 6, P.woodDark);
    g.hline(x + 1, y + 1, w - 2, P.woodLight);
  };
  if (r === 0) {
    back(7, seatY - 18, 18, 20);
    legs();
    g.box(6, seatY, 20, 6, P.woodLight);
  } else if (r === 2) {
    legs();
    g.box(6, seatY, 20, 6, P.woodLight);
    back(7, seatY - 14, 18, 18);
  } else {
    const bx = r === 1 ? 22 : 6;
    legs();
    g.box(6, seatY, 20, 6, P.woodLight);
    back(bx, seatY - 18, 5, 26);
  }
  g.rect(8, seatY + 1, 16, 2, 0xc85a4a); // cushion
}

function table(g: PixelGrid, r: Rotation): void {
  const W = g.w;
  const H = g.h;
  const legH = 10;
  const top = 6;
  for (const x of [4, W - 8]) g.rect(x, H - legH - 2, 4, legH, P.woodDark);
  g.box(1, top, W - 2, H - legH - top, P.wood);
  g.hline(2, top + 1, W - 4, P.woodLight);
  g.rect(1, H - legH - 4, W - 2, 3, P.woodDark);
  const vertical = r % 2 === 1;
  if (vertical) for (let y = top + 6; y < H - legH - 4; y += 7) g.hline(3, y, W - 6, shade(P.wood, -0.18));
  else for (let x = 10; x < W - 4; x += 10) g.vline(x, top + 2, H - legH - top - 6, shade(P.wood, -0.18));
  // A little vase or plate on top.
  g.ellipse(W / 2, top + 9, 5, 3, P.cream);
  g.ellipse(W / 2, top + 8, 3, 1.5, 0xe8a050);
}

function bed(g: PixelGrid, r: Rotation): void {
  const W = g.w;
  const H = g.h;
  const blanket = 0x4a7ac8;
  g.box(1, 4, W - 2, H - 6, P.woodDark);
  g.rect(3, 7, W - 6, H - 11, P.white);
  // Head end depends on rotation: 0 top, 1 right... pillow sits at the head.
  const head = (["top", "right", "bottom", "left"] as const)[r];
  const blank = (x: number, y: number, w: number, h: number) => {
    g.rect(x, y, w, h, blanket);
    g.hline(x, y, w, shade(blanket, 0.3));
    for (let i = x + 4; i < x + w; i += 8) g.vline(i, y + 1, h - 1, shade(blanket, -0.15));
    g.hline(x, y + h - 1, w, shade(blanket, -0.35));
  };
  if (head === "top") {
    g.rect(1, 0, W - 2, 10, P.wood);
    g.hline(1, 0, W - 2, P.woodLight);
    g.box(6, 10, W - 12, 9, P.cream);
    blank(3, 22, W - 6, H - 26);
  } else if (head === "bottom") {
    blank(3, 7, W - 6, H - 26);
    g.box(6, H - 18, W - 12, 9, P.cream);
    g.rect(1, H - 8, W - 2, 8, P.wood);
  } else {
    const left = head === "left";
    g.rect(left ? 0 : W - 8, 0, 8, H, P.wood);
    g.vline(left ? 0 : W - 8, 0, H, P.woodLight);
    g.box(left ? 10 : W - 22, 10, 12, H - 18, P.cream);
    blank(left ? 24 : 3, 7, W - 30, H - 11);
  }
}

function rug(g: PixelGrid, r: Rotation): void {
  const W = g.w;
  const H = g.h;
  const outer = 0xa83a3a;
  const inner = 0xe0b060;
  g.ellipse(W / 2, H / 2, W / 2 - 2, H / 2 - 4, outer);
  g.ellipse(W / 2, H / 2, W / 2 - 6, H / 2 - 8, inner);
  g.ellipse(W / 2, H / 2, W / 2 - 10, H / 2 - 12, 0x3a6a9a);
  const horiz = r % 2 === 0;
  for (let i = -2; i <= 2; i++) {
    if (horiz) g.tint(8, H / 2 + i * 6, W - 16, 1, inner);
    else g.tint(W / 2 + i * 6, 8, 1, H - 16, inner);
  }
  g.ellipse(W / 2, H / 2, 4, 4, outer);
}

function lamp(g: PixelGrid): void {
  const cx = 16;
  const H = g.h;
  g.ellipse(cx, 12, 14, 12, P.flameHot, 45);
  g.ellipse(cx, H - 4, 7, 3, P.woodDark);
  g.rect(cx - 1, 16, 3, H - 20, P.woodDark);
  g.poly([[cx - 9, 22], [cx - 5, 6], [cx + 5, 6], [cx + 9, 22]], 0xf2dca0);
  g.poly([[cx + 1, 22], [cx + 3, 6], [cx + 5, 6], [cx + 9, 22]], 0xd8b878);
  g.hline(cx - 9, 22, 19, 0xc89a5a);
  g.rect(cx - 3, 22, 6, 2, P.flameHot);
}

function flowerPot(g: PixelGrid): void {
  const H = g.h;
  g.poly([[8, H - 16], [24, H - 16], [21, H - 2], [11, H - 2]], 0xc8643a);
  g.rect(7, H - 18, 18, 4, 0xd8784a);
  g.vline(20, H - 14, 12, 0xa04a2a);
  for (const [x, y, c] of [[11, H - 26, 0xf06a8a], [20, H - 28, 0xf2e070], [16, H - 32, 0xb070e0]] as const) {
    g.line(16, H - 18, x, y + 3, 0x3a8a2a);
    g.ellipse(x, y, 3, 3, c);
    g.px(x, y, P.gold);
  }
  g.ellipse(9, H - 22, 3, 1.5, 0x5aa83e);
  g.ellipse(23, H - 21, 3, 1.5, 0x5aa83e);
}

function fence(g: PixelGrid, r: Rotation): void {
  const H = g.h;
  if (r % 2 === 0) {
    for (const y of [H - 20, H - 11]) {
      g.rect(0, y, 32, 4, P.wood);
      g.hline(0, y, 32, P.woodLight);
      g.hline(0, y + 3, 32, P.woodDark);
    }
    for (const x of [2, 24]) {
      g.rect(x, H - 26, 6, 24, P.wood);
      g.vline(x, H - 26, 24, P.woodLight);
      g.vline(x + 5, H - 26, 24, P.woodDark);
    }
  } else {
    // Running north-south: rails seen end-on from above, one post in the middle.
    for (const x of [12, 18]) {
      g.rect(x, 0, 3, H - 4, P.wood);
      g.vline(x, 0, H - 4, P.woodLight);
    }
    g.rect(13, H - 24, 6, 22, P.wood);
    g.vline(13, H - 24, 22, P.woodLight);
    g.vline(18, H - 24, 22, P.woodDark);
  }
}

function scarecrow(g: PixelGrid): void {
  const H = g.h;
  const cx = 16;
  g.rect(cx - 1, 14, 3, H - 16, P.bark);
  g.rect(2, 28, 28, 3, P.bark);
  // Shirt and straw cuffs.
  g.rect(cx - 7, 24, 15, 18, 0x4a7ac8);
  g.rect(3, 26, 6, 6, 0x4a7ac8);
  g.rect(23, 26, 6, 6, 0x4a7ac8);
  g.rect(cx - 4, 30, 4, 4, 0xd04a3a);
  for (const x of [1, 29]) g.vline(x, 26, 6, 0xe8c860);
  g.vline(cx, 42, 6, 0xe8c860);
  // Sack head and hat.
  g.ellipse(cx + 0.5, 18, 6, 6, 0xd8c090);
  g.px(cx - 2, 18, P.black);
  g.px(cx + 3, 18, P.black);
  g.hline(cx - 1, 21, 4, 0x8a5a3a);
  g.ellipse(cx + 0.5, 12, 11, 2.5, 0xb08a40);
  g.rect(cx - 5, 5, 11, 7, 0xc8a050);
  g.hline(cx - 5, 10, 11, 0xa83a2a);
}

export function drawFurniture(item: string, rotation: Rotation): PixelGrid {
  const fp = rotatedFootprint(item, rotation);
  const extra = Object.hasOwn(EXTRA, item) ? EXTRA[item] : 6;
  const g = new PixelGrid(fp.w * T, fp.h * T + extra);
  switch (item) {
    case "chair_wood":
      chair(g, rotation);
      break;
    case "table_wood":
      table(g, rotation);
      break;
    case "bed_simple":
      bed(g, rotation);
      break;
    case "rug":
      rug(g, rotation);
      break;
    case "lamp":
      lamp(g);
      break;
    case "flower_pot":
      flowerPot(g);
      break;
    case "fence":
      fence(g, rotation);
      break;
    case "scarecrow":
      scarecrow(g);
      break;
    default:
      genericBox(g, hashStr(item));
  }
  g.outline("self");
  return g;
}

function genericBox(g: PixelGrid, h: number): void {
  const c: Rgb = [P.wood, 0x8a6a9a, 0x5a8a7a, 0xa86a4a][h % 4];
  g.box(2, 4, g.w - 4, g.h - 6, c);
  g.rect(3, 5, g.w - 6, 4, shade(c, 0.25));
  g.rect(g.w / 2 - 2, g.h / 2, 4, 4, P.gold);
}
