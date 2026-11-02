// Who a villager faces on YOUR screen. The server keeps one facing per NPC (whoever spoke to it
// last), so with several players chatting to the same villager it would turn away from most of
// them. Each client instead turns the villager it's talking to toward its own player, while the
// server stays authoritative for where the villager is and everyone else's view. Pure.
import type { EntityState, Facing, Vec2 } from "../../shared/types";

/** Past this many tiles apart the conversation is over as far as facing goes. */
export const FACE_RANGE = 4;
/** After opening a villager's shop (no conversation window), they keep facing you this long. */
export const ENGAGED_MS = 8000;

/** The villager you're engaged with: talked to or opened the shop of, and when. */
export interface Engaged {
  id: string;
  at: number;
}

/** The facing that looks from `from` toward `to`: the axis with the larger gap wins (ties: vertical). */
export function facingToward(from: Vec2, to: Vec2, fallback: Facing = "down"): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/**
 * The villager this client turns toward its player: the one in the open conversation window, or
 * the one whose shop you opened within ENGAGED_MS. Null when neither.
 */
export function facingTarget(talkingTo: string | null, engaged: Engaged | null, now: number): string | null {
  if (talkingTo) return talkingTo;
  if (engaged && now - engaged.at >= 0 && now - engaged.at < ENGAGED_MS) return engaged.id;
  return null;
}

/**
 * The entities to draw this frame, with villager `npcId` turned to face `me` while it stands still
 * within FACE_RANGE. Anyone else, and that villager while walking, keep the server's facing. Returns
 * the input list itself when nothing changes.
 */
export function faceViewer(states: EntityState[], npcId: string | null, me: Vec2 | null): EntityState[] {
  if (!npcId || !me) return states;
  const i = states.findIndex((s) => s.id === npcId);
  const npc = i >= 0 ? states[i]! : null;
  // A villager sitting down keeps facing the way the seat does.
  if (!npc || npc.kind !== "npc" || npc.moving || npc.act?.k === "sit") return states;
  if (Math.hypot(npc.x - me.x, npc.y - me.y) > FACE_RANGE) return states;
  const facing = facingToward(npc, me, npc.facing);
  if (facing === npc.facing) return states;
  const out = states.slice();
  out[i] = { ...npc, facing };
  return out;
}
