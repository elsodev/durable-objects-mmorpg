// One shared in-game tooltip for item slots (hotbar, bag, shop, shipping bin), replacing the
// browser's `title` tooltip. Mouse: on hover. Keyboard: on focus. Touch: on long-press, so a tap
// still just selects. It never takes the pointer, and it hides while a slot is being dragged.
import type { ItemId } from "../../shared/types";
import { arrowAt, itemTipText, LONG_PRESS_MS, placeTip, pressMoved } from "./item-tip-logic";
import "./styles/item-tip.css";

export interface TipItem {
  item: ItemId;
  qty: number;
}

export interface ItemTip {
  /** `itemOf` is read each time the tip shows, so it follows the slot's current contents. */
  attach(el: HTMLElement, itemOf: () => TipItem | null): void;
  /** Re-reads the item under the tip after the bag changed (hides it if the slot emptied). */
  refresh(): void;
  hide(): void;
}

/** After a long-press the tip lingers this long once the finger lifts. */
const TOUCH_LINGER_MS = 1500;

let shared: ItemTip | null = null;

/** The page's one tooltip, created on first use. */
export function itemTip(): ItemTip {
  shared ??= createItemTip(document.body);
  return shared;
}

export function createItemTip(host: HTMLElement): ItemTip {
  const tip = document.createElement("div");
  tip.className = "dm-item-tip";
  tip.setAttribute("role", "tooltip");
  tip.id = "item-tip";
  tip.hidden = true;
  const title = document.createElement("div");
  title.className = "dm-item-tip-title";
  const desc = document.createElement("div");
  desc.className = "dm-item-tip-desc";
  const detail = document.createElement("div");
  detail.className = "dm-item-tip-detail";
  for (const part of [title, desc, detail]) tip.appendChild(part);
  host.appendChild(tip);

  let anchor: { el: HTMLElement; itemOf: () => TipItem | null } | null = null;
  let linger: ReturnType<typeof setTimeout> | null = null;

  function clearLinger(): void {
    if (linger) clearTimeout(linger);
    linger = null;
  }

  function hide(): void {
    clearLinger();
    if (anchor) anchor.el.removeAttribute("aria-describedby");
    anchor = null;
    tip.hidden = true;
  }

  function show(el: HTMLElement, itemOf: () => TipItem | null): void {
    clearLinger();
    const it = itemOf();
    // Dragging, or the slot sits in a panel that just closed.
    if (!it || document.body.classList.contains("dm-dragging") || !el.isConnected || el.getClientRects().length === 0) return hide();
    if (anchor && anchor.el !== el) anchor.el.removeAttribute("aria-describedby");
    anchor = { el, itemOf };
    const t = itemTipText(it.item, it.qty);
    title.textContent = t.title;
    desc.textContent = t.desc ?? "";
    desc.hidden = !t.desc;
    detail.textContent = t.detail ?? "";
    detail.hidden = !t.detail;
    tip.hidden = false;
    el.setAttribute("aria-describedby", tip.id);
    // Measure first, then place: the size depends on the text.
    tip.style.left = "0px";
    tip.style.top = "0px";
    // Inside a `data-tip-frame` (the hotbar) the tip clears the whole frame, not just the slot.
    const r = el.getBoundingClientRect();
    const f = el.closest<HTMLElement>("[data-tip-frame]")?.getBoundingClientRect() ?? r;
    const size = tip.getBoundingClientRect();
    const p = placeTip({ left: r.left, width: r.width, top: f.top, height: f.bottom - f.top }, size, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    tip.style.left = `${p.left}px`;
    tip.style.top = `${p.top}px`;
    tip.style.setProperty("--tip-arrow", `${arrowAt(r.left + r.width / 2 - p.left, size.width)}px`);
    tip.dataset.side = p.side;
  }

  function attach(el: HTMLElement, itemOf: () => TipItem | null): void {
    el.removeAttribute("title");
    let press: { x: number; y: number; id: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let pressShown = false;
    const endPress = (): void => {
      if (press) clearTimeout(press.timer);
      press = null;
    };

    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "touch") show(el, itemOf);
    });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "touch" && anchor?.el === el) hide();
    });
    el.addEventListener("focus", () => {
      if (el.matches(":focus-visible")) show(el, itemOf);
    });
    el.addEventListener("blur", () => {
      if (anchor?.el === el) hide();
    });
    el.addEventListener("pointerdown", (e) => {
      // A click or the start of a drag: the hotbar's name flash or the drag ghost takes over.
      if (e.pointerType !== "touch") return hide();
      endPress();
      pressShown = false;
      press = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        timer: setTimeout(() => {
          press = null;
          pressShown = true;
          show(el, itemOf);
        }, LONG_PRESS_MS),
      };
    });
    el.addEventListener("pointermove", (e) => {
      if (press && e.pointerId === press.id && pressMoved(e.clientX - press.x, e.clientY - press.y)) endPress();
      if (pressShown && document.body.classList.contains("dm-dragging")) hide();
    });
    const lift = (): void => {
      endPress();
      if (pressShown && anchor?.el === el) {
        clearLinger();
        linger = setTimeout(hide, TOUCH_LINGER_MS);
      }
      pressShown = false;
    };
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lift);
    // The phone's own long-press menu ("Save image") would cover the tooltip.
    el.addEventListener("contextmenu", (e) => {
      if (pressShown || press) e.preventDefault();
    });
  }

  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);

  return {
    attach,
    refresh() {
      if (anchor && !tip.hidden) show(anchor.el, anchor.itemOf);
    },
    hide,
  };
}
