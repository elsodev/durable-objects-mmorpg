// The NPC "mind" NpcRunner talks to: per-(NPC, player) memory and replies. ZoneRoom passes the
// NpcAgent-backed one (npc/think/client.ts); tests pass fakes.
import type { NpcId } from "../npc/bible";
import type { ConverseRequest, ConverseResult, GiftRequest, GiftResult } from "../npc/think/types";

export interface NpcMind {
  converse(npcId: NpcId, req: ConverseRequest): Promise<ConverseResult>;
  receiveGift(npcId: NpcId, req: GiftRequest): Promise<GiftResult>;
}
