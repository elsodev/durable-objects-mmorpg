// Trade rules between two players: editing an offer against your own bag, the Ready / Trade
// handshake, and the final swap. Offers never take items out of a bag while the window is open;
// they name stacks (item + quality) and amounts, and settleTrade checks both bags again and plans
// the whole swap on copies, so it either applies in full or not at all.
import type { Inventory, InventorySlot, ItemId } from "../types";
import { getItem, isWardrobeItem } from "../items";
import { addItem, gridOf } from "./inventory";
import { TRADE_SLOTS, type TradeItem, type TradeOffer } from "../trade";

export type TradeSide = 0 | 1;

export interface TradeState {
  offers: [TradeOffer, TradeOffer];
  ready: [boolean, boolean];
  confirmed: [boolean, boolean];
}

const q = (s: { quality?: number }): number => s.quality ?? 0;
const sameKey = (a: { item: ItemId; quality?: number }, b: { item: ItemId; quality?: number }): boolean =>
  a.item === b.item && q(a) === q(b);

/** Known items only, and never the house's own wardrobe. */
export function isTradable(item: ItemId): boolean {
  return !!getItem(item) && !isWardrobeItem(item);
}

/** How many of an item at a quality the bag holds, across stacks. */
export function countStack(inv: Inventory, key: { item: ItemId; quality?: number }): number {
  let n = 0;
  for (const s of inv.slots) if (s && sameKey(s, key)) n += s.qty;
  return n;
}

/** Takes `qty` of an item at a quality, last slots first (the hotbar stays put). False: unchanged. */
export function takeStack(inv: Inventory, key: { item: ItemId; quality?: number }, qty: number): boolean {
  if (!Number.isInteger(qty) || qty <= 0 || countStack(inv, key) < qty) return false;
  let left = qty;
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i];
    if (!s || !sameKey(s, key)) continue;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    if (s.qty === 0) inv.slots[i] = null;
  }
  return true;
}

function entryOf(s: InventorySlot, qty: number): TradeItem {
  return q(s) ? { item: s.item, qty, quality: q(s) } : { item: s.item, qty };
}

const copyOffer = (o: TradeOffer): TradeOffer => ({ items: o.items.map((i) => ({ ...i })), coins: o.coins });

/**
 * Puts up to `qty` from bag slot `slot` into the offer (merging with the same stack already in
 * it, and never more than the bag holds). Returns the new offer, or why not.
 */
export function offerAdd(offer: TradeOffer, inv: Inventory, slot: number, qty: number): TradeOffer | string {
  const s = Number.isInteger(slot) && slot >= 0 ? inv.slots[slot] : undefined;
  if (!s) return "That slot is empty.";
  if (!isTradable(s.item)) return "That can't be traded.";
  if (!Number.isInteger(qty) || qty <= 0) return "Pick how many to trade.";
  const out = copyOffer(offer);
  const have = out.items.find((e) => sameKey(e, s));
  const free = countStack(inv, s) - (have?.qty ?? 0);
  if (free <= 0) return "All of those are in the trade already.";
  const n = Math.min(qty, free);
  if (have) have.qty += n;
  else if (out.items.length >= TRADE_SLOTS) return "The trade window is full.";
  else out.items.push(entryOf(s, n));
  return out;
}

/** Takes `qty` (default: all) of offer entry `index` back out. */
export function offerRemove(offer: TradeOffer, index: number, qty?: number): TradeOffer | string {
  const e = Number.isInteger(index) && index >= 0 ? offer.items[index] : undefined;
  if (!e) return "That isn't in the trade.";
  const out = copyOffer(offer);
  const n = qty === undefined ? e.qty : Math.min(e.qty, qty);
  if (!Number.isInteger(n) || n <= 0) return "Pick how many to take back.";
  out.items[index]!.qty -= n;
  if (out.items[index]!.qty === 0) out.items.splice(index, 1);
  return out;
}

/** Sets the coins in the offer; you can't offer more than you carry. */
export function offerCoins(offer: TradeOffer, inv: Inventory, coins: number): TradeOffer | string {
  if (!Number.isInteger(coins) || coins < 0) return "That isn't an amount of coins.";
  if (coins > inv.coins) return "You don't have that many coins.";
  return { ...copyOffer(offer), coins };
}

/**
 * The offer cut down to what the bag still holds (after selling, dropping or eating something
 * mid-trade). Returns the same object when nothing had to change.
 */
export function fitOffer(offer: TradeOffer, inv: Inventory): TradeOffer {
  let changed = offer.coins > inv.coins;
  const items: TradeItem[] = [];
  for (const e of offer.items) {
    const n = Math.min(e.qty, countStack(inv, e));
    if (n !== e.qty) changed = true;
    if (n > 0) items.push({ ...e, qty: n });
  }
  return changed ? { items, coins: Math.min(offer.coins, inv.coins) } : offer;
}

export function sameOffer(a: TradeOffer, b: TradeOffer): boolean {
  if (a.coins !== b.coins || a.items.length !== b.items.length) return false;
  return a.items.every((e, i) => sameKey(e, b.items[i]!) && e.qty === b.items[i]!.qty);
}

export const isEmptyOffer = (o: TradeOffer): boolean => o.coins === 0 && o.items.length === 0;

export function newTrade(): TradeState {
  return { offers: [{ items: [], coins: 0 }, { items: [], coins: 0 }], ready: [false, false], confirmed: [false, false] };
}

/**
 * One side's offer changed. Any real change takes both players back to not ready, so nobody can
 * swap something out after the other side agreed.
 */
export function withOffer(state: TradeState, side: TradeSide, offer: TradeOffer): TradeState {
  if (sameOffer(state.offers[side], offer)) return state;
  const offers: [TradeOffer, TradeOffer] = [state.offers[0], state.offers[1]];
  offers[side] = offer;
  return { offers, ready: [false, false], confirmed: [false, false] };
}

/** Ready (or not). Taking it back also clears any Trade press, on both sides. */
export function withReady(state: TradeState, side: TradeSide, ready: boolean): TradeState {
  const r: [boolean, boolean] = [...state.ready];
  r[side] = ready;
  return { offers: state.offers, ready: r, confirmed: ready ? state.confirmed : [false, false] };
}

/** The final Trade press: only once both are ready and something is on the table. */
export function withConfirm(state: TradeState, side: TradeSide): TradeState | string {
  if (!state.ready[0] || !state.ready[1]) return "Both of you need to be ready first.";
  if (isEmptyOffer(state.offers[0]) && isEmptyOffer(state.offers[1])) return "There's nothing to trade yet.";
  const c: [boolean, boolean] = [...state.confirmed];
  c[side] = true;
  return { ...state, confirmed: c };
}

export const bothConfirmed = (s: TradeState): boolean => s.confirmed[0] && s.confirmed[1];

export type SettleFail = "a_missing" | "b_missing" | "a_full" | "b_full";

/**
 * The swap, planned on copies: each bag gives up its own offer (which frees room) and then takes
 * the other's. Either both new bags come back, or the reason nothing may change.
 */
export function settleTrade(
  invA: Inventory,
  offerA: TradeOffer,
  invB: Inventory,
  offerB: TradeOffer,
): { a: Inventory; b: Inventory } | { fail: SettleFail } {
  const a: Inventory = { coins: invA.coins, slots: gridOf(invA.slots) };
  const b: Inventory = { coins: invB.coins, slots: gridOf(invB.slots) };
  const give = (inv: Inventory, o: TradeOffer): boolean => {
    if (!Number.isInteger(o.coins) || o.coins < 0 || inv.coins < o.coins) return false;
    for (const e of o.items) if (!isTradable(e.item) || !takeStack(inv, e, e.qty)) return false;
    inv.coins -= o.coins;
    return true;
  };
  const take = (inv: Inventory, o: TradeOffer): boolean => {
    for (const e of o.items) if (!addItem(inv, e.item, e.qty, q(e) || undefined)) return false;
    inv.coins += o.coins;
    return true;
  };
  if (!give(a, offerA)) return { fail: "a_missing" };
  if (!give(b, offerB)) return { fail: "b_missing" };
  if (!take(a, offerB)) return { fail: "a_full" };
  if (!take(b, offerA)) return { fail: "b_full" };
  return { a, b };
}
