// GET /ws/:zone -> authenticated WebSocket forwarded to the zone's (or the player's home) Durable Object.
import { H_COPY, H_GUEST, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME, H_ZONE, type Env } from "../env";
import { copyName, copyOrder, FULL_HEADER, FULL_STATUS, parseCopy } from "../../shared/zoneCopies";
import type { AuthUser } from "../auth";
import { getMap } from "../../shared/maps";
import { safeSpawnName } from "../../shared/validate";
import type { ZoneId } from "../../shared/types";
import { errorJson, setAdminAndIp, stripIdentityHeaders } from "./util";
import { zoneAllowed } from "./zone-route";
import { originAllowed } from "./origin";

export async function forwardWs(request: Request, env: Env, zone: ZoneId, user: AuthUser | null): Promise<Response> {
  // Auth first: the client probes with a plain GET after a failed socket to learn whether it was refused.
  if (!user) return errorJson(401, "sign in required");
  if (!zoneAllowed(zone, user.isGuest)) return errorJson(403, "account required");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return errorJson(426, "expected websocket");
  if (!originAllowed(request.headers.get("origin"), env)) return errorJson(403, "bad origin");

  const url = new URL(request.url);
  const headers = stripIdentityHeaders(request.headers);
  headers.set(H_USER_ID, user.id);
  headers.set(H_USER_NAME, encodeHeaderName(user.name));
  headers.set(H_ZONE, zone);
  headers.set(H_SPAWN, safeSpawnName(getMap(zone).spawns, url.searchParams.get("spawn")));
  headers.set(H_GUEST, user.isGuest ? "1" : "0");
  headers.set(H_SESSION, user.sessionId);
  setAdminAndIp(headers, request, user);

  if (zone === "home") return env.HOME.get(env.HOME.idFromName(user.id)).fetch(new Request(request.url, { method: "GET", headers }));
  // A busy zone runs as several copies: try the one asked for, then the lowest with room.
  for (const n of copyOrder(parseCopy(url.searchParams.get("copy")))) {
    headers.set(H_COPY, String(n));
    const res = await env.ZONE.get(env.ZONE.idFromName(copyName(zone, n))).fetch(new Request(request.url, { method: "GET", headers }));
    if (res.status !== FULL_STATUS || res.headers.get(FULL_HEADER) !== "1") return res;
  }
  return errorJson(503, "zone full");
}

/**
 * Header values must be bytes; percent-encode only "%" and non-printable-ASCII so plain names pass
 * through unchanged and decodeURIComponent() restores any name exactly.
 */
export function encodeHeaderName(name: string): string {
  return name.replace(/[^\x20-\x24\x26-\x7e]+/gu, (s) => encodeURIComponent(s));
}
