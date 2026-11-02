// Fallback 32x32 food icons for when the LPC food sheet isn't loaded: a cup for drinks, a bowl
// for meals and a hand-held bun for snacks, each filled with the food's own colour.
import { foodSpec, type FoodType } from "../../../shared/foods";
import { hashStr, shade, type Rgb } from "../palette";
import type { PixelGrid } from "./grid";

/** Fill colour per food; anything unlisted gets a warm brown from its id. */
const FILL: Record<string, Rgb> = {
  mint_tea: 0x8ac070, coffee: 0x5a3a24, hot_cocoa: 0x7a4a30, apple_juice: 0xe8b840, milk: 0xf2f0e8, cider: 0xd89a3a,
  inn_stew: 0x9a5a34, pumpkin_soup: 0xe0882a, veggie_curry: 0xd8a030, mushroom_risotto: 0xe0d0a8,
  roast_dinner: 0xa86040, fish_pie: 0xe8c070, shepherds_pie: 0xc89050, pancakes: 0xe0a860, omelette: 0xf2d860,
  bread_roll: 0xc88a48, oat_cookie: 0xb8884a, apple_pie: 0xd09a50, berry_muffin: 0x8a4a8a, cheese_wedge: 0xf2cc50,
};

function cup(g: PixelGrid, c: Rgb): void {
  const mug = 0xe8e4dc;
  g.rect(8, 10, 14, 17, mug);
  g.vline(8, 10, 17, shade(mug, -0.25));
  g.rect(22, 13, 4, 2, mug);
  g.rect(24, 15, 2, 6, mug);
  g.rect(22, 20, 4, 2, mug);
  g.hline(9, 11, 12, c);
  g.hline(9, 12, 12, shade(c, -0.2));
  g.hline(8, 26, 14, shade(mug, -0.35));
}

function bowl(g: PixelGrid, c: Rgb): void {
  const clay = 0x8a5a3a;
  g.ellipse(16, 15, 12, 4, c);
  g.ellipse(14, 14, 4, 1, shade(c, 0.35));
  g.poly([[4, 16], [28, 16], [24, 25], [8, 25]], clay);
  g.hline(5, 16, 22, shade(clay, 0.3));
  g.hline(9, 25, 14, shade(clay, -0.35));
}

function bun(g: PixelGrid, c: Rgb): void {
  g.ball(16, 18, 11, 8, c, shade(c, -0.3), shade(c, 0.35));
  g.hline(10, 22, 12, shade(c, -0.2));
}

const DRAW: Record<FoodType, (g: PixelGrid, c: Rgb) => void> = { drink: cup, meal: bowl, snack: bun };

/** Draws `item` if it's a catalogue food; false for anything else. */
export function drawFood(g: PixelGrid, item: string): boolean {
  const spec = foodSpec(item);
  if (!spec) return false;
  DRAW[spec.type](g, Object.hasOwn(FILL, item) ? FILL[item]! : shade(0xb07a4a, ((hashStr(item) % 40) - 20) / 100));
  return true;
}
