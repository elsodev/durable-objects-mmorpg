// Pure chat helpers (no DOM) so they can be unit tested and typechecked with the Worker config.
import { cleanChat } from "../../shared/validate";
import { CHAT_TABS, type ChatChannel, type ChatTab } from "../../shared/social";


export const MAX_LOG_LINES = 100;
export const MAX_NAME_LEN = 32;
/** Log fades after this long without new lines or interaction. */
export const IDLE_FADE_MS = 10_000;
/** Within this many px of the bottom counts as "following" the log. */
export const STICK_PX = 24;

/** Stable hue (0..359) for a name, so each speaker keeps one color. FNV-1a. */
export function nameHue(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

export function nameColor(name: string): string {
  return `hsl(${nameHue(name)} 70% 72%)`;
}

/** Text the input should send, or null when there is nothing to send. */
export function outgoingText(raw: string): string | null {
  return cleanChat(raw);
}

/** Sanitized display copy of an incoming line (server already cleans; this is defence in depth). */
export function displayLine(name: string, text: string): { name: string; text: string } {
  const n = (cleanChat(name) ?? "").slice(0, MAX_NAME_LEN);
  return { name: n, text: cleanChat(text) ?? "" };
}

// ---------------------------------------------------------------- channels & tabs


/** The tab after (or before, with step -1) `t`, wrapping around. Tab and Shift+Tab use it. */
export function cycleTab(t: ChatTab, step: 1 | -1 = 1): ChatTab {
  const i = CHAT_TABS.indexOf(t);
  return CHAT_TABS[(i + step + CHAT_TABS.length) % CHAT_TABS.length]!;
}

export const TAB_LABELS: Record<ChatTab, string> = { all: "All", world: "World", zone: "Zone", pm: "PM" };

/** Whether a line of `channel` shows under `tab`. System lines show everywhere. */
export function lineVisible(tab: ChatTab, channel: ChatChannel): boolean {
  return tab === "all" || channel === "system" || tab === channel;
}

/** Tabs that should light an unread dot when a `channel` line arrives while `active` is selected. */
export function unreadTabs(active: ChatTab, channel: ChatChannel): ChatTab[] {
  if (channel === "system") return [];
  const showing: ChatTab[] = ["all", channel];
  return showing.filter((t) => t !== active && !lineVisible(active, channel));
}

/** Short tag in front of a line: "[W]", "[PM]"; zone lines have none. */
export function channelTag(channel: ChatChannel, pm?: "in" | "out"): string {
  if (channel === "world") return "[W]";
  if (channel === "pm") return pm === "out" ? "[PM to]" : "[PM]";
  return "";
}

export function placeholderFor(tab: ChatTab, guest: boolean): string {
  if (tab === "world") return guest ? "Create an account to chat with everyone" : "Say to the world (Enter)";
  if (tab === "pm") return guest ? "Create an account to whisper" : "/w name message, or /r to reply";
  return "Press Enter to chat · /w name · /emote";
}
