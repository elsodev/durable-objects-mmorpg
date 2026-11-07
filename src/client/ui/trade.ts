// Trading with another player: the request card ("Bob wants to trade with you", Accept / Decline)
// and the trade window (#trade-panel): your offer and theirs side by side, coins for each, your bag
// below, and the Ready / Trade buttons. The server decides everything; this only sends intents
// and redraws from the `trade` messages. Names come from players: textContent only.
import { MAX_SLOTS } from "../../shared/items";
import { TRADE_SLOTS, type TradeItem, type TradeView } from "../../shared/trade";
import type { Inventory, InventorySlot } from "../../shared/types";
import { formatCoins } from "./inventory-format";
import { iconFor } from "./icons";
import { itemTip } from "./item-tip";
import { createSlotMenu } from "./slot-menu";
import { tradeMenuChoices } from "./slot-menu-logic";
import { uiSound } from "./sound";
import { askText, bagLeft, coinInput, secondsLeft, sideBadge, tradeStatus } from "./trade-logic";
import "./styles/trade.css";

export interface TradeUiOpts {
  answer(fromEntity: string, accept: boolean): void;
  add(slot: number, qty: number): void;
  remove(index: number, qty?: number): void;
  coins(coins: number): void;
  ready(ready: boolean): void;
  confirm(): void;
  cancel(): void;
  setTyping(typing: boolean): void;
  now(): number;
}

export interface TradeUi {
  ask(from: string, name: string, expiresAt: number): void;
  askGone(from: string): void;
  set(view: TradeView): void;
  end(): void;
  setInventory(inv: Inventory): void;
  isOpen(): boolean;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function add(parent: Node, ...children: Node[]): void {
  for (const c of children) parent.appendChild(c);
}

function button(text: string, cls: string, id: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.id = id;
  b.addEventListener("pointerenter", () => uiSound("hover"));
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    uiSound("click");
    onClick();
  });
  return b;
}

/** An item slot (or an empty one); `dim`: shown greyed (all of it is in the trade). */
function slotEl(s: InventorySlot | TradeItem | null, cls: string, dim = false): HTMLButtonElement {
  const b = el("button", `dm-slot trade-slot ${cls}${s ? "" : " is-empty"}${dim ? " is-dim" : ""}`);
  b.type = "button";
  if (!s) {
    b.disabled = true;
    b.setAttribute("aria-label", "Empty slot");
    return b;
  }
  const img = el("img");
  img.alt = "";
  img.draggable = false;
  try {
    img.src = iconFor(s.item);
  } catch {
    // no icon: the tooltip still names it
  }
  b.appendChild(img);
  if (s.qty > 1) b.appendChild(el("span", "dm-qty", String(s.qty)));
  itemTip().attach(b, () => s);
  return b;
}

export function createTradeUi(root: HTMLElement, opts: TradeUiOpts): TradeUi {
  const layer = el("div", "hud-layer trade-layer");
  root.appendChild(layer);

  // ---- request card
  let asks: { from: string; name: string; expiresAt: number }[] = [];
  const card = el("div", "dm-panel trade-ask");
  card.id = "trade-ask";
  card.setAttribute("role", "dialog");
  card.hidden = true;
  const askTitle = el("div", "trade-ask-title", "Trade request");
  const askLine = el("p", "trade-ask-text");
  askLine.id = "trade-ask-text";
  const askTime = el("span", "trade-ask-time");
  const answer = (accept: boolean) => () => {
    const a = asks.shift();
    renderAsk();
    if (a) opts.answer(a.from, accept);
  };
  const askActions = el("div", "trade-ask-actions");
  askActions.appendChild(button("Accept", "dm-btn dm-btn-primary", "trade-accept", answer(true)));
  askActions.appendChild(button("Decline", "dm-btn", "trade-decline", answer(false)));
  askActions.appendChild(askTime);
  add(card, askTitle, askLine, askActions);
  layer.appendChild(card);

  function renderAsk(): void {
    const now = opts.now();
    asks = asks.filter((a) => a.expiresAt > now);
    const a = asks[0];
    card.hidden = !a || !!view;
    if (!a) return;
    askLine.textContent = asks.length > 1 ? `${askText(a.name)} (+${asks.length - 1} more)` : askText(a.name);
    askTime.textContent = `${secondsLeft(a.expiresAt, now)}s`;
  }
  const askTimer = setInterval(renderAsk, 500);

  // ---- trade window
  const panel = el("section", "dm-panel trade-panel");
  panel.id = "trade-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Trade");
  panel.hidden = true;
  const head = el("div", "dm-panel-header");
  const title = el("span", "dm-title trade-title", "Trade");
  title.id = "trade-title";
  const closeBtn = el("button", "dm-close", "✕");
  closeBtn.type = "button";
  closeBtn.id = "trade-close";
  closeBtn.setAttribute("aria-label", "Cancel trade");
  closeBtn.addEventListener("click", () => opts.cancel());
  add(head, title, closeBtn);

  function side(id: string, label: string): {
    box: HTMLElement;
    name: HTMLElement;
    badge: HTMLElement;
    grid: HTMLElement;
    coins: HTMLElement;
  } {
    const box = el("div", "trade-side");
    box.id = id;
    const top = el("div", "trade-side-head");
    const name = el("span", "trade-side-name", label);
    const badge = el("span", "trade-badge");
    add(top, name, badge);
    const grid = el("div", "trade-grid");
    const coins = el("div", "trade-coins");
    add(box, top, grid, coins);
    return { box, name, badge, grid, coins };
  }
  const mine = side("trade-mine", "You");
  const theirs = side("trade-theirs", "They offer");
  const arrows = el("div", "trade-arrows", "⇄");
  arrows.setAttribute("aria-hidden", "true");
  const sides = el("div", "trade-sides");
  add(sides, mine.box, arrows, theirs.box);

  // Your coins: a box you type into; theirs: just the number.
  const coinBox = el("input", "dm-input trade-coin-input");
  coinBox.id = "trade-coins";
  coinBox.type = "text";
  coinBox.inputMode = "numeric";
  coinBox.autocomplete = "off";
  coinBox.maxLength = 9;
  coinBox.setAttribute("aria-label", "Coins you offer");
  const commitCoins = (): void => {
    if (!view) return;
    const n = coinInput(coinBox.value, inv.coins);
    coinBox.value = String(n);
    if (n !== view.mine.coins) opts.coins(n);
  };
  coinBox.addEventListener("focus", () => {
    opts.setTyping(true);
    coinBox.select();
  });
  coinBox.addEventListener("blur", () => {
    opts.setTyping(false);
    commitCoins();
  });
  coinBox.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") coinBox.blur();
    if (ev.key === "Escape") {
      coinBox.value = String(view?.mine.coins ?? 0);
      coinBox.blur();
    }
  });
  const myCoinRow = el("label", "trade-coin-row");
  add(myCoinRow, el("span", "dm-coin trade-coin-icon"), coinBox);
  const myPurse = el("span", "trade-purse");
  myCoinRow.appendChild(myPurse);
  mine.coins.appendChild(myCoinRow);
  const theirCoins = el("span", "trade-coin-amount");
  theirCoins.id = "trade-their-coins";
  const theirCoinRow = el("div", "trade-coin-row");
  add(theirCoinRow, el("span", "dm-coin trade-coin-icon"), theirCoins);
  theirs.coins.appendChild(theirCoinRow);

  const bagTitle = el("div", "trade-sub", "Your bag · tap to add, long-press or right-click to pick how many");
  const bag = el("div", "trade-bag");
  bag.id = "trade-bag";
  const status = el("p", "trade-status");
  status.id = "trade-status";
  status.setAttribute("aria-live", "polite");
  const foot = el("div", "trade-foot");
  const cancelBtn = button("Cancel", "dm-btn", "trade-cancel", () => opts.cancel());
  const readyBtn = button("Ready", "dm-btn dm-btn-primary", "trade-ready", () => {
    if (view) opts.ready(!view.ready.mine);
  });
  const tradeBtn = button("Trade", "dm-btn dm-btn-accent trade-go", "trade-confirm", () => opts.confirm());
  const spacer = el("span", "trade-foot-gap");
  add(foot, cancelBtn, spacer, readyBtn, tradeBtn);
  add(panel, head, sides, bagTitle, bag, status, foot);
  layer.appendChild(panel);

  // The bag's own right-click menu: only the Add choices.
  const menu = createSlotMenu(layer, () => {}, {
    noDrop: true,
    extra: (stack) => tradeMenuChoices(stack.qty),
    onTrade: (slot, qty) => {
      const s = left[slot];
      if (s) opts.add(slot, qty ?? s.qty);
    },
  });

  let view: TradeView | null = null;
  let inv: Inventory = { coins: 0, slots: [] };
  let left: (InventorySlot | null)[] = [];

  function drawOffer(target: HTMLElement, items: TradeItem[], mineSide: boolean): void {
    const cells: HTMLButtonElement[] = [];
    for (let i = 0; i < TRADE_SLOTS; i++) {
      const it = items[i] ?? null;
      const b = slotEl(it, mineSide ? "trade-offer-mine" : "trade-offer-theirs");
      if (it && mineSide) {
        b.setAttribute("aria-label", `Take back ${it.qty}`);
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          uiSound("click");
          opts.remove(i, ev.shiftKey ? 1 : undefined);
        });
      } else if (it) {
        b.tabIndex = -1;
        b.classList.add("is-view");
      }
      cells.push(b);
    }
    target.replaceChildren(...cells);
  }

  function draw(): void {
    if (!view) return;
    // Slots are rebuilt, so a tip over an old one would linger on a stale item.
    itemTip().hide();
    const v = view;
    title.textContent = `Trading with ${v.with.name}`;
    theirs.name.textContent = v.with.name;
    theirs.name.title = v.with.name;
    for (const [s, b] of [
      [mine, sideBadge(v.ready.mine, v.confirmed.mine)],
      [theirs, sideBadge(v.ready.theirs, v.confirmed.theirs)],
    ] as const) {
      s.badge.textContent = b.text;
      s.badge.dataset.state = b.state;
      s.box.dataset.state = b.state;
    }
    drawOffer(mine.grid, v.mine.items, true);
    drawOffer(theirs.grid, v.theirs.items, false);
    if (document.activeElement !== coinBox) coinBox.value = String(v.mine.coins);
    myPurse.textContent = `of ${formatCoins(inv.coins)}`;
    theirCoins.textContent = formatCoins(v.theirs.coins);
    theirCoinRow.classList.toggle("is-zero", v.theirs.coins === 0);

    left = bagLeft(inv, v.mine);
    const cells: HTMLButtonElement[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const had = inv.slots[i] ?? null;
      const now = left[i] ?? null;
      const b = slotEl(now ?? had, "trade-bag-slot", !!had && !now);
      if (now) {
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          uiSound("click");
          opts.add(i, ev.shiftKey ? 1 : now.qty);
        });
        b.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          itemTip().hide();
          menu.open(i, now, ev.clientX, ev.clientY);
        });
      } else if (had) {
        b.disabled = true;
        b.setAttribute("aria-label", "All in the trade");
      }
      cells.push(b);
    }
    bag.replaceChildren(...cells);

    const st = tradeStatus(v);
    status.textContent = st.line;
    status.dataset.tone = st.tone;
    readyBtn.textContent = st.readyLabel;
    readyBtn.classList.toggle("dm-btn-primary", !v.ready.mine);
    readyBtn.setAttribute("aria-pressed", String(v.ready.mine));
    tradeBtn.disabled = !st.tradeEnabled;
    tradeBtn.classList.toggle("is-live", st.tradeEnabled);
  }

  // Bubble phase: a menu, the bag or the chat box that handles Escape first stops it reaching here.
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && view && document.activeElement !== coinBox) {
      ev.preventDefault();
      ev.stopPropagation();
      opts.cancel();
    }
  };
  addEventListener("keydown", onKey);

  const api: TradeUi = {
    ask(from, name, expiresAt) {
      asks = asks.filter((a) => a.from !== from);
      asks.push({ from, name: name.slice(0, 40), expiresAt });
      renderAsk();
      uiSound("open");
    },
    askGone(from) {
      asks = asks.filter((a) => a.from !== from);
      renderAsk();
    },
    set(next) {
      const opening = !view;
      view = next;
      // The person you're now trading with no longer needs an answer.
      asks = asks.filter((a) => a.from !== next.with.id);
      panel.hidden = false;
      renderAsk();
      draw();
      if (opening) uiSound("open");
    },
    end() {
      if (!view) return;
      view = null;
      panel.hidden = true;
      menu.close();
      itemTip().hide();
      if (document.activeElement === coinBox) coinBox.blur();
      renderAsk();
    },
    setInventory(next) {
      inv = next;
      draw();
    },
    isOpen: () => !!view,
    destroy() {
      clearInterval(askTimer);
      removeEventListener("keydown", onKey);
      layer.remove();
    },
  };
  return api;
}
