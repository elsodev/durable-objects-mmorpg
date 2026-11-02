// Reaches a player wherever they are in the game: every copy of every shared zone (and their own
// home, for a removal). Used to close a removed player's sockets and to lock up or let out a jailed
// one. Fire-and-forget from SocialRoom; each room answers for itself and a slow one holds up nobody.
import type { Env } from "../env";
import { SHARED_ZONES } from "../../shared/types";
import { copyName } from "../../shared/zoneCopies";

type ZoneStub = ReturnType<Env["ZONE"]["get"]>;

/** Runs `act` on every copy of every shared zone. */
async function everyZone(env: Pick<Env, "ZONE">, act: (room: ZoneStub) => Promise<unknown>): Promise<void> {
  const inZone = async (zone: string): Promise<void> => {
    const original = env.ZONE.get(env.ZONE.idFromName(zone));
    await act(original);
    const n = await original.copies();
    await Promise.allSettled(Array.from({ length: n - 1 }, (_, i) => act(env.ZONE.get(env.ZONE.idFromName(copyName(zone, i + 2))))));
  };
  await Promise.allSettled(SHARED_ZONES.map(inZone));
}

export async function removeFromGame(env: Pick<Env, "ZONE" | "HOME">, userId: string, text: string): Promise<void> {
  await Promise.allSettled([env.HOME.get(env.HOME.idFromName(userId)).removeUser(userId, text), everyZone(env, (z) => z.removeUser(userId, text))]);
}

/** The sentence is already saved in their HomeRoom: lock them up in whichever zone holds them. */
export async function jailInZones(env: Pick<Env, "ZONE">, userId: string, until: number, text: string): Promise<void> {
  await everyZone(env, (z) => z.jailUser(userId, until, text));
}

export async function unjailInZones(env: Pick<Env, "ZONE">, userId: string): Promise<void> {
  await everyZone(env, (z) => z.unjailUser(userId));
}
