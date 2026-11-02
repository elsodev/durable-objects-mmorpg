// Fast travel from the Map tab. The client asks the zone (or home) it is in; that room saves the
// player with the destination and only then tells the client to switch, exactly like walking
// through an exit, so nothing is lost between the two Durable Objects. Pure.
import type { ZoneId } from "./types";

export const TRAVEL_ZONES = ["home", "village", "riverside", "quarry", "caves", "jail"] as const;
export type TravelZone = (typeof TRAVEL_ZONES)[number];

export function isTravelZone(v: unknown): v is TravelZone {
  return typeof v === "string" && (TRAVEL_ZONES as readonly string[]).includes(v);
}

/** Spawn a fast traveller arrives at: each place's default arrival point. */
export const TRAVEL_SPAWN = "default";

/** Shortest gap the server allows between two travel requests from one player. */
export const TRAVEL_MIN_INTERVAL_MS = 1500;

/** Why the server won't start this trip, or null when it may. */
export function travelBlock(to: TravelZone, here: ZoneId, now: number, last: number): string | null {
  if (to === here) return "You are already here.";
  if (now - last < TRAVEL_MIN_INTERVAL_MS) return "Just a moment.";
  return null;
}
