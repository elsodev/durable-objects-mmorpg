// Picking and prompting the villagers' game tips (the lines live in tipTables.ts). Used by the
// scripted replies (AI off, timeouts) and listed in both LLM prompts.
import { NPC_IDS, type NpcId } from "./bible";
import type { Intent, NpcDef } from "./brain";
import { clampLine, fillName, pickLine } from "./text";
import { normalize } from "./rules";
import { NPC_TIPS, type Tip } from "./tipTables";

export { MAX_TIP_LEN, NPC_TIPS, type Tip } from "./tipTables";

/** Chance a scripted answer to a question is a tip rather than a stock line. */
export const TIP_CHANCE = 0.5;

/** Words that mean "teach me something": the scripted reply is then always a tip. */
export const TIP_WORDS: readonly string[] = [
  "tip",
  "tips",
  "advice",
  "hint",
  "hints",
  "teach me",
  "show me how",
  "how do i",
  "how can i",
  "how to",
  "what should i",
  "where do i",
  "where can i",
  "new here",
  "beginner",
  "any ideas",
];

/** The tips for a villager id, or none for unknown ids (ids can arrive from clients). */
export function tipsFor(id: string): readonly Tip[] {
  return (NPC_IDS as readonly string[]).includes(id) ? NPC_TIPS[id as NpcId] : [];
}

/** True when the player is plainly asking to be taught something. */
export function wantsTip(text: string): boolean {
  const norm = normalize(text);
  return TIP_WORDS.some((w) => norm.includes(` ${w} `));
}

/** Tips whose topic words appear in what the player said, best match first. */
export function relevantTips(id: string, text: string): Tip[] {
  const norm = normalize(text);
  return tipsFor(id)
    .map((tip) => ({ tip, score: tip.about.filter((w) => norm.includes(` ${w} `)).length }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((t) => t.tip);
}

/** A tip line for the player: the best match for their words, else a random one. null when the NPC has none. */
export function pickTip(id: string, text: string, playerName: string, rand: () => number): string | null {
  const pool = tipsFor(id);
  if (pool.length === 0) return null;
  const match = relevantTips(id, text)[0];
  const tip = match ?? pool[Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)))]!;
  return clampLine(fillName(tip.line, playerName));
}

/**
 * Whether a scripted reply should be a tip: always when asked for advice, about half the time for
 * a question, never for shopping, rudeness or goodbyes.
 */
export function shouldTip(intent: Intent, text: string, rand: () => number): boolean {
  if (intent === "rude" || intent === "buy" || intent === "sell" || intent === "goodbye") return false;
  if (wantsTip(text)) return true;
  return intent === "ask_info" && rand() < TIP_CHANCE;
}

/** The scripted line for an intent, or a tip when shouldTip says so (AI off, timeouts, errors). */
export function scriptedLine(npc: NpcDef, intent: Intent, playerName: string, text: string, rand: () => number = Math.random): string {
  if (shouldTip(intent, text, rand)) {
    const tip = pickTip(npc.id, text, playerName, rand);
    if (tip) return tip;
  }
  return pickLine(npc, intent, playerName, rand);
}

/** Prompt section listing a villager's tips, with how to use them. Empty for unknown ids. */
export function tipsPrompt(id: string, text = ""): string {
  const tips = tipsFor(id);
  if (tips.length === 0) return "";
  const best = relevantTips(id, text)[0];
  return [
    "Valley know-how you can pass on (true; never invent other rules, keys, prices or places):",
    ...tips.map((t) => `- ${t.line.split("{name}").join("friend")}`),
    "Now and then, when it fits the moment, weave ONE of these into your reply in your own voice. Not every reply, and never more than one.",
    "If the visitor asks for advice or how to do something, answer with the most fitting one.",
    "You may name a key or a slash command exactly as written above, said plainly as everyday know-how.",
    best ? `The tip that best fits what they just said: ${best.line.split("{name}").join("friend")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
