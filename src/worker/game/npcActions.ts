// Filters NPC decisions (rules or LLM-backed) down to what the server allows. Decisions are
// untrusted: they may only target the speaker, stay near the NPC's home, and gifts are tiny.
import type { NpcAction } from "../npc/brain";
import type { Vec2 } from "../../shared/types";
import { getItem } from "../../shared/items";

export const MAX_ACTIONS = 4;
export const MAX_FOLLOW_MS = 10_000;
export const MAX_GIFT_QTY = 3;
/** Gifts are limited to cheap, non-tool, non-furniture items. */
export const MAX_GIFT_VALUE = 50;

export interface ActionScope {
  speakerId: string;
  home: Vec2;
  /** NPC may walk at most this far from home. */
  leash: number;
  hasShop: boolean;
  /** False if this speaker already got a gift from this NPC today. */
  giftAllowed: boolean;
  /** On shift at its counter/desk/stall: it never follows anyone off (walks stay within `leash`). */
  atPost?: boolean;
}

const EMOTES = new Set(["happy", "sad", "angry", "surprised", "love", "think"]);

export function sanitizeActions(actions: unknown, scope: ActionScope): NpcAction[] {
  const out: NpcAction[] = [];
  let gave = false;
  for (const a of Array.isArray(actions) ? actions : []) {
    if (out.length >= MAX_ACTIONS) break;
    if (!a || typeof a !== "object") continue;
    const act = a as NpcAction;
    switch (act.kind) {
      case "emote":
        if (EMOTES.has(act.emote)) out.push({ kind: "emote", emote: act.emote });
        break;
      case "face":
        if (act.targetId === scope.speakerId) out.push({ kind: "face", targetId: act.targetId });
        break;
      case "walk_to": {
        if (!Number.isFinite(act.x) || !Number.isFinite(act.y)) break;
        const dx = act.x - scope.home.x;
        const dy = act.y - scope.home.y;
        const d = Math.hypot(dx, dy);
        const k = d > scope.leash ? scope.leash / d : 1;
        out.push({ kind: "walk_to", x: scope.home.x + dx * k, y: scope.home.y + dy * k });
        break;
      }
      case "follow":
        if (!scope.atPost && act.targetId === scope.speakerId && Number.isFinite(act.ms)) {
          out.push({ kind: "follow", targetId: act.targetId, ms: Math.min(MAX_FOLLOW_MS, Math.max(0, act.ms)) });
        }
        break;
      case "open_shop":
        if (scope.hasShop && act.playerId === scope.speakerId) out.push({ kind: "open_shop", playerId: act.playerId });
        break;
      case "give": {
        if (gave || !scope.giftAllowed || act.playerId !== scope.speakerId) break;
        const def = getItem(act.item);
        if (!def || def.kind === "tool" || def.kind === "furniture" || def.sell > MAX_GIFT_VALUE) break;
        if (!Number.isInteger(act.qty) || act.qty < 1) break;
        out.push({ kind: "give", playerId: act.playerId, item: def.id, qty: Math.min(MAX_GIFT_QTY, act.qty) });
        gave = true;
        break;
      }
      case "idle":
        out.push({ kind: "idle" });
        break;
    }
  }
  return out;
}

export const EMOTE_STATUS: Record<string, string> = {
  happy: "♪",
  sad: "…",
  angry: "!!",
  surprised: "!",
  love: "♥",
  think: "?",
};
