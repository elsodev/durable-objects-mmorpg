// Scripted replies from the bible plus this pair's memory: what NPCs say with AI off, on timeouts,
// and whenever the budget says no. Deterministic given `rand`.
import type { ItemId } from "../../../shared/types";
import { giftTaste, NPC_BIBLE, NPC_DIALOGUE, type GiftTaste, type NpcId } from "../bible";
import { pickLineKey, type Situation } from "../dialogue";
import { getNpc } from "../catalog";
import type { Intent } from "../brain";
import { clampLine, pickLine, safeName } from "../text";
import { itemName, lastGift, type Fact, type PairMemory } from "./memory";

export interface Fill {
  name: string;
  item?: string;
  lastGift?: string;
  fact?: string;
}

export function fillTemplate(line: string, f: Fill): string {
  return line
    .split("{name}").join(safeName(f.name))
    .split("{item}").join(f.item ?? "gift")
    .split("{lastGift}").join(f.lastGift ?? "gift")
    .split("{fact}").join(f.fact ?? "");
}

function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)))]!;
}

/** Second-person version of a fact, for "I remember you ..." lines. Notes are not recalled aloud. */
export function factForRecall(f: Fact): string | null {
  switch (f.kind) {
    case "likes":
      return `like ${f.value}`;
    case "dislikes":
      return `don't care for ${f.value}`;
    case "favourite":
      return `said your favourite ${f.value}`;
    case "note":
      return null;
  }
}

const FACT_RECALL = ["I remember you {fact}, {name}.", "You told me you {fact}, {name}. I haven't forgotten."];

/**
 * The situation-keyed greeting for today (birthday, hearts band, weekday, season), or null when
 * only the default applies. Keys are tried in pickLineKey's priority order.
 */
export function keyedGreeting(id: NpcId, sit: Situation | undefined): { key: string; lines: readonly string[] } | null {
  if (!sit) return null;
  const table = NPC_DIALOGUE[id];
  const key = pickLineKey(table, sit);
  if (!key || key === "default") return null;
  return { key, lines: table[key]! };
}

/**
 * A reply in the NPC's voice. `mem` is the memory BEFORE this talk is counted, so talks === 0
 * means a first meeting. Greetings pick by situation key first (a birthday always wins; hearts,
 * weekday and season lines take turns with the memory lines), then memory (name, last gift, a
 * fact); other intents use the catalog lines for that intent.
 */
export function scriptedReply(id: NpcId, mem: PairMemory, intent: Intent, interact: boolean, rand: () => number, sit?: Situation): string {
  const def = getNpc(id);
  const lines = NPC_BIBLE[id].memoryLines;
  const name = mem.playerName;
  const greeting = interact || intent === "greet";
  if (greeting && mem.talks === 0) return clampLine(fillTemplate(pick(lines.firstMeet, rand), { name }));
  if (greeting) {
    const keyed = keyedGreeting(id, sit);
    if (keyed && (keyed.key === "birthday" || mem.talks % 2 === 0)) return clampLine(fillTemplate(pick(keyed.lines, rand), { name }));
    const gift = lastGift(mem);
    // Alternate so returning players hear about their gift every other visit, not every time.
    if (gift && mem.talks % 2 === 1) return clampLine(fillTemplate(pick(lines.rememberGift, rand), { name, lastGift: itemName(gift.item) }));
    const facts = mem.facts.map(factForRecall).filter((f): f is string => !!f);
    if (facts.length && mem.talks % 3 === 2) return clampLine(fillTemplate(pick(FACT_RECALL, rand), { name, fact: pick(facts, rand) }));
    return clampLine(fillTemplate(pick(lines.welcomeBack, rand), { name }));
  }
  if (intent === "smalltalk" && rand() < 0.5) return clampLine(fillTemplate(pick(NPC_BIBLE[id].sampleLines, rand), { name }));
  return def ? pickLine(def, intent, name, rand) : "...";
}

export function giftReply(id: NpcId, item: ItemId, playerName: string, rand: () => number): { reply: string; taste: GiftTaste } {
  const taste = giftTaste(id, item);
  const lines = NPC_BIBLE[id].memoryLines;
  const pool =
    taste === "loved"
      ? lines.giftLoved
      : taste === "liked"
        ? lines.giftLiked
        : taste === "hated"
          ? (lines.giftHated ?? lines.giftDisliked)
          : taste === "disliked"
            ? lines.giftDisliked
            : lines.giftNeutral;
  return { reply: clampLine(fillTemplate(pick(pool, rand), { name: playerName, item: itemName(item) })), taste };
}

/** Hard cap from the bible rules: at most two sentences, at most MAX_LINE chars. */
export function twoSentences(s: string): string {
  const parts = s.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g);
  if (!parts) return clampLine(s.trim());
  return clampLine(dropStrayQuotes(parts.slice(0, 2).join("").trim()));
}

/** The model often wraps its whole reply in quotes; once trimmed, a lone closing quote is left over. */
function dropStrayQuotes(s: string): string {
  const straight = (s.match(/"/g) ?? []).length;
  const open = (s.match(/“/g) ?? []).length;
  const close = (s.match(/”/g) ?? []).length;
  if (straight % 2 === 1) s = s.replace(/"$/, "").replace(/^"/, "");
  if (close > open) s = s.replace(/”$/, "");
  if (open > close) s = s.replace(/^“/, "");
  return s.trim();
}
