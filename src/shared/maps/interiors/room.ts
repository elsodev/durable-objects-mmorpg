// Room: a walled interior built on MapBuilder. Every interior has the same shell so the client,
// the tests and the door logic can rely on it:
//
//   row 0..2      north wall (Ground.Wall) covered by 1x3 "iwall" pieces drawn from inside
//   rows 3..h+2   floor, columns 1..w (columns 0 and w+1 are side walls)
//   row h+3       south wall with the door gap; the door tile is the exit back to the village
//
// Furniture is placed in floor coordinates (fx, fy) = (0, 0) at the floor's top-left tile.

import { Ground, type InteriorZoneId, type MapData, type MapProp } from "../../types";
import { MapBuilder } from "../builder";
import type { PropType } from "../props";
import { doorFor } from "./doors";
import { TALL_WALL_PROPS, WALL_DECOR_PROPS, wallPiece, type WallFeature, type WallStyle } from "./props";
import { deriveSeats } from "./rules";

export interface RoomSpec {
  zone: InteriorZoneId;
  /** Floor size in tiles (walls excluded). */
  w: number;
  h: number;
  floor: Ground;
  wall: WallStyle;
  /** Floor column of the door in the south wall. */
  door: number;
  seed: number;
  /** Floor art (catalog `interior` key, e.g. "floor_parquet"); default plain wood/stone. */
  floorStyle?: string;
  /**
   * One char per map column (w + 2) for the north wall: p plain, w window, s shelf, a art,
   * - (left free for a prop placed with wallProp, e.g. stairs). Missing chars are plain.
   */
  wallPattern?: string;
}

const FEATURE: Record<string, WallFeature> = { p: "plain", w: "window", s: "shelf", a: "art" };

export class Room {
  readonly b: MapBuilder;
  readonly spec: RoomSpec;

  constructor(spec: RoomSpec) {
    this.spec = spec;
    const width = spec.w + 2;
    const height = spec.h + 4;
    const b = new MapBuilder(width, height, Ground.Wall, spec.seed);
    this.b = b;
    b.fill({ x: 1, y: 3, w: spec.w, h: spec.h }, spec.floor);
    const door = this.doorTile();
    b.set(door.x, door.y, spec.floor);

    const pattern = spec.wallPattern ?? "";
    for (let x = 0; x < width; x++) {
      const ch = pattern[x] ?? "p";
      if (ch === "-") continue;
      b.prop(wallPiece(spec.wall, FEATURE[ch] ?? "plain"), x, 0, { id: `wall_${x}` });
    }

    // Way in and out: the door column stays clear of furniture for two rows.
    b.exit({ x: door.x, y: door.y, w: 1, h: 1 }, "village", `from_${spec.zone}`);
    b.spawn("default", door.x, door.y - 2);
    b.spawn("from_village", door.x, door.y - 2);
    b.prop("doormat", door.x, door.y - 1, { id: "doormat" });
  }

  /** Map tile of the door (south wall). */
  doorTile(): { x: number; y: number } {
    return { x: 1 + this.spec.door, y: this.spec.h + 3 };
  }

  /** Places a prop at floor coords. */
  put(type: PropType, fx: number, fy: number, id?: string): void {
    this.b.prop(type, 1 + fx, 3 + fy, id ? { id } : {});
  }

  /** Places a prop over the north wall at map column x (its wallPattern chars must be "-"). */
  wallProp(type: PropType, x: number, id?: string): void {
    this.b.prop(type, x, 0, id ? { id } : {});
  }

  /** Hangs a picture, shelf or lamp on the north wall, starting at map column x. */
  hang(type: PropType, x: number, id?: string): void {
    this.b.prop(type, x, 1, id ? { id } : {});
  }

  npc(npcId: string, fx: number, fy: number, wander: number): void {
    this.b.npc(npcId, 1 + fx, 3 + fy, wander);
  }

  build(): MapData {
    const map = this.b.build({ zone: this.spec.zone, name: doorFor(this.spec.zone).name, ambient: "indoor" });
    moveWindowsFromBehindFurniture(map, this.spec.wall);
    map.seats = deriveSeats(map);
    map.interior = { wall: this.spec.wall, ...(this.spec.floorStyle ? { floor: this.spec.floorStyle } : {}) };
    return map;
  }
}

/** Map columns whose north wall is hidden behind tall furniture on the first floor row. */
export function columnsBehindTallFurniture(map: Pick<MapData, "props">): Set<number> {
  const cols = new Set<number>();
  for (const p of map.props) if (TALL_WALL_PROPS.has(p.type) && p.y === 3) for (let x = p.x; x < p.x + p.w; x++) cols.add(x);
  return cols;
}

/**
 * A fireplace or a wardrobe never stands in front of a window: the window piece behind it turns
 * plain, and the window moves to the nearest plain stretch of wall that is open (nothing tall in
 * front, nothing hung on it). With no such stretch the window is simply walled up.
 */
function moveWindowsFromBehindFurniture(map: MapData, style: WallStyle): void {
  const hidden = columnsBehindTallFurniture(map);
  const piece = (x: number) => map.props.find((p) => p.type.startsWith("iwall_") && p.x === x);
  const hung = (x: number) => map.props.some((p) => WALL_DECOR_PROPS.has(p.type) && x >= p.x && x < p.x + p.w);
  for (const x of [...hidden].sort((a, b) => a - b)) {
    const w = piece(x);
    if (!w || w.type !== wallPiece(style, "window")) continue;
    w.type = wallPiece(style, "plain");
    let best: MapProp | undefined;
    for (const q of map.props) {
      if (q.type !== wallPiece(style, "plain") || hidden.has(q.x) || hung(q.x) || q.x < 1 || q.x > map.width - 2) continue;
      if (!best || Math.abs(q.x - x) < Math.abs(best.x - x)) best = q;
    }
    if (best) best.type = wallPiece(style, "window");
  }
}
