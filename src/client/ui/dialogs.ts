// Shop dialog, village goals panel, toast notices and the guest "create an account" prompt.
// All text goes through textContent; server and item names are never parsed as HTML.
import type { ShopOffer, VillageGoal } from "../../shared/protocol";
import type { Inventory, ItemId } from "../../shared/types";
import { clampQty, donatePlan, itemName, maxAffordable, MAX_STEP_QTY, progress, sellRows } from "./dialogs-logic";
import { mountAccountForm } from "./auth";
import { iconFor } from "./icons";
import { itemTip } from "./item-tip";
import { uiSound } from "./sound";
import type { CreateAccountPrompt, CreateGoals, CreateNotices, CreateShop } from "./index";
import "./styles/dialogs.css";

const NOTICE_MS = 3500;
const MAX_NOTICES = 5;
const MAX_TEXT = 200;

// ---------- DOM helpers ----------

// appendChild rather than append(): the combined tsconfig merges Workers types, whose HTMLRewriter Element.append
// signature shadows the DOM one.
function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, cls: string, onClick: () => void, sound = "click"): HTMLButtonElement {
  const b = el("button", `dm-btn ${cls}`.trim(), label);
  b.type = "button";
  b.addEventListener("mouseenter", () => {
    if (!b.disabled) uiSound("hover");
  });
  b.addEventListener("click", () => {
    if (b.disabled) return;
    if (sound) uiSound(sound);
    onClick();
  });
  return b;
}

function closeButton(onClick: () => void): HTMLButtonElement {
  const b = button("×", "dm-close", onClick, "");
  b.className = "dm-close";
  b.setAttribute("aria-label", "Close");
  return b;
}

/** The item's icon, with the shared item tooltip (the row's text already names it). */
function icon(item: ItemId, qty = 1): HTMLElement {
  const img = el("img", "dlg-icon");
  img.alt = "";
  img.width = 32;
  img.height = 32;
  let out: HTMLElement = img;
  try {
    img.src = iconFor(item);
  } catch {
    out = el("span", "dlg-icon dlg-icon-fallback", itemName(item).charAt(0).toUpperCase());
  }
  itemTip().attach(out, () => ({ item, qty }));
  return out;
}

function coinText(n: number): string {
  return `${n.toLocaleString()} c`;
}

interface Stepper {
  root: HTMLElement;
}

/** − [n] + control. `get`/`set` keep the value in the caller's state so re-renders preserve it. */
function stepper(get: () => number, set: (n: number) => void, max: number, onChange: () => void): Stepper {
  const root = el("div", "dlg-stepper");
  const input = el("input", "dlg-qty");
  input.type = "number";
  input.min = "1";
  input.max = String(Math.max(1, max));
  input.value = String(get());
  input.setAttribute("aria-label", "Quantity");
  const apply = (n: number) => {
    set(clampQty(n, max));
    input.value = String(get());
    onChange();
  };
  const minus = button("−", "dlg-step", () => apply(get() - 1));
  const plus = button("+", "dlg-step", () => apply(get() + 1));
  minus.setAttribute("aria-label", "Less");
  plus.setAttribute("aria-label", "More");
  input.addEventListener("change", () => apply(Number(input.value)));
  // Keep game keys (WASD, I, G) from firing while typing a number.
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") input.blur();
  });
  add(root, minus, input, plus);
  return { root };
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

// ---------- shop ----------

export const createShop: CreateShop = (root, opts) => {
  const dialog = el("div", "dm-panel dlg-shop");
  dialog.id = "shop-dialog";
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", "shop-title");

  const header = el("div", "dlg-header");
  const title = el("h2", "dlg-title");
  title.id = "shop-title";
  const coins = el("span", "dlg-coins");
  coins.id = "shop-coins";
  add(header, title, coins, closeButton(() => close(true)));

  const tabs = el("div", "dlg-tabs");
  tabs.setAttribute("role", "tablist");
  const buyTab = button("Buy", "dlg-tab", () => setTab("buy"), "tab");
  const sellTab = button("Sell", "dlg-tab", () => setTab("sell"), "tab");
  buyTab.id = "shop-tab-buy";
  sellTab.id = "shop-tab-sell";
  for (const t of [buyTab, sellTab]) t.setAttribute("role", "tab");
  add(tabs, buyTab, sellTab);

  const list = el("ul", "dlg-list");
  list.id = "shop-list";
  add(dialog, header, tabs, list);
  add(root, dialog);

  let npc = "";
  let offers: ShopOffer[] = [];
  let buys: ItemId[] = [];
  let inv: Inventory = { coins: 0, slots: [] };
  let tab: "buy" | "sell" = "buy";
  const buyQty = new Map<ItemId, number>();
  const sellQty = new Map<number, number>();

  function setTab(t: "buy" | "sell") {
    tab = t;
    render();
  }

  function render() {
    coins.textContent = coinText(inv.coins);
    buyTab.setAttribute("aria-selected", String(tab === "buy"));
    sellTab.setAttribute("aria-selected", String(tab === "sell"));
    buyTab.classList.toggle("is-active", tab === "buy");
    sellTab.classList.toggle("is-active", tab === "sell");
    sellTab.hidden = buys.length === 0;
    list.replaceChildren(...(tab === "buy" ? buyRows() : sellRowEls()));
  }

  function buyRows(): HTMLElement[] {
    if (offers.length === 0) return [el("li", "dlg-empty", "Nothing for sale today.")];
    return offers.map((o) => {
      const li = el("li", "dlg-row");
      const price = el("span", "dlg-price");
      const action = button("Buy", "dm-btn-primary dlg-action", () => {
        const qty = buyQty.get(o.item) ?? 1;
        opts.send({ t: "buy", npc, item: o.item, qty });
      }, "confirm");
      const refresh = () => {
        const qty = buyQty.get(o.item) ?? 1;
        const total = o.price * qty;
        price.textContent = coinText(total);
        const ok = total <= inv.coins;
        action.disabled = !ok;
        li.classList.toggle("is-disabled", maxAffordable(o.price, inv.coins) < 1);
        action.title = ok ? "" : "Not enough coins";
      };
      const st = stepper(
        () => buyQty.get(o.item) ?? 1,
        (n) => buyQty.set(o.item, n),
        MAX_STEP_QTY,
        refresh,
      );
      add(li, icon(o.item), el("span", "dlg-name", itemName(o.item)), el("span", "dlg-unit", `${o.price} c each`), st.root, price, action);
      refresh();
      return li;
    });
  }

  function sellRowEls(): HTMLElement[] {
    const rows = sellRows(inv, buys);
    if (rows.length === 0) return [el("li", "dlg-empty", "You have nothing this shop buys.")];
    return rows.map((r) => {
      const li = el("li", "dlg-row");
      const total = el("span", "dlg-price");
      const action = button("Sell", "dm-btn-primary dlg-action", () => {
        opts.send({ t: "sell", npc, slot: r.slot, qty: clampQty(sellQty.get(r.slot) ?? 1, r.qty) });
      }, "confirm");
      const get = () => clampQty(sellQty.get(r.slot) ?? 1, r.qty);
      const refresh = () => {
        total.textContent = `+${coinText(r.price * get())}`;
      };
      const st = stepper(get, (n) => sellQty.set(r.slot, n), r.qty, refresh);
      add(li, icon(r.item, r.qty), el("span", "dlg-name", `${itemName(r.item)} ×${r.qty}`), el("span", "dlg-unit", `${r.price} c each`), st.root, total, action);
      refresh();
      return li;
    });
  }

  function close(sound: boolean) {
    if (dialog.hidden) return;
    dialog.hidden = true;
    if (sound) uiSound("close");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dialog.hidden && !isTypingTarget(e.target)) close(true);
  });

  return {
    open(npcId, name, o, b, i) {
      const wasOpen = !dialog.hidden;
      if (npcId !== npc) {
        buyQty.clear();
        sellQty.clear();
        tab = "buy";
      }
      npc = npcId;
      offers = o;
      buys = b;
      inv = i;
      title.textContent = name.slice(0, 60);
      dialog.hidden = false;
      render();
      if (!wasOpen) uiSound("open");
    },
    setInventory(i) {
      inv = i;
      // Sell quantities are keyed by slot; a changed inventory can move items around.
      sellQty.clear();
      if (!dialog.hidden) render();
    },
    close() {
      // Sounds only when it was actually open (Esc in the world calls this every time).
      close(true);
    },
  };
};

// ---------- goals ----------

export const createGoals: CreateGoals = (root, opts) => {
  const panel = el("div", "dm-panel dlg-goals");
  panel.id = "goals-panel";
  panel.hidden = true;
  const header = el("div", "dlg-header");
  add(header, el("h2", "dlg-title", "Village Goals"), closeButton(() => hide()));
  const list = el("ul", "dlg-goal-list");
  add(panel, header, list);
  add(root, panel);

  let goals: VillageGoal[] = [];
  let inv: Inventory = { coins: 0, slots: [] };

  function render() {
    if (goals.length === 0) {
      list.replaceChildren(el("li", "dlg-empty", "No village goals right now."));
      return;
    }
    list.replaceChildren(...goals.map(goalEl));
  }

  function goalEl(g: VillageGoal): HTMLElement {
    const li = el("li", `dlg-goal${g.done ? " is-done" : ""}`);
    li.dataset.goal = g.id;
    const head = el("div", "dlg-goal-head");
    add(head, el("h3", "dlg-goal-name", g.name));
    if (g.done) add(head, el("span", "dlg-badge", "Complete!"));
    const needs = el("ul", "dlg-needs");
    for (const n of g.needs) {
      const row = el("li", "dlg-need");
      const bar = el("div", "dlg-bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(n.qty));
      bar.setAttribute("aria-valuenow", String(Math.min(n.have, n.qty)));
      const fill = el("div", "dlg-bar-fill");
      fill.style.width = `${Math.round(progress(n.have, n.qty) * 100)}%`;
      add(bar, fill, el("span", "dlg-bar-text", `${Math.min(n.have, n.qty)} / ${n.qty}`));
      add(row, icon(n.item), el("span", "dlg-name", itemName(n.item)), bar);
      const plan = g.done ? null : donatePlan(n, inv);
      if (plan) {
        add(
          row,
          button(`Donate ${plan.qty}`, "dm-btn-primary dlg-action", () => {
            opts.send({ t: "donate", goal: g.id, slot: plan.slot, qty: plan.qty });
          }, "confirm"),
        );
      }
      add(needs, row);
    }
    add(li, head, needs);
    return li;
  }

  function hide() {
    if (panel.hidden) return;
    panel.hidden = true;
    uiSound("close");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden && !isTypingTarget(e.target)) hide();
  });

  render();
  return {
    set(g) {
      goals = g;
      render();
    },
    setInventory(i) {
      inv = i;
      render();
    },
    toggle() {
      if (panel.hidden) {
        panel.hidden = false;
        uiSound("open");
        render();
      } else hide();
    },
  };
};

// ---------- notices ----------

export const createNotices: CreateNotices = (root) => {
  const stack = el("div", "dlg-notices");
  stack.setAttribute("role", "status");
  stack.setAttribute("aria-live", "polite");
  add(root, stack);

  function dismiss(n: HTMLElement) {
    if (!n.isConnected || n.classList.contains("is-leaving")) return;
    n.classList.add("is-leaving");
    // Remove after the fade; fallback timer in case transitionend never fires (hidden tab).
    const done = () => n.remove();
    n.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 400);
  }

  return {
    notice(text, kind) {
      const n = el("div", `dlg-notice dlg-notice-${kind}`, String(text).slice(0, MAX_TEXT));
      n.addEventListener("click", () => dismiss(n));
      add(stack, n);
      while (stack.childElementCount > MAX_NOTICES) stack.firstElementChild?.remove();
      if (kind === "error") uiSound("error");
      setTimeout(() => dismiss(n), kind === "error" ? NOTICE_MS + 1500 : NOTICE_MS);
    },
  };
};

// ---------- account prompt ----------

export const createAccountPrompt: CreateAccountPrompt = (root) => {
  let pending: Promise<boolean> | null = null;

  return {
    show(reason) {
      if (pending) return pending;
      pending = new Promise<boolean>((resolve) => {
        const backdrop = el("div", "dlg-backdrop");
        backdrop.id = "account-prompt";
        const box = el("div", "dm-panel dlg-account");
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.setAttribute("aria-labelledby", "account-prompt-title");
        const header = el("div", "dlg-header");
        const title = el("h2", "dlg-title", "Create an account to explore");
        title.id = "account-prompt-title";
        add(header, title, closeButton(() => finish(false)));
        // The embedded account form shows the reason and its own "Not now", so the dialog adds
        // neither (they used to appear twice).
        const formHost = el("div", "dlg-account-form");
        const error = el("p", "dlg-error");
        error.hidden = true;
        add(box, header, formHost, error);
        add(backdrop, box);
        add(root, backdrop);
        uiSound("open");

        let settled = false;
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") finish(false);
        };
        document.addEventListener("keydown", onKey);

        function finish(ok: boolean) {
          if (settled) return;
          settled = true;
          document.removeEventListener("keydown", onKey);
          backdrop.remove();
          uiSound(ok ? "confirm" : "close");
          pending = null;
          resolve(ok);
        }

        mountAccountForm(formHost, { reason }).then(
          (user) => finish(user !== null),
          (err: unknown) => {
            if (settled) return;
            error.textContent = err instanceof Error ? err.message.slice(0, MAX_TEXT) : "Something went wrong.";
            error.hidden = false;
            uiSound("error");
          },
        );
      });
      return pending;
    },
  };
};
