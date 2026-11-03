// The scythe's sweep: one swing cuts the ripe crop on the tile you aim at and the two tiles beside
// it across your facing (the blade's arc). Pure: the server filters these by reach and ripeness.
import type { Facing, Vec2 } from "../types";

/** Tiles one sweep covers, the aimed tile first: across the facing, one tile each side. */
export function scytheSweep(target: Vec2, facing: Facing): Vec2[] {
  const x = Math.floor(target.x);
  const y = Math.floor(target.y);
  const across = facing === "up" || facing === "down";
  return across
    ? [{ x, y }, { x: x - 1, y }, { x: x + 1, y }]
    : [{ x, y }, { x, y: y - 1 }, { x, y: y + 1 }];
}
