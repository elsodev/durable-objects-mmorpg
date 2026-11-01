import type { ZoneId } from "../../shared/types";

/** Socket path: /ws/<zone>, or /ws/visit/<ownerId> when visiting someone else's home. */
function wsPath(zone: ZoneId, visit?: string): string {
  return visit ? `/ws/visit/${encodeURIComponent(visit)}` : `/ws/${encodeURIComponent(zone)}`;
}

export function wsUrl(loc: { protocol: string; host: string }, zone: ZoneId, spawn?: string, visit?: string): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  const q = spawn && !visit ? `?spawn=${encodeURIComponent(spawn)}` : "";
  return `${scheme}://${loc.host}${wsPath(zone, visit)}${q}`;
}

/** Same path over HTTP, used to ask why a handshake failed (403 = not allowed). */
export function probeUrl(loc: { protocol: string; host: string }, zone: ZoneId, visit?: string): string {
  return `${loc.protocol}//${loc.host}${wsPath(zone, visit)}`;
}
