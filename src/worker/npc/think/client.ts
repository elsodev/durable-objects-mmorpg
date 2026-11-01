// ZoneRoom/Worker side of the NpcAgent: typed stubs per (NPC, player) and the account wipe.
import { getAgentByName } from "agents";
import type { Env } from "../../env";
import type { NpcId } from "../bible";
import type { NpcMind } from "../../game/npcMind";
import { pairName, pairsForUser } from "./pair";
import type { NpcAgent } from "./agent";

function stub(env: Env, name: string) {
  return getAgentByName<Env, NpcAgent>(env.NPC_AGENT, name);
}

/** The NpcMind ZoneRoom uses: every call goes to that player's own agent for that NPC. */
export function agentMind(env: Env): NpcMind {
  return {
    async converse(npcId: NpcId, req) {
      return (await stub(env, pairName(npcId, req.playerId))).converse(req);
    },
    async receiveGift(npcId: NpcId, req) {
      return (await stub(env, pairName(npcId, req.playerId))).receiveGift(req);
    },
  };
}

/** Wipes every NPC's memory of this user (account deletion, guest cleanup). Best effort per NPC. */
export async function forgetNpcMemory(env: Env, userId: string): Promise<number> {
  let wiped = 0;
  await Promise.all(
    pairsForUser(userId).map(async (name) => {
      try {
        if (await (await stub(env, name)).forget()) wiped++;
      } catch (err) {
        // destroy() aborts the object right after it answers; a disconnect here still means wiped.
        if (String(err).includes("destroyed")) wiped++;
        else console.error("npc memory wipe failed", name, err);
      }
    }),
  );
  return wiped;
}
