// Validation of NPC actions that came from an AI. Anything outside the NPC's allowed list is dropped.
import type { ItemId } from "../../shared/types";
import { getItem } from "../../shared/items";
import { NPC_GIFTS } from "./catalog";
import type { NpcAction, NpcContext } from "./brain";

/** The only items any NPC may ever give, with the max quantity per gift. Cheap on purpose. */
export const SAFE_GIFTS: Readonly<Record<ItemId, number>> = {
  seed_turnip: 2,
  seed_carrot: 1,
  herb_mint: 1,
  mushroom: 1,
  wood: 3,
  stone: 3,
};

export type Emote = Extract<NpcAction, { kind: "emote" }>["emote"];
export const EMOTES: readonly Emote[] = ["happy", "sad", "angry", "surprised", "love", "think"];
export const MAX_ACTIONS = 4;
/** walk_to must stay within this many tiles of the NPC (it wanders, it doesn't travel). */
export const MAX_WALK = 6;
export const MAX_FOLLOW_MS = 10_000;

/** Items this NPC may give: its catalog list, narrowed to SAFE_GIFTS. */
export function giftsFor(npcId: string): ItemId[] {
  const list = Object.hasOwn(NPC_GIFTS, npcId) ? NPC_GIFTS[npcId] : [];
  return list.filter((id) => Object.hasOwn(SAFE_GIFTS, id) && getItem(id) !== undefined);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isEmote(v: unknown): v is Emote {
  return typeof v === "string" && (EMOTES as readonly string[]).includes(v);
}

/** Validates untrusted action data against the context. Unknown or unsafe actions are dropped; at most one gift. */
export function validateActions(raw: unknown, ctx: NpcContext): NpcAction[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>([ctx.speaker.id, ...ctx.nearby.map((n) => n.id)]);
  const gifts = new Set(giftsFor(ctx.npc.id));
  const out: NpcAction[] = [];
  let gave = false;
  for (const a of raw.slice(0, 16)) {
    if (out.length >= MAX_ACTIONS) break;
    if (!isObj(a)) continue;
    switch (a.kind) {
      case "emote":
        if (isEmote(a.emote)) out.push({ kind: "emote", emote: a.emote });
        break;
      case "face":
        if (typeof a.targetId === "string" && known.has(a.targetId)) out.push({ kind: "face", targetId: a.targetId });
        break;
      case "walk_to":
        if (finite(a.x) && finite(a.y) && Math.hypot(a.x - ctx.pos.x, a.y - ctx.pos.y) <= MAX_WALK)
          out.push({ kind: "walk_to", x: a.x, y: a.y });
        break;
      case "follow":
        if (typeof a.targetId === "string" && known.has(a.targetId) && finite(a.ms))
          out.push({ kind: "follow", targetId: a.targetId, ms: Math.round(Math.min(MAX_FOLLOW_MS, Math.max(0, a.ms))) });
        break;
      case "open_shop":
        if (ctx.npc.shop && a.playerId === ctx.speaker.id) out.push({ kind: "open_shop", playerId: ctx.speaker.id });
        break;
      case "give": {
        const item = a.item;
        if (gave || a.playerId !== ctx.speaker.id || typeof item !== "string" || !gifts.has(item)) break;
        if (!finite(a.qty) || !Number.isInteger(a.qty) || a.qty < 1) break;
        out.push({ kind: "give", playerId: ctx.speaker.id, item, qty: Math.min(a.qty, SAFE_GIFTS[item]) });
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
