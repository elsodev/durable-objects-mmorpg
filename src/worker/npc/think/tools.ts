// The agent's tools. Each one only RECORDS an intent; nothing here touches game state. Intents are
// validated twice: here (against the pair and the NPC) and again by ZoneRoom before it acts.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { NpcAction } from "../brain";
import { giftsFor, SAFE_GIFTS } from "../actions";
import { isPlaceId, type NpcId, type PlaceId } from "../bible";
import { getNpc } from "../catalog";
import { cleanFact, isMood, MOODS, type Mood } from "./memory";
import { GOAL_IDS, type GoalId, type NpcIntent } from "./types";

export const TOOL_NAMES = ["give_gift", "open_shop", "remember", "set_mood", "suggest_quest", "walk_to"] as const;
export const MAX_INTENTS = 4;

export interface IntentScope {
  npcId: NpcId;
  /** The pair's player (user id). */
  playerId: string;
}

/** AI SDK tools that push raw tool input into `sink`, tagged with the tool name. */
export function npcTools(sink: (raw: { kind: string } & Record<string, unknown>) => void): ToolSet {
  const ok = { ok: true } as const;
  return {
    give_gift: tool({
      description: "Hand the visitor a small gift you own (rarely, only to someone kind).",
      inputSchema: z.object({ item: z.string().max(40), qty: z.number().int().min(1).max(3) }),
      execute: async (input) => (sink({ kind: "give_gift", ...input }), ok),
    }),
    open_shop: tool({
      description: "Show the visitor your shop, if you run one.",
      inputSchema: z.object({}),
      execute: async () => (sink({ kind: "open_shop" }), ok),
    }),
    remember: tool({
      description: "Remember one short fact the visitor told you about themselves.",
      inputSchema: z.object({ playerId: z.string().max(128), fact: z.string().max(200) }),
      execute: async (input) => (sink({ kind: "remember", ...input }), ok),
    }),
    set_mood: tool({
      description: "Set how you feel right now.",
      inputSchema: z.object({ mood: z.enum(MOODS) }),
      execute: async (input) => (sink({ kind: "set_mood", ...input }), ok),
    }),
    suggest_quest: tool({
      description: "Point the visitor to a village goal.",
      inputSchema: z.object({ goal: z.enum(GOAL_IDS) }),
      execute: async (input) => (sink({ kind: "suggest_quest", ...input }), ok),
    }),
    walk_to: tool({
      description: "Take a few steps toward a nearby place.",
      inputSchema: z.object({ placeId: z.string().max(40) }),
      execute: async (input) => (sink({ kind: "walk_to", ...input }), ok),
    }),
  };
}

function obj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Drops anything malformed, outside this NPC's powers, or about a different player. */
export function validateIntents(raw: unknown, scope: IntentScope): NpcIntent[] {
  if (!Array.isArray(raw)) return [];
  const gifts = new Set(giftsFor(scope.npcId));
  const hasShop = !!getNpc(scope.npcId)?.shop;
  const out: NpcIntent[] = [];
  const seen = new Set<string>();
  for (const a of raw.slice(0, 16)) {
    if (out.length >= MAX_INTENTS) break;
    if (!obj(a) || typeof a.kind !== "string" || seen.has(a.kind)) continue;
    let intent: NpcIntent | null = null;
    switch (a.kind) {
      case "give_gift": {
        const item = a.item;
        const qty = a.qty;
        if (typeof item === "string" && gifts.has(item) && typeof qty === "number" && Number.isInteger(qty) && qty >= 1)
          intent = { kind: "give_gift", item, qty: Math.min(qty, SAFE_GIFTS[item] ?? 1) };
        break;
      }
      case "open_shop":
        if (hasShop) intent = { kind: "open_shop" };
        break;
      case "remember": {
        const fact = cleanFact(a.fact);
        if (a.playerId === scope.playerId && fact) intent = { kind: "remember", playerId: scope.playerId, fact };
        break;
      }
      case "set_mood":
        if (isMood(a.mood)) intent = { kind: "set_mood", mood: a.mood };
        break;
      case "suggest_quest":
        if (typeof a.goal === "string" && (GOAL_IDS as readonly string[]).includes(a.goal)) intent = { kind: "suggest_quest", goal: a.goal as GoalId };
        break;
      case "walk_to":
        if (isPlaceId(a.placeId)) intent = { kind: "walk_to", placeId: a.placeId };
        break;
    }
    if (intent) {
      out.push(intent);
      seen.add(intent.kind);
    }
  }
  return out;
}

const MOOD_EMOTE: Record<Mood, Extract<NpcAction, { kind: "emote" }>["emote"] | null> = {
  neutral: null,
  happy: "happy",
  sad: "sad",
  annoyed: "angry",
  surprised: "surprised",
  fond: "love",
  thoughtful: "think",
};

export interface IntentTargets {
  /** The speaker's entity id in the zone. */
  speakerEntityId: string;
  /** Tile coords of a place in this zone, or null when it isn't here. */
  place(placeId: PlaceId): { x: number; y: number } | null;
}

/**
 * Turns validated intents into the NpcAction list the runner already sanitizes and applies, plus
 * goals to point the player at. `remember` is the agent's own memory, so it maps to nothing.
 */
export function intentsToActions(intents: NpcIntent[], t: IntentTargets): { actions: NpcAction[]; quests: GoalId[] } {
  const actions: NpcAction[] = [];
  const quests: GoalId[] = [];
  for (const i of intents) {
    switch (i.kind) {
      case "give_gift":
        actions.push({ kind: "give", playerId: t.speakerEntityId, item: i.item, qty: i.qty });
        break;
      case "open_shop":
        actions.push({ kind: "open_shop", playerId: t.speakerEntityId });
        break;
      case "set_mood": {
        const emote = MOOD_EMOTE[i.mood];
        if (emote) actions.push({ kind: "emote", emote });
        break;
      }
      case "walk_to": {
        const p = t.place(i.placeId);
        if (p) actions.push({ kind: "walk_to", x: p.x, y: p.y });
        break;
      }
      case "suggest_quest":
        quests.push(i.goal);
        break;
      case "remember":
        break;
    }
  }
  return { actions, quests };
}
