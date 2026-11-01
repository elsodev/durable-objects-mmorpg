// Drag and drop between bag slots (inventory panel and hotbar). Pointer events, so it works with
// mouse, pen and touch. Slots opt in with `data-bag-slot`; a drop anywhere else does nothing.
// Shift-drag moves half the stack. A drag swallows the click that would follow it.
import { dragStarted } from "./slot-drag-logic";
import "./styles/slot-drag.css";

export interface SlotDragOpts {
  /** Item icon URL for the slot, or null when it's empty (nothing to drag). */
  iconOf(slot: number): string | null;
  /** Dropped `from` onto `to`. */
  onDrop(from: number, to: number, split: boolean): void;
  /** False while dragging isn't allowed (visiting, build mode). */
  enabled?(): boolean;
}

export interface SlotDrag {
  attach(el: HTMLElement, slot: number): void;
  destroy(): void;
}

export function createSlotDrag(opts: SlotDragOpts): SlotDrag {
  let press: { slot: number; x: number; y: number; id: number; split: boolean; el: HTMLElement } | null = null;
  let ghost: HTMLImageElement | null = null;
  let over: HTMLElement | null = null;

  function slotUnder(x: number, y: number): HTMLElement | null {
    const hit = document.elementFromPoint(x, y);
    return hit instanceof Element ? (hit.closest("[data-bag-slot]") as HTMLElement | null) : null;
  }

  function setOver(el: HTMLElement | null): void {
    if (el === over) return;
    over?.classList.remove("is-drop-target");
    over = el;
    over?.classList.add("is-drop-target");
  }

  function end(): void {
    ghost?.remove();
    ghost = null;
    setOver(null);
    press?.el.classList.remove("is-dragging");
    document.body.classList.remove("dm-dragging");
    press = null;
  }

  function swallowClick(): void {
    const stop = (e: Event): void => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", stop, { capture: true, once: true });
    // If no click follows (touch), drop the listener on the next tick.
    setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
  }

  const onMove = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    if (!ghost) {
      if (!dragStarted(e.clientX - press.x, e.clientY - press.y)) return;
      const src = opts.iconOf(press.slot);
      if (!src) return end();
      ghost = document.createElement("img");
      ghost.className = "dm-drag-ghost";
      ghost.src = src;
      ghost.alt = "";
      document.body.appendChild(ghost);
      press.el.classList.add("is-dragging");
      document.body.classList.add("dm-dragging");
    }
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    setOver(slotUnder(e.clientX, e.clientY));
  };

  const onUp = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    const dragging = !!ghost;
    const target = dragging ? slotUnder(e.clientX, e.clientY) : null;
    end();
    if (!dragging) return;
    swallowClick();
    const to = target ? Number(target.dataset.bagSlot) : NaN;
    if (Number.isInteger(to) && to !== p.slot) opts.onDrop(p.slot, to, p.split);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && press) end();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", end);
  window.addEventListener("keydown", onKey);

  return {
    attach(el, slot) {
      el.dataset.bagSlot = String(slot);
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || (opts.enabled && !opts.enabled())) return;
        if (!opts.iconOf(slot)) return;
        press = { slot, x: e.clientX, y: e.clientY, id: e.pointerId, split: e.shiftKey, el };
      });
    },
    destroy() {
      end();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey);
    },
  };
}
