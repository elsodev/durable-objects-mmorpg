// Keyboard, wheel and pointer input for the game canvas. See ../contracts.ts for the contract.
// Keys are matched by KeyboardEvent.code (physical position), so WASD stays WASD on AZERTY etc.
import type { CreateInput, Input, InputAction, PointerInfo } from "../contracts";
import type { Vec2 } from "../../shared/types";

export const HOTBAR_SLOTS = 8;

const MOVE: Record<string, { dx: number; dy: number }> = {
  KeyW: { dx: 0, dy: -1 },
  ArrowUp: { dx: 0, dy: -1 },
  KeyS: { dx: 0, dy: 1 },
  ArrowDown: { dx: 0, dy: 1 },
  KeyA: { dx: -1, dy: 0 },
  ArrowLeft: { dx: -1, dy: 0 },
  KeyD: { dx: 1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

const ACTIONS: Record<string, InputAction> = {
  Space: "use",
  KeyE: "use",
  KeyF: "interact",
  // Q gives the selected hotbar item to the nearest villager (at home the session uses Q to eat).
  KeyQ: "gift",
  KeyB: "build",
  KeyR: "rotate",
  Escape: "cancel",
  KeyI: "inventory",
  KeyG: "goals",
  Enter: "chat",
  NumpadEnter: "chat",
};

export function isMoveCode(code: string): boolean {
  return code in MOVE;
}

/** Held direction, each axis in {-1,0,1}; opposite keys cancel. Diagonals are not scaled here. */
export function dirFromKeys(held: Iterable<string>): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  for (const code of held) {
    const m = MOVE[code];
    if (m) {
      dx += m.dx;
      dy += m.dy;
    }
  }
  return { dx: Math.sign(dx), dy: Math.sign(dy) };
}

export function actionForCode(code: string): InputAction | null {
  return ACTIONS[code] ?? null;
}

/** Digit1..8 / Numpad1..8 -> slot 0..7. */
export function slotForCode(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-8])$/.exec(code);
  return m ? Number(m[1]) - 1 : null;
}

export function wrapSlot(slot: number): number {
  return ((slot % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS;
}

interface MaybeElement {
  tagName?: string;
  isContentEditable?: boolean;
}

/** True for focus targets that take text, where game keys must not fire. */
export function isEditable(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as MaybeElement;
  if (e.isContentEditable) return true;
  const tag = typeof e.tagName === "string" ? e.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Turns wheel deltas into slot steps. Trackpads emit many tiny deltas, so they accumulate until a
 * threshold, and at most one step fires per cooldown so a fling doesn't spin the whole hotbar.
 */
export function createWheelStepper(threshold = 50, cooldownMs = 80) {
  let acc = 0;
  let lastStep = -Infinity;
  return (deltaPx: number, now: number): -1 | 0 | 1 => {
    if (Math.sign(deltaPx) !== Math.sign(acc)) acc = 0;
    acc += deltaPx;
    if (Math.abs(acc) < threshold || now - lastStep < cooldownMs) return 0;
    const step = acc > 0 ? 1 : -1;
    acc = 0;
    lastStep = now;
    return step;
  };
}

const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

type Listener<T> = (v: T) => void;

function emitter<T>() {
  const subs = new Set<Listener<T>>();
  return {
    on(cb: Listener<T>): () => void {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit(v: T): void {
      for (const cb of [...subs]) cb(v);
    },
    clear(): void {
      subs.clear();
    },
  };
}

export const createInput: CreateInput = (canvas, screenToTile) => {
  const win: Window = canvas.ownerDocument?.defaultView ?? window;
  const doc: Document = canvas.ownerDocument ?? document;
  const held = new Set<string>();
  let typing = false;
  let slot = 0;
  const wheelStep = createWheelStepper();
  /** Build mode: the wheel turns the furniture ghost instead of changing the hotbar slot. */
  let wheelRotates = false;

  const actions = emitter<InputAction>();
  const slots = emitter<number>();
  const clicks = emitter<PointerInfo>();
  const moves = emitter<PointerInfo>();
  const dirs = emitter<{ dir: { dx: number; dy: number }; at: number }>();
  let lastDir = { dx: 0, dy: 0 };

  const focusBlocked = () => isEditable(doc.activeElement);
  const blocked = () => typing || focusBlocked();

  /** Reports a held-direction change right away, so movement doesn't wait for the next frame. */
  const dirChanged = (at: number) => {
    const d = blocked() ? { dx: 0, dy: 0 } : dirFromKeys(held);
    if (d.dx === lastDir.dx && d.dy === lastDir.dy) return;
    lastDir = d;
    dirs.emit({ dir: d, at });
  };

  const selectSlot = (s: number) => {
    slot = wrapSlot(s);
    slots.emit(slot);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (blocked() || isEditable(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const code = e.code;
    if (isMoveCode(code)) {
      held.add(code);
      e.preventDefault(); // arrows would scroll the page
      dirChanged(e.timeStamp);
      return;
    }
    const s = slotForCode(code);
    if (s !== null) {
      if (!e.repeat) selectSlot(s);
      e.preventDefault();
      return;
    }
    const a = actionForCode(code);
    if (a) {
      e.preventDefault();
      // Shift+R turns furniture the other way.
      if (!e.repeat) actions.emit(a === "rotate" && e.shiftKey ? "rotateBack" : a);
    }
  };

  // Always release, even while typing, so a key held while focusing chat doesn't stick.
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.code);
    dirChanged(e.timeStamp);
  };

  const clearHeld = () => {
    held.clear();
    dirChanged(performance.now());
  };
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") clearHeld();
  };
  const onFocusIn = (e: FocusEvent) => {
    if (isEditable(e.target)) clearHeld();
  };

  const pointerInfo = (e: MouseEvent, button: 0 | 2): PointerInfo => {
    const r = canvas.getBoundingClientRect();
    const screen: Vec2 = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { screen, tile: screenToTile(screen.x, screen.y), button };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.isPrimary === false) return; // second finger of a multi-touch
    clicks.emit(pointerInfo(e, e.button));
  };

  const onPointerMove = (e: PointerEvent) => {
    moves.emit(pointerInfo(e, (e.buttons & 2) !== 0 ? 2 : 0));
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return; // pinch-zoom gesture
    e.preventDefault();
    const scale = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * scale;
    const step = wheelStep(delta, e.timeStamp);
    if (step === 0) return;
    if (wheelRotates) actions.emit(step > 0 ? "rotate" : "rotateBack");
    else selectSlot(slot + step);
  };

  win.addEventListener("keydown", onKeyDown);
  win.addEventListener("keyup", onKeyUp);
  win.addEventListener("blur", clearHeld);
  doc.addEventListener("visibilitychange", onVisibility);
  doc.addEventListener("focusin", onFocusIn);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const input: Input = {
    dir() {
      if (blocked()) return { dx: 0, dy: 0 };
      return dirFromKeys(held);
    },
    setTyping(t) {
      typing = t;
      if (t) clearHeld();
    },
    setSlot(s) {
      slot = wrapSlot(s);
    },
    setWheelRotates(on) {
      wheelRotates = on;
    },
    onDir: (cb) => dirs.on((v) => cb(v.dir, v.at)),
    onAction: actions.on,
    onSlot: slots.on,
    onClick: clicks.on,
    onPointerMove: moves.on,
    destroy() {
      win.removeEventListener("keydown", onKeyDown);
      win.removeEventListener("keyup", onKeyUp);
      win.removeEventListener("blur", clearHeld);
      doc.removeEventListener("visibilitychange", onVisibility);
      doc.removeEventListener("focusin", onFocusIn);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      clearHeld();
      dirs.clear();
      actions.clear();
      slots.clear();
      clicks.clear();
      moves.clear();
    },
  };
  return input;
};
