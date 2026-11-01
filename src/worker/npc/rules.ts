// Keyword intent rules: instant, free, and the fallback whenever AI is off or slow.
import type { Decision, Intent, NpcAction, NpcContext } from "./brain";

export interface RuleMatch {
  intent: Intent;
  /** True when the keywords are clear enough that asking Jev would add nothing. */
  confident: boolean;
}

const RUDE = ["idiot", "stupid", "dumb", "shut up", "hate you", "ugly", "loser", "moron", "useless", "go away", "jerk"];
const GOODBYE = ["bye", "goodbye", "good bye", "farewell", "see you", "see ya", "cya", "later", "good night", "gotta go", "take care"];
const BUY = ["buy", "purchase", "shop", "store", "wares", "sell me", "for sale", "how much", "price", "prices", "stock", "what do you have", "what do you sell", "browse"];
const SELL = ["sell", "selling", "trade", "buy my", "buy this", "want my"];
const GREET = ["hi", "hello", "hey", "howdy", "greetings", "yo", "hiya", "good morning", "good afternoon", "good evening", "morning", "sup"];
const QUEST = ["quest", "task", "job", "help", "errand", "work", "need", "donate", "goal", "fix", "repair", "rebuild", "relight", "can i do"];
const STORY = ["lantern", "bridge", "fair", "festival", "shrine", "slime", "slimes", "bat", "bats", "crab", "crabs", "critters", "monsters", "gem", "crystal"];
const ASK = ["who", "what", "where", "why", "how", "when", "tell me", "know", "rumor", "rumour", "news", "explain", "story"];

/** Lowercase words separated by single spaces, so phrases match on word boundaries. */
export function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim()} `;
}

function has(norm: string, words: string[]): boolean {
  return words.some((w) => norm.includes(` ${w} `));
}

export function classify(text: string): RuleMatch {
  const norm = normalize(text);
  const trimmed = norm.trim();
  const words = trimmed === "" ? 0 : trimmed.split(" ").length;
  if (words === 0) return { intent: "greet", confident: true };
  if (has(norm, RUDE)) return { intent: "rude", confident: true };
  // "buy my" means the player wants to sell; "sell me" means buy. Check the specific phrases first.
  if (has(norm, ["buy my", "buy this", "want my"])) return { intent: "sell", confident: true };
  if (has(norm, BUY)) return { intent: "buy", confident: true };
  if (has(norm, SELL)) return { intent: "sell", confident: true };
  if (has(norm, GOODBYE)) return { intent: "goodbye", confident: words <= 5 };
  const story = has(norm, STORY);
  if (has(norm, QUEST)) return { intent: "quest", confident: story };
  if (has(norm, ASK) || text.includes("?")) return { intent: "ask_info", confident: story };
  if (has(norm, GREET)) return { intent: "greet", confident: words <= 5 };
  return { intent: "smalltalk", confident: false };
}

export function moodFor(intent: Intent): Decision["mood"] {
  if (intent === "rude") return "annoyed";
  if (intent === "greet" || intent === "goodbye" || intent === "smalltalk") return "happy";
  return "neutral";
}

/** Actions a rule-based decision takes for an intent. */
export function ruleActions(ctx: NpcContext, intent: Intent): NpcAction[] {
  const face: NpcAction = { kind: "face", targetId: ctx.speaker.id };
  switch (intent) {
    case "buy":
    case "sell":
      return ctx.npc.shop
        ? [face, { kind: "open_shop", playerId: ctx.speaker.id }]
        : [face, { kind: "emote", emote: "think" }];
    case "rude":
      return [face, { kind: "emote", emote: "angry" }];
    case "quest":
    case "ask_info":
      return [face, { kind: "emote", emote: "think" }];
    case "greet":
    case "goodbye":
    case "smalltalk":
      return [face, { kind: "emote", emote: "happy" }];
  }
}

export function ruleDecision(ctx: NpcContext, intent: Intent, source: Decision["source"]): Decision {
  return { intent, actions: ruleActions(ctx, intent), mood: moodFor(intent), source };
}
