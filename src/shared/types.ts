// Core game types shared by the Worker, the Durable Objects and the browser client.
// Positions are in TILE units (floats). One tile = 16 px of source art, drawn at 3x on screen.

export const TILE_PX = 16;
export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;

/** Outdoor shared maps. */
export type OutdoorZoneId = "village" | "riverside" | "caves";
export const OUTDOOR_ZONES: OutdoorZoneId[] = ["village", "riverside", "caves"];
/**
 * Building interiors: public shared rooms behind the village doors (maps in shared/maps/interiors).
 * Houses are named after the villager who lives there.
 */
export const INTERIOR_ZONES = [
  "int_townhall",
  "int_inn",
  "int_smithy",
  "int_house_bram",
  "int_house_odette",
  "int_house_fenwick",
  "int_house_pip",
  "int_house_marlo",
  "int_house_iris",
  "int_house_grumm",
  "int_house_tess",
] as const;
export type InteriorZoneId = (typeof INTERIOR_ZONES)[number];
/** Shared zones everyone sees (served by ZoneRoom), plus the private home. */
export type SharedZoneId = OutdoorZoneId | InteriorZoneId;
export type ZoneId = SharedZoneId | "home";
export const SHARED_ZONES: SharedZoneId[] = [...OUTDOOR_ZONES, ...INTERIOR_ZONES];

export function isInteriorZone(z: unknown): z is InteriorZoneId {
  return (INTERIOR_ZONES as readonly unknown[]).includes(z);
}

export type Facing = "down" | "up" | "left" | "right";

export interface Vec2 {
  x: number;
  y: number;
}

export type EntityKind = "player" | "npc" | "monster";

/** What the server broadcasts about anything that moves. */
export interface EntityState {
  id: string; // "p:<userId>", "n:<npcId>", "m:<n>"
  kind: EntityKind;
  name: string;
  sprite: string; // key into the client sprite catalog, e.g. "ninja_blue", "slime"
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  hp?: number;
  maxHp?: number;
  /** Short status line shown over the head, e.g. "..." while an NPC thinks. */
  status?: string;
  /** Players only: chosen character look (ids from shared/look.ts); drawn as composited LPC layers. */
  look?: Look;
  /**
   * Last tool action, for action animations: k is "hoe" | "water" | "pickaxe" | "sword" |
   * "harvest" | "plant" | "eat", at the server time it happened. "sit" lasts while the entity
   * sits on a seat (entity at the seat tile's centre, facing the table); it is removed on standing.
   */
  act?: { k: string; at: number; item?: ItemId };
}

/** Character creator choices; every field is an option id listed in shared/look.ts. */
export interface Look {
  /** Body type ("male", "male_slim", "female"); saves from before body types read as "male". */
  body: string;
  skin: string;
  eyes: string;
  hairStyle: string;
  hairColor: string;
  top: string;
  bottom: string;
  shoes: string;
}

/** Ground layer tile kinds. Maps are a grid of these. */
export enum Ground {
  Void = 0,
  Grass = 1,
  Dirt = 2, // path
  Sand = 3,
  Water = 4, // blocks
  Stone = 5, // cave floor
  Wood = 6, // indoor floor / dock / bridge
  Tilled = 7, // farmland that has been hoed
  CaveWall = 8, // blocks
  Wall = 9, // building wall, blocks
}

export const BLOCKING_GROUND = new Set<Ground>([Ground.Void, Ground.Water, Ground.CaveWall, Ground.Wall]);

/** Static decoration / obstacle placed by the map (trees, houses, rocks...). */
export interface MapProp {
  id: string;
  type: string; // key into client prop catalog: "tree", "house_small", "town_hall", "well", "rock_copper", "fountain", ...
  x: number; // top-left tile
  y: number;
  w: number; // footprint in tiles (blocks movement)
  h: number;
  /** Short text the client draws on the prop (signposts: destination of the nearby exit). */
  label?: string;
  /** Flat decoration (rugs) drawn on the floor: never blocks and never hides anyone. */
  walkable?: boolean;
}

/** A place to sit: the seat prop's tile and the way the sitter faces (toward the table). */
export interface Seat {
  /** Same as the seat prop's id. */
  id: string;
  x: number;
  y: number;
  facing: Facing;
}

export interface MapExit {
  /** Tile rectangle that triggers the exit when a player steps in. */
  x: number;
  y: number;
  w: number;
  h: number;
  to: ZoneId;
  /** Spawn point name in the destination map. */
  spawn: string;
}

export interface NpcSpawn {
  npcId: string; // key into NPC catalog (src/worker/npc/catalog.ts)
  x: number;
  y: number;
  /** NPC wanders within this many tiles of its spawn. */
  wander: number;
}

export interface MonsterSpawn {
  type: "slime" | "bat" | "rock_crab";
  x: number;
  y: number;
  radius: number;
  count: number;
}

export interface MapData {
  zone: ZoneId;
  name: string;
  width: number;
  height: number;
  /** Row-major ground grid, length width*height. */
  ground: Ground[];
  props: MapProp[];
  exits: MapExit[];
  spawns: Record<string, Vec2>; // "default", "from_village", ...
  npcs: NpcSpawn[];
  monsters: MonsterSpawn[];
  /** Home only: rectangles where farming is allowed. */
  farmArea?: { x: number; y: number; w: number; h: number }[];
  /** Home only: rectangles where furniture may be placed (indoors). */
  floorArea?: { x: number; y: number; w: number; h: number }[];
  /** Mining nodes that can be broken (caves). */
  rocks?: { id: string; x: number; y: number; ore: "stone" | "copper" | "iron" | "gem" }[];
  /** Interiors: chairs and stools anyone may sit on (derived from the seat props). */
  seats?: Seat[];
  /** Interiors: wall style (side/south wall art) and floor art key (catalog `interior` floors). */
  interior?: { wall: string; floor?: string };
  /** Visual tint for the client (caves are darker). */
  ambient: "day" | "cave" | "indoor";
}

// ---------- Items & inventory ----------

export type ItemId = string; // e.g. "seed_turnip", "turnip", "ore_copper", "hoe", "chair_wood"

export interface InventorySlot {
  item: ItemId;
  qty: number;
}

export interface Inventory {
  coins: number;
  slots: InventorySlot[]; // max 24
}

// ---------- Home: farming & placed objects ----------

export interface FarmTile {
  x: number;
  y: number;
  /** null = tilled but empty */
  crop: ItemId | null; // crop id, e.g. "turnip"
  plantedAt: number | null; // ms epoch
  /** Number of distinct in-game days the crop was watered. */
  wateredDays: number;
  lastWateredDay: number | null; // day index = Math.floor(ms / DAY_MS)
  /** Home only: day ends this tile spent tilled with nothing planted (it reverts to grass after 2-3). */
  dryDays?: number;
}

export interface PlacedObject {
  id: string;
  item: ItemId; // furniture/fence item id
  x: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
}

/**
 * Length of one in-game day in farm time. At home, farm functions run on a virtual clock where
 * each home day N is `farmNow(N)` (see engine/homeclock.ts), so day N always means the N-th
 * DAY_MS window regardless of how long the real day took (sleep ends it early).
 */
export const DAY_MS = 20 * 60 * 1000;
