// Places on the Map tab's island: where each sits on the picture, which one you are in, and
// whether you can fast-travel there from here.
import { caveLevelOf } from "../../shared/caveLevels";
import { isInteriorZone, type ZoneId } from "../../shared/types";
import { doorFor, outsideOf } from "../../shared/maps/interiors/doors";

export interface MapRow {
  id: "home" | "village" | "riverside" | "quarry" | "caves" | "jail";
  name: string;
  desc: string;
  here: boolean;
  /** The building you're inside, when you're in one. */
  inside?: string;
  /** Pin on the island picture, in % of its width and height. */
  pin: { x: number; y: number };
}

export type TravelId = MapRow["id"];

/** The island picture (assets/lpc/map/island.png) is 256 x 160 source pixels. */
export const ISLAND = { src: "/assets/lpc/map/island.png", w: 256, h: 160 } as const;

const PLACES: readonly Omit<MapRow, "here">[] = [
  // Pins sit on the matching spot of the picture: farmhouse, plaza, dock, cliffs, cave arch.
  { id: "home", name: "Your farm", desc: "Your fields, your house and the mailbox.", pin: { x: 20.5, y: 47 } },
  { id: "village", name: "Village", desc: "Town hall, inn, smithy, market and the villagers' cottages.", pin: { x: 55.5, y: 50 } },
  { id: "riverside", name: "Riverside", desc: "The river, the dock and the fishing spots.", pin: { x: 44, y: 88 } },
  { id: "quarry", name: "Quarry", desc: "The cliffs east of the village and the cave mouth.", pin: { x: 80, y: 57 } },
  { id: "caves", name: "Caves", desc: "Ore, gems, treasure chests and monsters, four levels deep.", pin: { x: 84.4, y: 35 } },
  { id: "jail", name: "Town Jail", desc: "The police station south of the quarry: the sheriff, and the cell.", pin: { x: 71.9, y: 70.5 } },
];

/** "int_house_bram" -> "Bram's house", "int_inn" -> "the inn". */
export function buildingName(zone: string): string {
  const id = zone.replace(/^int_/, "");
  if (id.startsWith("house_")) {
    const who = id.slice("house_".length);
    return `${who.charAt(0).toUpperCase()}${who.slice(1)}'s house`;
  }
  return `the ${id === "townhall" ? "town hall" : id === "police" ? "police station" : id}`;
}

export function mapRows(zone: ZoneId | null): MapRow[] {
  const cave = caveLevelOf(zone);
  const inside = zone && isInteriorZone(zone) ? buildingName(zone) : cave ? `depth ${cave.depth}` : undefined;
  // Buildings pin to the map they stand in (the village, or the jail yard); cave levels to the caves.
  const at = cave ? "caves" : zone && isInteriorZone(zone) ? outsideOf(doorFor(zone)) : zone;
  return PLACES.map((p) => ({ ...p, here: p.id === at, ...(p.id === at && inside ? { inside } : {}) }));
}

/** Shortest gap between two fast travels, so a double click doesn't travel twice. */
export const TRAVEL_COOLDOWN_MS = 2000;

/**
 * Why you can't fast-travel to `to` right now, or null when you can. You can't travel to the
 * place you're already in (a building in the village counts as the village only for the pin,
 * so travelling to the village from inside one takes you out to the plaza).
 */
export function travelRefusal(to: TravelId, zone: ZoneId | null, now: number, lastTravel: number): string | null {
  if (zone === null) return "Still on the way.";
  if (zone === to) return "You are already here.";
  if (now - lastTravel < TRAVEL_COOLDOWN_MS) return "Just a moment.";
  return null;
}

export function isTravelId(v: unknown): v is TravelId {
  return typeof v === "string" && PLACES.some((p) => p.id === v);
}
