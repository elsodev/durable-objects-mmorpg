// What a visitor may do in someone else's home: walk, talk, emote, strike a pose, pet the animals and help harvest ready crops. Checked
// by HomeRoom on every visitor message. The table is keyed by every ClientMsg type, so a new
// message type fails to compile until someone decides whether visitors may send it.
import { visitorMayPose } from "../../shared/poses";
import type { ClientMsg } from "../../shared/protocol";

export type VisitorAction = "move" | "chat" | "emote" | "pose" | "ping" | "harvest" | "hold" | "pet";
export type VisitorVerdict = { allow: VisitorAction } | { deny: string };

const NOT_YOURS = "Only the owner can do that here.";
export const TRADE_ELSEWHERE = "Meet in the village to trade.";

export const VISITOR_RULES: { readonly [K in ClientMsg["t"]]: VisitorVerdict } = {
  move: { allow: "move" },
  moveTo: { allow: "move" },
  chat: { allow: "chat" },
  emote: { allow: "emote" },
  ping: { allow: "ping" },
  // Accepted and ignored: a visitor's bag isn't loaded here, so their hands stay empty.
  hold: { allow: "hold" },
  // `use` only ever harvests a ready crop for a visitor; the slot is ignored (no tools, no seeds).
  use: { allow: "harvest" },
  interact: { deny: NOT_YOURS },
  place: { deny: "Only the owner can arrange furniture." },
  moveObject: { deny: "Only the owner can arrange furniture." },
  pickup: { deny: "Only the owner can arrange furniture." },
  moveObjects: { deny: "Only the owner can arrange furniture." },
  pickupObjects: { deny: "Only the owner can arrange furniture." },
  buy: { deny: "Visit the village for that." },
  sell: { deny: "Visit the village for that." },
  donate: { deny: "Visit the village for that." },
  giftNpc: { deny: "Visit the village for that." },
  npcSay: { deny: "Visit the village for that." },
  setLook: { deny: "Change clothes at your own home." },
  eat: { deny: "That isn't yours to eat." },
  sleep: { deny: "You can't sleep in someone else's bed." },
  unship: { deny: NOT_YOURS },
  moveSlot: { deny: "You can tidy your bag after the visit." },
  dropItem: { deny: "Drop things in your own home." },
  sortBag: { deny: "You can tidy your bag after the visit." },
  // Sitting, waving or dancing is harmless; visitorVerdict still refuses the one pose that isn't.
  pose: { allow: "pose" },
  // A visitor's save lives in their own HomeRoom; the client just leaves the visit instead.
  travel: { deny: "Leave the visit first." },
  storeOpen: { deny: "That isn't yours to open." },
  storePut: { deny: "That isn't yours to open." },
  storeTake: { deny: "That isn't yours to open." },
  storeClose: { deny: "That isn't yours to open." },
  wardrobeOpen: { deny: "That's your host's wardrobe. You can change clothes in your own at home." },
  // Petting is harmless: the pet shows its love, but only the owner's affection is ever kept.
  petAnimal: { allow: "pet" },
  feedAnimal: { deny: "Only the owner feeds their animals." },
  adoptAnimal: { deny: NOT_YOURS },
  // The notice board stands in the village; nothing here reaches it.
  noticePost: { deny: "Visit the village for that." },
  noticeVote: { deny: "Visit the village for that." },
  noticeDelete: { deny: "Visit the village for that." },
  // Trades happen between players out in the shared zones, never inside someone's home.
  tradeRequest: { deny: TRADE_ELSEWHERE },
  tradeAnswer: { deny: TRADE_ELSEWHERE },
  tradeAdd: { deny: TRADE_ELSEWHERE },
  tradeRemove: { deny: TRADE_ELSEWHERE },
  tradeCoins: { deny: TRADE_ELSEWHERE },
  tradeReady: { deny: TRADE_ELSEWHERE },
  tradeConfirm: { deny: TRADE_ELSEWHERE },
  tradeCancel: { deny: TRADE_ELSEWHERE },
};

const NO_POSE: VisitorVerdict = { deny: "Not in someone else's home." };

export function visitorVerdict(msg: ClientMsg): VisitorVerdict {
  if (msg.t === "pose" && !visitorMayPose(msg.pose)) return NO_POSE;
  return VISITOR_RULES[msg.t] ?? { deny: NOT_YOURS };
}
