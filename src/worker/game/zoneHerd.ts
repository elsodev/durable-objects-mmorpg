// Keeps a ZoneRoom's herd in step with who should be there now: the village regulars, plus Happy
// the husky in whichever zone the roam clock (shared/roam.ts) puts him. Returns the notices for the
// people here when a roamer comes or goes. Synchronous and cheap enough to run every tick.
import { zoneAnimals } from "../../shared/roam";
import type { SharedZoneId } from "../../shared/types";
import type { AnimalHerd } from "./animalHerd";

const PLACE: Partial<Record<SharedZoneId, string>> = { village: "the village", quarry: "the quarry" };

export function syncZoneHerd(herd: AnimalHerd, zone: SharedZoneId, now: number, announce = true): string[] {
  const { came, left } = herd.sync(zoneAnimals(zone, now), now);
  if (!announce) return [];
  const other = zone === "village" ? "quarry" : "village";
  const out: string[] = [];
  for (const a of left) out.push(`${a.name} trots off toward ${PLACE[other] ?? "somewhere new"}.`);
  for (const a of came) out.push(`${a.name} bounds in from ${PLACE[other] ?? "somewhere"}!`);
  return out;
}
