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

/**
 * The maps of a player's home, all served by the owner's HomeRoom: "home" is the yard (house
 * exterior, farm, shipping bin, mailbox), "home_in" the inside of the house. Players stay in
 * zone "home" on both; only the map they stand on changes (see MapExit.map).
 */
export type HomeMapId = "home" | "home_in";
export const HOME_MAPS: readonly HomeMapId[] = ["home", "home_in"];
export function isHomeMapId(v: unknown): v is HomeMapId {
  return v === "home" || v === "home_in";
}
/** Anything getMap() can build: every zone plus the home's inside. */
export type MapId = ZoneId | HomeMapId;

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

/** Kinds of outdoor spots where villagers spend their day (see shared/npcHangouts.ts). */
export const HANGOUT_KINDS = ["fountain", "pond", "dock", "garden", "market", "notice", "well", "porch", "yard"] as const;
export type HangoutKind = (typeof HANGOUT_KINDS)[number];

/** An outdoor spot a villager walks to and lingers at, facing `face` (the fountain, the water...). */
export interface Hangout {
  id: string;
  kind: HangoutKind;
  /** Tile (the villager stands at its centre). */
  x: number;
  y: number;
  face: Facing;
  /** Only this villager uses the spot (their own garden or yard). */
  owner?: string;
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
  /**
   * Home only: a door between the home's own maps. `to` stays "home" and the player switches to
   * this map on the same connection instead of changing zone.
   */
  map?: HomeMapId;
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
  /** Rectangles where farming is allowed (when not `farmGrass`). */
  farmArea?: { x: number; y: number; w: number; h: number }[];
  /**
   * Home yard: every grass tile is farmland except paths, props (house,
   * trees, fences...), exits and the `noFarm` rectangles. Replaces `farmArea`.
   */
  farmGrass?: boolean;
  /** With `farmGrass`: tiles kept clear of farmland (in front of the door, bin and mailbox). */
  noFarm?: { x: number; y: number; w: number; h: number }[];
  /** Home only: rectangles where furniture may be placed (indoors). */
  floorArea?: { x: number; y: number; w: number; h: number }[];
  /** Mining nodes that can be broken (caves). */
  rocks?: { id: string; x: number; y: number; ore: RockOre }[];
  /** Chairs, stools and benches anyone may sit on (derived from the seat props). */
  seats?: Seat[];
  /** Outdoor spots villagers walk between during the day (village). */
  hangouts?: Hangout[];
  /** Interiors: wall style (side/south wall art) and floor art key (catalog `interior` floors). */
  interior?: { wall: string; floor?: string };
  /** Visual tint for the client (caves are darker). */
  ambient: "day" | "cave" | "indoor";
  /** Home maps only: which of the home's maps this is. */
  homeMap?: HomeMapId;
}

// ---------- Items & inventory ----------

/**
 * What a mining rock holds. Maps place stone, copper, iron and gem rocks; in the caves a rock may
 * come back as silver, gold or diamond instead (shared/engine/rockOres.ts).
 */
export type RockOre = "stone" | "copper" | "iron" | "silver" | "gold" | "gem" | "diamond";

export type ItemId = string; // e.g. "seed_turnip", "turnip", "ore_copper", "hoe", "chair_wood"

export interface InventorySlot {
  item: ItemId;
  qty: number;
  /** Optional per-stack quality (0 normal). Stacks only merge when item and quality match. */
  quality?: number;
}

/**
 * A fixed grid of MAX_SLOTS (24) slots. Empty slots stay `null` so items never shift position
 * (the hotbar is slots 0..7). Old saves and tests may hold a shorter, packed array: every engine
 * function treats a missing index as empty, and sanitizeInventory pads to the full grid.
 */
export interface Inventory {
  coins: number;
  slots: (InventorySlot | null)[];
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
  /**
   * Home only: day ends in a row this tile went unwatered. Empty soil reverts to grass after 2-3;
   * a growing crop wilts from 1 and dies at CROP_DEATH_DAYS.
   */
  dryDays?: number;
  /** Home only: the crop died of thirst and stays as a dead plant until cleared. */
  dead?: boolean;
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
