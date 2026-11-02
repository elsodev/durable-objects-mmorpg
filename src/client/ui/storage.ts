// Storage panel (#storage-panel): what is inside an open fridge beside your bag. Clicking a bag
// stack puts it in, clicking a shelf takes it out (Shift: just one). The server decides; this
// panel only sends intents and redraws from the `storage` and `inventory` messages.
import type { StorageAccepts } from "../../shared/furnitureItems";
import type { Inventory, InventorySlot, ItemId } from "../../shared/types";
import { MAX_SLOTS } from "../../shared/items";
import { iconFor } from "./icons";
import { itemTip } from "./item-tip";
import { uiSound } from "./sound";
import { canStore, moveQty, storageHint, storageTitle, usedLabel } from "./storage-logic";
import "./styles/storage.css";

export interface StoragePanelOpts {
  put(id: string, slot: number, qty: number): void;
  take(id: string, index: number, qty: number): void;
  /** The panel closed (✕, Escape, or close()): the game shuts the door. */
  onClose(id: string): void;
}

export interface StoragePanel {
  /** Shows (open) or refreshes the panel for storage object `id`. */
  set(id: string, item: ItemId, slots: (InventorySlot | null)[], accepts: StorageAccepts, open: boolean): void;
  setInventory(inv: Inventory): void;
  /** Id of the storage piece on screen, or null. */
  openId(): string | null;
  close(): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function slotButton(s: InventorySlot | null, enabled: boolean, onClick: (one: boolean) => void): HTMLButtonElement {
  const b = el("button", `dm-slot store-slot${s ? "" : " is-empty"}${s && !enabled ? " is-off" : ""}`);
  b.type = "button";
  if (s) {
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    try {
      img.src = iconFor(s.item);
    } catch {
      // no icon: the tooltip still names it
    }
    b.appendChild(img);
    if (s.qty > 1) b.appendChild(el("span", "store-qty", String(s.qty)));
    itemTip().attach(b, () => s);
  }
  b.disabled = !s || !enabled;
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    uiSound("click");
    onClick(ev.shiftKey);
  });
  return b;
}

export function createStoragePanel(root: HTMLElement, opts: StoragePanelOpts): StoragePanel {
  const panel = el("section", "dm-panel store-panel");
  panel.id = "storage-panel";
  panel.setAttribute("role", "dialog");
  panel.hidden = true;
  const head = el("div", "dm-panel-header");
  const title = el("span", "dm-title", "Fridge");
  const close = el("button", "dm-close", "✕");
  close.type = "button";
  close.id = "storage-close";
  close.addEventListener("click", () => api.close());
  for (const c of [title, close]) head.appendChild(c);
  const used = el("div", "store-used");
  const shelves = el("div", "store-grid store-box");
  shelves.id = "storage-box";
  const bagTitle = el("div", "store-sub", "Your bag");
  const bag = el("div", "store-grid store-bag");
  bag.id = "storage-bag";
  const hint = el("p", "store-hint");
  for (const c of [head, used, shelves, bagTitle, bag, hint]) panel.appendChild(c);
  root.appendChild(panel);

  let id: string | null = null;
  let box: (InventorySlot | null)[] = [];
  let accepts: StorageAccepts = "food";
  let inv: Inventory = { coins: 0, slots: [] };

  function draw(): void {
    if (!id) return;
    // The slots are rebuilt, so a tip shown over an old one would linger on a stale item.
    itemTip().hide();
    used.textContent = usedLabel(box);
    hint.textContent = storageHint(accepts);
    shelves.replaceChildren(
      ...box.map((s, i) =>
        slotButton(s, true, (one) => {
          if (s && id) opts.take(id, i, moveQty(s, one));
        }),
      ),
    );
    const bagSlots: HTMLButtonElement[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = inv.slots[i] ?? null;
      bagSlots.push(
        slotButton(s, canStore(accepts, s), (one) => {
          if (s && id) opts.put(id, i, moveQty(s, one));
        }),
      );
    }
    bag.replaceChildren(...bagSlots);
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && id) {
      ev.preventDefault();
      api.close();
    }
  };
  addEventListener("keydown", onKey, true);

  const api: StoragePanel = {
    set(newId, item, slots, acc, open) {
      if (!open && newId !== id) return;
      id = newId;
      box = slots;
      accepts = acc;
      title.textContent = storageTitle(item);
      panel.hidden = false;
      draw();
    },
    setInventory(next) {
      inv = next;
      draw();
    },
    openId: () => id,
    close() {
      if (!id) return;
      const was = id;
      id = null;
      panel.hidden = true;
      itemTip().hide();
      opts.onClose(was);
    },
    destroy() {
      removeEventListener("keydown", onKey, true);
      panel.remove();
    },
  };
  return api;
}
