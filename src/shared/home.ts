// Home simulation protocol: day clock, stamina, watering can, shipping bin, sleep and the
// end-of-day summary. Appended to ClientMsg / ServerMsg in protocol.ts.
import type { FarmTile, ItemId } from "./types";
import type { HomeClock } from "./engine/homeclock";
import type { MailServerMsg } from "./mail";

export type HomeClientMsg =
  /** Eat one of the (edible) item in an inventory slot: restores stamina. Home only. */
  | { t: "eat"; slot: number; req?: string }
  /** Go to sleep (the client asked "Go to sleep? The day will end." first). Must be near a bed. */
  | { t: "sleep" }
  /** Take the last shipped stack back out of the shipping bin (same day only). */
  | { t: "unship"; req?: string };

export interface ShipLine {
  item: ItemId;
  qty: number;
  /** Coins this line pays at the end of the day. */
  coins: number;
}

export interface DaySummary {
  /** The day that ended. */
  day: number;
  /** Shipping bin payout, one line per item id (quality crops are their own ids). */
  lines: ShipLine[];
  total: number;
  /** Crops the crows ate this morning. */
  crows: { x: number; y: number; crop: ItemId }[];
  /** Empty tilled tiles that went back to grass. */
  reverted: number;
  /** Crops that grew a stage overnight. */
  grown: number;
  /** Growing crops that wilted for lack of water (water them today to revive them). */
  wilted?: number;
  /** Crops that died of thirst. */
  died?: { x: number; y: number; crop: ItemId }[];
  /** Stayed up past 2:00. */
  passedOut: boolean;
  /** Coins lost for passing out. */
  penalty: number;
  /** The day ended while you were away (paid when you came home). */
  away?: boolean;
}

export type HomeServerMsg =
  /** Clock, stamina and watering can. Sent after welcome at home and whenever one changes. */
  | {
      t: "homeState";
      clock: HomeClock;
      stamina: number;
      maxStamina: number;
      water: number;
      maxWater: number;
      serverTime: number;
    }
  /** Shipping bin contents (paid at the end of the day). `open` asks the client to show the panel. */
  | { t: "bin"; items: ShipLine[]; total: number; open?: boolean }
  /** The whole farm (replaces the client's copy, e.g. after a day end removed tiles). */
  | { t: "farmAll"; tiles: FarmTile[] }
  /** Someone is going to sleep: the day ends at `endsAt` (countdown for anyone else at home). */
  | { t: "sleeping"; host: string; endsAt: number }
  /** A new morning: the end-of-day summary. */
  | { t: "daySummary"; summary: DaySummary }
  | MailServerMsg;

const isSlot = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
const optReq = (o: Record<string, unknown>): { req?: string } | null => {
  if (o.req === undefined) return {};
  return typeof o.req === "string" && o.req.length > 0 && o.req.length <= 64 ? { req: o.req } : null;
};

/** Validates the home client messages (called from validate.ts for types it doesn't know). */
export function validateHomeClientMsg(o: Record<string, unknown>): HomeClientMsg | null {
  const req = optReq(o);
  if (!req) return null;
  switch (o.t) {
    case "eat":
      return isSlot(o.slot) ? { t: "eat", slot: o.slot, ...req } : null;
    case "sleep":
      return { t: "sleep" };
    case "unship":
      return { t: "unship", ...req };
    default:
      return null;
  }
}
