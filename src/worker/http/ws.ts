// GET /ws/:zone -> authenticated WebSocket forwarded to the zone's (or the player's home) Durable Object.
import { H_GUEST, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME, H_ZONE, type Env } from "../env";
import type { AuthUser } from "../auth";
import { getMap } from "../../shared/maps";
import { safeSpawnName } from "../../shared/validate";
import type { ZoneId } from "../../shared/types";
import { errorJson, stripIdentityHeaders } from "./util";
import { zoneAllowed } from "./zone-route";
import { originAllowed } from "./origin";

export function forwardWs(request: Request, env: Env, zone: ZoneId, user: AuthUser | null): Promise<Response> | Response {
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
  const forwarded = new Request(request.url, { method: "GET", headers });

  if (zone === "home") return env.HOME.get(env.HOME.idFromName(user.id)).fetch(forwarded);
  return env.ZONE.get(env.ZONE.idFromName(zone)).fetch(forwarded);
}

/**
 * Header values must be bytes; percent-encode only "%" and non-printable-ASCII so plain names pass
 * through unchanged and decodeURIComponent() restores any name exactly.
 */
export function encodeHeaderName(name: string): string {
  return name.replace(/[^\x20-\x24\x26-\x7e]+/gu, (s) => encodeURIComponent(s));
}
