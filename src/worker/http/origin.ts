// Cross-site WebSocket hijacking guard: browsers send cookies on a WS upgrade from any site, so
// the upgrade must come from our own origin.
import type { Env } from "../env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `wrangler dev --env local` (DMMO_ENV=local in wrangler.jsonc). */
export function isLocalEnv(env: Pick<Env, "DMMO_ENV">): boolean {
  return env.DMMO_ENV === "local";
}

export function originAllowed(origin: string | null, env: Pick<Env, "BETTER_AUTH_URL" | "DMMO_ENV">): boolean {
  const local = isLocalEnv(env);
  if (!origin) return local;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (local && LOCAL_HOSTS.has(o.hostname) && (o.protocol === "http:" || o.protocol === "https:")) return true;
  if (!env.BETTER_AUTH_URL) return false;
  try {
    return o.origin === new URL(env.BETTER_AUTH_URL).origin;
  } catch {
    return false;
  }
}
