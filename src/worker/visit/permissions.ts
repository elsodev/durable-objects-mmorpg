// What a visitor may do in someone else's home: walk, talk, emote, and help harvest ready crops. Checked
// by HomeRoom on every visitor message. The table is keyed by every ClientMsg type, so a new
// message type fails to compile until someone decides whether visitors may send it.
import type { ClientMsg } from "../../shared/protocol";

export type VisitorAction = "move" | "chat" | "emote" | "ping" | "harvest";
export type VisitorVerdict = { allow: VisitorAction } | { deny: string };

const NOT_YOURS = "Only the owner can do that here.";

export const VISITOR_RULES: { readonly [K in ClientMsg["t"]]: VisitorVerdict } = {
  move: { allow: "move" },
  moveTo: { allow: "move" },
  chat: { allow: "chat" },
  emote: { allow: "emote" },
  ping: { allow: "ping" },
  // `use` only ever harvests a ready crop for a visitor; the slot is ignored (no tools, no seeds).
  use: { allow: "harvest" },
  interact: { deny: NOT_YOURS },
  place: { deny: "Only the owner can arrange furniture." },
  moveObject: { deny: "Only the owner can arrange furniture." },
  pickup: { deny: "Only the owner can arrange furniture." },
  buy: { deny: "Visit the village for that." },
  sell: { deny: "Visit the village for that." },
  donate: { deny: "Visit the village for that." },
  giftNpc: { deny: "Visit the village for that." },
  setLook: { deny: "Change clothes at your own home." },
  eat: { deny: "That isn't yours to eat." },
  sleep: { deny: "You can't sleep in someone else's bed." },
  unship: { deny: NOT_YOURS },
};

export function visitorVerdict(msg: ClientMsg): VisitorVerdict {
  return VISITOR_RULES[msg.t] ?? { deny: NOT_YOURS };
}
