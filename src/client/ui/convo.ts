// The conversation window: centred on screen while you talk to a villager. Their portrait, name
// and your hearts with them at the top, the conversation in the middle, a reply box at the bottom.
// Replies go to the server, which judges them and answers with `bond` (hearts) and the villager's
// line. Every text goes in with textContent only.
import type { BondView } from "../../shared/hearts";
import type { ItemId } from "../../shared/types";
import { MAX_CHAT_LEN } from "../../shared/validate";
import { getItem } from "../../shared/items";
import { heartProgress, heartRow, progressText } from "./bonds-logic";
import { ANSWER_WAIT_MS, heartChange, outOfRange, pushLine, sendable, type ConvoLine } from "./convo-logic";
import { iconFor } from "./icons";
import { uiSound } from "./sound";
import "./styles/convo.css";

const RANGE_CHECK_MS = 400;
const POP_MS = 1500;

export interface ConvoOpts {
  /** Sends a reply to the villager with this entity id. */
  say(entityId: string, text: string): void;
  setTyping(typing: boolean): void;
  /** Tiles from you to that entity, or null when it is out of view. */
  distance(entityId: string): number | null;
  portrait(entityId: string): HTMLCanvasElement | null;
}

export interface ConvoUi {
  /** Friendship with a villager changed; `talk` (you walked up to them) opens the window. */
  bond(view: BondView, delta: number, talk: boolean, entityId?: string, gifts?: ItemId[]): void;
  /** A villager answered you. */
  said(entityId: string, text: string): void;
  /** The server refused a reply (too fast, too far...). */
  failed(reason: string): void;
  close(): void;
  isOpen(): boolean;
  /** Entity id of the villager you're talking to while the window is open, else null. */
  talkingTo?(): string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function put(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

/** Phones and tablets: don't pop the on-screen keyboard until the player taps the box. */
function coarsePointer(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function createConvo(root: HTMLElement, opts: ConvoOpts): ConvoUi {
  const win = el("section", "dm-panel convo");
  win.id = "convo";
  win.hidden = true;
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-labelledby", "convo-name");

  const head = el("header", "convo-head");
  const portrait = el("div", "convo-portrait");
  const who = el("div", "convo-who");
  const nameRow = el("div", "convo-name-row");
  const name = el("h2", "convo-name");
  name.id = "convo-name";
  const close = el("button", "dm-close convo-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Leave the conversation");
  close.addEventListener("click", () => api.close());
  put(nameRow, name, close);
  const heartsBox = el("div", "convo-hearts");
  heartsBox.id = "convo-hearts";
  const heartsRow = el("span", "bond-hearts convo-hearts-row");
  const bar = el("div", "bond-bar convo-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const barFill = el("div", "bond-bar-fill");
  const barText = el("span", "bond-bar-text");
  put(bar, barFill, barText);
  put(heartsBox, heartsRow);
  put(who, nameRow, heartsBox, bar);
  put(head, portrait, who);

  const log = el("ol", "convo-log");
  log.id = "convo-log";
  log.setAttribute("aria-live", "polite");

  const form = el("form", "convo-form");
  const input = el("input", "dm-input convo-input");
  input.id = "convo-input";
  input.type = "text";
  input.maxLength = MAX_CHAT_LEN;
  input.autocomplete = "off";
  input.spellcheck = true;
  input.enterKeyHint = "send";
  input.setAttribute("aria-label", "Your reply");
  const sendBtn = el("button", "dm-btn dm-btn-primary convo-send", "Send");
  sendBtn.id = "convo-send";
  sendBtn.type = "submit";
  put(form, input, sendBtn);
  const hint = el("p", "convo-hint", "Enter to send · Esc to leave");
  put(win, head, log, form, hint);
  put(root, win);

  let npc: string | null = null;
  let entity: string | null = null;
  let npcName = "";
  let lines: ConvoLine[] = [];
  let waiting = false;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  let rangeTimer: ReturnType<typeof setInterval> | null = null;
  let lastSent = 0;
  let typing = false;

  const setTyping = (t: boolean): void => {
    if (t === typing) return;
    typing = t;
    opts.setTyping(t);
  };
  input.addEventListener("focus", () => setTyping(true));
  input.addEventListener("blur", () => setTyping(false));
  input.addEventListener("input", () => syncSend());
  // Game and HUD keys (WASD, I, H...) never fire from the reply box.
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      api.close();
    }
  });
  input.addEventListener("keyup", (e) => e.stopPropagation());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });

  /** Shown (not covered by the shop or the menu, which hide it in CSS). */
  const visible = (): boolean => !win.hidden && win.getClientRects().length > 0;

  // Capture phase: runs before the menu's and the game's Escape handlers, so one press only
  // leaves the conversation, and a menu open on top of it closes first.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !visible()) return;
      if (isTypingTarget(e.target) && e.target !== input) return;
      e.preventDefault();
      e.stopPropagation();
      api.close();
    },
    true,
  );

  function syncSend(): void {
    sendBtn.disabled = input.value.trim().length === 0;
  }

  function renderLog(): void {
    const items = lines.map((l) => {
      const li = el("li", `convo-line convo-${l.who}${l.gifts ? " convo-gift" : ""}`);
      const bubble = el("span", "convo-bubble", l.text);
      for (const item of l.gifts ?? []) bubble.appendChild(giftChip(item));
      put(li, bubble);
      return li;
    });
    if (waiting) {
      const li = el("li", "convo-line convo-npc convo-waiting");
      li.setAttribute("aria-label", `${npcName} is thinking`);
      const b = el("span", "convo-bubble");
      for (let i = 0; i < 3; i++) put(b, el("span", "convo-dot"));
      put(li, b);
      items.push(li);
    }
    log.replaceChildren(...items);
    log.scrollTop = log.scrollHeight;
  }

  function add(line: ConvoLine): void {
    lines = pushLine(lines, line);
    renderLog();
  }

  function setWaiting(on: boolean): void {
    waiting = on;
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = on ? setTimeout(() => setWaiting(false), ANSWER_WAIT_MS) : null;
    renderLog();
  }

  function renderHearts(v: BondView): void {
    heartsRow.replaceChildren(...heartRow(v.hearts).map((s) => el("span", `bond-heart ${s}`)));
    heartsRow.setAttribute("aria-label", `${v.hearts} of 10 hearts`);
    const pct = Math.round(heartProgress(v) * 100);
    barFill.style.width = `${pct}%`;
    bar.setAttribute("aria-valuenow", String(pct));
    barText.textContent = progressText(v);
  }

  function renderPortrait(entityId: string, v: BondView): void {
    let pic: HTMLCanvasElement | null = null;
    try {
      pic = opts.portrait(entityId);
    } catch {
      pic = null;
    }
    if (pic) {
      pic.className = "convo-portrait-img";
      pic.setAttribute("aria-hidden", "true");
      portrait.replaceChildren(pic);
    } else portrait.replaceChildren(el("span", "convo-portrait-letter", v.name.charAt(0).toUpperCase() || "?"));
  }

  function pop(delta: number): void {
    const change = heartChange(delta);
    if (!change) return;
    const p = el("span", `convo-pop ${change.dir}`, change.text);
    p.setAttribute("aria-hidden", "true");
    heartsBox.appendChild(p);
    heartsRow.classList.remove("bump-up", "bump-down");
    // Restart the animation even when two changes come in a row.
    void heartsRow.offsetWidth;
    heartsRow.classList.add(change.dir === "up" ? "bump-up" : "bump-down");
    setTimeout(() => p.remove(), POP_MS);
  }

  function giftChip(item: string): HTMLElement {
    const chip = el("span", "bond-gift-chip");
    try {
      const img = el("img");
      img.src = iconFor(item);
      img.alt = "";
      chip.appendChild(img);
    } catch {
      // No icon yet: the name is enough.
    }
    chip.appendChild(el("span", "", getItem(item)?.name ?? item));
    return chip;
  }

  function open(v: BondView, entityId: string): void {
    const same = npc === v.npc && !win.hidden;
    npc = v.npc;
    entity = entityId;
    npcName = v.name;
    name.textContent = v.name;
    renderPortrait(entityId, v);
    renderHearts(v);
    if (!same) {
      lines = [];
      input.value = "";
      syncSend();
      if (v.pending > 0) lines = pushLine(lines, { who: "note", text: `${v.name} has a gift waiting for you. Make room in your bag!` });
    }
    // Walking up to someone says hello: their answer is on its way.
    setWaiting(true);
    if (win.hidden) {
      win.hidden = false;
      uiSound("open");
    }
    if (rangeTimer) clearInterval(rangeTimer);
    rangeTimer = setInterval(() => {
      if (!entity || outOfRange(opts.distance(entity))) api.close();
    }, RANGE_CHECK_MS);
    if (!coarsePointer() && visible()) input.focus({ preventScroll: true });
  }

  function send(): void {
    if (!entity) return;
    const now = Date.now();
    const text = sendable(input.value, lastSent, now);
    if (!text) {
      if (input.value.trim()) uiSound("error");
      return;
    }
    lastSent = now;
    opts.say(entity, text);
    input.value = "";
    syncSend();
    uiSound("click");
    add({ who: "you", text });
    setWaiting(true);
  }

  const api: ConvoUi = {
    bond(view, delta, talk, entityId, gifts) {
      if (talk && entityId) open(view, entityId);
      if (win.hidden || view.npc !== npc) return;
      renderHearts(view);
      pop(delta);
      if (gifts && gifts.length > 0) add({ who: "note", text: `${npcName} gave you`, gifts });
    },
    said(entityId, text) {
      if (win.hidden || entityId !== entity) return;
      waiting = false;
      if (waitTimer) clearTimeout(waitTimer);
      waitTimer = null;
      add({ who: "npc", text });
    },
    failed(reason) {
      if (win.hidden) return;
      waiting = false;
      if (waitTimer) clearTimeout(waitTimer);
      waitTimer = null;
      add({ who: "note", text: reason });
    },
    close() {
      if (win.hidden) return;
      if (document.activeElement === input) input.blur();
      setTyping(false);
      win.hidden = true;
      npc = null;
      entity = null;
      waiting = false;
      if (waitTimer) clearTimeout(waitTimer);
      if (rangeTimer) clearInterval(rangeTimer);
      waitTimer = null;
      rangeTimer = null;
      uiSound("close");
    },
    isOpen: () => !win.hidden,
    talkingTo: () => (win.hidden ? null : entity),
  };
  syncSend();
  return api;
}
