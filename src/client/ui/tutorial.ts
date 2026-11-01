// Controls card: shown once per account the first time they reach the world, and from the HUD
// "Controls" button any time after.
import "./styles/tutorial.css";
import { uiSound } from "./sound";
import { CONTROL_GROUPS, markTutorialSeen, tutorialSeen, type KeyValueStore } from "./tutorial-logic";

export interface Tutorial {
  open(): void;
  /** Opens it unless this account has already dismissed it. */
  openFirstTime(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

function storage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createTutorial(parent: HTMLElement, opts: { userId: string; setTyping(t: boolean): void }): Tutorial {
  const backdrop = el("div", "dm-tutorial");
  backdrop.id = "tutorial";
  backdrop.hidden = true;
  const card = el("div", "dm-panel dm-tutorial-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "tutorial-title");
  const title = el("h2", "dm-title", "Welcome to Mossbrook!");
  title.id = "tutorial-title";
  const intro = el("p", "dm-tutorial-intro", "Here's how to get around. You can open this again from Controls in the menu.");
  const grid = el("div", "dm-tutorial-grid");
  for (const g of CONTROL_GROUPS) {
    const section = el("section", "dm-tutorial-group");
    section.appendChild(el("h3", "dm-tutorial-group-title", g.title));
    for (const r of g.rows) {
      const row = el("div", "dm-tutorial-row");
      const keys = el("span", "dm-tutorial-keys");
      for (const k of r.keys) {
        if (k === "–") keys.appendChild(el("span", "dm-tutorial-sep", "–"));
        else keys.appendChild(el("kbd", k === "click" || k === "wheel" ? "dm-kbd dm-kbd-mouse" : "dm-kbd", k));
      }
      row.appendChild(keys);
      row.appendChild(el("span", "dm-tutorial-text", r.text));
      section.appendChild(row);
    }
    grid.appendChild(section);
  }
  const ok = el("button", "dm-btn dm-btn-primary dm-tutorial-ok", "Got it");
  ok.type = "button";
  ok.id = "tutorial-ok";
  const footer = el("div", "dm-tutorial-footer");
  footer.appendChild(ok);
  for (const child of [title, intro, grid, footer]) card.appendChild(child);
  backdrop.appendChild(card);
  parent.appendChild(backdrop);

  let open = false;
  const close = () => {
    if (!open) return;
    open = false;
    backdrop.hidden = true;
    markTutorialSeen(storage(), opts.userId);
    opts.setTyping(false);
    removeEventListener("keydown", onKey, true);
    uiSound("close");
  };
  // While the card is up, game and HUD keys stay quiet; Esc, Enter and Space dismiss it.
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!e.repeat) close();
    }
  };
  ok.addEventListener("click", () => close());
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });

  const show = () => {
    if (open) return;
    open = true;
    backdrop.hidden = false;
    opts.setTyping(true);
    addEventListener("keydown", onKey, true);
    uiSound("open");
    ok.focus({ preventScroll: true });
  };

  return {
    open: show,
    openFirstTime() {
      if (!tutorialSeen(storage(), opts.userId)) show();
    },
    close,
    isOpen: () => open,
    destroy() {
      removeEventListener("keydown", onKey, true);
      backdrop.remove();
    },
  };
}
