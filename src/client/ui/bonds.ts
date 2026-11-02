// Friendship UI: the Relationships panel (every villager met, warmest first). The conversation
// window (ui/convo.ts) shows hearts while you talk. Text goes in with textContent only.
import type { BondView } from "../../shared/hearts";
import { heartProgress, heartRow, progressText, rowMarkers } from "./bonds-logic";
import { uiSound } from "./sound";
import "./styles/bonds.css";

export interface BondsUi {
  setList(list: BondView[]): void;
  /** Friendship with one villager changed. */
  bond(view: BondView): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** appendChild for several children (Element.append isn't typed in every project config). */
function put(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

function hearts(n: number, className: string): HTMLElement {
  const row = el("span", `bond-hearts ${className}`);
  row.setAttribute("aria-label", `${n} of 10 hearts`);
  for (const s of heartRow(n)) row.appendChild(el("span", `bond-heart ${s}`));
  return row;
}

function bar(v: BondView): HTMLElement {
  const b = el("div", "bond-bar");
  b.setAttribute("role", "progressbar");
  b.setAttribute("aria-valuemin", "0");
  b.setAttribute("aria-valuemax", "100");
  const pct = Math.round(heartProgress(v) * 100);
  b.setAttribute("aria-valuenow", String(pct));
  const fill = el("div", "bond-bar-fill");
  fill.style.width = `${pct}%`;
  put(b, fill, el("span", "bond-bar-text", progressText(v)));
  return b;
}

function closeBtn(onClick: () => void): HTMLButtonElement {
  const b = el("button", "dm-btn dm-btn-small dlg-close", "×");
  b.type = "button";
  b.title = "Close";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function createBondsUi(root: HTMLElement): BondsUi {
  // ---- relationships panel
  const panel = el("div", "dm-panel bond-panel");
  panel.id = "bonds-panel";
  panel.hidden = true;
  const head = el("div", "dlg-header");
  put(head, el("h2", "dlg-title", "Relationships"), closeBtn(() => api.close()));
  const list = el("ul", "bond-list");
  put(panel, head, list);
  put(root, panel);

  let views: BondView[] = [];
  function renderList(): void {
    if (views.length === 0) {
      list.replaceChildren(el("li", "dlg-empty", "Talk to villagers to get to know them."));
      return;
    }
    list.replaceChildren(
      ...views.map((v) => {
        const li = el("li", "bond-row");
        li.dataset.npc = v.npc;
        const top = el("div", "bond-row-top");
        put(top, el("span", "bond-row-name", v.name), hearts(v.hearts, ""));
        const marks = el("div", "bond-row-marks");
        for (const m of rowMarkers(v)) {
          const chip = el("span", `bond-mark bond-mark-${m.key}${m.on ? " is-on" : ""}`, m.text);
          chip.title = m.title;
          chip.setAttribute("aria-label", m.title);
          marks.appendChild(chip);
        }
        put(li, top, bar(v), marks);
        return li;
      }),
    );
  }
  renderList();

  const api: BondsUi = {
    setList(next) {
      views = [...next];
      renderList();
    },
    bond(view) {
      const i = views.findIndex((v) => v.npc === view.npc);
      if (i >= 0) views[i] = view;
      else views.push(view);
      renderList();
    },
    toggle() {
      if (panel.hidden) {
        panel.hidden = false;
        uiSound("open");
      } else api.close();
    },
    close() {
      if (panel.hidden) return;
      panel.hidden = true;
      uiSound("close");
    },
    isOpen: () => !panel.hidden,
  };
  return api;
}
