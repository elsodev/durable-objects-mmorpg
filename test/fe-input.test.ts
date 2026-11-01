import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actionForCode,
  createInput,
  createWheelStepper,
  dirFromKeys,
  isEditable,
  slotForCode,
  wrapSlot,
} from "../src/client/game/input";
import type { Input, InputAction, PointerInfo } from "../src/client/contracts";

describe("pure helpers", () => {
  it("dir by sign, opposite keys cancel", () => {
    expect(dirFromKeys(["KeyW", "KeyD"])).toEqual({ dx: 1, dy: -1 });
    expect(dirFromKeys(["KeyA", "ArrowLeft"])).toEqual({ dx: -1, dy: 0 });
    expect(dirFromKeys(["KeyA", "KeyD", "ArrowDown"])).toEqual({ dx: 0, dy: 1 });
    expect(dirFromKeys([])).toEqual({ dx: 0, dy: 0 });
  });
  it("maps action and slot codes", () => {
    expect(actionForCode("Space")).toBe("use");
    expect(actionForCode("KeyE")).toBe("use");
    expect(actionForCode("KeyF")).toBe("interact");
    expect(actionForCode("Escape")).toBe("cancel");
    expect(actionForCode("Enter")).toBe("chat");
    expect(actionForCode("KeyQ")).toBe("gift");
    expect(actionForCode("KeyZ")).toBeNull();
    expect(slotForCode("Digit1")).toBe(0);
    expect(slotForCode("Numpad8")).toBe(7);
    expect(slotForCode("Digit9")).toBeNull();
    expect(slotForCode("Digit0")).toBeNull();
    expect(wrapSlot(-1)).toBe(7);
    expect(wrapSlot(8)).toBe(0);
  });
  it("detects editable focus", () => {
    expect(isEditable({ tagName: "INPUT" })).toBe(true);
    expect(isEditable({ tagName: "textarea" })).toBe(true);
    expect(isEditable({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditable({ tagName: "CANVAS" })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
  it("wheel stepper accumulates and rate-limits", () => {
    const step = createWheelStepper(50, 80);
    expect(step(20, 0)).toBe(0);
    expect(step(40, 10)).toBe(1);
    expect(step(100, 20)).toBe(0); // cooldown
    expect(step(10, 200)).toBe(1); // accumulated 110
    expect(step(-60, 400)).toBe(-1); // direction change resets
  });
});

// Minimal DOM stand-ins: Node has EventTarget/Event, so events are plain Events with fields assigned.
class FakeDoc extends EventTarget {
  activeElement: unknown = null;
  visibilityState = "visible";
}
class FakeCanvas extends EventTarget {
  constructor(
    public ownerDocument: unknown,
    private listeners: Map<string, number>,
  ) {
    super();
  }
  getBoundingClientRect() {
    return { left: 10, top: 20, width: 800, height: 600 };
  }
  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, o?: AddEventListenerOptions | boolean) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, cb, o);
  }
  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, o?: EventListenerOptions | boolean) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1);
    super.removeEventListener(type, cb, o);
  }
}

function ev(type: string, fields: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
  return e;
}

describe("createInput", () => {
  let win: EventTarget & { document?: unknown };
  let doc: FakeDoc;
  let canvas: FakeCanvas;
  let counts: Map<string, number>;
  let input: Input;

  beforeEach(() => {
    doc = new FakeDoc();
    win = new EventTarget();
    (doc as unknown as { defaultView: unknown }).defaultView = win;
    counts = new Map();
    canvas = new FakeCanvas(doc, counts);
    input = createInput(canvas as unknown as HTMLCanvasElement, (sx, sy) => ({ x: sx / 64, y: sy / 64 }));
  });
  afterEach(() => input.destroy());

  const key = (type: "keydown" | "keyup", code: string, extra: Record<string, unknown> = {}) => {
    const e = ev(type, { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
    win.dispatchEvent(e);
    return e;
  };

  it("tracks held movement and prevents arrow scrolling", () => {
    key("keydown", "KeyW");
    const e = key("keydown", "ArrowRight");
    expect(e.defaultPrevented).toBe(true);
    expect(input.dir()).toEqual({ dx: 1, dy: -1 });
    key("keyup", "KeyW");
    expect(input.dir()).toEqual({ dx: 1, dy: 0 });
  });

  it("is zero while typing or focused in an input, and clears on blur", () => {
    key("keydown", "KeyD");
    input.setTyping(true);
    expect(input.dir()).toEqual({ dx: 0, dy: 0 });
    key("keydown", "KeyA");
    input.setTyping(false);
    expect(input.dir()).toEqual({ dx: 0, dy: 0 });

    key("keydown", "KeyD");
    doc.activeElement = { tagName: "INPUT" };
    expect(input.dir()).toEqual({ dx: 0, dy: 0 });
    doc.activeElement = null;
    expect(input.dir()).toEqual({ dx: 1, dy: 0 });
    win.dispatchEvent(ev("blur"));
    expect(input.dir()).toEqual({ dx: 0, dy: 0 });
  });

  it("emits actions once per press, not while typing or with modifiers", () => {
    const got: InputAction[] = [];
    input.onAction((a) => got.push(a));
    key("keydown", "Space");
    key("keydown", "Space", { repeat: true });
    key("keydown", "KeyB");
    key("keydown", "KeyR", { ctrlKey: true });
    doc.activeElement = { tagName: "TEXTAREA" };
    key("keydown", "Enter");
    doc.activeElement = null;
    key("keydown", "Enter");
    expect(got).toEqual(["use", "build", "chat"]);
  });

  it("selects slots by keys and wheel", () => {
    const got: number[] = [];
    input.onSlot((s) => got.push(s));
    key("keydown", "Digit3");
    canvas.dispatchEvent(ev("wheel", { deltaY: 100, deltaX: 0, deltaMode: 0, ctrlKey: false, timeStamp: 1000 }));
    input.setSlot?.(0);
    canvas.dispatchEvent(ev("wheel", { deltaY: -100, deltaX: 0, deltaMode: 0, ctrlKey: false, timeStamp: 2000 }));
    expect(got).toEqual([2, 3, 7]);
  });

  it("reports clicks and moves in canvas px with tile coords; blocks context menu", () => {
    const clicks: PointerInfo[] = [];
    const moves: PointerInfo[] = [];
    input.onClick((p) => clicks.push(p));
    input.onPointerMove((p) => moves.push(p));
    canvas.dispatchEvent(ev("pointerdown", { button: 2, isPrimary: true, clientX: 138, clientY: 84 }));
    canvas.dispatchEvent(ev("pointerdown", { button: 1, isPrimary: true, clientX: 0, clientY: 0 }));
    canvas.dispatchEvent(ev("pointermove", { buttons: 0, clientX: 74, clientY: 20 }));
    expect(clicks).toEqual([{ screen: { x: 128, y: 64 }, tile: { x: 2, y: 1 }, button: 2 }]);
    expect(moves).toEqual([{ screen: { x: 64, y: 0 }, tile: { x: 1, y: 0 }, button: 0 }]);
    const cm = ev("contextmenu");
    canvas.dispatchEvent(cm);
    expect(cm.defaultPrevented).toBe(true);
  });

  it("destroy removes every canvas listener and stops callbacks", () => {
    const got: InputAction[] = [];
    input.onAction((a) => got.push(a));
    input.destroy();
    key("keydown", "KeyI");
    expect(got).toEqual([]);
    for (const n of counts.values()) expect(n).toBe(0);
  });
});
