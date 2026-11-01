// Rows of the Map tab: the valley's places in travel order, and which one you are in.
import { isInteriorZone, type ZoneId } from "../../shared/types";

export interface MapRow {
  id: "home" | "village" | "riverside" | "caves";
  name: string;
  desc: string;
  here: boolean;
  /** The building you're inside, when you're in one. */
  inside?: string;
}

const PLACES: readonly Omit<MapRow, "here">[] = [
  { id: "home", name: "Your farm", desc: "Your fields, your house and the mailbox." },
  { id: "village", name: "Village", desc: "Town hall, inn, smithy, market and the villagers' cottages." },
  { id: "riverside", name: "Riverside", desc: "The river, the dock and the fishing spots." },
  { id: "caves", name: "Caves", desc: "Ore, gems, treasure chests and monsters." },
];

/** "int_house_bram" -> "Bram's house", "int_inn" -> "the inn". */
export function buildingName(zone: string): string {
  const id = zone.replace(/^int_/, "");
  if (id.startsWith("house_")) {
    const who = id.slice("house_".length);
    return `${who.charAt(0).toUpperCase()}${who.slice(1)}'s house`;
  }
  return `the ${id === "townhall" ? "town hall" : id}`;
}

export function mapRows(zone: ZoneId | null): MapRow[] {
  const inside = zone && isInteriorZone(zone) ? buildingName(zone) : undefined;
  // Every building is in the village.
  const at = inside ? "village" : zone;
  return PLACES.map((p) => ({ ...p, here: p.id === at, ...(p.id === at && inside ? { inside } : {}) }));
}
