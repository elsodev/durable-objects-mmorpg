// House edit mode, DOM side: the Edit button (owner, inside the house), the "Editing your home"
// banner with Done, the small toolbar that floats by the selection (turn, pick up, deselect),
// and the tray of furniture in your bag that replaces the hotbar while editing. DOM only; every
// text is set with textContent. The game drives it through EditUi; it calls back through opts.
import { getItem } from "../../shared/items";
import type { ItemId, Vec2 } from "../../shared/types";
import { editIcon, type EditIconName } from "./edit-icons";
import { iconFor } from "./icons";
import { itemTip } from "./item-tip";
import { uiSound } from "./sound";
import "./styles/edit.css";

export interface EditTrayItem {
  slot: number;
  item: ItemId;
  qty: number;
}

export interface EditToolbarState {
  /** Pieces selected (0 while holding a new piece from the tray). */
  count: number;
  /** Holding a piece from the bag: the bar docks above the tray and offers Turn and Put back. */
  holding: boolean;
  /** The held piece's name. */
  name?: string;
  canTurn: boolean;
  canPickUp: boolean;
}

export interface EditUiOpts {
  /** The Edit button (or its hotkey): enter or leave edit mode. */
  toggle(): void;
  rotate(): void;
  pickUp(): void;
  deselect(): void;
  /** "Select several": taps add to the selection and a finger drag draws a box (touch). */
  setMulti(on: boolean): void;
  /** A tray piece was chosen (null: put the held piece back). */
  hold(slot: number | null): void;
}

export interface EditUi {
  /** Show the Edit button (your own house) or hide it (anywhere else, or visiting). */
  setAvailable(on: boolean): void;
  setActive(on: boolean): void;
  setMulti(on: boolean): void;
  setTray(items: readonly EditTrayItem[], held: number | null): void;
  /** Place the toolbar with its top-left at `at` (screen px), or hide it (null). */
  setToolbar(at: Vec2 | null, state?: EditToolbarState): void;
  /** Toolbar size (px) for placing it; a fair guess before it was first shown. */
  toolbarSize(state: EditToolbarState): { w: number; h: number };
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(text: string, className: string, id: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `dm-btn ${className}`, text);
  b.type = "button";
  b.id = id;
  b.title = title;
  b.setAttribute("aria-label", title);
  // The canvas sits under the HUD: a press on a button must never reach it (no drag, no box).
  b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    uiSound("click");
    onClick();
  });
  return b;
}

/** A toolbar button: a pixel icon and, when there's room, a label. */
function toolBtn(icon: EditIconName, label: string, id: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = btn("", "dm-btn-small edit-tool", id, title, onClick);
  b.appendChild(editIcon(icon));
  if (label) b.appendChild(el("span", "edit-tool-label", label));
  return b;
}

export function createEditUi(root: HTMLElement, opts: EditUiOpts): EditUi {
  const layer = el("div", "hud-layer edit-layer");
  root.appendChild(layer);

  // ---- Edit button (bottom-right, by the hotbar)
  const editBtn = btn("", "edit-open", "edit-open", "Edit your home (T)", () => opts.toggle());
  editBtn.appendChild(editIcon("pencil"));
  editBtn.appendChild(el("span", "edit-open-label", "Edit"));
  editBtn.appendChild(el("span", "dm-btn-key edit-key", "T"));
  editBtn.hidden = true;
  layer.appendChild(editBtn);

  // ---- banner (top-centre)
  const banner = el("div", "dm-panel edit-banner");
  banner.id = "edit-banner";
  banner.setAttribute("role", "status");
  const title = el("div", "edit-banner-title");
  title.appendChild(editIcon("pencil"));
  title.appendChild(el("span", "dm-title", "Editing your home"));
  const hint = el("span", "dm-muted edit-banner-hint", "Drag to move · Shift-click or drag a box for several · R turns · Del picks up");
  const multiBtn = btn("Select several", "dm-btn-small edit-multi", "edit-multi", "Tap pieces to add them; drag to draw a box", () => opts.setMulti(!multi));
  multiBtn.setAttribute("aria-pressed", "false");
  const doneBtn = btn("Done", "dm-btn-primary dm-btn-small", "edit-done", "Done editing (Esc)", () => opts.toggle());
  const row = el("div", "edit-banner-row");
  row.appendChild(multiBtn);
  row.appendChild(doneBtn);
  banner.appendChild(title);
  banner.appendChild(hint);
  banner.appendChild(row);
  banner.hidden = true;
  layer.appendChild(banner);

  // ---- floating toolbar
  const bar = el("div", "dm-panel edit-toolbar");
  bar.id = "edit-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selected furniture");
  const countEl = el("span", "edit-count");
  const turnBtn = toolBtn("turn", "Turn", "edit-rotate", "Turn (R)", () => opts.rotate());
  const pickBtn = toolBtn("bag", "Pick up", "edit-pickup", "Pick up into your bag (Del)", () => opts.pickUp());
  const closeBtn = toolBtn("close", "", "edit-deselect", "Deselect (Esc)", () => opts.deselect());
  bar.appendChild(countEl);
  bar.appendChild(turnBtn);
  bar.appendChild(pickBtn);
  bar.appendChild(closeBtn);
  bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  bar.hidden = true;
  layer.appendChild(bar);

  // ---- tray (bottom, replaces the hotbar while editing)
  const tray = el("div", "dm-panel edit-tray");
  tray.id = "edit-tray";
  tray.setAttribute("role", "toolbar");
  tray.setAttribute("aria-label", "Furniture in your bag");
  const trayLabel = el("span", "edit-tray-label", "Place");
  const traySlots = el("div", "edit-tray-slots");
  tray.appendChild(trayLabel);
  tray.appendChild(traySlots);
  tray.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  tray.hidden = true;
  layer.appendChild(tray);

  let multi = false;
  let traySig = "";

  function applyToolbar(state: EditToolbarState): void {
    countEl.textContent = state.holding ? (state.name ?? "") : state.count > 1 ? `${state.count} pieces` : "";
    countEl.hidden = !state.holding && state.count <= 1;
    turnBtn.disabled = !state.canTurn;
    // Holding a new piece: "Put back" already says it; the cross would say the same again.
    closeBtn.hidden = state.holding;
    bar.classList.toggle("is-docked", state.holding);
    pickBtn.disabled = !state.holding && !state.canPickUp;
    const label = pickBtn.querySelector(".edit-tool-label");
    if (label) label.textContent = state.holding ? "Put back" : "Pick up";
    pickBtn.title = state.holding ? "Put it back in your bag (Esc)" : "Pick up into your bag (Del)";
  }

  return {
    setAvailable(on) {
      editBtn.hidden = !on;
    },
    setActive(on) {
      banner.hidden = !on;
      tray.hidden = !on;
      editBtn.classList.toggle("is-on", on);
      editBtn.setAttribute("aria-pressed", String(on));
      root.classList.toggle("dm-editing", on);
      if (!on) bar.hidden = true;
      uiSound(on ? "open" : "close");
    },
    setMulti(on) {
      multi = on;
      multiBtn.classList.toggle("is-on", on);
      multiBtn.setAttribute("aria-pressed", String(on));
    },
    setTray(items, held) {
      const sig = `${held}|${items.map((i) => `${i.slot}:${i.item}:${i.qty}`).join(",")}`;
      if (sig === traySig) return;
      traySig = sig;
      traySlots.replaceChildren();
      if (items.length === 0) {
        traySlots.appendChild(el("span", "dm-muted edit-tray-empty", "No furniture in your bag. The furniture stall in the village sells some."));
        return;
      }
      for (const it of items) {
        const b = el("button", "dm-slot edit-tray-slot");
        b.type = "button";
        b.dataset.slot = String(it.slot);
        b.dataset.item = it.item;
        const name = getItem(it.item)?.name ?? it.item;
        b.setAttribute("aria-label", `${name} (${it.qty})`);
        b.setAttribute("aria-pressed", String(held === it.slot));
        b.classList.toggle("is-held", held === it.slot);
        const img = el("img", "edit-tray-icon");
        img.alt = "";
        try {
          img.src = iconFor(it.item);
        } catch {
          // no icon: the label still reads
        }
        b.appendChild(img);
        if (it.qty > 1) b.appendChild(el("span", "edit-tray-qty", String(it.qty)));
        itemTip().attach(b, () => ({ item: it.item, qty: it.qty }));
        b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          uiSound("select");
          opts.hold(held === it.slot ? null : it.slot);
        });
        traySlots.appendChild(b);
      }
    },
    setToolbar(at, state) {
      if (!at || !state) {
        bar.hidden = true;
        return;
      }
      applyToolbar(state);
      bar.hidden = false;
      // Docked (holding a new piece) it stays put above the tray while the ghost follows you.
      bar.style.left = state.holding ? "" : `${Math.round(at.x)}px`;
      bar.style.top = state.holding ? "" : `${Math.round(at.y)}px`;
    },
    toolbarSize(state) {
      if (bar.hidden) {
        // Measure off screen so the first placement is right too.
        applyToolbar(state);
        bar.style.left = "-9999px";
        bar.hidden = false;
        const r = bar.getBoundingClientRect();
        bar.hidden = true;
        return { w: r.width || 220, h: r.height || 44 };
      }
      const r = bar.getBoundingClientRect();
      return { w: r.width, h: r.height };
    },
    destroy() {
      root.classList.remove("dm-editing");
      layer.remove();
    },
  };
}
