// Player-to-player trading: limits, the offer and window shapes, the `/trade` chat command and the
// socket messages. Shared by ZoneRoom (src/worker/game/trades.ts) and the client trade window.
// Pure: no DOM, no Workers APIs. The rules themselves live in shared/engine/trade.ts.
import type { ItemId } from "./types";

/** Different stacks one side may put in the trade window. */
export const TRADE_SLOTS = 9;
/** Tiles between two players for a request or an answer. */
export const TRADE_RANGE = 6;
/** Past this many tiles apart an open trade is called off (a little slack over TRADE_RANGE). */
export const TRADE_LEAVE_RANGE = 8;
/** A request nobody answered is gone after this long. */
export const TRADE_ASK_MS = 30_000;
/** Largest coin offer a message may carry (far above any purse; the bag decides the real limit). */
export const MAX_TRADE_COINS = 10_000_000;

/** One stack in a trade window: an item (and quality) and how many. */
export interface TradeItem {
  item: ItemId;
  qty: number;
  quality?: number;
}

/** What one side puts up. */
export interface TradeOffer {
  items: TradeItem[];
  coins: number;
}

/** The trade window as one side sees it. */
export interface TradeView {
  /** The other player: entity id and name. */
  with: { id: string; name: string };
  mine: TradeOffer;
  theirs: TradeOffer;
  ready: { mine: boolean; theirs: boolean };
  /** Pressed the final Trade button (only possible while both are ready). */
  confirmed: { mine: boolean; theirs: boolean };
}

export type TradeServerMsg =
  /** Someone nearby asks you to trade; answer with tradeAnswer before `expiresAt` (server ms). */
  | { t: "tradeAsk"; from: string; name: string; expiresAt: number }
  /** A request to you was withdrawn or ran out (they left, started another trade...). */
  | { t: "tradeAskGone"; from: string }
  /** The trade window opened or changed. */
  | { t: "trade"; view: TradeView }
  /** The trade window closed: `done` when the swap went through, else why it was called off. */
  | { t: "tradeEnd"; done: boolean; reason: string };

/** `/trade name` typed in chat; null for anything else. */
export function parseTradeCommand(text: string): { name: string } | null {
  const m = /^\/trade(?:\s+(.*))?$/i.exec(text.trim());
  if (!m) return null;
  return { name: (m[1] ?? "").trim() };
}

export function emptyOffer(): TradeOffer {
  return { items: [], coins: 0 };
}
