// One tabbed menu for Bag, Hearts, Friends, Map and Options. The existing panels move into its
// panes; the menu decides which one shows and plays the sounds (the drawer to open and close, a
// tab click to switch) while the panels are driven quietly. A panel that opens or closes itself
// (e.g. "/friend name" opens Friends) is followed: the menu opens on that tab, or closes with it.
import { MENU_KEYS, MENU_LABELS, MENU_TABS, menuStep, restoreTab, type MenuAction, type MenuState, type MenuTab } from "./game-menu-logic";
import { quietly, uiSound } from "./sound";
import "./styles/game-menu.css";

export interface MenuPane {
  /** The pane's content root (an existing panel is moved in here). */
  el: HTMLElement;
  /** Show / hide the content (called with UI sounds muted). */
  show(): void;
  hide(): void;
}

export interface GameMenu {
  toggle(tab: MenuTab): void;
  open(tab?: MenuTab): void;
  close(): void;
  isOpen(): boolean;
  tab(): MenuTab;
  destroy(): void;
}

const STORE_KEY = "dmmo.menuTab";

function readTab(): MenuTab {
  try {
    return restoreTab(localStorage.getItem(STORE_KEY));
  } catch {
    return "bag";
  }
}

function saveTab(tab: MenuTab): void {
  try {
    localStorage.setItem(STORE_KEY, tab);
  } catch {
    // Remembering the tab is a convenience only.
  }
}

export function createGameMenu(root: HTMLElement, panes: Record<MenuTab, MenuPane>): GameMenu {
  let state: MenuState = { open: false, tab: readTab() };

  const shell = document.createElement("section");
  shell.id = "game-menu";
  shell.className = "dm-panel game-menu";
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-label", "Menu");
  shell.hidden = true;

  const bar = document.createElement("div");
  bar.className = "game-menu-tabs";
  bar.setAttribute("role", "tablist");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "game-menu-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close menu");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dispatch({ k: "close" });
  });

  const body = document.createElement("div");
  body.className = "game-menu-body";

  const tabBtns = new Map<MenuTab, HTMLButtonElement>();
  const paneEls = new Map<MenuTab, HTMLElement>();
  for (const t of MENU_TABS) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = `menu-tab-${t}`;
    b.className = "game-menu-tab";
    b.setAttribute("role", "tab");
    b.dataset.tab = t;
    const key = MENU_KEYS[t];
    b.textContent = MENU_LABELS[t];
    if (key) {
      const k = document.createElement("span");
      k.className = "game-menu-key";
      k.textContent = key;
      b.appendChild(k);
    }
    b.addEventListener("pointerenter", () => uiSound("hover"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      dispatch({ k: "select", tab: t });
    });
    bar.appendChild(b);
    tabBtns.set(t, b);

    const pane = document.createElement("div");
    pane.className = `game-menu-pane game-menu-pane-${t}`;
    pane.setAttribute("role", "tabpanel");
    pane.hidden = true;
    pane.appendChild(panes[t].el);
    body.appendChild(pane);
    paneEls.set(t, pane);
  }
  bar.appendChild(closeBtn);
  shell.appendChild(bar);
  shell.appendChild(body);
  root.appendChild(shell);

  // Esc inside the menu closes the whole menu (before a panel's own Esc handler sees it).
  shell.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      dispatch({ k: "close" });
    },
    { capture: true },
  );

  /** Applies a state without sounds; panes are driven quietly. */
  function apply(next: MenuState): void {
    const prev = state;
    state = next;
    shell.hidden = !next.open;
    shell.classList.toggle("is-open", next.open);
    for (const t of MENU_TABS) {
      const active = next.open && next.tab === t;
      tabBtns.get(t)!.classList.toggle("is-active", active);
      tabBtns.get(t)!.setAttribute("aria-selected", String(active));
      paneEls.get(t)!.hidden = !active;
    }
    const wasShown = prev.open ? prev.tab : null;
    const nowShown = next.open ? next.tab : null;
    if (wasShown !== nowShown) {
      quietly(() => {
        if (wasShown && !panes[wasShown].el.hidden) panes[wasShown].hide();
        if (nowShown) panes[nowShown].show();
      });
    }
    if (next.open) saveTab(next.tab);
  }

  function dispatch(a: MenuAction): void {
    const { state: next, sound } = menuStep(state, a);
    if (next === state) return;
    apply(next);
    if (sound) uiSound(sound);
  }

  // Follow panels that open or close themselves.
  const watch = new MutationObserver(() => {
    for (const t of MENU_TABS) {
      const el = panes[t].el;
      const shownByMenu = state.open && state.tab === t;
      if (!el.hidden && !shownByMenu) {
        apply({ open: true, tab: t });
        return;
      }
      if (el.hidden && shownByMenu) {
        apply({ ...state, open: false });
        return;
      }
    }
  });
  for (const t of MENU_TABS) watch.observe(panes[t].el, { attributes: true, attributeFilter: ["hidden"] });

  apply(state);

  return {
    toggle: (tab) => dispatch({ k: "toggle", tab }),
    open: (tab) => dispatch({ k: "open", tab }),
    close: () => dispatch({ k: "close" }),
    isOpen: () => state.open,
    tab: () => state.tab,
    destroy() {
      watch.disconnect();
      shell.remove();
    },
  };
}
