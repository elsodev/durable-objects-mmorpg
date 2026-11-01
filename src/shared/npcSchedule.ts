// Daily routines: which zone each villager is in at a given hour. Shared zones have no day/night,
// so routines follow the real UTC clock. Every ZoneRoom evaluates the same pure function, so an
// NPC leaves one room and appears in another at the same moment without any cross-DO messages.
//
// Defaults below; the NPC bible may supply its own bands (same shape) later.

import { BUILDING_IDS, type BuildingId } from "./maps/interiors/doors";
import type { OutdoorZoneId, SharedZoneId } from "./types";

/** "work" = the NPC's outdoor post (stall, dock, camp); otherwise a building id. */
export type Place = BuildingId | "work";

/** Hours are UTC, [from, to); a band with from > to wraps past midnight. */
export interface ScheduleBand {
  from: number;
  to: number;
  at: Place;
}

/** The outdoor zone where each NPC works (their spawn in that zone's map). */
export const NPC_WORK_ZONE: Readonly<Record<string, OutdoorZoneId>> = {
  bram: "village",
  odette: "village",
  fenwick: "village",
  rue: "village",
  pip: "village",
  marlo: "riverside",
  sable: "riverside",
  iris: "riverside",
  grumm: "caves",
  tess: "caves",
};

const day = (evening: Place, home: Place, extra: ScheduleBand[] = []): ScheduleBand[] => [
  ...extra,
  { from: 8, to: 18, at: "work" },
  { from: 18, to: 22, at: evening },
  { from: 22, to: 8, at: home },
];

/**
 * Default routines: 08-18 at work (shopkeepers keep their stall the whole shop day), 18-22 at the
 * inn or town hall, 22-08 at home. Earlier bands win where they overlap. Sable never leaves the
 * shrine (it has no entry, so it stays in its map all day).
 */
export const NPC_SCHEDULE: Readonly<Record<string, readonly ScheduleBand[]>> = {
  bram: day("inn", "house_bram", [{ from: 13, to: 18, at: "townhall" }]),
  odette: day("inn", "house_odette"),
  fenwick: day("smithy", "house_fenwick"),
  // Rue runs the inn: out on the porch in the morning, behind the bar from lunch, sleeps upstairs.
  rue: [
    { from: 8, to: 13, at: "work" },
    { from: 13, to: 8, at: "inn" },
  ],
  pip: day("inn", "house_pip", [{ from: 21, to: 22, at: "house_pip" }]),
  marlo: day("inn", "house_marlo"),
  iris: day("inn", "house_iris"),
  grumm: day("inn", "house_grumm"),
  tess: day("townhall", "house_tess"),
};

/** UTC hour (0..23) for a timestamp, shifted by a whole number of hours (dev override). */
export function scheduleHour(nowMs: number, offsetHours = 0): number {
  const h = Math.floor(nowMs / 3_600_000) + Math.trunc(offsetHours);
  return ((h % 24) + 24) % 24;
}

export function inBand(band: ScheduleBand, hour: number): boolean {
  return band.from <= band.to ? hour >= band.from && hour < band.to : hour >= band.from || hour < band.to;
}

export function placeZone(npcId: string, place: Place): SharedZoneId | null {
  if (place === "work") return NPC_WORK_ZONE[npcId] ?? null;
  if (place === "market") return "village";
  return (BUILDING_IDS as readonly string[]).includes(place) ? (`int_${place}` as SharedZoneId) : null;
}

/**
 * The zone an NPC is in at `hour`, or null when it has no routine (it then stays wherever its map
 * puts it). `schedule` defaults to NPC_SCHEDULE.
 */
export function npcZoneAt(
  npcId: string,
  hour: number,
  schedule: Readonly<Record<string, readonly ScheduleBand[]>> = NPC_SCHEDULE,
): SharedZoneId | null {
  const bands = Object.hasOwn(schedule, npcId) ? schedule[npcId] : undefined;
  if (!bands) return null;
  for (const b of bands) if (inBand(b, hour)) return placeZone(npcId, b.at);
  return null;
}

/** True if the NPC should be in `zone` at `hour` (NPCs without a routine are always present). */
export function npcPresent(npcId: string, zone: SharedZoneId, hour: number): boolean {
  const z = npcZoneAt(npcId, hour);
  return z === null || z === zone;
}
