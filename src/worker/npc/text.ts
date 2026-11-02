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

// Tool calls a model writes out as text instead of calling them: `walk_to(placeId="x")`,
// `<function=walk_to>{...}</function>`, `[TOOL_CALLS]`, `<|python_tag|>`, JSON objects.
const TOOL_MARKUP = /<\|[^|>]*\|>|\[\/?TOOL_CALLS?\]|<\/?(function|tool_call|tool)[^>]*>/gi;
const CALL = /\b[A-Za-z_][\w.]*\s*\(([^()]*)\)/g;
const JSON_OBJ = /\{[^{}]*\}/g;
/** Tool and argument names, loosely (any case, with or without underscores). "remember" is left out: villagers say it. */
const TOOLISH = /\b(give_?gift|open_?shop|set_?mood|suggest_?quest|walk_?to|place_?id|function|tool_?call|parameters|arguments)\b/i;

/** True when a call's arguments look like code (`a="b"`, `a: 1`, quoted strings), not speech in brackets. */
function codeArgs(args: string): boolean {
  return /["'`]|\w\s*[=:]/.test(args) || args.trim() === "";
}

/** A line with any written-out tool call removed; what's left may still be speech. */
export function stripToolText(line: string): string {
  let s = line.replace(TOOL_MARKUP, " ");
  s = s.replace(JSON_OBJ, (m) => (/["']\s*:/.test(m) ? " " : m));
  s = s.replace(CALL, (m, args: string) => (codeArgs(args) || TOOLISH.test(m) ? " " : m));
  return s.replace(/\s+/g, " ").trim();
}

/** Text that still reads like a tool call or code after stripping: never shown to players. */
function looksLikeCode(s: string): boolean {
  return TOOLISH.test(s) && /[(){}=_]/.test(s);
}

/**
 * Turns raw model output into a single spoken line, or null when it is unusable
 * (empty, broke character, leaked the prompt, or only a tool call written out as text).
 */
export function sanitizeLine(raw: unknown, npcName: string): string | null {
  if (typeof raw !== "string") return null;
  const first = raw
    .split(/\r?\n/)
    .map((l) => stripToolText(stripControls(l).replace(/\s+/g, " ").trim()))
    .find((l) => /[A-Za-z]{2}/.test(l) && !looksLikeCode(l));
  if (!first) return null;
  let s = first.replace(/[*_`#<>{}[\]|=]/g, "").trim();
  // Drop a leading speaker tag like "Bram:".
  s = s.replace(new RegExp(`^(${escapeRe(npcName)}|npc)\\s*[:\\-–]\\s*`, "i"), "");
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (!/[A-Za-z]{2}/.test(s) || BROKE_CHARACTER.test(s)) return null;
  return clampLine(s);
}
