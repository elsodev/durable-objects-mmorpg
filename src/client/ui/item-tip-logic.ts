// DOM-free parts of the in-game item tooltip and the hotbar name flash (tested in test/fe-item-tip.test.ts).
import { getItem } from "../../shared/items";
import type { ItemId } from "../../shared/types";

export interface ItemTipText {
  /** "Turnip Seeds ×10"; just the name for a single item. */
  title: string;
  /** Flavour text from the catalog, if any. */
  desc: string | null;
  /** One short fact: "Tool", "Grows Turnip in 4 days", "Sells for 25 coins". */
  detail: string | null;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

export function itemTitle(item: ItemId, qty: number): string {
  const name = getItem(item)?.name ?? item;
  return qty > 1 ? `${name} ×${qty}` : name;
}

export function itemTipText(item: ItemId, qty: number): ItemTipText {
  const def = getItem(item);
  const title = itemTitle(item, qty);
  if (!def) return { title, desc: null, detail: null };
  if (def.kind === "tool") return { title, desc: def.desc ?? null, detail: "Tool" };
  if (def.grows) {
    // Seed flavour text only repeats the growth time, so the fact line stands in for it.
    const crop = getItem(def.grows.crop)?.name ?? def.grows.crop;
    let detail = `Grows ${crop} in ${plural(def.grows.days, "day")}`;
    if (def.grows.regrow) detail += `, then every ${plural(def.grows.regrow, "day")}`;
    return { title, desc: null, detail };
  }
  return { title, desc: def.desc ?? null, detail: def.sell > 0 ? `Sells for ${plural(def.sell, "coin")}` : null };
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TipPlacement {
  left: number;
  top: number;
  side: "above" | "below";
}

/**
 * Puts the tooltip centred above the anchor, flipped below it when there's no room on top, and
 * slid sideways so it stays `margin` px inside the viewport.
 */
export function placeTip(
  anchor: Rect,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  gap = 8,
  margin = 8,
): TipPlacement {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const left = clamp(anchor.left + anchor.width / 2 - tip.width / 2, margin, view.width - margin - tip.width);
  const above = anchor.top - gap - tip.height;
  const side = above >= margin ? "above" : "below";
  const raw = side === "above" ? above : anchor.top + anchor.height + gap;
  return { left: Math.round(left), top: Math.round(clamp(raw, margin, view.height - margin - tip.height)), side };
}

/** Where the tip's pointer sits (px from its left edge): under the anchor, kept off the rounded corners. */
export function arrowAt(anchorCentre: number, tipWidth: number, inset = 12): number {
  return Math.round(Math.max(inset, Math.min(anchorCentre, tipWidth - inset)));
}

/** A press held this long on a touch screen shows the tooltip. */
export const LONG_PRESS_MS = 450;
/** Moving further than this cancels the long-press (it's a drag or a scroll). */
export const LONG_PRESS_SLOP = 10;

export function pressMoved(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > LONG_PRESS_SLOP;
}

// ---------- name flash ----------

export const FLASH_HOLD_MS = 2000;
export const FLASH_FADE_MS = 350;

export interface FlashView {
  show(text: string): void;
  /** Start the fade-out. */
  fade(): void;
  /** Gone for good (also called to cut a flash short). */
  hide(): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface NameFlash {
  /** Shows `text` for the hold time, then fades it. Null (an empty slot) clears any flash at once. */
  flash(text: string | null): void;
  cancel(): void;
}

export function createNameFlash(view: FlashView, timers: Timers = realTimers, holdMs = FLASH_HOLD_MS, fadeMs = FLASH_FADE_MS): NameFlash {
  let hold: unknown = null;
  let fade: unknown = null;
  const stop = (): void => {
    if (hold !== null) timers.clear(hold);
    if (fade !== null) timers.clear(fade);
    hold = fade = null;
  };
  const cancel = (): void => {
    stop();
    view.hide();
  };
  return {
    flash(text) {
      if (!text) return cancel();
      stop();
      view.show(text);
      hold = timers.set(() => {
        hold = null;
        view.fade();
        fade = timers.set(() => {
          fade = null;
          view.hide();
        }, fadeMs);
      }, holdMs);
    },
    cancel,
  };
}
