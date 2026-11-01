// RPC shapes between ZoneRoom's NpcRunner and the per-(NPC, player) NpcAgent. Plain data only.
import type { ItemId, SharedZoneId } from "../../../shared/types";
import type { Intent } from "../brain";
import type { PlaceId } from "../bible";
import type { Mood } from "./memory";

export const GOAL_IDS = ["bridge", "fair", "lantern"] as const;
export type GoalId = (typeof GOAL_IDS)[number];

/** What the agent may ask ZoneRoom to do. ZoneRoom validates every one before acting. */
export type NpcIntent =
  | { kind: "give_gift"; item: ItemId; qty: number }
  | { kind: "open_shop" }
  | { kind: "remember"; playerId: string; fact: string }
  | { kind: "set_mood"; mood: Mood }
  | { kind: "suggest_quest"; goal: GoalId }
  | { kind: "walk_to"; placeId: PlaceId };

export interface ConverseContext {
  /** Intent from rules/Jev, so scripted replies match the decision. */
  intent: Intent;
  /** True for a click/F interaction rather than typed chat. */
  interact: boolean;
  /** Generic world facts (village goal status). Never player data. */
  world: string[];
  /** Something the decision already did this turn. */
  shopOpened: boolean;
  gave?: { item: ItemId; qty: number };
}

export interface ConverseRequest {
  /** The player's user id; must match the agent's pair. */
  playerId: string;
  playerName: string;
  text: string;
  zone: SharedZoneId;
  context: ConverseContext;
  /** True only after NpcRunner reserved AiBudget for this turn. False = scripted, no model call. */
  ai: boolean;
}

export interface ConverseResult {
  reply: string;
  intents: NpcIntent[];
  source: "agent" | "scripted";
}

export interface GiftRequest {
  playerId: string;
  playerName: string;
  item: ItemId;
}

export interface GiftResult {
  reply: string;
  taste: "loved" | "liked" | "disliked" | "neutral";
}
