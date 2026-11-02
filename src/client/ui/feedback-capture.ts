// Screenshot area picker: the frozen view under a dim veil; drag (mouse or touch) to cut out a
// rectangle, then Redo, Whole screen, Use this area or Cancel. Esc cancels, Enter confirms.
import { dragRect, usableRect, type Point, type Rect } from "./feedback-rect-logic";
import type { ViewShot } from "./feedback-shot";
import { uiSound } from "./sound";

export interface AreaPicker {
  /** Resolves with the area in CSS pixels, or null when cancelled. */
  readonly done: Promise<Rect | null>;
  cancel(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

function btn(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `dm-btn dm-btn-small ${className}`.trim(), text);
  b.type = "button";
  b.addEventListener("pointerdown", (e) => e.stopPropagation());
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    uiSound("click");
    onClick();
  });
  return b;
}

export function pickArea(root: HTMLElement, shot: ViewShot): AreaPicker {
  const layer = el("div", "fb-capture");
  layer.id = "feedback-capture";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-label", "Pick a screenshot area");
  const frozen = shot.canvas;
  frozen.className = "fb-capture-frame";
  frozen.setAttribute("aria-hidden", "true");
  const veil = el("div", "fb-capture-veil");
  const sel = el("div", "fb-capture-sel");
  const size = el("span", "fb-capture-size");
  sel.appendChild(size);
  sel.hidden = true;

  const hint = el("span", "fb-capture-hint", "Drag over the part of the screen to show");
  const redo = btn("Redo", "", () => reset());
  redo.id = "feedback-capture-redo";
  const whole = btn("Whole screen", "", () => {
    rect = { x: 0, y: 0, w: shot.view.w, h: shot.view.h };
    render();
  });
  whole.id = "feedback-capture-whole";
  const use = btn("Use this area", "dm-btn-primary", () => finish(rect));
  use.id = "feedback-capture-use";
  const cancelBtn = btn("Cancel", "", () => finish(null));
  cancelBtn.id = "feedback-capture-cancel";
  const bar = el("div", "dm-panel fb-capture-bar");
  const buttons = el("div", "fb-capture-buttons");
  add(buttons, redo, whole, cancelBtn, use);
  add(bar, hint, buttons);
  add(layer, frozen, veil, sel, bar);
  root.appendChild(layer);

  let start: Point | null = null;
  let rect: Rect | null = null;
  let resolveDone: (r: Rect | null) => void = () => {};
  const done = new Promise<Rect | null>((r) => (resolveDone = r));
  let finished = false;

  function render(): void {
    const has = !!rect && rect.w > 0 && rect.h > 0;
    sel.hidden = !has;
    veil.hidden = has;
    if (rect && has) {
      sel.style.left = `${rect.x}px`;
      sel.style.top = `${rect.y}px`;
      sel.style.width = `${rect.w}px`;
      sel.style.height = `${rect.h}px`;
      size.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
    }
    const ok = usableRect(rect);
    use.disabled = !ok || start !== null;
    redo.disabled = !has;
    hint.textContent = start ? "Let go to finish" : ok ? "Use this area, or drag again" : "Drag over the part of the screen to show";
    layer.classList.toggle("is-dragging", start !== null);
  }

  function reset(): void {
    rect = null;
    start = null;
    render();
  }

  const at = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });
  const view = () => ({ w: window.innerWidth, h: window.innerHeight });

  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || finished) return;
    e.preventDefault();
    start = at(e);
    rect = dragRect(start, start, view());
    try {
      layer.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no capture
    }
    render();
  });
  layer.addEventListener("pointermove", (e) => {
    if (!start) return;
    rect = dragRect(start, at(e), view());
    render();
  });
  const end = (e: PointerEvent): void => {
    if (!start) return;
    rect = dragRect(start, at(e), view());
    start = null;
    if (!usableRect(rect)) rect = null;
    else uiSound("select");
    render();
  };
  layer.addEventListener("pointerup", end);
  layer.addEventListener("pointercancel", end);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    } else if (e.key === "Enter" && usableRect(rect)) {
      e.preventDefault();
      e.stopPropagation();
      finish(rect);
    } else {
      e.stopPropagation();
    }
  };
  window.addEventListener("keydown", onKey, true);

  function finish(r: Rect | null): void {
    if (finished) return;
    finished = true;
    window.removeEventListener("keydown", onKey, true);
    layer.remove();
    resolveDone(r && usableRect(r) ? r : null);
  }

  render();
  use.focus();
  return { done, cancel: () => finish(null) };
}
