// Home goods: the furniture shop's stock (classic pieces, cosy extras and modern appliances) and
// the rare pieces that no shop sells. Rare pieces come only from monsters deep in the caves and
// from villagers who love you. Pure data plus pure rolls; items.ts merges HOME_GOODS into ITEMS.
import type { ItemDef, Rotation } from "./items";
import type { ItemId } from "./types";

/** Which items a storage piece takes: anything, or only food (crops, fish, forage, edibles). */
export type StorageAccepts = "any" | "food";

export interface StorageSpec {
  /** Number of slots inside. */
  slots: number;
  accepts: StorageAccepts;
}

type Place = "floor" | "wall";
type Extra = Partial<Omit<ItemDef, "id" | "name" | "kind" | "icon" | "footprint" | "placeOn">>;

/** A piece of furniture: sells back for half its value; wall pieces never block anyone. */
function piece(id: ItemId, name: string, w: number, h: number, placeOn: Place, value: number, extra: Extra = {}): ItemDef {
  return {
    id,
    name,
    kind: "furniture",
    icon: id,
    sell: Math.floor(value / 2),
    buy: value,
    stack: 10,
    footprint: { w, h },
    placeOn,
    ...(placeOn === "wall" ? { walkable: true } : {}),
    ...extra,
  };
}

/** Rare: never in a shop (no `buy`), one per stack slot. */
function rare(id: ItemId, name: string, w: number, h: number, value: number, desc: string): ItemDef {
  return piece(id, name, w, h, "floor", value, { buy: undefined, stack: 1, rarity: "rare", desc });
}

const TURNS: readonly Rotation[] = [0, 1, 2, 3];

/** The fridge keeps food: 12 slots of crops, fish and forage. */
export const FRIDGE_STORAGE: StorageSpec = { slots: 12, accepts: "food" };

export const HOME_GOODS: readonly ItemDef[] = [
  // Classic pieces from the village workshops (art shared with the village interiors).
  piece("chair_dining", "Dining Chair", 1, 1, "floor", 45, { rotations: TURNS, desc: "Turns to face any table." }),
  piece("table_long", "Long Table", 3, 1, "floor", 140, { desc: "Room for the whole family." }),
  piece("kitchen_counter", "Kitchen Counter", 2, 1, "floor", 120),
  piece("kitchen_sink", "Kitchen Sink", 2, 1, "floor", 160, { desc: "A basin set into a sturdy counter." }),
  piece("bed_blue", "Blue Quilt Bed", 2, 2, "floor", 200, { bed: true, desc: "A roomy bed. Sleep in it to end the day." }),
  piece("bed_green", "Green Quilt Bed", 2, 2, "floor", 200, { bed: true, desc: "A roomy bed. Sleep in it to end the day." }),
  piece("bed_yellow", "Sunny Quilt Bed", 2, 2, "floor", 200, { bed: true, desc: "A roomy bed. Sleep in it to end the day." }),
  piece("rug_red", "Rose Rug", 5, 2, "floor", 90, { walkable: true }),
  piece("fireplace", "Brick Fireplace", 3, 1, "floor", 450, { desc: "Crackles all evening. Best against a wall." }),
  piece("window", "Lattice Window", 1, 1, "wall", 90),
  piece("window_stone", "Arched Window", 1, 1, "wall", 120),
  piece("wall_lamp_double", "Twin Wall Lamp", 1, 1, "wall", 100),

  // Cosy extras.
  piece("sofa", "Cozy Sofa", 2, 1, "floor", 240, { desc: "Deep cushions and a mustard pillow." }),
  piece("armchair", "Armchair", 1, 1, "floor", 120),
  piece("coffee_table", "Coffee Table", 2, 1, "floor", 90),
  piece("nightstand", "Nightstand", 1, 1, "floor", 70, { desc: "With a little reading lamp." }),
  piece("bookcase", "Tall Bookcase", 2, 1, "floor", 260, { desc: "Every shelf full, and a plant on top." }),
  piece("plant_pilea", "Pancake Plant", 1, 1, "floor", 65, { rotations: [0, 3] }),
  piece("plant_cactus", "Potted Cactus", 1, 1, "floor", 40, { rotations: [0, 3], desc: "Blooms once a year. Hardly needs water." }),
  piece("coat_rack", "Coat Rack", 1, 1, "floor", 60),
  piece("rug_round", "Round Rug", 3, 2, "floor", 75, { walkable: true }),
  piece("wall_clock", "Wall Clock", 1, 1, "wall", 80),
  piece("painting_meadow", "Meadow Painting", 2, 1, "wall", 160, { desc: "Spring hills, painted on the riverbank." }),

  // Modern appliances and gadgets.
  piece("fridge", "Fridge", 1, 1, "floor", 450, {
    storage: FRIDGE_STORAGE,
    desc: "Keeps 12 stacks of crops, fish and forage. Use it to open the door.",
  }),
  piece("oven", "Kitchen Range", 1, 1, "floor", 320, { desc: "Four burners and a roomy oven." }),
  piece("washer", "Washing Machine", 1, 1, "floor", 280),
  piece("tv", "Flat TV", 2, 1, "floor", 380, { desc: "On a low cabinet. Always showing the meadow channel." }),
  piece("game_console", "Game Console", 1, 1, "floor", 260, { desc: "One controller. Player two brings their own." }),
  piece("computer_desk", "Computer Desk", 2, 1, "floor", 420, { desc: "A desk, a tower and a big monitor." }),
  piece("monitor_stand", "Gaming Monitor", 1, 1, "floor", 220),
  piece("speaker", "Tall Speaker", 1, 1, "floor", 160),
  piece("air_con", "Air Conditioner", 2, 1, "wall", 240, { desc: "Keeps the house cool all summer." }),

  // Rare pieces: monster drops and villager gifts only.
  rare("throne_gold", "Golden Throne", 1, 1, 2000, "Fit for a mayor. Bram's dearest friends get one."),
  rare("aquarium", "Aquarium", 2, 1, 1200, "Marlo's spare tank, with three lively fish."),
  rare("arcade_cabinet", "Arcade Cabinet", 1, 1, 1500, "Pip's high score is still on it."),
  rare("jukebox", "Jukebox", 1, 1, 1300, "Rue's old jukebox from the inn. Still plays every ballad."),
  rare("star_globe", "Celestial Globe", 1, 1, 1100, "Sable's map of the night sky."),
  rare("suit_of_armor", "Suit of Armor", 1, 1, 1200, "Forged by Fenwick for a friend."),
  rare("crystal_lamp", "Crystal Lamp", 1, 1, 900, "Glows by itself. Cave bats sometimes carry a shard."),
  rare("slime_statue", "Slime Statue", 1, 1, 700, "Carved jade. Cave slimes guard them, for some reason."),
  rare("geode", "Amethyst Geode", 1, 1, 800, "Cracked open by a rock crab, or a patient miner."),
];

/** What the furniture stall sells, in shelf order. */
export const FURNITURE_SHOP: readonly ItemId[] = HOME_GOODS.filter((d) => d.buy).map((d) => d.id);

/** Rare pieces (never sold). */
export const RARE_FURNITURE: readonly ItemId[] = HOME_GOODS.filter((d) => d.rarity === "rare").map((d) => d.id);

/**
 * Rare pieces cave monsters may drop, per monster type: a small chance per kill, rolled with the
 * zone's rand and scaled by DROP_RATE_MONSTER (or DROP_RATE_RARE). Any cave zone counts.
 */
export const RARE_MONSTER_FURNITURE: Readonly<Record<string, { item: ItemId; chance: number }>> = {
  slime: { item: "slime_statue", chance: 0.004 },
  bat: { item: "crystal_lamp", chance: 0.004 },
  rock_crab: { item: "geode", chance: 0.006 },
};

/** True for zones where monsters may carry rare furniture (the caves and any deeper floors). */
export function isCaveZone(zone: string): boolean {
  return zone === "caves" || zone.startsWith("caves_");
}

/**
 * The rare piece a villager gives once you reach `hearts` with them (only once: the milestone
 * pays out a single time). Keys are villager ids.
 */
export const RARE_GIFTS: Readonly<Record<string, { item: ItemId; hearts: number }>> = {
  bram: { item: "throne_gold", hearts: 10 },
  marlo: { item: "aquarium", hearts: 8 },
  pip: { item: "arcade_cabinet", hearts: 8 },
  rue: { item: "jukebox", hearts: 8 },
  sable: { item: "star_globe", hearts: 10 },
  fenwick: { item: "suit_of_armor", hearts: 10 },
  grumm: { item: "geode", hearts: 8 },
};

/** The rare piece due at this milestone, or null. */
export function rareGiftAt(npc: string, milestone: number): ItemId | null {
  const g = Object.hasOwn(RARE_GIFTS, npc) ? RARE_GIFTS[npc] : undefined;
  return g && g.hearts === milestone ? g.item : null;
}
