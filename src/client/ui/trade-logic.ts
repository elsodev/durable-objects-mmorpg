// Pure helpers for the trade window and the trade request card (no DOM), tested in
// test/fe-trade.test.ts.
import { takeStack } from "../../shared/engine/trade";
import type { TradeOffer, TradeView } from "../../shared/trade";
import type { Inventory, InventorySlot } from "../../shared/types";

export interface TradeStatus {
  /** One line under the windows saying what happens next. */
  line: string;
  /** "ok" once both are ready (the line turns green). */
  tone: "" | "ok";
  readyLabel: string;
  tradeEnabled: boolean;
}

const hasAny = (o: TradeOffer): boolean => o.coins > 0 || o.items.length > 0;

export function tradeStatus(v: TradeView): TradeStatus {
  const them = v.with.name;
  const both = v.ready.mine && v.ready.theirs;
  const something = hasAny(v.mine) || hasAny(v.theirs);
  const readyLabel = v.ready.mine ? "Not ready" : "Ready";
  if (!both) {
    let line: string;
    if (v.ready.mine) line = `Waiting for ${them} to press Ready…`;
    else if (v.ready.theirs) line = `${them} is ready. Check their side, then press Ready.`;
    else if (!something) line = "Right-click (or long-press) items in your bag to add them, then press Ready.";
    else line = "When you're happy with both sides, press Ready.";
    return { line, tone: "", readyLabel, tradeEnabled: false };
  }
  if (!something) return { line: "Put something in the trade first.", tone: "", readyLabel, tradeEnabled: false };
  if (v.confirmed.mine) return { line: `Waiting for ${them} to press Trade…`, tone: "ok", readyLabel, tradeEnabled: false };
  if (v.confirmed.theirs) return { line: `${them} pressed Trade. Press Trade to finish.`, tone: "ok", readyLabel, tradeEnabled: true };
  return { line: "Both ready! Press Trade to swap.", tone: "ok", readyLabel, tradeEnabled: true };
}

/** The badge on each side's half: Not ready / Ready / Accepted. */
export function sideBadge(ready: boolean, confirmed: boolean): { text: string; state: "wait" | "ready" | "done" } {
  if (confirmed) return { text: "Accepted", state: "done" };
  return ready ? { text: "Ready", state: "ready" } : { text: "Not ready", state: "wait" };
}

/**
 * Your bag as it would look without what you've put in the trade (taken from the last slots
 * first, like the swap does), so the window shows what is still free to add. Slots stay put.
 */
export function bagLeft(inv: Inventory, offer: TradeOffer): (InventorySlot | null)[] {
  const copy: Inventory = { coins: inv.coins, slots: inv.slots.map((s) => (s ? { ...s } : null)) };
  for (const e of offer.items) takeStack(copy, e, Math.min(e.qty, countKey(copy, e)));
  return copy.slots;
}

function countKey(inv: Inventory, k: { item: string; quality?: number }): number {
  let n = 0;
  for (const s of inv.slots) if (s && s.item === k.item && (s.quality ?? 0) === (k.quality ?? 0)) n += s.qty;
  return n;
}

/** "Bob wants to trade with you." */
export function askText(name: string): string {
  return `${name} wants to trade with you.`;
}

/** Whole seconds left on a request (never negative). */
export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/** A coin amount typed in the box: a whole number from 0 up to what you carry. */
export function coinInput(text: string, have: number): number {
  const n = Math.floor(Number(text.replace(/[^\d]/g, "")) || 0);
  return Math.max(0, Math.min(n, Math.max(0, have)));
}
