// Where each building's door is, and which interior it leads to. Pure data shared by the outdoor
// maps (door exits + "from_<interior>" spawns) and the interior maps (exit back out). Most stand in
// the village; the police station stands in the jail yard (`outside`).
//
// Door tiles are measured from the building art: the bottom row of the building's footprint under
// the painted door. The exit cuts that tile out of the footprint (see buildCollision), so walking
// into the door enters the building; coming back out you appear two tiles south of it.

import type { InteriorZoneId, OutdoorZoneId, Vec2 } from "../../types";

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
  "police",
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];
export type InteriorBuildingId = Exclude<BuildingId, "market">;

export interface BuildingDoor {
  building: InteriorBuildingId;
  zone: InteriorZoneId;
  /** Display name ("Town Hall", "Bram's House"). */
  name: string;
  /** Id of the outdoor prop that is this building (`villageProp`: most stand in the village). */
  villageProp: string;
  /** Door tile outside (inside the prop footprint's bottom row). */
  door: Vec2;
  /** The outdoor map the building stands in; absent means the village. */
  outside?: OutdoorZoneId;
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
  { building: "police", zone: "int_police", name: "Police Station", villageProp: "police_station", door: { x: 17, y: 12 }, outside: "jail" },
];

/** The outdoor map a building's door opens onto. */
export function outsideOf(d: Pick<BuildingDoor, "outside">): OutdoorZoneId {
  return d.outside ?? "village";
}

/** The doors on one outdoor map. */
export function doorsIn(zone: OutdoorZoneId): BuildingDoor[] {
  return BUILDING_DOORS.filter((d) => outsideOf(d) === zone);
}

export function doorFor(zone: InteriorZoneId): BuildingDoor {
  const d = BUILDING_DOORS.find((b) => b.zone === zone);
  if (!d) throw new Error(`no door for ${zone}`);
  return d;
}

/** Outdoor spawn for someone leaving `zone` (in the village or the jail yard): two tiles south of its door. */
export function villageSpawnFor(zone: InteriorZoneId): Vec2 {
  const d = doorFor(zone).door;
  return { x: d.x, y: d.y + 2 };
}
