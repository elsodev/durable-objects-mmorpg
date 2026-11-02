// NPC brain. Rules first, then TypeSafe Jev for a typed decision, then an LLM writes the line.
import type { ItemId, SharedZoneId } from "../../shared/types";
import type { ShopOffer } from "../../shared/protocol";
import { classify, ruleDecision } from "./rules";
import { askJev, jevClient } from "./jev";
import { buildMessages } from "./prompt";
import { pickLine, sanitizeLine } from "./text";
import { gatewayOptions } from "./gateway";
import { scriptedLine } from "./tips";

export type Intent = "greet" | "buy" | "sell" | "quest" | "ask_info" | "smalltalk" | "rude" | "goodbye";

export interface NpcDef {
  id: string; // "bram", "odette", ...
  name: string;
  sprite: string; // client sprite key
  zone: SharedZoneId;
  role: string; // "Mayor of the village", ...
  personality: string; // 1-2 sentences for prompts
  knowledge: string[]; // facts they can share (story hooks)
  shop?: { sells: ShopOffer[]; buys: ItemId[] }; // buys: items they purchase at ItemDef.sell
  /** Scripted fallback lines per intent ({name} = player's name). */
  lines: Partial<Record<Intent | "idle" | "thinking_fail", string[]>>;
}

export type NpcAction =
  | { kind: "emote"; emote: "happy" | "sad" | "angry" | "surprised" | "love" | "think" }
  | { kind: "face"; targetId: string }
  | { kind: "walk_to"; x: number; y: number }
  | { kind: "follow"; targetId: string; ms: number }
  | { kind: "open_shop"; playerId: string }
  | { kind: "give"; playerId: string; item: ItemId; qty: number }
  | { kind: "idle" };

export interface NpcContext {
  npc: NpcDef;
  pos: { x: number; y: number };
  memory: string[]; // most recent last, max 10
  speaker: { id: string; name: string };
  text: string;
  nearby: { id: string; name: string; kind: "player" | "npc" | "monster"; dist: number }[];
}

export interface Decision {
  intent: Intent;
  actions: NpcAction[];
  mood: "annoyed" | "neutral" | "happy";
  /** Where the decision came from, for logs. */
  source: "rules" | "jev" | "fallback";
}

export interface BrainEnv {
  AI?: Ai;
  NPC_MODEL: string;
  NPC_AI_MODE?: "on" | "off";
  /** Workers AI model id for Jev decisions (e.g. "typesafe/jev"); unset = rule-based decisions. */
  JEV_MODEL?: string;
  /** AI Gateway every model call goes through; unset = straight to Workers AI. */
  AI_GATEWAY_ID?: string;
}

/** Approximate cost units per call, for AiBudget accounting. */
export function estimateUnits(kind: "speak" | "jev"): number {
  // speak: ~500 input + 80 output tokens on llama-3.1-8b-instruct-fast is ~5 neurons; rounded up.
  // jev: not billed in neurons; a fixed share keeps it inside the same daily cap.
  return kind === "speak" ? 6 : 2;
}

export const SPEAK_TIMEOUT_MS = 4000;
/** Chance that idleLine speaks when called. */
export const IDLE_CHANCE = 0.3;

function aiEnabled(env: BrainEnv): boolean {
  return env.NPC_AI_MODE !== "off";
}

/** Fast decision. Must resolve within ~1.5 s (rules are instant; Jev call has a timeout; falls back to rules). */
export function decide(ctx: NpcContext, env: BrainEnv): Promise<Decision> {
  return decideWith(ctx, env, jevClient);
}

/** decide() with an injectable Jev client factory (tests). */
export async function decideWith(ctx: NpcContext, env: BrainEnv, makeClient: typeof jevClient): Promise<Decision> {
  const match = classify(ctx.text);
  if (match.confident || !aiEnabled(env) || !env.AI || !env.JEV_MODEL) return ruleDecision(ctx, match.intent, "rules");
  let jev: Decision | null = null;
  try {
    jev = await askJev(ctx, makeClient(env.AI, env.JEV_MODEL, env.AI_GATEWAY_ID));
  } catch {
    jev = null;
  }
  return jev ?? ruleDecision(ctx, match.intent, "fallback");
}

/** Words for the decision. Uses Workers AI when NPC_AI_MODE !== "off"; scripted line on error/timeout. Max 200 chars. */
export async function speak(ctx: NpcContext, decision: Decision, env: BrainEnv, timeoutMs = SPEAK_TIMEOUT_MS): Promise<string> {
  // Questions and plain requests for advice get one of the villager's tips now and then.
  const scripted = () => scriptedLine(ctx.npc, decision.intent, ctx.speaker.name, ctx.text);
  if (!aiEnabled(env) || !env.AI || !env.NPC_MODEL) return scripted();
  // Ai.run is typed per model name; NPC_MODEL is configuration, so call it through a plain signature.
  const ai = env.AI as unknown as { run(model: string, input: unknown, options?: AiOptions): Promise<unknown> };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      ai.run(env.NPC_MODEL, { messages: buildMessages(ctx, decision), max_tokens: 80 }, { gateway: gatewayOptions(env.AI_GATEWAY_ID) }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    const raw = typeof out === "string" ? out : (out as { response?: unknown } | null)?.response;
    return sanitizeLine(raw, ctx.npc.name) ?? scripted();
  } catch (err) {
    console.warn("npc speak failed", ctx.npc.id, err instanceof Error ? err.message : String(err));
    return scripted();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Occasional ambient line when players are near but nobody spoke. null = stay quiet. */
export function idleLine(npc: NpcDef, rand: () => number): string | null {
  if (!npc.lines.idle?.length || rand() >= IDLE_CHANCE) return null;
  return pickLine(npc, "idle", "friend", rand);
}
