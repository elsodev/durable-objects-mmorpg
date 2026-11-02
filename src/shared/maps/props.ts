// Default footprints (in tiles) for every static prop type the maps use.
// The footprint is the part that blocks movement; the client may draw art taller than it
// (e.g. a tree canopy above its 1x1 trunk, a roof above a building's footprint).
import { INTERIOR_PROP_FOOTPRINTS } from "./interiors/props";

export const PROP_FOOTPRINTS = {
  tree: { w: 1, h: 1 },
  bush: { w: 1, h: 1 },
  rock_deco: { w: 1, h: 1 },
  house_small: { w: 4, h: 3 },
  house_large: { w: 6, h: 4 },
  // Each villager's house has its own exterior (walls, roof, porch side, size); see village.ts.
  house_iris: { w: 4, h: 3 },
  house_fenwick: { w: 4, h: 3 },
  house_tess: { w: 6, h: 4 },
  house_odette: { w: 6, h: 4 },
  house_marlo: { w: 6, h: 4 },
  house_bram: { w: 6, h: 4 },
  house_grumm: { w: 6, h: 4 },
  house_pip: { w: 8, h: 4 },
  town_hall: { w: 8, h: 5 },
  inn: { w: 8, h: 5 },
  blacksmith: { w: 6, h: 4 },
  market_stall: { w: 3, h: 2 },
  fountain: { w: 3, h: 3 },
  notice_board: { w: 2, h: 1 },
  well: { w: 2, h: 2 },
  shipping_bin: { w: 2, h: 1 },
  /** One fence tile; the client picks the piece (run, corner, post) from neighbouring fence tiles. */
  fence_deco: { w: 1, h: 1 },
  /** Mooring end of a dock (boat + posts). The walkable planks are Ground.Wood tiles. */
  dock: { w: 4, h: 1 },
  shrine: { w: 3, h: 2 },
  bridge_broken: { w: 4, h: 3 },
  lantern_post: { w: 1, h: 1 },
  ladder: { w: 1, h: 1 },
  mine_cart: { w: 2, h: 1 },
  campfire: { w: 1, h: 1 },
  /** Signpost beside an exit; its MapProp.label names where the exit leads. */
  sign_post: { w: 1, h: 1 },
  /** The player's house seen from the yard (LPC cottage art); its door is a home map exit. */
  home_house: { w: 4, h: 3 },
  /** Beside the player's house; its flag is up while there is unread mail. */
  mailbox: { w: 1, h: 1 },
  /** Home cottage facade/roof drawn over the cottage's north wall (home map overrides the width). */
  cottage: { w: 14, h: 3 },
  /** Forage patch at riverside (herbalist quests). */
  herb_patch: { w: 1, h: 1 },
  /** Rippling fishing spot, always placed on water (already blocked ground). */
  fishing_spot: { w: 1, h: 1 },
  /** Garden bench, seen from the front; two halves side by side make one bench. Seats face south. */
  bench_left: { w: 1, h: 1 },
  bench_right: { w: 1, h: 1 },
  /** Pond plants, always placed on water (flat, never block or cast a shadow). */
  lilypad: { w: 1, h: 1 },
  lilypad_small: { w: 1, h: 1 },
  lily_pink: { w: 1, h: 1 },
  lily_white: { w: 1, h: 1 },
  water_reeds: { w: 1, h: 1 },
  /** Reed clumps on the bank. */
  reeds: { w: 1, h: 1 },
  tall_grass: { w: 1, h: 1 },
  /** Garden beds and yard clutter around the cottages. */
  flower_bush_pink: { w: 1, h: 1 },
  flower_bush_red: { w: 1, h: 1 },
  flower_bush_yellow: { w: 1, h: 1 },
  garden_cabbage: { w: 1, h: 1 },
  garden_pumpkin: { w: 1, h: 1 },
  garden_carrot: { w: 1, h: 1 },
  garden_lettuce: { w: 1, h: 1 },
  woodpile: { w: 1, h: 1 },
  hay_bale: { w: 2, h: 1 },
  wheelbarrow: { w: 2, h: 1 },
  ...INTERIOR_PROP_FOOTPRINTS,
} as const satisfies Record<string, { w: number; h: number }>;

export type PropType = keyof typeof PROP_FOOTPRINTS;

/** Outdoor props that lie flat on the ground or water: walkable, drawn under everyone, no shadow. */
export const FLAT_OUTDOOR_PROPS: ReadonlySet<string> = new Set(["lilypad", "lilypad_small", "lily_pink", "lily_white", "water_reeds"]);
