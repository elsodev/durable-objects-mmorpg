// Pure state for the tabbed game menu (ui/game-menu.ts): which tab is open and which sound each
// step plays (open and close: the drawer; switching tabs: the tab click).

export const MENU_TABS = ["bag", "hearts", "friends", "map", "options"] as const;
export type MenuTab = (typeof MENU_TABS)[number];

export const MENU_LABELS: Readonly<Record<MenuTab, string>> = {
  bag: "Bag",
  hearts: "Hearts",
  friends: "Friends",
  map: "Map",
  options: "Options",
};

/** Hotkey shown on each tab (handled by the HUD's shortcut table). */
export const MENU_KEYS: Readonly<Partial<Record<MenuTab, string>>> = { bag: "I", hearts: "H", friends: "O", map: "M" };

export interface MenuState {
  open: boolean;
  tab: MenuTab;
}

export type MenuAction =
  /** A hotkey or HUD button: opens on that tab, closes if it's already showing, else switches. */
  | { k: "toggle"; tab: MenuTab }
  | { k: "open"; tab?: MenuTab }
  | { k: "close" }
  /** A tab button. */
  | { k: "select"; tab: MenuTab }
  | { k: "cycle"; dir: 1 | -1 };

export type MenuSound = "open" | "close" | "tab" | null;

export function isMenuTab(v: unknown): v is MenuTab {
  return typeof v === "string" && (MENU_TABS as readonly string[]).includes(v);
}

export function menuStep(s: MenuState, a: MenuAction): { state: MenuState; sound: MenuSound } {
  const same = { state: s, sound: null };
  switch (a.k) {
    case "toggle":
      if (!s.open) return { state: { open: true, tab: a.tab }, sound: "open" };
      if (s.tab === a.tab) return { state: { ...s, open: false }, sound: "close" };
      return { state: { open: true, tab: a.tab }, sound: "tab" };
    case "open": {
      const tab = a.tab ?? s.tab;
      if (!s.open) return { state: { open: true, tab }, sound: "open" };
      return tab === s.tab ? same : { state: { open: true, tab }, sound: "tab" };
    }
    case "close":
      return s.open ? { state: { ...s, open: false }, sound: "close" } : same;
    case "select":
      if (!s.open || s.tab === a.tab) return same;
      return { state: { open: true, tab: a.tab }, sound: "tab" };
    case "cycle": {
      if (!s.open) return same;
      const i = MENU_TABS.indexOf(s.tab);
      const tab = MENU_TABS[(i + a.dir + MENU_TABS.length) % MENU_TABS.length]!;
      return { state: { open: true, tab }, sound: "tab" };
    }
  }
}

/** The tab remembered from last time (localStorage text), or the bag. */
export function restoreTab(stored: string | null | undefined): MenuTab {
  return isMenuTab(stored) ? stored : "bag";
}
