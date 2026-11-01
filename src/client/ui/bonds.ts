// Friendship UI: the talk card (who you're talking to, their hearts and what they last said) and
// the Relationships panel (every villager met, warmest first). Text goes in with textContent only.
import type { BondView } from "../../shared/hearts";
import type { ItemId } from "../../shared/types";
import { getItem } from "../../shared/items";
import { iconFor } from "./icons";
import { gainText, heartProgress, heartRow, progressText, rowMarkers, todayText } from "./bonds-logic";
import { uiSound } from "./sound";
import "./styles/bonds.css";

/** The talk card hides this long after the last thing that happened in the conversation. */
const CARD_MS = 14_000;
const MAX_LINE = 220;

export interface BondsUi {
  setList(list: BondView[]): void;
  /** Friendship with one villager changed or you spoke to them (`talk` opens the card). */
  bond(view: BondView, delta: number, talk: boolean, entityId?: string, gifts?: ItemId[]): void;
  /** A villager said something to you; shown on the card when it is theirs. */
  said(entityId: string, text: string): void;
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
  // ---- talk card
  const card = el("div", "dm-panel bond-card");
  card.id = "bond-card";
  card.hidden = true;
  const cardName = el("h3", "bond-card-name");
  const cardHearts = el("div", "bond-card-hearts");
  const cardBar = el("div", "bond-card-bar");
  const cardLine = el("p", "bond-card-line");
  const cardToday = el("p", "bond-card-today dm-muted");
  const cardGift = el("div", "bond-card-gift");
  cardGift.hidden = true;
  const cardHead = el("div", "bond-card-head");
  put(cardHead, cardName, closeBtn(() => hideCard()));
  put(card, cardHead, cardHearts, cardBar, cardLine, cardGift, cardToday);

  // ---- relationships panel
  const panel = el("div", "dm-panel bond-panel");
  panel.id = "bonds-panel";
  panel.hidden = true;
  const head = el("div", "dlg-header");
  put(head, el("h2", "dlg-title", "Relationships"), closeBtn(() => api.close()));
  const list = el("ul", "bond-list");
  put(panel, head, list);
  put(root, card, panel);

  let views: BondView[] = [];
  let cardNpc: string | null = null;
  let cardEntity: string | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  /** "Pip gave you: [icon] Candle, [icon] Crate" under their line. */
  function showGifts(name: string, gifts: ItemId[]): void {
    cardGift.replaceChildren(el("span", "bond-card-gift-label", `${name} gave you`));
    for (const item of gifts) {
      const chip = el("span", "bond-gift-chip");
      let src: string | null = null;
      try {
        src = iconFor(item);
      } catch {
        src = null;
      }
      if (src) {
        const img = el("img");
        img.src = src;
        img.alt = "";
        chip.appendChild(img);
      }
      chip.appendChild(el("span", "", getItem(item)?.name ?? item));
      cardGift.appendChild(chip);
    }
    cardGift.hidden = false;
  }

  function hideCard(): void {
    card.hidden = true;
    cardGift.hidden = true;
    cardNpc = null;
    cardEntity = null;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  }

  function keepCard(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCard, CARD_MS);
  }

  function renderCard(v: BondView): void {
    cardName.textContent = v.name;
    cardHearts.replaceChildren(hearts(v.hearts, "bond-hearts-big"));
    cardBar.replaceChildren(bar(v));
    cardToday.textContent = v.pending > 0 ? `${v.name} has a gift waiting for you. Make room in your bag!` : todayText(v);
  }

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
      const mine = cardNpc ? views.find((v) => v.npc === cardNpc) : undefined;
      if (mine && !card.hidden) renderCard(mine);
    },
    bond(view, delta, talk, entityId, gifts) {
      const i = views.findIndex((v) => v.npc === view.npc);
      if (i >= 0) views[i] = view;
      else views.push(view);
      renderList();
      if (talk && cardNpc !== view.npc) {
        cardLine.textContent = "…";
        cardLine.classList.add("is-waiting");
        cardGift.hidden = true;
      }
      if (talk || cardNpc === view.npc) {
        cardNpc = view.npc;
        cardEntity = entityId ?? cardEntity;
        renderCard(view);
        card.hidden = false;
        keepCard();
      }
      if (gifts && gifts.length > 0 && cardNpc === view.npc) showGifts(view.name, gifts);
      if (delta !== 0 && !card.hidden && cardNpc === view.npc) {
        const pop = el("span", `bond-pop ${delta > 0 ? "up" : "down"}`, gainText(delta) ?? "");
        cardHearts.appendChild(pop);
        setTimeout(() => pop.remove(), 1400);
      }
    },
    said(entityId, text) {
      if (card.hidden || entityId !== cardEntity) return;
      cardLine.textContent = text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text;
      cardLine.classList.remove("is-waiting");
      keepCard();
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
