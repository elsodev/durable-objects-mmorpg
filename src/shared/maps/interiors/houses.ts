// Villager cottages. Each owner has their own room (size, walls, door) and their own things; the
// seeded furniture placer (placer.ts) arranges them so every cottage differs but still makes sense:
// bed headboard to the wall, chairs facing tables, nothing in the way of the door.

import { Ground, type InteriorZoneId, type MapData } from "../../types";
import type { HouseOwner } from "./doors";
import { furnish, seedOf, type FurnishPlan } from "./placer";
import type { WallStyle } from "./props";
import type { RoomSpec } from "./room";

interface HouseSpec {
  w: number;
  h: number;
  door: number;
  wall: WallStyle;
  floor: Ground;
  floorStyle: string;
  /** North wall, one char per map column (w + 2): p plain, w window, s shelf, a art. */
  wallPattern: string;
  plan: Omit<FurnishPlan, "npc">;
  wander: number;
  /** The owner's favourite part of the room (fractions of width/height). */
  prefer: { x: number; y: number };
}

export const HOUSE_SPECS: Record<HouseOwner, HouseSpec> = {
  // The mayor: papers at a writing desk, shelves of records, a grandfather clock, a good red bed.
  bram: {
    w: 12,
    h: 8,
    door: 6,
    wall: "timber",
    floor: Ground.Wood,
    floorStyle: "floor_wood_red",
    wallPattern: "pwpapwspwpasp",
    plan: {
      north: ["bed_red", "fireplace", "bookshelf", "bookshelf", "clock", "wardrobe"],
      kitchen: false,
      tables: [{ table: "writing_desk", lamp: true }, { table: "table_round_meal", rug: "rug_red" }],
      wall: ["potted_tree", "chest", "flower_vase"],
      decor: ["painting_portrait", "wall_sconce", "notice_board_wall"],
    },
    wander: 3,
    prefer: { x: 0.25, y: 0.35 },
  },
  // The market gardener: baskets of produce, crates of vegetables, plants on every sill.
  odette: {
    w: 10,
    h: 7,
    door: 3,
    wall: "plaster",
    floor: Ground.Wood,
    floorStyle: "floor_wood_light",
    wallPattern: "pwpwpspwpwpp",
    plan: {
      north: ["bed_yellow", "hearth", "dish_cabinet"],
      kitchen: true,
      tables: [{ table: "table_long_meal", rug: "rug_vine" }],
      wall: ["produce_basket", "produce_basket", "veg_crate", "veg_crate", "produce_pile", "basket", "sack", "potted_plant", "flower_vase"],
      decor: ["painting_flowers", "wall_pans"],
    },
    wander: 2,
    prefer: { x: 0.8, y: 0.45 },
  },
  // The smith: a rack of tools, a strongbox, barrels and crates of stock. Small and plain.
  fenwick: {
    w: 8,
    h: 7,
    door: 5,
    wall: "stone",
    floor: Ground.Wood,
    floorStyle: "floor_wood_dark",
    wallPattern: "pspwpppsp",
    plan: {
      north: ["bed_brown", "hearth", "tool_rack"],
      kitchen: false,
      tables: [{ table: "table_round" }],
      wall: ["chest", "barrel", "barrel_water", "crate", "crate"],
      decor: ["wall_tool_rack", "wall_torch"],
      tabletop: ["mugs"],
    },
    wander: 2,
    prefer: { x: 0.25, y: 0.75 },
  },
  // The kid: a toy chest, a crate fort, a spare bed for sleepovers.
  pip: {
    w: 11,
    h: 8,
    door: 2,
    wall: "plaster",
    floor: Ground.Wood,
    floorStyle: "floor_wood_light",
    wallPattern: "pwpappwpapwp",
    plan: {
      north: ["bed_blue", "bed_green", "hearth", "cupboard"],
      kitchen: true,
      tables: [{ table: "table_round_meal", rug: "rug_vine" }],
      wall: ["toy_chest", "toy_chest", "crate", "crate", "crate", "potted_plant"],
      decor: ["painting_flowers", "painting_sea"],
    },
    wander: 4,
    prefer: { x: 0.5, y: 0.8 },
  },
  // The fisherman: barrels of brine, crates of the catch, a narrow room by the water.
  marlo: {
    w: 9,
    h: 6,
    door: 6,
    wall: "log",
    floor: Ground.Wood,
    floorStyle: "floor_wood_dark",
    wallPattern: "pwppspwpwp",
    plan: {
      north: ["bed_blue", "hearth", "stove"],
      kitchen: false,
      tables: [{ table: "table_round_meal" }],
      wall: ["fish_crate", "fish_crate", "barrel_stack", "barrel", "sack"],
      decor: ["painting_sea", "wall_pans"],
    },
    wander: 2,
    prefer: { x: 0.75, y: 0.3 },
  },
  // The herbalist: a bubbling cauldron, boxes of herbs and flowers, plants.
  iris: {
    w: 9,
    h: 8,
    door: 4,
    wall: "timber",
    floor: Ground.Wood,
    floorStyle: "floor_wood",
    wallPattern: "pspwpwpsap",
    plan: {
      north: ["bed_green", "fireplace", "bookshelf"],
      kitchen: true,
      tables: [{ table: "table_round", rug: "rug_vine" }],
      wall: ["cauldron", "herb_box", "herb_box", "herb_box_flowers", "potted_plant", "potted_tree", "basket"],
      decor: ["wall_shelf", "mirror"],
      tabletop: ["candle"],
    },
    wander: 3,
    prefer: { x: 0.3, y: 0.55 },
  },
  // The miner: crates of ore, a coal heap, a lamp for the dark, stone walls.
  grumm: {
    w: 11,
    h: 7,
    door: 8,
    wall: "stone",
    floor: Ground.Stone,
    floorStyle: "floor_stone",
    wallPattern: "ppsppwppspp",
    plan: {
      north: ["bed_grey", "fireplace", "dresser", "wardrobe"],
      kitchen: false,
      tables: [{ table: "table_long", lamp: true, rug: "rug_red" }],
      wall: ["ore_crate", "ore_crate", "coal_pile", "barrel", "crate", "sack"],
      decor: ["wall_torch", "wall_torch"],
      tabletop: ["mugs", "bottle"],
    },
    wander: 2,
    prefer: { x: 0.8, y: 0.75 },
  },
  // The explorer: books and maps at a writing desk, a chest of gear.
  tess: {
    w: 10,
    h: 8,
    door: 1,
    wall: "log",
    floor: Ground.Wood,
    floorStyle: "floor_wood_red",
    wallPattern: "pwppsappwpwp",
    plan: {
      north: ["bed_cream", "hearth", "bookshelf", "bookshelf", "bookshelf"],
      kitchen: true,
      tables: [{ table: "writing_desk", lamp: true }, { table: "table_round" }],
      wall: ["chest", "crate", "potted_plant"],
      decor: ["painting_landscape", "wall_sconce"],
      tabletop: ["candle", "bowl"],
    },
    wander: 3,
    prefer: { x: 0.55, y: 0.3 },
  },
};

export function houseZone(owner: HouseOwner): InteriorZoneId {
  return `int_house_${owner}` as InteriorZoneId;
}

/** The owner's cottage furnished from any seed (the fuzz tests try many). */
export function buildHouseWithSeed(owner: HouseOwner, seed: number): MapData {
  const s = HOUSE_SPECS[owner];
  const spec: RoomSpec = {
    zone: houseZone(owner),
    w: s.w,
    h: s.h,
    floor: s.floor,
    wall: s.wall,
    door: s.door,
    seed: seed,
    floorStyle: s.floorStyle,
    wallPattern: s.wallPattern,
  };
  return furnish(spec, { ...s.plan, npc: { id: owner, wander: s.wander, prefer: s.prefer } }, seed);
}

/** The cottage everyone sees: seeded by its building id, so server and client agree. */
export function buildHouse(owner: HouseOwner): MapData {
  return buildHouseWithSeed(owner, seedOf(`house_${owner}`));
}
