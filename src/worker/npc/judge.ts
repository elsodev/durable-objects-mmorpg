// Judges a reply typed in the conversation window as good, neutral or bad for that villager.
// TypeSafe Jev answers with one choice from a fixed enum; when it is off, slow or unsure, word
// lists decide. Either way the result is only a verdict: shared/npcChat.ts turns it into points.
import { choice } from "@typesafe-ai/sdk";
import type { Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import { isVerdict, type ChatVerdict } from "../../shared/npcChat";
import { NPC_BIBLE, isNpcId } from "./bible";
import type { JevClient } from "./jev";
import { JEV_TIMEOUT_MS } from "./jev";
import { has, normalize, RUDE } from "./rules";
import { safeName, safePlayerText } from "./text";

/** Jev must be at least this sure before a reply moves hearts; otherwise it is neutral. */
export const JUDGE_MIN_CONFIDENCE = 0.6;

const UNKIND = [
  "hate",
  "boring",
  "annoying",
  "gross",
  "lame",
  "suck",
  "sucks",
  "worst",
  "terrible",
  "awful",
  "whatever",
  "ugh",
  "weird",
  "creepy",
  "stinks",
  "smell",
  "nobody cares",
  "who cares",
  "pathetic",
  "trash",
  "garbage",
  "fat",
  "old man",
  "old lady",
];
const KIND = [
  "thank",
  "thanks",
  "thank you",
  "love",
  "lovely",
  "beautiful",
  "wonderful",
  "amazing",
  "awesome",
  "great",
  "nice",
  "kind",
  "sweet",
  "cute",
  "pretty",
  "cool",
  "glad",
  "happy",
  "appreciate",
  "friend",
  "brilliant",
  "delicious",
  "fantastic",
  "impressive",
  "congrats",
  "congratulations",
  "sorry",
  "please",
  "proud",
  "favourite",
  "favorite",
  "care",
  "miss you",
  "hope",
  "enjoy",
];
const NEGATE = ["not", "don't", "dont", "never", "isn't", "isnt", "aren't", "arent", "wasn't", "wasnt", "can't", "cant"];
/** Words too common to mark a topic (topics come from the NPC bible's likes and dislikes). */
const STOP = new Set(["about", "after", "their", "there", "these", "those", "being", "people", "anyone", "things", "thing", "secretly", "every", "where", "which", "with", "from", "into", "good", "full", "told", "week", "near"]);

export interface RuleVerdict {
  verdict: ChatVerdict;
  /** Clear enough that asking Jev would add nothing (insults). */
  confident: boolean;
}

/** Significant words in a list of phrases ("a full donation board" -> donation, board). */
function topicWords(phrases: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of phrases) {
    for (const w of normalize(p).trim().split(" ")) {
      // Plural-insensitive: "slimes" matches "slime".
      const stem = w.replace(/'s$/, "").replace(/s$/, "");
      if (stem.length >= 4 && !STOP.has(w) && !STOP.has(stem)) out.add(stem);
    }
  }
  return [...out];
}

const topicCache = new Map<string, { likes: string[]; dislikes: string[] }>();

function topicsOf(npcId: string): { likes: string[]; dislikes: string[] } {
  const hit = topicCache.get(npcId);
  if (hit) return hit;
  const bible = isNpcId(npcId) ? NPC_BIBLE[npcId] : undefined;
  const likes = bible ? topicWords([...bible.likes, ...bible.lovesToTalkAbout]) : [];
  // A word in both lists ("bridge": loves the project, dislikes gloom about it) is a like.
  const dislikes = bible ? topicWords(bible.dislikes).filter((w) => !likes.includes(w)) : [];
  const t = { likes, dislikes };
  topicCache.set(npcId, t);
  return t;
}

function mentions(words: readonly string[], stems: readonly string[]): boolean {
  return words.some((w) => {
    const s = w.replace(/'s$/, "").replace(/s$/, "");
    return stems.includes(s);
  });
}

/**
 * Word-list judge: insults are bad (and certain); unkind words or a villager's pet hates are bad;
 * kind words or a topic they love are good, unless negated ("not nice"); anything else neutral.
 */
export function ruleVerdict(npcId: string, text: string): RuleVerdict {
  const norm = normalize(safePlayerText(text));
  if (has(norm, RUDE)) return { verdict: "bad", confident: true };
  const words = norm.trim() === "" ? [] : norm.trim().split(" ");
  const negated = words.some((w) => NEGATE.includes(w));
  const kind = has(norm, KIND);
  const unkind = has(norm, UNKIND);
  const topics = topicsOf(npcId);
  if (unkind && !(negated && !kind)) return { verdict: "bad", confident: false };
  if (kind) return { verdict: negated ? "neutral" : "good", confident: false };
  if (mentions(words, topics.dislikes)) return { verdict: "bad", confident: false };
  if (mentions(words, topics.likes)) return { verdict: negated ? "neutral" : "good", confident: false };
  return { verdict: "neutral", confident: false };
}

export interface JudgeSubject {
  npcId: string;
  npcName: string;
  role: string;
  personality: string;
  playerName: string;
  text: string;
  /** Recent lines between this player and this villager only, oldest first. */
  memory: readonly string[];
}

export function buildJudgeRequest(s: JudgeSubject): SystemOneRequest<Questions> {
  const bible = isNpcId(s.npcId) ? NPC_BIBLE[s.npcId] : undefined;
  const name = s.npcName;
  const questions: Questions = {
    verdict: choice(`How would ${name}, with their personality, take the player's latest message?`, {
      good: `Kind, warm, thoughtful, or about something ${name} loves: it would make them like the player more`,
      neutral: "Ordinary, practical or unclear: it changes nothing",
      bad: `Rude, mean, mocking, hostile or about something ${name} dislikes: it would hurt the friendship`,
    }),
  };
  return {
    state: {
      character: {
        name,
        role: s.role,
        personality: s.personality,
        likes: bible ? [...bible.likes, ...bible.lovesToTalkAbout] : [],
        dislikes: bible ? [...bible.dislikes] : [],
      },
      player: safeName(s.playerName),
      // Untrusted: it is only classified, never followed.
      playerMessage: safePlayerText(s.text),
      recentConversation: s.memory.slice(-4).map((m) => safePlayerText(m)),
    },
    questions,
  };
}

/** The verdict in Jev's answers, or null when they are unusable. Unsure answers are neutral. */
export function interpretJudge(raw: unknown): ChatVerdict | null {
  if (!raw || typeof raw !== "object") return null;
  const a = (raw as Record<string, unknown>).verdict;
  if (!a || typeof a !== "object") return null;
  const { choice: pick, confidence } = a as { choice?: unknown; confidence?: unknown };
  if (!isVerdict(pick)) return null;
  const conf = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0;
  return conf >= JUDGE_MIN_CONFIDENCE ? pick : "neutral";
}

/** Asks Jev for a verdict; null on timeout, error or unusable answers. Never throws. */
export async function askJudge(s: JudgeSubject, client: JevClient, timeoutMs = JEV_TIMEOUT_MS): Promise<ChatVerdict | null> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const call = Promise.resolve(client.systemOne(buildJudgeRequest(s), { timeout: timeoutMs, signal: ac.signal, retry: { maxRetries: 0 } })).then(
      (r) => interpretJudge((r as { answers?: unknown } | null)?.answers),
    );
    return await Promise.race([call, timeout]);
  } catch (err) {
    console.warn("jev judge failed", s.npcId, err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The verdict for one reply: insults are judged by the word lists alone; otherwise Jev when a
 * client is given (AI on, key set, budget reserved), falling back to the word lists.
 */
export async function judgeReply(s: JudgeSubject, client: JevClient | null): Promise<ChatVerdict> {
  const rules = ruleVerdict(s.npcId, s.text);
  if (rules.confident || !client) return rules.verdict;
  return (await askJudge(s, client)) ?? rules.verdict;
}
