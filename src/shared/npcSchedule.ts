// Daily routines: which zone each villager is in at a given hour. Shared zones have no day/night,
// so routines follow the real UTC clock. Every ZoneRoom evaluates the same pure function, so an
// NPC leaves one room and appears in another at the same moment without any cross-DO messages.
//
// Defaults below; the NPC bible may supply its own bands (same shape) later.

import { BUILDING_IDS, type BuildingId } from "./maps/interiors/doors";
import type { OutdoorZoneId, SharedZoneId } from "./types";

/**
 * "work" = the NPC's outdoor post (stall, dock, camp); "about" = out and about in the village
 * (the pond, the square, a garden) for villagers who work elsewhere; otherwise a building id.
 */
export type Place = BuildingId | "work" | "about";

/** Hours are UTC, [from, to); a band with from > to wraps past midnight. */
export interface ScheduleBand {
  from: number;
  to: number;
  at: Place;
}

/** The outdoor zone of each NPC's post (their spawn in that zone's map; for Bram, Fenwick and Rue
 * the spot outside their building, where they stroll out of hours). */
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

/**
 * Villagers with a job, where they do it and their hours ([from, to), UTC; `to` may be 24). Through
 * those hours they stay at their counter, desk, anvil or stall so players can always find them to
 * trade: the zone runner keeps them at their spot (no benches, no strolls, no following anyone) and
 * clamps AI walk requests to it. Out of hours they roam as everyone else does.
 */
export interface Job {
  at: Place;
  from: number;
  to: number;
}

export const NPC_JOBS: Readonly<Record<string, Job>> = {
  // The mayor at his desk in the Town Hall.
  bram: { at: "townhall", from: 8, to: 17 },
  // The seed stall on the market lane.
  odette: { at: "work", from: 8, to: 18 },
  // At the anvil in the smithy.
  fenwick: { at: "smithy", from: 8, to: 17 },
  // Behind the bar; the inn keeps going until midnight.
  rue: { at: "inn", from: 8, to: 24 },
  // The river dock, the herb stall and the cave camp.
  marlo: { at: "work", from: 8, to: 18 },
  iris: { at: "work", from: 8, to: 18 },
  grumm: { at: "work", from: 8, to: 17 },
};

const shift = (npcId: string): ScheduleBand[] => {
  const j = NPC_JOBS[npcId]!;
  return [{ from: j.from, to: j.to % 24, at: j.at }];
};

const day = (evening: Place, home: Place, extra: ScheduleBand[] = []): ScheduleBand[] => [
  ...extra,
  { from: 8, to: 18, at: "work" },
  { from: 18, to: 20, at: evening },
  { from: 20, to: 8, at: home },
];

/**
 * Default routines: villagers with a job keep their workplace through its hours (NPC_JOBS); the
 * rest are out and about in the village 08-18. Supper at the inn (or the town hall / the smithy)
 * 18-20, and home for the night from 20. Earlier bands win where they overlap. Sable never leaves
 * the shrine (it has no entry, so it stays in its map all day).
 */
export const NPC_SCHEDULE: Readonly<Record<string, readonly ScheduleBand[]>> = {
  // Bram keeps the Town Hall desk through the day, then takes a turn round the square before supper.
  bram: day("inn", "house_bram", shift("bram")),
  // Odette keeps her stall all day and goes home early to her window boxes.
  odette: day("inn", "house_odette", [...shift("odette"), { from: 19, to: 20, at: "house_odette" }]),
  // Fenwick works the smithy, steps out into the forge yard at five, then finishes orders inside.
  fenwick: day("smithy", "house_fenwick", shift("fenwick")),
  // Rue runs the inn from breakfast to midnight and sleeps upstairs; a breath of air on the porch at dawn.
  rue: [...shift("rue"), { from: 7, to: 8, at: "work" }, { from: 0, to: 7, at: "inn" }],
  pip: day("inn", "house_pip"),
  // Marlo keeps the river dock through shop hours, then fishes the village pond before supper.
  marlo: day("inn", "house_marlo", [...shift("marlo"), { from: 18, to: 19, at: "about" }]),
  // Iris tends her garden at dawn, before her herb stall by the river opens.
  iris: day("inn", "house_iris", [...shift("iris"), { from: 7, to: 8, at: "about" }]),
  // Grumm comes up from the mine for a sit on the square before supper.
  grumm: day("inn", "house_grumm", [...shift("grumm"), { from: 17, to: 18, at: "about" }]),
  // Tess pins up her maps on the notice board before heading down the tunnels.
  tess: day("townhall", "house_tess", [{ from: 8, to: 9, at: "about" }]),
};

/** True while the NPC's working hours are on (it has a job and `hour` is inside them). */
export function onShift(npcId: string, hour: number): boolean {
  const j = Object.hasOwn(NPC_JOBS, npcId) ? NPC_JOBS[npcId] : undefined;
  return !!j && hour >= j.from && hour < j.to;
}

/** The zone of the NPC's workplace, or null when it has no job. */
export function jobZone(npcId: string): SharedZoneId | null {
  const j = Object.hasOwn(NPC_JOBS, npcId) ? NPC_JOBS[npcId] : undefined;
  return j ? placeZone(npcId, j.at) : null;
}

/** True when the NPC is on shift at `hour` and `zone` is where it works. */
export function atWork(npcId: string, zone: SharedZoneId, hour: number): boolean {
  return onShift(npcId, hour) && jobZone(npcId) === zone;
}

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
  if (place === "market" || place === "about") return "village";
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

/** Milliseconds until the routine hour changes (bands are whole hours). */
export function msToNextHour(nowMs: number): number {
  return 3_600_000 - (((nowMs % 3_600_000) + 3_600_000) % 3_600_000);
}

/** The zone an NPC moves to when the current hour ends (null: same zone, or no routine). */
export function npcNextZone(npcId: string, hour: number): SharedZoneId | null {
  const now = npcZoneAt(npcId, hour);
  const next = npcZoneAt(npcId, (hour + 1) % 24);
  return next !== now ? next : null;
}

/** The zone an NPC was in during the previous hour, when it differs from this hour's. */
export function npcPrevZone(npcId: string, hour: number): SharedZoneId | null {
  const now = npcZoneAt(npcId, hour);
  const prev = npcZoneAt(npcId, (hour + 23) % 24);
  return prev !== now ? prev : null;
}
