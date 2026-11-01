// Pure parsing for /ws/:zone so it can be unit tested.
import { SHARED_ZONES, type ZoneId } from "../../shared/types";

const ZONES: readonly ZoneId[] = [...SHARED_ZONES, "home"];

/** "/ws/village" -> "village", "/ws/int_inn" -> "int_inn"; anything else -> null. */
export function parseWsZone(pathname: string): ZoneId | null {
  const m = /^\/ws\/([a-z_]{1,32})\/?$/.exec(pathname);
  if (!m) return null;
  const z = m[1] as ZoneId;
  return ZONES.includes(z) ? z : null;
}

/** Guests may only enter their own home. */
export function zoneAllowed(zone: ZoneId, isGuest: boolean): boolean {
  return !isGuest || zone === "home";
}
