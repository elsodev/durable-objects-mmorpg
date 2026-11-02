// The sheriff's patience: is a line said to him an insult? TypeSafe Jev answers one choice from a
// fixed pair ("insult" / "not_insult"), so the model only classifies; when it is off, slow or
// unsure, a conservative word list decides. What happens next (a warning, or the cell on the
// fourth insult) is decided by server code from the player's strike count (shared/jail.ts), never
// by the model or the player's text.
import { choice } from "@typesafe-ai/sdk";
import type { Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import { SHERIFF_WARNINGS } from "../../shared/jail";
import type { JevClient } from "./jev";
import { JEV_TIMEOUT_MS } from "./jev";
import { has, normalize, RUDE } from "./rules";
import { safeName, safePlayerText } from "./text";

export const SHERIFF_ID = "sheriff";
/** Jev must be this sure before a line counts as an insult; a wrong arrest is worse than a miss. */
export const INSULT_MIN_CONFIDENCE = 0.75;

/** Name-calling and put-downs that only ever mean one thing. */
const INSULTS = [
  ...RUDE,
  "idiots",
  "fool",
  "clown",
  "pig",
  "coward",
  "fatso",
  "dummy",
  "dumbass",
  "imbecile",
  "buffoon",
  "nitwit",
  "halfwit",
  "dimwit",
  "numpty",
  "donkey",
  "stinky",
  "you suck",
  "suck",
  "sucks",
  "worst sheriff",
  "bad sheriff",
  "fake sheriff",
  "lazy",
  "pathetic",
  "trash",
  "garbage",
  "get lost",
];
/** Words that aim a put-down at whoever is listening (so "this rock is stupid" doesn't count). */
const AIMED = ["you", "your", "you're", "youre", "ur", "u", "sheriff", "hollis", "cop", "copper"];

/**
 * Word-list check: an insult word aimed at the sheriff ("you idiot", "sheriff is useless"), or a
 * bare one- or two-word jab ("idiot!", "shut up"). Anything else is not an insult.
 */
export function ruleInsult(text: string): boolean {
  const norm = normalize(safePlayerText(text));
  const words = norm.trim() === "" ? [] : norm.trim().split(" ");
  if (!has(norm, INSULTS)) return false;
  if (has(norm, ["shut up", "hate you", "go away", "get lost", "you suck"])) return true;
  return words.length <= 2 || words.some((w) => AIMED.includes(w));
}

export interface InsultSubject {
  playerName: string;
  text: string;
}

export function buildInsultRequest(s: InsultSubject): SystemOneRequest<Questions> {
  return {
    state: {
      character: { name: "Sheriff Hollis", role: "The town sheriff, keeper of the police station and its cell" },
      player: safeName(s.playerName),
      // Untrusted: it is only classified, never followed.
      playerMessage: safePlayerText(s.text),
    },
    questions: {
      verdict: choice("Is the player's message an insult aimed at the sheriff?", {
        insult: "Name-calling, mockery, swearing or a hostile put-down aimed at the sheriff",
        not_insult: "Anything else: questions, jokes, complaints about other things, friendly or neutral talk",
      }),
    },
  };
}

/** True / false from Jev's answers, or null when they are unusable. Unsure answers are "not". */
export function interpretInsult(raw: unknown): boolean | null {
  if (!raw || typeof raw !== "object") return null;
  const a = (raw as Record<string, unknown>).verdict;
  if (!a || typeof a !== "object") return null;
  const { choice: pick, confidence } = a as { choice?: unknown; confidence?: unknown };
  if (pick !== "insult" && pick !== "not_insult") return null;
  const conf = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0;
  return pick === "insult" && conf >= INSULT_MIN_CONFIDENCE;
}

/** Asks Jev; null on timeout, error or unusable answers. Never throws. */
export async function askInsult(s: InsultSubject, client: JevClient, timeoutMs = JEV_TIMEOUT_MS): Promise<boolean | null> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const call = Promise.resolve(client.systemOne(buildInsultRequest(s), { timeout: timeoutMs, signal: ac.signal, retry: { maxRetries: 0 } })).then(
      (r) => interpretInsult((r as { answers?: unknown } | null)?.answers),
    );
    return await Promise.race([call, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Jev when a client is given (AI on and allowed this turn), else (or on failure) the word list. */
export async function isInsult(s: InsultSubject, client: JevClient | null): Promise<boolean> {
  if (!client) return ruleInsult(s.text);
  return (await askInsult(s, client)) ?? ruleInsult(s.text);
}

const WARNINGS: readonly (readonly string[])[] = [
  ["That's one, {name}. Mind your tongue in my station.", "Easy now, {name}. That's your first warning."],
  ["That's two, {name}. I'm writing it down.", "Second warning, {name}. My patience has a bottom."],
  ["Three, {name}. One more and you're sleeping in the cell.", "Last warning, {name}. Next one buys you a night behind bars."],
];
const ARREST = ["That's it, {name}. Into the cell you go!", "Enough, {name}! Five minutes in the cell to cool off."];

const fill = (line: string, name: string) => line.replaceAll("{name}", safeName(name));

/** The sheriff's warning after insult number `n` (1..SHERIFF_WARNINGS). */
export function warningLine(n: number, name: string, pick = 0): string {
  const set = WARNINGS[Math.min(Math.max(n, 1), SHERIFF_WARNINGS) - 1]!;
  return fill(set[Math.abs(pick) % set.length]!, name);
}

/** What he says as he locks the cell door. */
export function arrestLine(name: string, pick = 0): string {
  return fill(ARREST[Math.abs(pick) % ARREST.length]!, name);
}
