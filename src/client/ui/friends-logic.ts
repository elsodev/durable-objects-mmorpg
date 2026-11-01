// Pure helpers for the Friends panel (no DOM), tested in test/fe-friends.test.ts.
import { FRIEND_NAME_HINT, FRIEND_NAME_RE } from "../../shared/friends";

/** Polling interval for GET /api/friends while the panel is open. */
export const FRIENDS_POLL_MS = 20_000;
/** A Remove click arms the button; a second click within this window confirms. */
export const CONFIRM_MS = 3000;
/** Touch hold that opens the player menu. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;

const ZONE_LABELS: Record<string, string> = {
  village: "Village",
  riverside: "Riverside",
  caves: "Caves",
  home: "At home",
};

export function zoneLabel(online: boolean, zone: string | null): string {
  if (!online) return "Offline";
  if (!zone) return "Online";
  return ZONE_LABELS[zone] ?? zone.charAt(0).toUpperCase() + zone.slice(1);
}

/** Error to show for the add-friend input, or null when the name can be sent. */
export function addNameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Type a player's name.";
  return FRIEND_NAME_RE.test(name) ? null : FRIEND_NAME_HINT;
}

/** Badge text for a count ("" hides it; caps at 99+). */
export function badgeText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n > 99 ? "99+" : String(Math.floor(n));
}

export function whisperPrefill(name: string): string {
  return `/w ${name} `;
}

export function inviteCommand(name: string): string {
  return `/invite ${name}`;
}
