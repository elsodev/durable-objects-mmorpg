// The right-click menu on a bag or hotbar slot (Drop 1 / Drop all, and the Add to trade choices
// while a trade window is open). DOM only; labels via textContent.
import { getItem } from "../../shared/items";
import type { InventorySlot } from "../../shared/types";
import { menuPosition, slotMenuChoices, type SlotMenuChoice } from "./slot-menu-logic";
import { uiSound } from "./sound";
import "./styles/slot-menu.css";

export interface SlotMenu {
  open(slot: number, stack: InventorySlot, x: number, y: number): void;
  close(): void;
}

export interface SlotMenuOpts {
  /** Choices listed above Drop (the trade ones while trading); none by default. */
  extra?(stack: InventorySlot): SlotMenuChoice[];
  /** Leave out the Drop choices (the trade window's own bag). */
  noDrop?: boolean;
  onTrade?(slot: number, qty: number | null): void;
}

export function createSlotMenu(root: HTMLElement, onDrop: (slot: number, qty: number | null) => void, opts: SlotMenuOpts = {}): SlotMenu {
  const menu = document.createElement("div");
  menu.className = "dm-panel slot-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  root.appendChild(menu);

  const close = (): void => {
    menu.hidden = true;
    menu.replaceChildren();
  };
  // Any click or key elsewhere closes it; the menu's own clicks act first.
  window.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) close();
  }, true);
  window.addEventListener("keydown", (e) => {
    if (!menu.hidden && e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);

  return {
    open(slot, stack, x, y) {
      close();
      const title = document.createElement("div");
      title.className = "slot-menu-title";
      title.textContent = getItem(stack.item)?.name ?? stack.item;
      menu.appendChild(title);
      const extra = opts.extra?.(stack) ?? [];
      const choices = [...extra, ...(opts.noDrop ? [] : slotMenuChoices(stack.qty))];
      choices.forEach((c, i) => {
        if (i > 0 && i === extra.length) {
          const line = document.createElement("div");
          line.className = "slot-menu-sep";
          menu.appendChild(line);
        }
        const b = document.createElement("button");
        b.type = "button";
        b.className = "slot-menu-item";
        b.setAttribute("role", "menuitem");
        b.textContent = c.label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          uiSound("click");
          close();
          if (c.action === "trade") opts.onTrade?.(slot, c.qty);
          else onDrop(slot, c.qty);
        });
        menu.appendChild(b);
      });
      menu.hidden = false;
      const r = menu.getBoundingClientRect();
      const p = menuPosition(x, y, r.width, r.height, window.innerWidth, window.innerHeight);
      menu.style.left = `${p.x}px`;
      menu.style.top = `${p.y}px`;
      (menu.querySelector(".slot-menu-item") as HTMLButtonElement | null)?.focus({ preventScroll: true });
    },
    close,
  };
}
