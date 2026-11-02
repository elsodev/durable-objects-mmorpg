// Player card (#player-card): right-click (or touch long-press) a player in the world, or a player's
// name in chat. Shows a portrait, online/zone, lifetime stats and friendship from
// GET /api/players/:id/card, with Add friend / Whisper / Trade / Invite home / Mute buttons, and Kick for
// admins (two clicks: "Kick" then "Remove <name>?") plus a minutes box and "Send to Jail" (the
// server checks admin rights on both). Your own card
// has no buttons. Closes on Esc, a click outside (which then does nothing else), or when the player
// walks away. Names and stats are untrusted: textContent only.
import type { PlayerCard as CardData } from "../../shared/players";
import { JAIL_DEFAULT_MINUTES, JAIL_MAX_MINUTES, parseJailMinutes } from "../../shared/jail";
import { friendsApi } from "./friends-api";
import { CONFIRM_MS, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, whisperPrefill } from "./friends-logic";
import type { MuteStore } from "./mutes";
import { mutesApi as defaultApi, type MutesApi } from "./mutes-api";
import {
  CARD_WATCH_MS,
  cardButtons,
  cardLevel,
  friendButton,
  placeCard,
  presenceLine,
  shouldCloseForDistance,
  statRows,
  type CardContext,
  type PlayerHit,
} from "./player-card-logic";
import { uiSound } from "./sound";

/** Elements carrying this attribute (chat names) name a player. */
export const PLAYER_NAME_ATTR = "data-player-name";

export interface PlayerCardOpts {
  /** Player drawn under a viewport point in the game canvas (yourself included), else null. */
  playerAt(clientX: number, clientY: number): PlayerHit | null;
  /** A player in view by name (for chat names), else null. */
  playerByName?(name: string): PlayerHit | null;
  /** Tiles from you to that entity, or null once it is gone. */
  distanceTo?(entityId: string): number | null;
  portrait?(entityId: string): HTMLCanvasElement | null;
  context(): CardContext;
  addFriend(name: string): Promise<void>;
  /** Friends list changed from the card. */
  friendsChanged?(): void;
  prefillChat(text: string): void;
  inviteHome(name: string): void;
  /** Ask this player to trade (shown only where CardContext.canTrade). */
  trade?(hit: PlayerHit): void;
  /** Admins: remove this player from the server (shown only where CardContext.admin). */
  kick?(name: string): void;
  /** Admins: send this player to the cell for `minutes` (the server checks rights and range). */
  jail?(name: string, minutes: number): void;
  mutes: MuteStore;
  notice(text: string, kind: "info" | "error" | "loot"): void;
  api?: MutesApi;
}

export interface PlayerCardUi {
  open(hit: PlayerHit, clientX: number, clientY: number): void;
  close(): void;
  isOpen(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createPlayerCard(root: HTMLElement, opts: PlayerCardOpts): PlayerCardUi {
  const api = opts.api ?? defaultApi;
  const card = el("div", "dm-panel pc-card");
  card.id = "player-card";
  card.setAttribute("role", "dialog");
  card.hidden = true;
  const head = el("div", "pc-head");
  const portrait = el("div", "pc-portrait");
  const who = el("div", "pc-who");
  const nameRow = el("div", "pc-name-row");
  const name = el("div", "pc-name");
  name.id = "player-card-name";
  const lvl = el("span", "pc-level");
  lvl.id = "player-card-level";
  lvl.hidden = true;
  nameRow.appendChild(name);
  nameRow.appendChild(lvl);
  const status = el("div", "pc-status");
  status.id = "player-card-status";
  who.appendChild(nameRow);
  who.appendChild(status);
  head.appendChild(portrait);
  head.appendChild(who);
  const close = el("button", "dm-close pc-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    hide();
  });
  head.appendChild(close);
  const stats = el("dl", "pc-stats");
  stats.id = "player-card-stats";
  const actions = el("div", "pc-actions");
  const msg = el("div", "pc-msg");
  msg.id = "player-card-msg";
  msg.setAttribute("aria-live", "polite");
  card.appendChild(head);
  card.appendChild(stats);
  card.appendChild(actions);
  card.appendChild(msg);
  root.appendChild(card);

  let hit: PlayerHit | null = null;
  let data: CardData | null = null;
  let seq = 0;
  let watch: ReturnType<typeof setInterval> | null = null;
  let at = { x: 0, y: 0 };

  function button(text: string, id: string, onClick: (b: HTMLButtonElement) => void, cls = ""): HTMLButtonElement {
    const b = el("button", `dm-btn dm-btn-small ${cls}`.trim(), text);
    b.type = "button";
    b.id = id;
    b.addEventListener("pointerenter", () => uiSound("hover"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      uiSound("click");
      onClick(b);
    });
    return b;
  }

  function say(text: string, kind: "ok" | "error" | "" = ""): void {
    msg.textContent = text;
    msg.dataset.kind = kind;
    if (kind === "error") uiSound("error");
  }

  function muted(): boolean {
    if (!hit) return false;
    return hit.userId ? opts.mutes.set.hasId(hit.userId) : opts.mutes.set.hasName(hit.name);
  }

  function render(): void {
    if (!hit) return;
    name.textContent = data?.name ?? hit.name;
    const level = cardLevel(hit, data);
    lvl.textContent = level ?? "";
    lvl.hidden = level === null;
    status.textContent = hit.self && !data ? "You" : presenceLine(data);
    status.dataset.online = String(!!data?.online);
    stats.replaceChildren();
    for (const [k, v] of statRows(data)) {
      stats.appendChild(el("dt", "", k));
      stats.appendChild(el("dd", "", v));
    }
    stats.hidden = stats.childElementCount === 0;
    actions.replaceChildren();
    const ctx = opts.context();
    if (ctx.viewerGuest && !hit.self) say("Create an account to add friends and mute players.");
    for (const kind of cardButtons(hit, data, ctx)) {
      const target = hit;
      if (kind === "friend") {
        const f = friendButton(data?.friendship ?? "none");
        const b = button(f.label, "player-card-friend", (btn) => void onFriend(f.action, btn), f.action === "add" ? "dm-btn-primary" : "");
        b.disabled = f.disabled;
        actions.appendChild(b);
      } else if (kind === "whisper") {
        actions.appendChild(
          button("Whisper", "player-card-whisper", () => {
            hide();
            opts.prefillChat(whisperPrefill(target.name));
          }),
        );
      } else if (kind === "trade") {
        if (!opts.trade || !target.entityId) continue;
        actions.appendChild(
          button("Trade", "player-card-trade", () => {
            hide();
            opts.trade?.(target);
          }),
        );
      } else if (kind === "invite") {
        actions.appendChild(
          button("Invite home", "player-card-invite", () => {
            hide();
            opts.inviteHome(target.name);
          }),
        );
      } else if (kind === "kick") {
        if (!opts.kick) continue;
        actions.appendChild(button("Kick", "player-card-kick", (b) => onKick(target, b), "pc-kick"));
      } else if (kind === "jail") {
        if (!opts.jail) continue;
        actions.appendChild(jailRow(target));
      } else {
        const on = muted();
        actions.appendChild(button(on ? "Unmute" : "Mute", "player-card-mute", (b) => void onMute(!on, b), on ? "" : "pc-mute"));
      }
    }
  }

  let armed: ReturnType<typeof setTimeout> | null = null;
  let armedKick: ReturnType<typeof setTimeout> | null = null;
  async function onFriend(action: ReturnType<typeof friendButton>["action"], b: HTMLButtonElement): Promise<void> {
    const target = hit;
    if (!target || !action) return;
    if (action === "remove" && !armed) {
      // "Friends ✓" -> "Remove friend?" -> removes on the second click.
      b.textContent = "Remove friend";
      b.classList.add("dm-btn-accent");
      armed = setTimeout(() => {
        armed = null;
        render();
      }, CONFIRM_MS);
      return;
    }
    if (armed) clearTimeout(armed);
    armed = null;
    b.disabled = true;
    if (action === "add") {
      await opts.addFriend(target.name);
    } else if (action === "accept") {
      const r = await friendsApi.respond(target.userId, true);
      if (!r.ok) say(r.error, "error");
      else uiSound("confirm");
    } else {
      const r = await friendsApi.remove(target.userId);
      if (!r.ok) say(r.error, "error");
      else say(`Removed ${target.name} from friends.`, "ok");
    }
    opts.friendsChanged?.();
    if (hit === target) await load(target);
  }

  /** "Kick" arms the button ("Remove Ann?"); a second click within CONFIRM_MS sends the kick. */
  function onKick(target: PlayerHit, b: HTMLButtonElement): void {
    if (!armedKick) {
      b.textContent = `Remove ${target.name}?`;
      b.classList.add("dm-btn-accent");
      armedKick = setTimeout(() => {
        armedKick = null;
        render();
      }, CONFIRM_MS);
      return;
    }
    clearTimeout(armedKick);
    armedKick = null;
    hide();
    opts.kick?.(target.name);
  }

  /** Minutes box (default 5) and "Send to Jail"; bad input is refused here and again by the server. */
  function jailRow(target: PlayerHit): HTMLElement {
    const row = el("div", "pc-jail");
    const input = el("input", "pc-jail-min");
    input.type = "number";
    input.min = "1";
    input.max = String(JAIL_MAX_MINUTES);
    input.step = "1";
    input.value = String(JAIL_DEFAULT_MINUTES);
    input.id = "player-card-jail-minutes";
    input.setAttribute("aria-label", "Jail minutes");
    const unit = el("span", "pc-jail-unit", "min");
    const send = button("Send to Jail", "player-card-jail", () => {
      const minutes = parseJailMinutes(input.value);
      if (minutes === null) {
        say(`Jail time is whole minutes from 1 to ${JAIL_MAX_MINUTES}.`, "error");
        return;
      }
      hide();
      opts.jail?.(target.name, minutes);
    }, "pc-jail-send");
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") send.click();
    });
    row.appendChild(input);
    row.appendChild(unit);
    row.appendChild(send);
    return row;
  }

  async function onMute(on: boolean, b: HTMLButtonElement): Promise<void> {
    const target = hit;
    if (!target) return;
    b.disabled = true;
    let r: { error: string } | { name: string };
    if (on) r = await opts.mutes.mute(target.userId ? { userId: target.userId } : { name: target.name });
    else {
      const id = target.userId || opts.mutes.set.idByName(target.name);
      r = id ? await opts.mutes.unmute(id) : { error: `${target.name} isn't muted.` };
    }
    if (hit !== target) return;
    if ("error" in r) {
      b.disabled = false;
      return say(r.error, "error");
    }
    say(on ? `Muted ${target.name}. You won't see their chat.` : `Unmuted ${target.name}.`, "ok");
    if (data) data = { ...data, muted: on };
    render();
  }

  async function load(target: PlayerHit): Promise<void> {
    if (!target.userId) return;
    const mine = ++seq;
    const r = await api.card(target.userId);
    if (mine !== seq || hit !== target) return;
    if (!r.ok) {
      if (r.status !== 401) say(r.error, "error");
      return;
    }
    data = r.data;
    render();
    position();
  }

  function position(): void {
    const { left, top } = placeCard(at.x, at.y, card.offsetWidth || 240, card.offsetHeight || 200, innerWidth, innerHeight);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function open(target: PlayerHit, x: number, y: number): void {
    hit = target;
    data = null;
    at = { x, y };
    say("");
    portrait.replaceChildren();
    const pic = target.entityId ? opts.portrait?.(target.entityId) : null;
    if (pic) {
      pic.className = "pc-portrait-img";
      portrait.appendChild(pic);
    } else {
      portrait.appendChild(el("span", "pc-portrait-letter", target.name.charAt(0).toUpperCase() || "?"));
    }
    card.hidden = false;
    card.classList.toggle("is-self", target.self);
    card.setAttribute("aria-label", `${target.name}'s card`);
    render();
    position();
    uiSound("open");
    void load(target);
    if (watch) clearInterval(watch);
    watch = null;
    if (target.entityId && !target.self && opts.distanceTo) {
      watch = setInterval(() => {
        if (hit && hit.entityId && shouldCloseForDistance(opts.distanceTo!(hit.entityId))) hide();
      }, CARD_WATCH_MS);
    }
  }

  function hide(): void {
    if (card.hidden) return;
    card.hidden = true;
    hit = null;
    data = null;
    seq++;
    if (watch) clearInterval(watch);
    watch = null;
    if (armed) clearTimeout(armed);
    armed = null;
    if (armedKick) clearTimeout(armedKick);
    armedKick = null;
  }

  opts.mutes.onChange(() => {
    if (hit) render();
  });

  function hitFor(target: EventTarget | null, x: number, y: number): PlayerHit | null {
    if (!(target instanceof Element)) return null;
    const tagged = target.closest(`[${PLAYER_NAME_ATTR}]`);
    if (tagged) {
      const n = tagged.getAttribute(PLAYER_NAME_ATTR);
      if (!n) return null;
      return opts.playerByName?.(n) ?? { entityId: "", userId: "", name: n, self: false };
    }
    if (target instanceof HTMLCanvasElement) {
      try {
        return opts.playerAt(x, y);
      } catch {
        return null;
      }
    }
    return null;
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      const found = hitFor(e.target, e.clientX, e.clientY);
      if (!found) return;
      e.preventDefault();
      open(found, e.clientX, e.clientY);
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
      const inside = e.target instanceof Node && card.contains(e.target);
      if (!card.hidden && !inside) {
        hide();
        // The click that dismisses the card doesn't also walk or swing a tool. (A right-click goes
        // on: its contextmenu reopens the card on whoever is there, and never moves anyway.)
        if (e.button !== 2 && e.target instanceof HTMLCanvasElement) {
          e.stopPropagation();
          e.preventDefault();
        }
      }
      if (e.pointerType === "mouse" || !e.isPrimary) return cancelPress();
      cancelPress();
      const { clientX: x, clientY: y, target } = e;
      press = {
        id: e.pointerId,
        x,
        y,
        timer: setTimeout(() => {
          press = null;
          const found = hitFor(target, x, y);
          if (found) open(found, x, y);
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
    if (e.key === "Escape" && !card.hidden) hide();
  });

  return { open, close: hide, isOpen: () => !card.hidden };
}
