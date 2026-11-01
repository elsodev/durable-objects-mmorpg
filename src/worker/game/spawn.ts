// Where a joining player appears. A named spawn in the WebSocket URL is only honoured when it
// matches the transfer recorded by the exit the player actually took, so nobody can fast-travel
// by opening /ws/caves?spawn=... directly.
import type { Vec2, ZoneId } from "../../shared/types";

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
  if (
    requested !== "default" &&
    transfer &&
    transfer.to === zone &&
    transfer.spawn === requested &&
    now - transfer.at <= TRANSFER_TTL_MS &&
    Object.hasOwn(spawns, requested)
  ) {
    return spawns[requested];
  }
  if (saved.zone === zone && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: saved.x!, y: saved.y! };
  }
  return spawns.default;
}

export function sanitizeTransfer(t: unknown): PendingTransfer | null {
  if (!t || typeof t !== "object") return null;
  const o = t as PendingTransfer;
  if (typeof o.to !== "string" || typeof o.spawn !== "string" || typeof o.at !== "number") return null;
  if (o.spawn.length > 64) return null;
  return { to: o.to, spawn: o.spawn, at: o.at };
}
