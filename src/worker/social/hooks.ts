// Fire-and-forget calls from ZoneRoom/HomeRoom into the global SocialRoom. Never awaited on a
// game path: a slow or failing SocialRoom must not stall a tick or a join.
import type { Env } from "../env";
import type { ZoneId } from "../../shared/types";

export const SOCIAL_ROOM = "global";

export function socialRoom(env: Pick<Env, "SOCIAL">) {
  return env.SOCIAL.get(env.SOCIAL.idFromName(SOCIAL_ROOM));
}

/** This player joined (here=true) or left (false) `zone`. */
export function reportPresence(env: Pick<Env, "SOCIAL">, userId: string, zone: ZoneId, here: boolean): void {
  try {
    void socialRoom(env)
      .presence(userId, zone, here)
      .catch(() => {});
  } catch {
    // binding missing (old config): social presence is optional
  }
}

/** Adds `n` to today's server-wide counter `key` (e.g. "crops_shipped"). */
export function reportStat(env: Pick<Env, "SOCIAL">, key: string, n: number): void {
  if (!(n > 0)) return;
  try {
    void socialRoom(env)
      .recordStat(key, n)
      .catch(() => {});
  } catch {
    // optional
  }
}
