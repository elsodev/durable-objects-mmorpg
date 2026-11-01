// Friends: limits, name rule, HTTP API shapes and notification payloads, shared by the Worker
// (src/worker/friends) and the client panel (src/client/ui/friends.ts). Pure: no DOM, no Workers APIs.

/** Player names that can be looked up (the social branch enforces this on sign-up / rename). */
export const FRIEND_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MAX_FRIENDS = 100;
export const MAX_PENDING_OUT = 20;
/** Friend requests (POST /api/friends/request) per user per window. */
export const FRIEND_REQ_RATE_MAX = 10;
export const FRIEND_REQ_RATE_WINDOW_MS = 60 * 60_000;

export interface FriendEntry {
  userId: string;
  name: string;
  online: boolean;
  /** Zone the friend is in, only while online; never sent for pending requests. */
  zone: string | null;
  since: number;
}

export interface FriendRequestEntry {
  userId: string;
  name: string;
  at: number;
}

/** GET /api/friends */
export interface FriendsList {
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
  limits: { maxFriends: number; maxPendingOut: number };
}

/** POST /api/friends/request -> "requested" (201) or "accepted" (they had already asked you). */
export interface FriendRequestResult {
  status: "requested" | "accepted";
  user: { userId: string; name: string };
}

/** Delivered through the social socket as `{ t: "social", payload }`. */
export type FriendNotice =
  | { t: "friendRequest"; fromId: string; fromName: string }
  | { t: "friendAccepted"; userId: string; name: string }
  | { t: "friendRemoved"; userId: string };

export const FRIEND_NOTICE_TYPES: readonly FriendNotice["t"][] = ["friendRequest", "friendAccepted", "friendRemoved"];

/** Trimmed name if it is a valid player name, else null. */
export function cleanFriendName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return FRIEND_NAME_RE.test(name) ? name : null;
}

/** Message for a name that fails FRIEND_NAME_RE (client and server say the same thing). */
export const FRIEND_NAME_HINT = "Names are 3-16 letters, numbers or _.";

/** Better Auth ids are opaque short strings; cap and restrict them before they reach SQL or URLs. */
export function isUserId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

/** `/friend name` typed in chat -> the name (possibly invalid), or null when it isn't that command. */
export function parseFriendCommand(text: string): { name: string } | null {
  const m = /^\/friend(?:\s+(.*))?$/i.exec(text.trim());
  if (!m) return null;
  return { name: (m[1] ?? "").trim() };
}

/** Friends list order: online first, then by name (case-insensitive). */
export function sortFriends(list: FriendEntry[]): FriendEntry[] {
  return [...list].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
