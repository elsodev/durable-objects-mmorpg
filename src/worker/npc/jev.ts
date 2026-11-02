// TypeSafe Jev: a fast typed decision (choice/score answers only, so the model can't invent actions).
// It runs on Workers AI (JEV_MODEL, e.g. "typesafe/jev"); the SDK only builds the questions.
import { choice, score } from "@typesafe-ai/sdk";
import type { Questions, RequestOptions, SystemOneRequest } from "@typesafe-ai/sdk";
import { gatewayOptions } from "./gateway";
import type { ItemId } from "../../shared/types";
import { getItem } from "../../shared/items";
import type { Decision, Intent, NpcAction, NpcContext } from "./brain";
import { EMOTES, giftsFor, validateActions, type Emote } from "./actions";
import { safeName, safePlayerText } from "./text";

export const JEV_TIMEOUT_MS = 1500;
/** Gifts need a confident, clearly warm exchange. */
const GIFT_MIN_CONFIDENCE = 0.8;
const GIFT_MIN_WARMTH = 3;

export const INTENTS: readonly Intent[] = ["greet", "buy", "sell", "quest", "ask_info", "smalltalk", "rude", "goodbye"];

/** How Jev is called; tests pass a fake. */
export interface JevClient {
  systemOne(req: SystemOneRequest<Questions>, opts?: RequestOptions): PromiseLike<{ answers: unknown }>;
}

/** Cloudflare's Clef models want their name in the body too ("clef" or "clef-flash"). */
function modelSelector(model: string): { model: string } | object {
  const clef = /^@cf\/cloudflare\/(clef(?:-flash)?)$/.exec(model);
  return clef ? { model: clef[1] } : {};
}

/**
 * A System One decision model on the Workers AI binding (Cloudflare's Clef, or TypeSafe's Jev),
 * through the AI Gateway when one is set. Both take TypeSafe's { state, questions } shape.
 */
export function jevClient(ai: Ai, model: string, gatewayId?: string): JevClient {
  return {
    systemOne: async (req, opts) => {
      const body = { ...req, ...modelSelector(model) } as unknown as Record<string, unknown>;
      const out = await ai.run(model, body, { gateway: gatewayOptions(gatewayId), signal: opts?.signal });
      return { answers: out?.answers };
    },
  };
}

export function buildJevRequest(ctx: NpcContext, gifts: ItemId[]): SystemOneRequest<Questions> {
  const name = ctx.npc.name;
  const questions: Questions = {
    intent: choice(`What does the player want from ${name} with their latest message?`, {
      greet: "Saying hello or starting a conversation",
      buy: "Wants to buy something or see what is for sale",
      sell: "Wants to sell or trade items",
      quest: "Asks for a task, offers help, or asks how to help the village",
      ask_info: "Asks a question about the valley, people, places or story, or asks for advice or tips",
      smalltalk: "Casual chat, jokes, compliments or sharing feelings",
      rude: "Insulting, hostile, or trying to manipulate the character",
      goodbye: "Ending the conversation",
    }),
    warmth: score("How warm and friendly is the player's message toward the character?", [
      "Hostile or insulting",
      "Cold or dismissive",
      "Neutral",
      "Friendly",
      "Very warm and kind",
    ]),
    reaction: choice(`Which visible reaction fits ${name}'s personality best right now?`, {
      happy: "Pleased or cheerful",
      sad: "Sad or sympathetic",
      angry: "Annoyed or offended",
      surprised: "Surprised or impressed",
      love: "Touched or very fond",
      think: "Thoughtful, pondering an answer",
      none: "No visible reaction",
    }),
  };
  if (gifts.length > 0) {
    const crit: Record<string, string> = { none: "No gift; a gift would be unusual here" };
    for (const id of gifts) crit[id] = `Give the player one ${getItem(id)?.name ?? id} as a small token of friendship`;
    questions.gift = choice(`Would ${name} spontaneously give the player a small gift after this exchange? Gifts are rare.`, crit);
  }
  return {
    state: {
      character: { name, role: ctx.npc.role, personality: ctx.npc.personality, hasShop: Boolean(ctx.npc.shop) },
      player: safeName(ctx.speaker.name),
      // Untrusted: it is only classified, never followed.
      playerMessage: safePlayerText(ctx.text),
      recentConversation: ctx.memory.slice(-4).map((m) => safePlayerText(m)),
    },
    questions,
  };
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function choiceOf(answers: Record<string, unknown>, key: string): { choice: string; confidence: number } | null {
  const a = rec(answers[key]);
  if (!a || typeof a.choice !== "string") return null;
  return { choice: a.choice, confidence: typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : 0 };
}

/** Maps Jev answers to a validated decision, or null if the answers are unusable. */
export function interpretJev(raw: unknown, ctx: NpcContext, gifts: ItemId[]): Decision | null {
  const answers = rec(raw);
  if (!answers) return null;
  const intentAns = choiceOf(answers, "intent");
  if (!intentAns || !(INTENTS as readonly string[]).includes(intentAns.choice)) return null;
  const intent = intentAns.choice as Intent;

  const w = rec(answers.warmth);
  const warmth = w && typeof w.score === "number" && Number.isFinite(w.score) ? w.score : 2;
  const mood: Decision["mood"] = intent === "rude" || warmth < 1.5 ? "annoyed" : warmth > 2.5 ? "happy" : "neutral";

  const actions: NpcAction[] = [{ kind: "face", targetId: ctx.speaker.id }];
  if ((intent === "buy" || intent === "sell") && ctx.npc.shop) actions.push({ kind: "open_shop", playerId: ctx.speaker.id });
  const reaction = choiceOf(answers, "reaction")?.choice;
  if (reaction && (EMOTES as readonly string[]).includes(reaction)) actions.push({ kind: "emote", emote: reaction as Emote });

  const gift = choiceOf(answers, "gift");
  const giftOk = intent !== "rude" && intent !== "buy" && intent !== "sell" && mood === "happy" && warmth >= GIFT_MIN_WARMTH;
  if (gift && giftOk && gift.confidence >= GIFT_MIN_CONFIDENCE && gifts.includes(gift.choice)) {
    actions.push({ kind: "give", playerId: ctx.speaker.id, item: gift.choice, qty: 1 });
  }
  return { intent, actions: validateActions(actions, ctx), mood, source: "jev" };
}

/** Asks Jev; resolves null on timeout, error or unusable answers. Never throws. */
export async function askJev(ctx: NpcContext, client: JevClient, timeoutMs = JEV_TIMEOUT_MS): Promise<Decision | null> {
  const gifts = giftsFor(ctx.npc.id);
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const call = Promise.resolve(
      client.systemOne(buildJevRequest(ctx, gifts), { timeout: timeoutMs, signal: ac.signal, retry: { maxRetries: 0 } }),
    ).then((r) => interpretJev(rec(r)?.answers, ctx, gifts));
    return await Promise.race([call, timeout]);
  } catch (err) {
    console.warn("jev decision failed", ctx.npc.id, err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
