// Chat box, bottom-left of the HUD: tabs (All / World / Zone / PM) with unread dots, a scrolling
// log (#chat-log), the input (#chat-input) and an emote picker. Compact and translucent when idle;
// taller, solid and scrollable while hovered or focused.
// All text from players and NPCs is untrusted, so it only ever goes through textContent.
import type { ChatLineOpts, CreateChat } from "./index";
import { MAX_CHAT_LEN } from "../../shared/validate";
import { EMOTES, type EmoteCode } from "../../shared/emotes";
import { CHAT_TABS, emoteVerb, type ChatChannel, type ChatTab } from "../../shared/social";
import {
  channelTag,
  displayLine,
  IDLE_FADE_MS,
  lineVisible,
  MAX_LOG_LINES,
  nameColor,
  outgoingText,
  placeholderFor,
  STICK_PX,
  TAB_LABELS,
  unreadTabs,
  cycleTab,
} from "./chat-format";
import { emoteDataUrl } from "../art/emotes";
import { uiSound } from "./sound";
import "./styles/chat.css";
import { enterCompletes, moveSelection, slashSuggestions, type SlashContext, type SlashSuggestion } from "./slash-commands";

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export const createChat: CreateChat = (root, opts) => {
  const box = document.createElement("div");
  box.className = "chat";
  box.id = "chat";

  // --- tabs
  let tab: ChatTab = "all";
  const tabs = document.createElement("div");
  tabs.className = "chat-tabs";
  tabs.setAttribute("role", "tablist");
  const tabEls = new Map<ChatTab, HTMLButtonElement>();
  for (const t of CHAT_TABS) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = `chat-tab-${t}`;
    b.className = "chat-tab";
    b.setAttribute("role", "tab");
    b.textContent = TAB_LABELS[t];
    const dot = document.createElement("span");
    dot.className = "chat-dot";
    dot.setAttribute("aria-label", "unread");
    b.appendChild(dot);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      selectTab(t);
      uiSound("click");
    });
    tabEls.set(t, b);
    tabs.appendChild(b);
  }

  const log = document.createElement("div");
  log.id = "chat-log";
  log.className = "chat-log";
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  // --- input row
  const row = document.createElement("div");
  row.className = "chat-row";
  const input = document.createElement("input");
  input.id = "chat-input";
  input.className = "chat-input";
  input.type = "text";
  input.maxLength = MAX_CHAT_LEN;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Chat message");

  const emoteBtn = document.createElement("button");
  emoteBtn.type = "button";
  emoteBtn.id = "chat-emote";
  emoteBtn.className = "chat-emote-btn";
  emoteBtn.title = "Emotes";
  emoteBtn.setAttribute("aria-label", "Emotes");
  emoteBtn.setAttribute("aria-expanded", "false");
  const emoteBtnIcon = document.createElement("img");
  emoteBtnIcon.alt = "";
  emoteBtnIcon.draggable = false;
  emoteBtn.appendChild(emoteBtnIcon);

  const picker = document.createElement("div");
  picker.id = "chat-emotes";
  picker.className = "chat-emotes";
  picker.hidden = true;
  picker.setAttribute("role", "menu");
  for (const code of EMOTES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chat-emote";
    b.dataset.emote = code;
    b.title = `/emote ${code}`;
    b.setAttribute("role", "menuitem");
    b.setAttribute("aria-label", code);
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    try {
      img.src = emoteDataUrl(code);
    } catch {
      b.textContent = code;
    }
    b.appendChild(img);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      pick(code);
    });
    picker.appendChild(b);
  }
  try {
    emoteBtnIcon.src = emoteDataUrl("laugh", 2);
  } catch {
    emoteBtn.textContent = ":)";
  }

  row.appendChild(input);
  row.appendChild(emoteBtn);
  // --- "/" command suggestions, above the input
  const slash = document.createElement("div");
  slash.id = "chat-slash";
  slash.className = "chat-slash";
  slash.hidden = true;
  slash.setAttribute("role", "listbox");
  slash.setAttribute("aria-label", "Commands");
  input.setAttribute("aria-controls", slash.id);

  for (const part of [picker, slash, tabs, log, row]) box.appendChild(part);
  root.appendChild(box);

  const isGuest = () => {
    try {
      return opts.guest?.() ?? false;
    } catch {
      return false;
    }
  };
  const refreshPlaceholder = () => {
    input.placeholder = placeholderFor(tab, isGuest());
  };

  function selectTab(t: ChatTab): void {
    tab = t;
    log.dataset.tab = t;
    for (const [k, b] of tabEls) {
      b.setAttribute("aria-selected", String(k === t));
      b.classList.toggle("active", k === t);
      if (k === t) b.classList.remove("unread");
    }
    refreshPlaceholder();
    log.scrollTop = log.scrollHeight;
  }

  function setPicker(open: boolean): void {
    picker.hidden = !open;
    emoteBtn.setAttribute("aria-expanded", String(open));
    box.classList.toggle("chat-open", open);
  }

  function pick(code: EmoteCode): void {
    setPicker(false);
    uiSound("confirm");
    opts.emote?.(code);
  }

  emoteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    uiSound("click");
    setPicker(picker.hidden);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!picker.hidden && !box.contains(e.target as Node)) setPicker(false);
  });

  // --- idle fade
  let idleTimer = 0;
  const wake = (): void => {
    box.classList.remove("chat-idle");
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (document.activeElement !== input && !box.matches(":hover") && picker.hidden) box.classList.add("chat-idle");
    }, IDLE_FADE_MS);
  };
  box.addEventListener("pointerenter", wake);
  box.addEventListener("pointerleave", wake);
  log.addEventListener("scroll", wake, { passive: true });
  // Wheel over the log scrolls history instead of zooming the game.
  log.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  input.addEventListener("focus", () => {
    wake();
    opts.setTyping(true);
  });
  input.addEventListener("blur", () => {
    wake();
    opts.setTyping(false);
  });

  let suggestions: SlashSuggestion[] = [];
  let selected = -1;
  /** Esc hides the list until the text changes. */
  let dismissedFor: string | null = null;
  const slashCtx = (): SlashContext => {
    try {
      return opts.slashContext?.() ?? { atHome: false, homeOwner: false, guest: isGuest(), devTools: false };
    } catch {
      return { atHome: false, homeOwner: false, guest: isGuest(), devTools: false };
    }
  };
  function renderSlash(): void {
    slash.replaceChildren();
    suggestions.forEach((sg, i) => {
      const item = document.createElement("div");
      item.className = "chat-slash-item";
      item.id = `chat-slash-${i}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === selected));
      const label = document.createElement("span");
      label.className = "chat-slash-label";
      label.textContent = sg.label;
      item.appendChild(label);
      if (sg.syntax) {
        const syntax = document.createElement("span");
        syntax.className = "chat-slash-syntax";
        syntax.textContent = sg.syntax;
        item.appendChild(syntax);
      }
      if (sg.description) {
        const desc = document.createElement("span");
        desc.className = "chat-slash-desc";
        desc.textContent = sg.description;
        item.appendChild(desc);
      }
      // pointerdown, not click: keep focus in the input.
      item.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        complete(i);
      });
      slash.appendChild(item);
    });
    slash.hidden = suggestions.length === 0;
    box.classList.toggle("chat-slash-open", !slash.hidden);
    if (selected >= 0) {
      input.setAttribute("aria-activedescendant", `chat-slash-${selected}`);
      slash.children[selected]?.scrollIntoView?.({ block: "nearest" });
    }
    else input.removeAttribute("aria-activedescendant");
  }
  function refreshSlash(): void {
    const text = input.value;
    const next = dismissedFor === text ? [] : slashSuggestions(text, slashCtx());
    if (dismissedFor !== text) dismissedFor = null;
    const keep = selected >= 0 ? suggestions[selected]?.key : undefined;
    suggestions = next;
    const i = keep ? next.findIndex((s) => s.key === keep) : -1;
    selected = i >= 0 ? i : next.length > 0 ? 0 : -1;
    renderSlash();
  }
  function closeSlash(): void {
    suggestions = [];
    selected = -1;
    renderSlash();
  }
  function complete(i: number): void {
    const sg = suggestions[i];
    if (!sg) return;
    input.value = sg.completion;
    input.setSelectionRange(input.value.length, input.value.length);
    uiSound("select");
    refreshSlash();
  }
  input.addEventListener("input", refreshSlash);
  input.addEventListener("blur", closeSlash);

  input.addEventListener("keydown", (e) => {
    // Keep game hotkeys (I, G, WASD...) from firing while typing.
    e.stopPropagation();
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        selected = moveSelection(selected, e.key === "ArrowDown" ? 1 : -1, suggestions.length);
        renderSlash();
        return;
      }
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        complete(selected >= 0 ? selected : 0);
        return;
      }
      if (e.key === "Enter" && !e.isComposing && enterCompletes(input.value, suggestions[selected])) {
        e.preventDefault();
        complete(selected);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedFor = input.value;
        closeSlash();
        return;
      }
    }
    if (e.key === "Tab") {
      // While typing, Tab and Shift+Tab walk the chat tabs instead of leaving the box.
      e.preventDefault();
      selectTab(cycleTab(tab, e.shiftKey ? -1 : 1));
      uiSound("select");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const text = outgoingText(input.value);
      input.value = "";
      closeSlash();
      if (text) {
        // Client-side commands (e.g. "/friend name") are handled locally, never broadcast.
        if (!opts.command?.(text)) opts.send(text, tab);
        uiSound("confirm");
      }
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (!picker.hidden) setPicker(false);
      else input.blur();
    }
  });
  input.addEventListener("keyup", (e) => e.stopPropagation());

  document.addEventListener("keydown", (e) => {
    // Tab from the game (nothing else focused) jumps into chat. Inside menus and dialogs Tab keeps
    // its normal job of moving between buttons.
    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey && e.target !== input) {
      const a = document.activeElement;
      if (a === null || a === document.body || a instanceof HTMLCanvasElement) {
        e.preventDefault();
        input.focus();
      }
      return;
    }
    if (e.key !== "Enter" || e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target === input || isEditable(document.activeElement)) return;
    e.preventDefault();
    input.focus();
  });

  function whisper(name: string): void {
    const n = displayLine(name, "x").name;
    if (!n) return;
    input.value = `/w ${n} `;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function nameSpan(name: string): HTMLSpanElement {
    const who = document.createElement("span");
    who.className = "chat-name";
    who.textContent = name;
    who.style.color = nameColor(name);
    who.title = `Whisper to ${name}`;
    // Right-click / long-press opens the player menu (ui/player-card.ts).
    who.setAttribute("data-player-name", name);
    who.addEventListener("click", (e) => {
      e.stopPropagation();
      whisper(name);
    });
    return who;
  }

  const add = (name: string, text: string, kind: "player" | "npc" | "system", lineOpts: ChatLineOpts = {}): void => {
    const line = displayLine(name, text);
    if (!line.text) return;
    const channel: ChatChannel = lineOpts.channel ?? (kind === "system" ? "system" : "zone");
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_PX;

    const el = document.createElement("div");
    el.className = `chat-line chat-${kind} chat-ch-${channel}`;
    el.dataset.ch = channel;
    const tag = channelTag(channel, lineOpts.pm);
    if (tag) {
      const t = document.createElement("span");
      t.className = "chat-tag";
      t.textContent = `${tag} `;
      el.appendChild(t);
    }
    if (kind !== "system" && line.name) {
      // NPC names aren't players: no whisper link.
      if (kind === "player") el.appendChild(nameSpan(line.name));
      else {
        const who = document.createElement("span");
        who.className = "chat-name";
        who.textContent = line.name;
        who.style.color = nameColor(line.name);
        el.appendChild(who);
      }
      el.appendChild(document.createTextNode(": "));
    }
    const body = document.createElement("span");
    body.className = "chat-text";
    body.textContent = line.text;
    el.appendChild(body);
    log.appendChild(el);

    while (log.childElementCount > MAX_LOG_LINES) log.firstElementChild?.remove();
    if (stick) log.scrollTop = log.scrollHeight;
    for (const t of unreadTabs(tab, channel)) tabEls.get(t)?.classList.add("unread");
    if (lineVisible(tab, channel)) wake();
  };

  selectTab("all");
  wake();
  return {
    add,
    focus: () => input.focus(),
    whisper,
    setGuest: () => refreshPlaceholder(),
    prefill(text: string) {
      input.value = text.slice(0, MAX_CHAT_LEN);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
  };
};

/** Chat-log text for an emote: "Ann waves". */
export function emoteLine(name: string, code: EmoteCode): string {
  return `${name} ${emoteVerb(code)}`;
}
