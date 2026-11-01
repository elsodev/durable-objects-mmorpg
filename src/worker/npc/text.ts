// Line helpers: scripted picks and sanitizing LLM output into one safe line.
import type { Intent, NpcDef } from "./brain";

export const MAX_LINE = 200;
export const MAX_PLAYER_TEXT = 200;
const MAX_NAME = 24;

// C0/C1 controls and line/paragraph separators become spaces; format chars (\p{Cf}: zero-width,
// bidi overrides and isolates, BOM, soft hyphen...) are removed outright.
const CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const FORMAT = /\p{Cf}/gu;

export function stripControls(s: string): string {
  return s.replace(FORMAT, "").replace(CONTROLS, " ");
}

/** Player names are user-chosen: keep them short and printable before putting them in a line. */
export function safeName(name: string): string {
  const clean = stripControls(name).replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return clean || "friend";
}

/** Untrusted player text for prompts: one line, capped. */
export function safePlayerText(text: string): string {
  return stripControls(text).replace(/\s+/g, " ").trim().slice(0, MAX_PLAYER_TEXT);
}

export function fillName(line: string, playerName: string): string {
  return line.split("{name}").join(safeName(playerName));
}

export function pickLine(
  npc: NpcDef,
  key: Intent | "idle" | "thinking_fail",
  playerName: string,
  rand: () => number = Math.random,
): string {
  const own = npc.lines[key];
  const pool = own && own.length > 0 ? own : npc.lines.thinking_fail?.length ? npc.lines.thinking_fail : ["..."];
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)));
  return clampLine(fillName(pool[i], playerName));
}

/** Cuts to MAX_LINE at a word boundary when possible. */
export function clampLine(s: string): string {
  if (s.length <= MAX_LINE) return s;
  const cut = s.slice(0, MAX_LINE - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > MAX_LINE * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

const BROKE_CHARACTER =
  /\b(as an ai|language model|system prompt|my instructions|i am an ai|i'm an ai|openai|llama|meta ai|assistant:|ignore (all |the )?previous)/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turns raw model output into a single spoken line, or null when it is unusable
 * (empty, broke character, leaked the prompt).
 */
export function sanitizeLine(raw: unknown, npcName: string): string | null {
  if (typeof raw !== "string") return null;
  const first = raw
    .split(/\r?\n/)
    .map((l) => stripControls(l).replace(/\s+/g, " ").trim())
    .find((l) => l.length > 0);
  if (!first) return null;
  let s = first.replace(/[*_`#<>]/g, "").trim();
  // Drop a leading speaker tag like "Bram:".
  s = s.replace(new RegExp(`^(${escapeRe(npcName)}|npc)\\s*[:\\-–]\\s*`, "i"), "");
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (!s || BROKE_CHARACTER.test(s)) return null;
  return clampLine(s);
}
