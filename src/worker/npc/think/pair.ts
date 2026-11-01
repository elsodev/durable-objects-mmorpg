// Agent naming: one NpcAgent per (NPC, player). The name is the only link between them.
import { isNpcId, NPC_IDS, type NpcId } from "../bible";

const MAX_USER_ID = 128;

export function pairName(npcId: NpcId, userId: string): string {
  return `${npcId}:${userId}`;
}

export function parsePairName(name: string | undefined): { npcId: NpcId; userId: string } | null {
  if (typeof name !== "string") return null;
  const i = name.indexOf(":");
  if (i <= 0) return null;
  const npcId = name.slice(0, i);
  const userId = name.slice(i + 1);
  if (!isNpcId(npcId) || userId.length === 0 || userId.length > MAX_USER_ID) return null;
  return { npcId, userId };
}

/** Every pair a user can have, for wiping their memories. */
export function pairsForUser(userId: string): string[] {
  return NPC_IDS.map((id) => pairName(id, userId));
}
