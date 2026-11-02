// Inventory panel (#inventory-panel): 6x4 grid of slots with icon, qty and the shared item tooltip, plus coins.
// All text goes in via textContent; item data comes from the shared catalog.
import { MAX_SLOTS } from "../../shared/items";
import type { Inventory } from "../../shared/types";
import { formatCoins } from "./inventory-format";
import { iconFor } from "./icons";
import { itemTip } from "./item-tip";
import { itemTitle } from "./item-tip-logic";
import type { CreateInventoryPanel, InventoryPanel } from "./index";
import { uiSound } from "./sound";
import { gaugeLabel, holdsWater, waterGauge, type WaterLevel } from "./water-gauge";
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
  let water: WaterLevel | null = null;

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
  // The same coin as the status panel's (theme.css .dm-coin).
  const coinIcon = el("span", "inv-coin-icon dm-coin");
  coinIcon.setAttribute("aria-hidden", "true");
  const coins = el("span", "inv-coins", "0");
  coins.id = "inventory-coins";
  const wallet = el("span", "inv-wallet");
  wallet.title = "Coins";
  add(wallet, coinIcon, coins);
  const sortBtn = el("button", "dm-btn dm-btn-small inv-sort", "Sort");
  sortBtn.type = "button";
  sortBtn.id = "inventory-sort";
  sortBtn.title = "Sort by item type (the hotbar row stays as it is)";
  sortBtn.addEventListener("click", () => {
    uiSound("click");
    opts.onSort?.();
  });
  sortBtn.hidden = !opts.onSort;
  add(footer, wallet, sortBtn);

  const tip = itemTip();

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
    });
    tip.attach(btn, () => inv.slots[i] ?? null);
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!inv.slots[i]) return;
      tip.hide();
      opts.onMenu?.(i, e.clientX, e.clientY);
    });
    opts.drag?.attach(btn, i);
    add(grid, btn);
    slotEls.push({ btn, img, qty });
  }

  // Grid and footer share one width, so Sort lines up with the right edge of the grid.
  const body = el("div", "inv-body");
  add(body, grid, footer);
  add(panel, header, body);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      panelApi.close();
    }
  });
  add(root, panel);

  function render(): void {
    coins.textContent = formatCoins(inv.coins);
    for (let i = 0; i < slotEls.length; i++) {
      const { btn, img, qty } = slotEls[i];
      const slot = inv.slots[i];
      btn.querySelector(".slot-water")?.remove();
      if (slot) {
        const gauge = waterGauge(slot.item, water);
        if (gauge) btn.appendChild(gauge);
        const src = iconFor(slot.item);
        if (img.getAttribute("src") !== src) img.src = src;
        img.hidden = false;
        qty.textContent = slot.qty > 1 ? String(slot.qty) : "";
        btn.classList.remove("is-empty");
        btn.removeAttribute("aria-disabled");
        const level = water && holdsWater(slot.item) ? `, ${gaugeLabel(water)}` : "";
        btn.setAttribute("aria-label", itemTitle(slot.item, slot.qty) + level);
      } else {
        img.removeAttribute("src");
        img.hidden = true;
        qty.textContent = "";
        btn.classList.add("is-empty");
        // Not `disabled`: an empty slot is still a drop target.
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("aria-label", "Empty slot");
      }
    }
  }

  const panelApi: InventoryPanel = {
    setInventory(next) {
      inv = next;
      render();
    },
    setWater(level) {
      water = level;
      render();
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
      tip.hide();
      uiSound("close");
    },
    isOpen: () => open,
  };

  render();
  return panelApi;
};
