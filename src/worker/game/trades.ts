// Trades between two players in one zone: requests, the open trade windows, and the swap.
// Held in memory only: a trade that hasn't gone through has changed nothing, so losing it to a
// restart or hibernation costs nothing (bags are never touched until the final swap).
//
// Every edit re-checks the offer against the sender's own bag, any change clears both Ready
// states, and the swap re-checks both bags and plans the whole thing before writing either one,
// in one synchronous step.
import type { ServerMsg } from "../../shared/protocol";
import type { Inventory } from "../../shared/types";
import { dist } from "../../shared/engine";
import {
  bothConfirmed,
  fitOffer,
  newTrade,
  offerAdd,
  offerCoins,
  offerRemove,
  settleTrade,
  withConfirm,
  withOffer,
  withReady,
  type SettleFail,
  type TradeSide,
  type TradeState,
} from "../../shared/engine/trade";
import { TRADE_ASK_MS, TRADE_LEAVE_RANGE, TRADE_RANGE, type TradeOffer, type TradeView } from "../../shared/trade";
import { Throttle } from "../throttle";
import { TokenBucket } from "./rateLimit";

/** What the desk needs of a player (ZoneRoom's ZPlayer has all of it). */
export interface TradeParty {
  userId: string;
  name: string;
  entity: { id: string; x: number; y: number };
  inv: Inventory;
}

export interface TradeHooks<P extends TradeParty> {
  send(p: P, msg: ServerMsg): void;
  /** Both bags were just swapped: save both players and log it. */
  settled(a: P, b: P, gaveA: TradeOffer, gaveB: TradeOffer): void;
}

/** One request per player this often (a declined player can't be pestered every click). */
export const TRADE_ASK_EVERY_MS = 3000;
/** Window edits: a quick burst of clicks, then a few a second. */
const EDIT_BURST = 12;
const EDIT_PER_SEC = 6;

interface Ask<P> {
  from: P;
  to: P;
  expiresAt: number;
}

interface Session<P> {
  parties: [P, P];
  state: TradeState;
}

export class TradeDesk<P extends TradeParty> {
  /** Open requests, by requester. */
  private asks = new Map<string, Ask<P>>();
  /** Open trades, under both players' user ids. */
  private sessions = new Map<string, Session<P>>();
  private askThrottle = new Throttle(TRADE_ASK_EVERY_MS);
  private edits = new Map<string, TokenBucket>();

  constructor(private readonly hooks: TradeHooks<P>) {}

  inTrade(p: P): boolean {
    return this.sessions.get(p.userId)?.parties.includes(p) ?? false;
  }

  /** Ask `to` to trade. Returns why not, or null when the request went out. */
  request(from: P, to: P | undefined, now: number): string | null {
    if (!to) return "They aren't here anymore.";
    if (to === from || to.userId === from.userId) return "You can't trade with yourself.";
    if (this.inTrade(to) && this.sessions.get(to.userId) !== this.sessions.get(from.userId)) return `${to.name} is busy trading.`;
    if (this.inTrade(from) && this.inTrade(to)) return `You're already trading with ${to.name}.`;
    if (dist(from.entity, to.entity) > TRADE_RANGE) return `Walk closer to ${to.name} to trade.`;
    const open = this.asks.get(from.userId);
    if (open && open.to === to && open.expiresAt > now) return `You already asked ${to.name}. Give them a moment.`;
    if (!this.askThrottle.allow(from.userId, now)) return "Wait a moment before asking again.";
    // Asking someone else while a trade is open ends that trade first.
    this.cancel(from, "You asked someone else, so that trade was called off.", `${from.name} asked someone else to trade, so the trade was called off.`);
    // Asking them back answers their own request instead of crossing two prompts.
    const theirs = this.asks.get(to.userId);
    if (theirs && theirs.to === from && theirs.expiresAt > now) return this.answer(from, to, true, now);
    if (open) this.withdraw(open);
    const expiresAt = now + TRADE_ASK_MS;
    this.asks.set(from.userId, { from, to, expiresAt });
    this.hooks.send(to, { t: "tradeAsk", from: from.entity.id, name: from.name, expiresAt });
    this.hooks.send(from, { t: "notice", text: `You asked ${to.name} to trade.`, kind: "info" });
    return null;
  }

  /** Accept or decline `from`'s request. Returns why not, or null. */
  answer(me: P, from: P | undefined, accept: boolean, now: number): string | null {
    const ask = from ? this.asks.get(from.userId) : undefined;
    if (!from || !ask || ask.to !== me || ask.from !== from) return "That request isn't open anymore.";
    this.asks.delete(from.userId);
    if (ask.expiresAt <= now) return "That request ran out.";
    if (!accept) {
      this.hooks.send(from, { t: "notice", text: `${me.name} doesn't want to trade right now.`, kind: "info" });
      return null;
    }
    if (this.sessions.has(me.userId)) return "Finish the trade you have open first.";
    if (this.sessions.has(from.userId)) return `${from.name} is busy trading.`;
    if (dist(me.entity, from.entity) > TRADE_RANGE) return `Walk closer to ${from.name} to trade.`;
    // Starting a trade ends every other request either of them had going.
    for (const a of [...this.asks.values()]) if (a.from === me || a.from === from || a.to === me || a.to === from) this.withdraw(a);
    const s: Session<P> = { parties: [from, me], state: newTrade() };
    this.sessions.set(from.userId, s);
    this.sessions.set(me.userId, s);
    this.sendState(s);
    return null;
  }

  add(me: P, slot: number, qty: number, now: number): string | null {
    return this.edit(me, now, (offer) => offerAdd(offer, me.inv, slot, qty));
  }

  remove(me: P, index: number, qty: number | undefined, now: number): string | null {
    return this.edit(me, now, (offer) => offerRemove(offer, index, qty));
  }

  coins(me: P, coins: number, now: number): string | null {
    return this.edit(me, now, (offer) => offerCoins(offer, me.inv, coins));
  }

  ready(me: P, ready: boolean, now: number): string | null {
    const at = this.open(me);
    if (!at) return "You aren't trading.";
    if (!this.allowEdit(me, now)) return null;
    const [s, side] = at;
    s.state = withReady(s.state, side, ready);
    this.sendState(s);
    return null;
  }

  /** The final Trade press; when both have pressed it, the swap happens right here. */
  confirm(me: P, now: number): string | null {
    const at = this.open(me);
    if (!at) return "You aren't trading.";
    if (!this.allowEdit(me, now)) return null;
    const [s, side] = at;
    this.refit(s);
    const next = withConfirm(s.state, side);
    if (typeof next === "string") {
      this.sendState(s);
      return next;
    }
    s.state = next;
    if (bothConfirmed(s.state)) return this.settle(s);
    this.sendState(s);
    return null;
  }

  /** Call off `p`'s open trade (if any), telling both why. */
  cancel(p: P, reasonForMe: string, reasonForThem: string): void {
    const s = this.sessions.get(p.userId);
    if (!s || !s.parties.includes(p)) return;
    this.close(s);
    const other = s.parties[0] === p ? s.parties[1] : s.parties[0];
    this.hooks.send(p, { t: "tradeEnd", done: false, reason: reasonForMe });
    this.hooks.send(other, { t: "tradeEnd", done: false, reason: reasonForThem });
  }

  /** `p` left the zone or their socket was replaced: their trade and requests end. */
  drop(p: P): void {
    this.cancel(p, "The trade was called off.", `${p.name} left, so the trade was called off.`);
    for (const a of [...this.asks.values()]) if (a.from === p || a.to === p) this.withdraw(a);
    this.askThrottle.drop(p.userId);
    this.edits.delete(p.userId);
  }

  /**
   * `p`'s bag changed (sold, dropped, ate, mined...): an offer the bag no longer covers shrinks to
   * fit, which clears Ready like any other change.
   */
  inventoryChanged(p: P): void {
    const s = this.sessions.get(p.userId);
    if (s && s.parties.includes(p) && this.refit(s)) this.sendState(s);
  }

  /** Requests run out; a trade whose players wandered apart is called off. */
  tick(now: number): void {
    for (const a of [...this.asks.values()]) if (a.expiresAt <= now) this.withdraw(a);
    const seen = new Set<Session<P>>();
    for (const s of this.sessions.values()) {
      if (seen.has(s)) continue;
      seen.add(s);
      const [a, b] = s.parties;
      if (dist(a.entity, b.entity) <= TRADE_LEAVE_RANGE) continue;
      this.cancel(a, `${b.name} is too far away now, so the trade was called off.`, `${a.name} is too far away now, so the trade was called off.`);
    }
  }

  // ---------------------------------------------------------------- internals

  private open(me: P): [Session<P>, TradeSide] | null {
    const s = this.sessions.get(me.userId);
    if (!s) return null;
    if (s.parties[0] === me) return [s, 0];
    if (s.parties[1] === me) return [s, 1];
    return null;
  }

  private allowEdit(me: P, now: number): boolean {
    let b = this.edits.get(me.userId);
    if (!b) this.edits.set(me.userId, (b = new TokenBucket(EDIT_BURST, EDIT_PER_SEC, now)));
    return b.take(now);
  }

  private edit(me: P, now: number, change: (offer: TradeOffer) => TradeOffer | string): string | null {
    const at = this.open(me);
    if (!at) return "You aren't trading.";
    if (!this.allowEdit(me, now)) return null;
    const [s, side] = at;
    this.refit(s);
    const next = change(s.state.offers[side]);
    if (typeof next === "string") {
      this.sendState(s);
      return next;
    }
    s.state = withOffer(s.state, side, next);
    this.sendState(s);
    return null;
  }

  /** Shrinks both offers to what the bags hold; true if either changed. */
  private refit(s: Session<P>): boolean {
    let changed = false;
    for (const side of [0, 1] as const) {
      const fit = fitOffer(s.state.offers[side], s.parties[side].inv);
      if (fit === s.state.offers[side]) continue;
      s.state = withOffer(s.state, side, fit);
      changed = true;
    }
    return changed;
  }

  /**
   * Both pressed Trade. Plans the swap on copies of both bags, then writes both at once with no
   * await in between. If a bag can't cover its offer or can't hold what's coming, nothing moves.
   */
  private settle(s: Session<P>): string | null {
    const [a, b] = s.parties;
    const [offerA, offerB] = s.state.offers;
    const r = settleTrade(a.inv, offerA, b.inv, offerB);
    if ("fail" in r) {
      s.state = withReady(withReady(s.state, 0, false), 1, false);
      for (const p of s.parties) this.hooks.send(p, { t: "notice", text: failText(r.fail, p === a, a, b), kind: "error" });
      this.sendState(s);
      return null;
    }
    this.close(s);
    a.inv.coins = r.a.coins;
    a.inv.slots = r.a.slots;
    b.inv.coins = r.b.coins;
    b.inv.slots = r.b.slots;
    this.hooks.send(a, { t: "tradeEnd", done: true, reason: `You traded with ${b.name}.` });
    this.hooks.send(b, { t: "tradeEnd", done: true, reason: `You traded with ${a.name}.` });
    this.hooks.settled(a, b, offerA, offerB);
    return null;
  }

  private close(s: Session<P>): void {
    for (const p of s.parties) if (this.sessions.get(p.userId) === s) this.sessions.delete(p.userId);
  }

  private withdraw(a: Ask<P>): void {
    if (this.asks.get(a.from.userId) === a) this.asks.delete(a.from.userId);
    this.hooks.send(a.to, { t: "tradeAskGone", from: a.from.entity.id });
  }

  private sendState(s: Session<P>): void {
    for (const side of [0, 1] as const) this.hooks.send(s.parties[side], { t: "trade", view: viewFor(s, side) });
  }
}

function viewFor<P extends TradeParty>(s: Session<P>, side: TradeSide): TradeView {
  const other = (1 - side) as TradeSide;
  const them = s.parties[other];
  return {
    with: { id: them.entity.id, name: them.name },
    mine: s.state.offers[side],
    theirs: s.state.offers[other],
    ready: { mine: s.state.ready[side], theirs: s.state.ready[other] },
    confirmed: { mine: s.state.confirmed[side], theirs: s.state.confirmed[other] },
  };
}

/** The notice each side gets when the swap can't happen (`forA`: the line for player a). */
function failText(fail: SettleFail, forA: boolean, a: TradeParty, b: TradeParty): string {
  const mine = (fail.startsWith("a") ? forA : !forA);
  const who = fail.startsWith("a") ? a.name : b.name;
  if (fail.endsWith("missing")) return mine ? "You no longer have everything you offered." : `${who} no longer has everything they offered.`;
  return mine ? "Your bag is too full for this trade. Make some room first." : `${who}'s bag is too full for this trade.`;
}
