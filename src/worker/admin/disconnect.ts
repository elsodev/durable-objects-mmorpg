// Closes a removed player's game sockets: their own home, and every copy of every shared zone.
// Fire-and-forget from SocialRoom; each room answers for itself and a slow one holds up nobody.
import type { Env } from "../env";
import { SHARED_ZONES } from "../../shared/types";
import { copyName } from "../../shared/zoneCopies";

export async function removeFromGame(env: Pick<Env, "ZONE" | "HOME">, userId: string, text: string): Promise<void> {
  const inZone = async (zone: string): Promise<void> => {
    const original = env.ZONE.get(env.ZONE.idFromName(zone));
    await original.removeUser(userId, text);
    const n = await original.copies();
    await Promise.allSettled(
      Array.from({ length: n - 1 }, (_, i) => env.ZONE.get(env.ZONE.idFromName(copyName(zone, i + 2))).removeUser(userId, text)),
    );
  };
  await Promise.allSettled([env.HOME.get(env.HOME.idFromName(userId)).removeUser(userId, text), ...SHARED_ZONES.map(inZone)]);
}
