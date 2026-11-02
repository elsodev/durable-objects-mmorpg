import type { ZoneId } from "../../shared/types";

/** Socket path: /ws/<zone>, or /ws/visit/<ownerId> when visiting someone else's home. */
function wsPath(zone: ZoneId, visit?: string): string {
  return visit ? `/ws/visit/${encodeURIComponent(visit)}` : `/ws/${encodeURIComponent(zone)}`;
}

/** `copy`: rejoin this copy of a busy zone (reconnecting) when it still has room. */
export function wsUrl(loc: { protocol: string; host: string }, zone: ZoneId, spawn?: string, visit?: string, copy?: number): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  const params: string[] = [];
  if (spawn && !visit) params.push(`spawn=${encodeURIComponent(spawn)}`);
  if (copy && copy > 1 && !visit) params.push(`copy=${copy}`);
  const q = params.length > 0 ? `?${params.join("&")}` : "";
  return `${scheme}://${loc.host}${wsPath(zone, visit)}${q}`;
}

/** Same path over HTTP, used to ask why a handshake failed (403 = not allowed). */
export function probeUrl(loc: { protocol: string; host: string }, zone: ZoneId, visit?: string): string {
  return `${loc.protocol}//${loc.host}${wsPath(zone, visit)}`;
}
