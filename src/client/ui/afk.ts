// "You are AFK" screen: covers the paused game while its connection is closed. The button is the
// one way back (Enter or Space press it from anywhere on the screen); every other key stops here
// so it can't reach the HUD's hotkeys or the chat box underneath.
import "./styles/afk.css";

export interface AfkScreen {
  show(): void;
  hide(): void;
  readonly visible: boolean;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A pixel-art "Z" (original, drawn in code), `px` screen pixels per art pixel, with a drop shadow. */
const Z_ART = ["#####", "...#.", "..#..", ".#...", "#####"];
function pixelZ(px: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = (Z_ART[0]!.length + 1) * px;
  c.height = (Z_ART.length + 1) * px;
  const g = c.getContext("2d");
  if (!g) return c;
  for (const [color, off] of [["#1b2836", px], ["#f6eed8", 0]] as const) {
    g.fillStyle = color;
    Z_ART.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === "#") g.fillRect(x * px + off, y * px + off, px, px);
    });
  }
  return c;
}

export function createAfkScreen(root: HTMLElement, opts: { onResume(): void }): AfkScreen {
  const veil = el("div", "dm-afk");
  veil.id = "afk-screen";
  veil.hidden = true;

  const card = el("div", "dm-panel dm-afk-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "afk-title");
  card.setAttribute("aria-describedby", "afk-text");

  // A moon with Z's drifting up from it (pure CSS, see afk.css).
  const sky = el("div", "dm-afk-sky");
  sky.setAttribute("aria-hidden", "true");
  sky.appendChild(el("div", "dm-afk-moon"));
  for (const i of [0, 1, 2]) {
    const z = pixelZ(3);
    z.className = `dm-afk-z dm-afk-z${i + 1}`;
    sky.appendChild(z);
  }

  const title = el("h2", "dm-afk-title", "You are AFK");
  title.id = "afk-title";
  const text = el("p", "dm-afk-text", "You've been away, so we paused your connection.");
  text.id = "afk-text";
  const sub = el("p", "dm-afk-sub", "Your farm and bag are saved while you're away.");

  const button = el("button", "dm-btn dm-btn-primary dm-afk-btn", "Go back online");
  button.type = "button";
  button.id = "afk-resume";
  const hint = el("p", "dm-afk-hint");
  hint.appendChild(document.createTextNode("or press "));
  hint.appendChild(el("kbd", "dm-kbd", "Enter"));

  for (const child of [sky, title, text, sub, button, hint]) card.appendChild(child);
  veil.appendChild(card);
  root.appendChild(veil);

  let visible = false;

  const resume = () => {
    if (!visible) return;
    api.hide();
    opts.onResume();
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    resume();
  });
  // A click anywhere else keeps the keyboard on the button.
  veil.addEventListener("pointerdown", (e) => {
    if (e.target !== button) {
      e.preventDefault();
      button.focus({ preventScroll: true });
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if (!visible) return;
    // Window capture runs before every game and HUD listener.
    e.stopImmediatePropagation();
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (!e.repeat) resume();
    } else if (e.key === "Tab") {
      e.preventDefault();
      button.focus({ preventScroll: true });
    }
  };
  const swallow = (e: KeyboardEvent) => {
    if (visible) e.stopImmediatePropagation();
  };

  const api: AfkScreen = {
    show() {
      if (visible) return;
      visible = true;
      veil.hidden = false;
      // Whatever had focus (the chat box) would otherwise keep catching keys.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", swallow, true);
      button.focus({ preventScroll: true });
    },
    hide() {
      if (!visible) return;
      visible = false;
      veil.hidden = true;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", swallow, true);
      button.blur();
    },
    get visible() {
      return visible;
    },
    destroy() {
      api.hide();
      veil.remove();
    },
  };
  return api;
}
