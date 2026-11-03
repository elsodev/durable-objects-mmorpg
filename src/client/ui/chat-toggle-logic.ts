// Whether the chat box is folded away on a phone. Pure (storage is passed in) so it's unit-tested.

export const CHAT_HIDDEN_KEY = "dmmo.chatHidden";

/** Chat starts hidden unless the player opened it last time. Storage may be missing or throw. */
export function initialChatHidden(read: () => string | null): boolean {
  try {
    return read() !== "0";
  } catch {
    return true;
  }
}

/** Which new lines light the toggle's dot while the chat is hidden: people talking, not system notes. */
export function lineWakesDot(kind: "player" | "npc" | "system"): boolean {
  return kind !== "system";
}
