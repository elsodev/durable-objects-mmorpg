// The village pond: open water with a grass bank (the client autotiles the shore), lily pads and
// reeds on the water, reed clumps on the bank, a short plank dock and benches facing the water.
// Water blocks walking; the planks are walkable Ground.Wood like the riverside dock.

import { Ground, type Vec2 } from "../types";
import type { MapBuilder, Rect } from "./builder";
import type { PropType } from "./props";

/** Water of the pond, row by row ([first, last] column): a rounded oval. */
export const POND_ROWS: Readonly<Record<number, readonly [number, number]>> = {
  9: [22, 26],
  10: [20, 28],
  11: [19, 28],
  12: [19, 28],
  13: [20, 27],
  14: [22, 25],
};
/** Dock planks reaching into the pond from the east bank. */
export const POND_DOCK: Rect = { x: 27, y: 11, w: 2, h: 1 };

export function isPondTile(x: number, y: number): boolean {
  const row = POND_ROWS[y];
  return row !== undefined && x >= row[0] && x <= row[1];
}

export function buildPond(b: MapBuilder): void {
  for (const [y, [x0, x1]] of Object.entries(POND_ROWS)) for (let x = x0; x <= x1; x++) b.set(x, Number(y), Ground.Water);
  b.fill(POND_DOCK, Ground.Wood);
  // A footpath from the north-south road to the dock.
  b.path([{ x: 29, y: 11 }, { x: 30, y: 11 }], 1);
  b.reserve({ x: 16, y: 7, w: 14, h: 10 });

  // On the water (flat, never block).
  const water = (list: [PropType, number, number][]) => {
    for (const [type, x, y] of list) b.prop(type, x, y);
  };
  water([
    ["lilypad", 21, 12],
    ["lily_pink", 23, 10],
    ["lilypad_small", 26, 10],
    ["lily_white", 24, 12],
    ["lilypad", 25, 13],
    ["lilypad_small", 22, 11],
    // Reeds stand in open water, a tile in from the shore (the bank's autotile eats edge tiles).
    ["water_reeds", 20, 11],
    ["water_reeds", 26, 12],
    ["water_reeds", 23, 13],
  ]);
  // On the bank: reed clumps, a mossy rock, and a bench on the north shore looking over the water.
  b.prop("reeds", 18, 12);
  b.prop("reeds", 21, 9);
  b.prop("tall_grass", 28, 13);
  b.prop("reeds", 29, 12);
  b.prop("rock_deco", 18, 10);
  b.prop("bench_left", 23, 8, { id: "bench_pond_1" });
  b.prop("bench_right", 24, 8, { id: "bench_pond_2" });

  // Where villagers stop by the water: the end of the dock (fishing), the shores.
  b.hangout("dock", 27, 11, "left");
  b.hangout("pond", 18, 11, "right");
  b.hangout("pond", 22, 15, "up");
  b.hangout("pond", 25, 15, "up");
  b.hangout("pond", 26, 8, "down");
}

/** Every water tile of the pond (tests, fishing). */
export function pondTiles(): Vec2[] {
  const out: Vec2[] = [];
  const dock = (x: number, y: number) => x >= POND_DOCK.x && x < POND_DOCK.x + POND_DOCK.w && y >= POND_DOCK.y && y < POND_DOCK.y + POND_DOCK.h;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) if (isPondTile(x, y) && !dock(x, y)) out.push({ x, y });
  return out;
}
