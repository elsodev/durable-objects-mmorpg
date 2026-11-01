// Pure helpers for the mailbox panel and its flag (no DOM).
import type { FriendRequestEntry } from "../../shared/friends";

/** A friend request is "read" once the mailbox has been opened while it was listed. */
export function requestKey(r: Pick<FriendRequestEntry, "userId" | "at">): string {
  return `${r.userId}:${r.at}`;
}

export function unseenRequests(reqs: readonly FriendRequestEntry[], seen: ReadonlySet<string>): number {
  return reqs.filter((r) => !seen.has(requestKey(r))).length;
}

/** Flag up while the server has unread mail or a friend request arrived since the last look. */
export function flagUp(serverUnread: number, reqs: readonly FriendRequestEntry[], seen: ReadonlySet<string>): boolean {
  return serverUnread > 0 || unseenRequests(reqs, seen) > 0;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "expires in 4m" / "expired". */
export function expiresIn(expiresAt: number, now: number): string {
  const s = Math.floor((expiresAt - now) / 1000);
  if (s <= 0) return "expired";
  return s < 60 ? `expires in ${s}s` : `expires in ${Math.ceil(s / 60)}m`;
}

const SEEN_KEY = "dmmo.mailbox.seenRequests";

/** Friend requests already seen in the mailbox; browser storage is only a convenience. */
export function loadSeen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string").slice(-200) : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    // private mode: the flag just comes back next session
  }
}
