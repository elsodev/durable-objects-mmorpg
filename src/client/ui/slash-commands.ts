// Chat slash commands: the one table the "/" suggestion popup reads, and its filter. Pure (no DOM).
// The handlers live in shared/social.ts parseChatInput (/w /r /world /zone /emote),
// shared/friends.ts parseFriendCommand, shared/players.ts parseMuteCommand, shared/visits.ts parseHomeCommand,
// and the dev tools in worker/home.ts devCommand (/day /time) and worker/zone.ts onChat (/hour, /hearts, /warp);
// slash-commands.test.ts checks every entry here against those parsers.
import { EMOTES } from "../../shared/emotes";

/** Where the player is, which decides which commands make sense. */
export interface SlashContext {
  /** In a home (yours or someone else's). */
  atHome: boolean;
  /** In your own home (not visiting). */
  homeOwner: boolean;
  guest: boolean;
  /** Local dev server with DEV_TOOLS on (welcome.devTools). */
  devTools: boolean;
}

export interface SlashCommand {
  name: string;
  aliases: readonly string[];
  /** Argument syntax shown after the name, e.g. "name message". Empty for none. */
  args: string;
  description: string;
  /** Values offered while typing the first argument (e.g. emote codes). */
  options?: readonly string[];
  available(ctx: SlashContext): boolean;
}

const always = () => true;
const account = (c: SlashContext) => !c.guest;
const owner = (c: SlashContext) => c.homeOwner && !c.guest;

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "w", aliases: ["whisper", "msg", "tell", "pm"], args: "name message", description: "Whisper to a player", available: account },
  { name: "r", aliases: ["reply"], args: "message", description: "Reply to the last whisper", available: account },
  { name: "world", aliases: ["g", "global"], args: "message", description: "Talk to everyone online", available: account },
  { name: "zone", aliases: ["s", "say"], args: "message", description: "Talk to people nearby", available: always },
  { name: "emote", aliases: ["e", "em"], args: "code", description: "Show an emote over your head", options: EMOTES, available: always },
  { name: "sleep", aliases: ["lie", "nap"], args: "", description: "Lie down on the ground (move to get up)", available: always },
  { name: "meditate", aliases: ["meditation"], args: "", description: "Sit cross-legged and meditate (move to get up)", available: always },
  { name: "piss", aliases: ["pee"], args: "", description: "Relieve yourself (villagers who see it won't forgive you)", available: always },
  { name: "friend", aliases: [], args: "name", description: "Send a friend request", available: account },
  { name: "mute", aliases: [], args: "name", description: "Hide a player's chat and requests", available: account },
  { name: "unmute", aliases: [], args: "name", description: "Show a muted player again", available: account },
  { name: "invite", aliases: [], args: "name", description: "Invite a friend to your home", available: owner },
  { name: "kick", aliases: [], args: "name", description: "Send a visitor home", available: owner },
  { name: "uninvite", aliases: [], args: "name", description: "Take back an invitation", available: owner },
  { name: "day", aliases: [], args: "", description: "Dev: end the day now", available: (c) => c.devTools && c.homeOwner },
  { name: "time", aliases: [], args: "hour", description: "Dev: set your home clock, e.g. /time 21", available: (c) => c.devTools && c.homeOwner },
  { name: "hour", aliases: [], args: "hour", description: "Dev: run village routines as if at this UTC hour", available: (c) => c.devTools && !c.atHome },
  { name: "hearts", aliases: [], args: "n", description: "Dev: put the nearest villager one point short of n hearts", available: (c) => c.devTools && !c.atHome },
  { name: "warp", aliases: [], args: "zone [spawn]", description: "Dev: walk straight into another zone, e.g. /warp caves_3_top", available: (c) => c.devTools && !c.atHome },
];

export interface SlashSuggestion {
  /** Stable key for the list item. */
  key: string;
  /** What the row shows in bold: "/w" or an argument value like "wave". */
  label: string;
  /** Syntax shown after the label, e.g. "name message". */
  syntax: string;
  description: string;
  /** Input text after choosing this row. */
  completion: string;
}

export const MAX_SUGGESTIONS = 16;

/**
 * Suggestions for the chat input. "/" lists every command available here; "/em" narrows it by
 * name or alias; "/emote wa" lists matching emote codes. Anything else gives none.
 */
export function slashSuggestions(input: string, ctx: SlashContext, commands: readonly SlashCommand[] = SLASH_COMMANDS): SlashSuggestion[] {
  if (!input.startsWith("/")) return [];
  const m = /^\/(\S*)(\s+(\S*))?$/.exec(input);
  if (!m) return [];
  const word = m[1]!.toLowerCase();
  const usable = commands.filter((c) => c.available(ctx));

  if (m[2] === undefined) {
    // Still typing the command name: exact names first, then name prefixes, then alias prefixes.
    const rank = (c: SlashCommand): number => {
      if (c.name === word) return 0;
      if (c.name.startsWith(word)) return 1;
      if (c.aliases.some((a) => a === word)) return 2;
      if (c.aliases.some((a) => a.startsWith(word))) return 3;
      return -1;
    };
    return usable
      .map((c, i) => ({ c, r: rank(c), i }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, MAX_SUGGESTIONS)
      .map(({ c }) => ({
        key: c.name,
        label: `/${c.name}`,
        syntax: c.args,
        description: c.description,
        completion: c.args ? `/${c.name} ` : `/${c.name}`,
      }));
  }

  // Typing the first argument: offer the command's options (emote codes).
  const cmd = usable.find((c) => c.name === word || c.aliases.includes(word));
  if (!cmd?.options) return [];
  const arg = (m[3] ?? "").toLowerCase();
  return cmd.options
    .filter((o) => o.startsWith(arg))
    .slice(0, MAX_SUGGESTIONS)
    .map((o) => ({ key: `${cmd.name}:${o}`, label: o, syntax: "", description: "", completion: `/${word} ${o}` }));
}

/** Moves a highlighted row by `delta`, wrapping; -1 when the list is empty. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return (((index + delta) % count) + count) % count;
}

/** Whether Enter should complete the highlighted row instead of sending: only when it changes the text. */
export function enterCompletes(input: string, s: SlashSuggestion | undefined): boolean {
  return !!s && s.completion !== input;
}
