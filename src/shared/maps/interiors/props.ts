import type { Facing } from "../../types";

// Footprints of the props that furnish building interiors. Merged into PROP_FOOTPRINTS.
// The north wall of every room is a row of 1x3 "iwall" pieces drawn from inside (style + feature);
// furniture art comes from the LPC atlas (catalog "props" entries), with procedural fallbacks.

export const WALL_STYLES = ["plaster", "timber", "stone", "log"] as const;
export type WallStyle = (typeof WALL_STYLES)[number];
export const WALL_FEATURES = ["plain", "window", "shelf", "art"] as const;
export type WallFeature = (typeof WALL_FEATURES)[number];
export type WallPiece = `iwall_${WallStyle}_${WallFeature}`;

export function wallPiece(style: WallStyle, feature: WallFeature): WallPiece {
  return `iwall_${style}_${feature}`;
}

const WALL_PIECES = Object.fromEntries(
  WALL_STYLES.flatMap((s) => WALL_FEATURES.map((f) => [wallPiece(s, f), { w: 1, h: 3 }])),
) as Record<WallPiece, { w: 1; h: 3 }>;

export const BED_COLORS = ["red", "blue", "green", "yellow", "brown", "cream", "grey"] as const;
export type BedColor = (typeof BED_COLORS)[number];
const BEDS = Object.fromEntries(BED_COLORS.map((c) => [`bed_${c}`, { w: 2, h: 2 }])) as Record<`bed_${BedColor}`, { w: 2; h: 2 }>;

export const INTERIOR_PROP_FOOTPRINTS = {
  ...WALL_PIECES,
  ...BEDS,
  /** Staircase climbing into the north wall (inn). Replaces two wall pieces. */
  stairs_up: { w: 2, h: 3 },
  /** Mat inside the door: flat, marks the way out. */
  doormat: { w: 1, h: 1 },
  bookshelf: { w: 1, h: 1 },
  cupboard: { w: 1, h: 1 },
  dish_cabinet: { w: 1, h: 1 },
  dresser: { w: 2, h: 1 },
  clock: { w: 1, h: 1 },
  fireplace: { w: 3, h: 1 },
  hearth: { w: 2, h: 1 },
  stove: { w: 1, h: 1 },
  kitchen_counter: { w: 2, h: 1 },
  bar_counter: { w: 3, h: 1 },
  bar_stool: { w: 1, h: 1 },
  table_round: { w: 1, h: 1 },
  table_round_meal: { w: 1, h: 1 },
  table_long: { w: 3, h: 1 },
  table_long_meal: { w: 3, h: 1 },
  meeting_table: { w: 3, h: 2 },
  mayor_desk: { w: 3, h: 1 },
  chair_down: { w: 1, h: 1 },
  chair_up: { w: 1, h: 1 },
  chair_left: { w: 1, h: 1 },
  chair_right: { w: 1, h: 1 },
  potted_plant: { w: 1, h: 1 },
  potted_tree: { w: 1, h: 1 },
  flower_vase: { w: 1, h: 1 },
  floor_lamp: { w: 1, h: 1 },
  barrel: { w: 1, h: 1 },
  crate: { w: 1, h: 1 },
  chest: { w: 1, h: 1 },
  cauldron: { w: 1, h: 1 },
  forge: { w: 4, h: 3 },
  smith_anvil: { w: 1, h: 1 },
  smith_bench: { w: 2, h: 1 },
  tool_rack: { w: 2, h: 1 },
  grindstone: { w: 1, h: 1 },
  coal_pile: { w: 2, h: 1 },
  rug_vine: { w: 5, h: 2 },
  rug_red: { w: 5, h: 2 },
  // Owners' things.
  writing_desk: { w: 2, h: 1 },
  produce_basket: { w: 1, h: 1 },
  veg_crate: { w: 1, h: 1 },
  herb_box: { w: 1, h: 1 },
  herb_box_flowers: { w: 1, h: 1 },
  fish_crate: { w: 1, h: 1 },
  ore_crate: { w: 1, h: 1 },
  toy_chest: { w: 1, h: 1 },
  // Art kit furniture.
  wardrobe: { w: 2, h: 1 },
  workbench: { w: 3, h: 1 },
  shop_counter: { w: 3, h: 1 },
  market_shelf: { w: 3, h: 1 },
  kitchen_sink: { w: 2, h: 1 },
  barrel_stack: { w: 2, h: 1 },
  barrel_water: { w: 1, h: 1 },
  sack: { w: 1, h: 1 },
  basket: { w: 1, h: 1 },
  produce_pile: { w: 1, h: 1 },
  bellows: { w: 1, h: 1 },
  // Hung on the north wall (row 1 of the wall pieces); walkable, drawn in front of the wall.
  painting_landscape: { w: 2, h: 1 },
  painting_sea: { w: 2, h: 1 },
  painting_portrait: { w: 1, h: 1 },
  painting_flowers: { w: 1, h: 1 },
  mirror: { w: 1, h: 1 },
  wall_shelf: { w: 2, h: 1 },
  wall_pans: { w: 1, h: 1 },
  wall_tool_rack: { w: 3, h: 1 },
  notice_board_wall: { w: 1, h: 1 },
  wall_sconce: { w: 1, h: 1 },
  wall_torch: { w: 1, h: 1 },
  wall_lamp_double: { w: 1, h: 1 },
  // Set on a table or counter tile; walkable, drawn on the table top.
  candle: { w: 1, h: 1 },
  table_lamp: { w: 1, h: 1 },
  plate: { w: 1, h: 1 },
  bowl: { w: 1, h: 1 },
  place_setting: { w: 1, h: 1 },
  mugs: { w: 1, h: 1 },
  bottle: { w: 1, h: 1 },
  bread: { w: 1, h: 1 },
  cash_box: { w: 1, h: 1 },
} as const satisfies Record<string, { w: number; h: number }>;

export type InteriorPropType = keyof typeof INTERIOR_PROP_FOOTPRINTS;

/** Hung on the north wall: placed on wall row 1, over a plain wall piece. */
export const WALL_DECOR_PROPS: ReadonlySet<string> = new Set([
  "painting_landscape",
  "painting_sea",
  "painting_portrait",
  "painting_flowers",
  "mirror",
  "wall_shelf",
  "wall_pans",
  "wall_tool_rack",
  "notice_board_wall",
  "wall_sconce",
  "wall_torch",
  "wall_lamp_double",
]);

/** Small things set on a table, desk or counter tile. */
export const TABLETOP_PROPS: ReadonlySet<string> = new Set([
  "candle",
  "table_lamp",
  "plate",
  "bowl",
  "place_setting",
  "mugs",
  "bottle",
  "bread",
  "cash_box",
]);

/** Props that never block movement: floor coverings, wall hangings, tabletop clutter. */
export const WALKABLE_PROPS: ReadonlySet<string> = new Set(["doormat", "rug_vine", "rug_red", ...WALL_DECOR_PROPS, ...TABLETOP_PROPS]);

/** Rugs (flat on the floor, only under table sets or on open floor). */
export const RUG_PROPS: ReadonlySet<string> = new Set(["rug_vine", "rug_red"]);

/** Seats and the way a sitter faces. Bar stools face whatever counter they stand at. */
export const SEAT_FACING: Readonly<Record<string, Facing | "counter">> = {
  chair_down: "down",
  chair_up: "up",
  chair_left: "left",
  chair_right: "right",
  bar_stool: "counter",
  bench_left: "down",
  bench_right: "down",
};

/** Things you sit at: every seat must face one of these, on the next tile. */
export const TABLE_PROPS: ReadonlySet<string> = new Set([
  "table_round",
  "table_round_meal",
  "table_long",
  "table_long_meal",
  "meeting_table",
  "mayor_desk",
  "writing_desk",
  "bar_counter",
]);

/** Surfaces a tabletop item may stand on. */
export const SURFACE_PROPS: ReadonlySet<string> = new Set([...TABLE_PROPS, "shop_counter", "kitchen_counter", "workbench", "smith_bench"]);

/** Stand with their back to the north wall (first floor row). Beds too: headboard to the wall. */
export const NORTH_WALL_PROPS: ReadonlySet<string> = new Set([
  "fireplace",
  "hearth",
  "stove",
  "kitchen_counter",
  "cupboard",
  "dish_cabinet",
  "bookshelf",
  "dresser",
  "clock",
  "forge",
  "tool_rack",
  "notice_board",
  "wardrobe",
  "workbench",
  "market_shelf",
  "kitchen_sink",
]);

/** Small things that belong against a wall or in a corner, never in the middle of the floor. */
export const ALONG_WALL_PROPS: ReadonlySet<string> = new Set([
  "potted_plant",
  "potted_tree",
  "flower_vase",
  "barrel",
  "crate",
  "chest",
  "cauldron",
  "coal_pile",
  "produce_basket",
  "veg_crate",
  "herb_box",
  "herb_box_flowers",
  "fish_crate",
  "ore_crate",
  "toy_chest",
  "barrel_stack",
  "barrel_water",
  "sack",
  "basket",
  "produce_pile",
]);

/**
 * Wall-side things whose art rises well above their one tile (a potted tree, stacked barrels, a
 * tall basket): on the first floor row they cover the bottom of a window behind them.
 */
export const TALL_ALONG_WALL_PROPS: ReadonlySet<string> = new Set(["potted_tree", "barrel_stack", "basket"]);
/** Tallest of those: its crown also covers a picture, shelf or lamp hung on the wall behind it. */
export const PICTURE_HIDING_PROPS: ReadonlySet<string> = new Set(["potted_tree"]);

/** Tall furniture backed against the north wall: never stands in front of a window. */
export const TALL_WALL_PROPS: ReadonlySet<string> = new Set([
  ...TALL_ALONG_WALL_PROPS,
  "fireplace",
  "hearth",
  "stove",
  "wardrobe",
  "bookshelf",
  "cupboard",
  "dish_cabinet",
  "clock",
  "dresser",
  "forge",
  "tool_rack",
  "market_shelf",
]);

export const isBed = (type: string): boolean => type.startsWith("bed_");
