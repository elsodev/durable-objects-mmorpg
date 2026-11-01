// Where each village building's door is, and which interior it leads to. Pure data shared by the
// village map (door exits + "from_<interior>" spawns) and the interior maps (exit back out).
//
// Door tiles are measured from the building art: the bottom row of the building's footprint under
// the painted door. The exit cuts that tile out of the footprint (see buildCollision), so walking
// into the door enters the building; coming back out you appear two tiles south of it.

import type { InteriorZoneId, Vec2 } from "../../types";

/** Villagers with a cottage of their own (Rue lives at the inn, Sable at the river shrine). */
export const HOUSE_OWNERS = ["bram", "odette", "fenwick", "pip", "marlo", "iris", "grumm", "tess"] as const;
export type HouseOwner = (typeof HOUSE_OWNERS)[number];

/**
 * Place ids the NPC bible and schedules use. Every id except "market" is an interior;
 * "market" is Odette's stall on the village square (the market has no building).
 */
export const BUILDING_IDS = [
  "townhall",
  "inn",
  "smithy",
  "market",
  "house_bram",
  "house_odette",
  "house_fenwick",
  "house_pip",
  "house_marlo",
  "house_iris",
  "house_grumm",
  "house_tess",
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];
export type InteriorBuildingId = Exclude<BuildingId, "market">;

export interface BuildingDoor {
  building: InteriorBuildingId;
  zone: InteriorZoneId;
  /** Display name ("Town Hall", "Bram's House"). */
  name: string;
  /** Id of the village prop that is this building. */
  villageProp: string;
  /** Door tile in the village (inside the prop footprint's bottom row). */
  door: Vec2;
}

const house = (owner: HouseOwner, name: string, villageProp: string, x: number, y: number): BuildingDoor => ({
  building: `house_${owner}`,
  zone: `int_house_${owner}`,
  name,
  villageProp,
  door: { x, y },
});

export const BUILDING_DOORS: readonly BuildingDoor[] = [
  { building: "townhall", zone: "int_townhall", name: "Town Hall", villageProp: "town_hall", door: { x: 30, y: 7 } },
  { building: "inn", zone: "int_inn", name: "The Mossy Mug Inn", villageProp: "inn", door: { x: 19, y: 19 } },
  { building: "smithy", zone: "int_smithy", name: "Fenwick's Smithy", villageProp: "blacksmith", door: { x: 45, y: 30 } },
  house("iris", "Iris's Cottage", "house_nw1", 8, 8),
  house("tess", "Tess's Cottage", "house_nw2", 16, 8),
  house("bram", "Bram's House", "house_ne1", 46, 8),
  house("odette", "Odette's Cottage", "house_ne2", 54, 8),
  house("marlo", "Marlo's Cottage", "house_sw1", 8, 32),
  house("pip", "Pip's House", "house_sw2", 17, 37),
  house("fenwick", "Fenwick's Cottage", "house_se1", 42, 41),
  house("grumm", "Grumm's House", "house_se2", 52, 39),
];

export function doorFor(zone: InteriorZoneId): BuildingDoor {
  const d = BUILDING_DOORS.find((b) => b.zone === zone);
  if (!d) throw new Error(`no door for ${zone}`);
  return d;
}

/** Village spawn for someone leaving `zone`: two tiles south of its door. */
export function villageSpawnFor(zone: InteriorZoneId): Vec2 {
  const d = doorFor(zone).door;
  return { x: d.x, y: d.y + 2 };
}
