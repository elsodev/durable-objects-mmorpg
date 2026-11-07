// On-screen controller for touch screens: a D-pad, A (use), B (talk), a give/eat button, a hold-to-run
// button, and Map / Bag pills. Portrait phones get it as a Game Boy style panel under the world;
// wider screens float it in the bottom corners. Toggled from the HUD and remembered per device.
import "./styles/gamepad.css";
import { PAD_KEY, initialPadOn, padPlacement, stickDir, type PadButton, type PadDir } from "./gamepad-logic";

export interface Gamepad {
  isOn(): boolean;
  setOn(on: boolean): void;
  toggle(): void;
  onChange(cb: (on: boolean) => void): () => void;
  destroy(): void;
}

export interface GamepadOpts {
  /** Held direction (each axis -1..1) and whether Run is held. Sent on every change. */
  dir(dx: number, dy: number, dash: boolean): void;
  press(button: PadButton): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A short buzz on phones that support it, so a press is felt as well as seen. */
function buzz(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Not allowed here: the press still works.
  }
}

/** A round pad button: a big letter with its job written under it. */
function padButton(cls: string, letter: string, label: string): HTMLButtonElement {
  const b = el("button", `dm-pad-btn ${cls}`);
  b.type = "button";
  b.appendChild(el("span", "dm-pad-letter", letter));
  b.appendChild(el("span", "dm-pad-label", label));
  b.setAttribute("aria-label", label);
  return b;
}

/** `host` is the app root (#app): the pad sits beside the HUD, and its classes resize the world. */
export function createGamepad(host: HTMLElement, opts: GamepadOpts): Gamepad {
  const root = el("div", "dm-pad");
  root.id = "gamepad";
  root.setAttribute("aria-label", "On-screen controller");
  root.hidden = true;

  // ---- D-pad
  const dpad = el("div", "dm-pad-dpad");
  dpad.id = "gamepad-dpad";
  const cross = el("div", "dm-pad-cross");
  for (const arm of ["up", "down", "left", "right"]) cross.appendChild(el("span", `dm-pad-arm dm-pad-arm-${arm}`));
  cross.appendChild(el("span", "dm-pad-hub"));
  dpad.appendChild(cross);

  // ---- face buttons
  const face = el("div", "dm-pad-face");
  const useBtn = padButton("dm-pad-a", "A", "Use");
  useBtn.id = "gamepad-a";
  const talkBtn = padButton("dm-pad-b", "B", "Talk");
  talkBtn.id = "gamepad-b";
  const giftBtn = padButton("dm-pad-x dm-pad-small", "Q", "Give/Eat");
  giftBtn.id = "gamepad-q";
  const runBtn = padButton("dm-pad-run dm-pad-small", "»", "Run");
  runBtn.id = "gamepad-run";
  for (const b of [giftBtn, useBtn, runBtn, talkBtn]) face.appendChild(b);

  // ---- menu pills
  const pills = el("div", "dm-pad-pills");
  const mapPill = el("button", "dm-pad-pill", "Map");
  mapPill.type = "button";
  mapPill.id = "gamepad-map";
  const bagPill = el("button", "dm-pad-pill", "Bag");
  bagPill.type = "button";
  bagPill.id = "gamepad-bag";
  pills.appendChild(mapPill);
  pills.appendChild(bagPill);

  for (const part of [dpad, face, pills]) root.appendChild(part);
  host.appendChild(root);

  // ---- state
  let on = false;
  let dir: PadDir = { dx: 0, dy: 0 };
  let run = false;
  let dpadPointer: number | null = null;
  const subs = new Set<(on: boolean) => void>();

  const emit = () => opts.dir(dir.dx, dir.dy, run && (dir.dx !== 0 || dir.dy !== 0));
  const setDir = (d: PadDir) => {
    const changed = d.dx !== dir.dx || d.dy !== dir.dy;
    dir = d;
    cross.dataset.dir = `${d.dx},${d.dy}`;
    if (changed) {
      if (d.dx !== 0 || d.dy !== 0) buzz();
      emit();
    }
  };

  const dirAt = (e: PointerEvent): PadDir => {
    const r = dpad.getBoundingClientRect();
    const radius = Math.min(r.width, r.height) / 2;
    return stickDir(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), radius * 0.22);
  };
  const onDpadDown = (e: PointerEvent) => {
    e.preventDefault();
    dpadPointer = e.pointerId;
    try {
      dpad.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events can't be captured; moves still arrive while the finger stays on the pad.
    }
    setDir(dirAt(e));
  };
  const onDpadMove = (e: PointerEvent) => {
    if (e.pointerId !== dpadPointer) return;
    setDir(dirAt(e));
  };
  const onDpadUp = (e: PointerEvent) => {
    if (e.pointerId !== dpadPointer) return;
    dpadPointer = null;
    setDir({ dx: 0, dy: 0 });
  };
  dpad.addEventListener("pointerdown", onDpadDown);
  dpad.addEventListener("pointermove", onDpadMove);
  dpad.addEventListener("pointerup", onDpadUp);
  dpad.addEventListener("pointercancel", onDpadUp);
  dpad.addEventListener("lostpointercapture", onDpadUp);

  /** Buttons act on touch-down (a click waits for the finger to lift, which feels slow in a game). */
  const pressable = (b: HTMLButtonElement, down: () => void, up?: () => void) => {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      b.classList.add("is-down");
      buzz();
      down();
    });
    const release = () => {
      if (!b.classList.contains("is-down")) return;
      b.classList.remove("is-down");
      up?.();
    };
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("pointerleave", release);
    // A keyboard or screen reader "click" still works.
    b.addEventListener("click", (e) => {
      if (e.detail === 0) {
        down();
        up?.();
      }
    });
  };
  pressable(useBtn, () => opts.press("use"));
  pressable(talkBtn, () => opts.press("interact"));
  pressable(giftBtn, () => opts.press("gift"));
  pressable(mapPill, () => opts.press("map"));
  pressable(bagPill, () => opts.press("bag"));
  pressable(
    runBtn,
    () => {
      run = true;
      emit();
    },
    () => {
      run = false;
      emit();
    },
  );
  // No long-press menu, text selection or double-tap zoom on the controller.
  root.addEventListener("contextmenu", (e) => e.preventDefault());

  const place = () => {
    const where = padPlacement(window.innerWidth, window.innerHeight);
    root.dataset.place = where;
    host.classList.toggle("has-pad", on);
    host.classList.toggle("pad-below", on && where === "below");
    host.classList.toggle("pad-sides", on && where === "sides");
  };
  window.addEventListener("resize", place);

  const save = () => {
    try {
      localStorage.setItem(PAD_KEY, on ? "1" : "0");
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  };

  const pad: Gamepad = {
    isOn: () => on,
    setOn(next) {
      if (next === on) return;
      on = next;
      root.hidden = !on;
      if (!on) {
        dpadPointer = null;
        run = false;
        setDir({ dx: 0, dy: 0 });
        opts.dir(0, 0, false);
      }
      place();
      save();
      for (const cb of [...subs]) cb(on);
    },
    toggle() {
      pad.setOn(!on);
    },
    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    destroy() {
      window.removeEventListener("resize", place);
      host.classList.remove("has-pad", "pad-below", "pad-sides");
      subs.clear();
      root.remove();
    },
  };
  if (initialPadOn(() => localStorage.getItem(PAD_KEY))) pad.setOn(true);
  else place();
  return pad;
}
