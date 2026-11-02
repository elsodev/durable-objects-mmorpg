// Where a joining player appears. A named spawn in the WebSocket URL is only honoured when it
// matches the transfer recorded by the exit the player actually took, so nobody can fast-travel
// by opening /ws/caves?spawn=... directly.
import type { MapExit, Vec2, ZoneId } from "../../shared/types";

/** Recorded by HomeRoom when a player takes an exit; consumed by the next join. */
export interface PendingTransfer {
  to: ZoneId;
  spawn: string;
  at: number;
}

export const TRANSFER_TTL_MS = 2 * 60_000;

export interface SavedPlace {
  zone?: ZoneId;
  x?: number;
  y?: number;
}

/**
 * `requested` is the already-sanitised spawn name ("default" when none was named).
 * Order: matching transfer -> saved position in this zone -> zone default.
 */
export function resolveSpawn(
  spawns: Record<string, Vec2>,
  zone: ZoneId,
  requested: string,
  saved: SavedPlace,
  transfer: PendingTransfer | null | undefined,
  now: number,
): Vec2 {
  if (transferHonoured(spawns, zone, requested, transfer, now)) return spawns[requested]!;
  if (saved.zone === zone && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: saved.x!, y: saved.y! };
  }
  return spawns.default;
}

/** True when the named spawn is the one the player's recorded exit led to. */
export function transferHonoured(
  spawns: Record<string, Vec2>,
  zone: ZoneId,
  requested: string,
  transfer: PendingTransfer | null | undefined,
  now: number,
): boolean {
  return (
    requested !== "default" &&
    !!transfer &&
    transfer.to === zone &&
    transfer.spawn === requested &&
    now - transfer.at <= TRANSFER_TTL_MS &&
    Object.hasOwn(spawns, requested)
  );
}

/** The zone a player walked in from, read off an honoured "from_<zone>" spawn. */
export function arrivedFrom(spawn: string, honoured: boolean, isZone: (z: string) => z is ZoneId): ZoneId | undefined {
  if (!honoured || !spawn.startsWith("from_")) return undefined;
  const z = spawn.slice("from_".length);
  return isZone(z) ? z : undefined;
}

/**
 * Where an exit takes this player. A shared way back up (exit.back) returns you to the map you
 * came down from, when that is one of its maps; otherwise it leads to `to`.
 */
export function routeExit(exit: MapExit, zone: ZoneId, cameFrom: ZoneId | undefined): MapExit {
  // `cameFrom` is the map above this one the player last came down from (their cave trail).
  if (cameFrom && cameFrom !== exit.to && exit.back?.includes(cameFrom)) return { ...exit, to: cameFrom, spawn: `from_${zone}` };
  return exit;
}

export function sanitizeTransfer(t: unknown): PendingTransfer | null {
  if (!t || typeof t !== "object") return null;
  const o = t as PendingTransfer;
  if (typeof o.to !== "string" || typeof o.spawn !== "string" || typeof o.at !== "number") return null;
  if (o.spawn.length > 64) return null;
  return { to: o.to, spawn: o.spawn, at: o.at };
}
