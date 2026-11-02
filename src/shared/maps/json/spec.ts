// The JSON map format (docs/guides/json-maps.md). A file names a few rooms and passages (or
// paints exact tiles with a legend) and lists what lives there; the seeded MapBuilder fills in
// the rest, so a whole cave is a page of JSON. These are the shapes after parseMapSpec checked
// them; the raw JSON is untrusted until then.
import type { RockOre, ZoneId } from "../../types";
import type { PropType } from "../props";

/** Ground names usable in JSON (Ground enum members, snake_case). */
export const GROUND_NAMES = ["void", "grass", "dirt", "sand", "water", "stone", "wood", "tilled", "cave_wall", "wall"] as const;
export type GroundName = (typeof GROUND_NAMES)[number];

export type Edge = "left" | "top" | "right" | "bottom";
export const EDGES: readonly Edge[] = ["left", "top", "right", "bottom"];

/** A tile, as [x, y]. */
export type TileXY = readonly [number, number];

/** A rough ellipse of floor, centre (x, y) and radii (rx, ry). */
export interface RoomSpec {
  id: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** Edge jitter (0 smooth .. 0.6 ragged). */
  noise: number;
}

export interface TunnelSpec {
  from: string;
  to: string;
  width: number;
}

/** Where something stands: a room's centre (and its inside, for scatter) or a fixed tile. */
export type Anchor = { room: string } | { at: TileXY };

export type ExitSpec = {
  to: ZoneId;
  /** Spawn in the destination; default "from_<this map>". */
  arrive?: string;
  label?: string;
  back?: ZoneId[];
} & (
  | {
      /** Cut a passage from the room straight to this edge of the map. */
      edge: Edge;
      room: string;
    }
  | {
      /** A fixed doorway (interiors): the exit rectangle and the tile you arrive on. */
      rect: readonly [number, number, number, number];
      spawnAt: TileXY;
    }
);

export interface MonsterGroupSpec {
  anchor: Anchor;
  type: "slime" | "bat" | "rock_crab";
  count: number;
  max: number;
  perPlayer: number;
  radius: number;
  level: number;
  respawnSec: number;
}

export interface RockGroupSpec {
  room: string;
  count: number;
  /** Base ore by weight. */
  ores: Partial<Record<"stone" | "copper" | "iron" | "gem", number>>;
  /** Per-spawn chance a rock comes back as a rarer ore. */
  odds?: { silver: number; gold: number; diamond: number };
}

export interface PropSpec {
  type: PropType;
  at: TileXY;
  id?: string;
  label?: string;
}

export interface DecorSpec {
  type: PropType;
  room: string;
  count: number;
}

export interface DropEntrySpec {
  item: string;
  weight: number;
  min: number;
  max: number;
}

export interface MapSpec {
  id: ZoneId;
  name: string;
  width: number;
  height: number;
  seed: number;
  ambient: "day" | "cave" | "indoor";
  fill: GroundName;
  floor: GroundName;
  depth?: number;
  /** Exact tiles: one string per row, one legend char per tile. */
  tiles?: { legend: Record<string, GroundName>; rows: string[] };
  rooms: RoomSpec[];
  tunnels: TunnelSpec[];
  exits: ExitSpec[];
  spawns: Record<string, Anchor>;
  monsters: MonsterGroupSpec[];
  rocks: RockGroupSpec[];
  props: PropSpec[];
  decor: DecorSpec[];
  chests: number;
  drops: {
    kill?: { chance: number; table: DropEntrySpec[] };
    ground?: { rooms: string[]; base: number; perPlayer: number; max: number; refillSec: number; table: DropEntrySpec[] };
  };
}

export type BaseOre = Extract<RockOre, "stone" | "copper" | "iron" | "gem">;
