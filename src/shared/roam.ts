// Where the roaming animals are. Happy the husky moves between the village and the quarry on a
// fixed clock, so every ZoneRoom works out the same answer from the time alone without talking to
// the others, and Happy is only ever in one zone. Pure (pass `now`).
import { VILLAGE_ANIMALS, type VillageAnimal } from "./animals";
import { mulberry32 } from "./maps/rng";
import type { SharedZoneId, Vec2 } from "./types";

/** Happy stays in one zone for this long before maybe moving on. */
export const ROAM_SLOT_MS = 15 * 60_000;
/** The zones a roamer visits, where it hangs about there and how far it strays. */
export const ROAM_HAUNTS: Readonly<Partial<Record<SharedZoneId, { home: Vec2; radius: number }>>> = {
  village: { home: { x: 32.5, y: 30.5 }, radius: 14 },
  quarry: { home: { x: 17.5, y: 13.5 }, radius: 11 },
};
/** Share of slots spent in the village (the rest at the quarry). */
const VILLAGE_SHARE = 0.6;

/** The zone a roaming animal is in at `now`: a hash of the slot, so the pattern isn't a strict back-and-forth. */
export function roamZoneAt(def: VillageAnimal, now: number): SharedZoneId {
  const slot = Math.floor(now / ROAM_SLOT_MS);
  let seed = slot;
  for (let i = 0; i < def.id.length; i++) seed = Math.imul(seed ^ def.id.charCodeAt(i), 0x9e3779b1);
  return mulberry32(seed)() < VILLAGE_SHARE ? "village" : "quarry";
}

export interface ZoneAnimal {
  id: string;
  name: string;
  sprite: string;
  species: VillageAnimal["species"];
  home: Vec2;
  radius: number;
}

/** The cats and dogs in `zone` at `now`: the village regulars, plus any roamer that is here. */
export function zoneAnimals(zone: SharedZoneId, now: number): ZoneAnimal[] {
  const out: ZoneAnimal[] = [];
  for (const a of VILLAGE_ANIMALS) {
    if (a.roams) {
      const haunt = ROAM_HAUNTS[zone];
      if (!haunt || roamZoneAt(a, now) !== zone) continue;
      out.push({ id: a.id, name: a.name, sprite: a.sprite, species: a.species, home: haunt.home, radius: haunt.radius });
    } else if (zone === "village") {
      out.push({ id: a.id, name: a.name, sprite: a.sprite, species: a.species, home: a.home, radius: a.radius });
    }
  }
  return out;
}

/** Zones that ever hold friendly animals (so a ZoneRoom knows to keep a herd). */
export function zoneHasAnimals(zone: SharedZoneId): boolean {
  return zone === "village" || ROAM_HAUNTS[zone] !== undefined;
}
