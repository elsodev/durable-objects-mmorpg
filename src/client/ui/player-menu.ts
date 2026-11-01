// Small context menu for another player: right-click (or touch long-press) on a player in the world
// or on a player's name in chat -> "Add friend" / "Whisper".
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from "./friends-logic";
import { uiSound } from "./sound";

export interface PlayerMenuOpts {
  /** Player name under a screen point in the game canvas, or null (yourself, NPCs, empty ground). */
  playerNameAt(clientX: number, clientY: number): string | null;
  addFriend(name: string): void;
  whisper(name: string): void;
}

export interface PlayerMenu {
  open(name: string, clientX: number, clientY: number): void;
  close(): void;
}

/** Elements carrying this attribute (chat names) name a player. */
export const PLAYER_NAME_ATTR = "data-player-name";

function nameFor(target: EventTarget | null, x: number, y: number, opts: PlayerMenuOpts): string | null {
  if (target instanceof Element) {
    const tagged = target.closest(`[${PLAYER_NAME_ATTR}]`);
    if (tagged) return tagged.getAttribute(PLAYER_NAME_ATTR) || null;
    if (target instanceof HTMLCanvasElement) {
      try {
        return opts.playerNameAt(x, y);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function createPlayerMenu(root: HTMLElement, opts: PlayerMenuOpts): PlayerMenu {
  const menu = document.createElement("div");
  menu.id = "player-menu";
  menu.className = "dm-panel fr-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const title = document.createElement("div");
  title.className = "fr-menu-title";
  menu.appendChild(title);
  root.appendChild(menu);

  let current = "";
  const item = (label: string, id: string, run: (name: string) => void): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = "dm-btn dm-btn-small fr-menu-item";
    b.setAttribute("role", "menuitem");
    b.textContent = label;
    b.addEventListener("pointerenter", () => uiSound("hover"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      uiSound("click");
      const name = current;
      close();
      if (name) run(name);
    });
    menu.appendChild(b);
  };
  item("Add friend", "player-menu-add", opts.addFriend);
  item("Whisper", "player-menu-whisper", opts.whisper);

  function open(name: string, x: number, y: number): void {
    current = name;
    title.textContent = name;
    menu.hidden = false;
    uiSound("open");
    // Keep it on screen.
    const w = menu.offsetWidth || 140;
    const h = menu.offsetHeight || 90;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
    (menu.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  function close(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    current = "";
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      const name = nameFor(e.target, e.clientX, e.clientY, opts);
      if (!name) return;
      e.preventDefault();
      open(name, e.clientX, e.clientY);
    },
    true,
  );

  // Touch long-press (iOS Safari never fires contextmenu for it).
  let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const cancelPress = (): void => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!menu.hidden && !(e.target instanceof Node && menu.contains(e.target))) close();
      if (e.pointerType === "mouse" || !e.isPrimary) return cancelPress();
      cancelPress();
      const { clientX: x, clientY: y, target } = e;
      press = {
        id: e.pointerId,
        x,
        y,
        timer: setTimeout(() => {
          press = null;
          const name = nameFor(target, x, y, opts);
          if (name) open(name, x, y);
        }, LONG_PRESS_MS),
      };
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP_PX) {
        cancelPress();
      }
    },
    true,
  );
  for (const type of ["pointerup", "pointercancel"] as const) document.addEventListener(type, cancelPress, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return { open, close };
}
