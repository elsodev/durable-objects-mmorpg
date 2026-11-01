// Inventory panel (#inventory-panel): 6x4 grid of slots with icon, qty and a tooltip, plus coins.
// All text goes in via textContent; item data comes from the shared catalog.
import { getItem, MAX_SLOTS } from "../../shared/items";
import type { Inventory } from "../../shared/types";
import { formatCoins, tooltipInfo } from "./inventory-format";
import { iconFor } from "./icons";
import type { CreateInventoryPanel, InventoryPanel } from "./index";
import { uiSound } from "./sound";
import "./styles/inventory.css";

export { formatCoins, tooltipInfo, type TooltipInfo } from "./inventory-format";

export const INVENTORY_COLS = 6;
export const INVENTORY_ROWS = 4;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function add(parent: Node, ...children: Node[]): void {
  for (const c of children) parent.appendChild(c);
}

export const createInventoryPanel: CreateInventoryPanel = (root, opts) => {
  const slotCount = Math.min(MAX_SLOTS, INVENTORY_COLS * INVENTORY_ROWS);
  let inv: Inventory = { coins: 0, slots: [] };
  let open = false;

  const panel = el("section", "dm-panel inv-panel");
  panel.id = "inventory-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Inventory");
  panel.hidden = true;

  const header = el("header", "inv-header");
  const title = el("h2", "inv-title", "Inventory");
  const closeBtn = el("button", "inv-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close inventory");
  closeBtn.addEventListener("click", () => panelApi.close());
  add(header, title, closeBtn);

  const grid = el("div", "inv-grid");
  grid.style.setProperty("--inv-cols", String(INVENTORY_COLS));

  const footer = el("footer", "inv-footer");
  const coinIcon = el("span", "inv-coin-icon");
  coinIcon.setAttribute("aria-hidden", "true");
  const coins = el("span", "inv-coins", "0");
  coins.id = "inventory-coins";
  add(footer, coinIcon, coins);

  const tip = el("div", "dm-panel inv-tooltip");
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  const tipName = el("div", "inv-tip-name");
  const tipDesc = el("div", "inv-tip-desc");
  const tipPrice = el("div", "inv-tip-price");
  add(tip, tipName, tipDesc, tipPrice);

  const slotEls: { btn: HTMLButtonElement; img: HTMLImageElement; qty: HTMLSpanElement }[] = [];
  for (let i = 0; i < slotCount; i++) {
    const btn = el("button", "dm-slot inv-slot");
    btn.type = "button";
    btn.dataset.slot = String(i);
    const img = el("img", "inv-icon");
    img.alt = "";
    img.draggable = false;
    const qty = el("span", "inv-qty");
    add(btn, img, qty);
    btn.addEventListener("click", () => {
      if (!inv.slots[i]) return;
      uiSound("select");
      opts.onItem(i);
    });
    btn.addEventListener("mouseenter", () => {
      if (inv.slots[i]) uiSound("hover");
      showTip(i, btn);
    });
    btn.addEventListener("focus", () => showTip(i, btn));
    btn.addEventListener("mouseleave", hideTip);
    btn.addEventListener("blur", hideTip);
    add(grid, btn);
    slotEls.push({ btn, img, qty });
  }

  add(panel, header, grid, footer, tip);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      panelApi.close();
    }
  });
  add(root, panel);

  function showTip(i: number, anchor: HTMLElement): void {
    const slot = inv.slots[i];
    if (!slot) return hideTip();
    const info = tooltipInfo(slot);
    tipName.textContent = info.qty > 1 ? `${info.name} ×${info.qty}` : info.name;
    tipDesc.textContent = info.desc ?? "";
    tipDesc.hidden = !info.desc;
    tipPrice.textContent = info.price;
    tip.hidden = false;
    // Position relative to the panel so it moves with it.
    const p = panel.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    tip.style.left = `${a.left - p.left + a.width / 2}px`;
    tip.style.top = `${a.top - p.top}px`;
  }

  function hideTip(): void {
    tip.hidden = true;
  }

  function render(): void {
    coins.textContent = formatCoins(inv.coins);
    for (let i = 0; i < slotEls.length; i++) {
      const { btn, img, qty } = slotEls[i];
      const slot = inv.slots[i];
      if (slot) {
        const name = getItem(slot.item)?.name ?? slot.item;
        const src = iconFor(slot.item);
        if (img.getAttribute("src") !== src) img.src = src;
        img.hidden = false;
        qty.textContent = slot.qty > 1 ? String(slot.qty) : "";
        btn.classList.remove("is-empty");
        btn.disabled = false;
        btn.setAttribute("aria-label", slot.qty > 1 ? `${name}, ${slot.qty}` : name);
      } else {
        img.removeAttribute("src");
        img.hidden = true;
        qty.textContent = "";
        btn.classList.add("is-empty");
        btn.disabled = true;
        btn.setAttribute("aria-label", "Empty slot");
      }
    }
  }

  const panelApi: InventoryPanel = {
    setInventory(next) {
      inv = next;
      render();
      if (!tip.hidden) hideTip();
    },
    toggle() {
      if (open) panelApi.close();
      else {
        open = true;
        // Icons may have switched from placeholders to real art since the last render.
        render();
        panel.hidden = false;
        panel.classList.add("is-open");
        uiSound("open");
      }
    },
    close() {
      if (!open) return;
      open = false;
      panel.hidden = true;
      panel.classList.remove("is-open");
      hideTip();
      uiSound("close");
    },
    isOpen: () => open,
  };

  render();
  return panelApi;
};
