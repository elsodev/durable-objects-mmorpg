// HUD shell: status bar, hotbar, build banner, guest badge, sign-out and keyboard shortcuts.
// Composes the inventory, chat, dialogs and icons modules (contracts in ./index.ts).
import type { ShopOffer, VillageGoal } from "../../shared/protocol";
import type { Inventory, ItemId, ZoneId } from "../../shared/types";
import { getItem } from "../../shared/items";
import type { AccountPrompt, Chat, GameApi, GoalsPanel, Hud, InventoryPanel, Notices, ShopDialog } from "./index";
import { createInventoryPanel } from "./inventory";
import { createChat } from "./chat";
import { createAccountPrompt, createGoals, createNotices, createShop } from "./dialogs";
import { iconFor, setIconSource } from "./icons";
import { createFriendsPanel, type FriendsPanel } from "./friends";
import { createPlayerMenu } from "./player-menu";
import { badgeText, whisperPrefill } from "./friends-logic";
import { FRIEND_NAME_HINT, parseFriendCommand } from "../../shared/friends";
import { parseHomeCommand } from "../../shared/visits";
import { runHomeCommand } from "./visits-api";
import { uiSound } from "./sound";
import { openCredits } from "./credits";
import { mountAudioControls } from "../audio/player";
import { HOTBAR_SIZE, heartStates, hotbarSlots, pingLevel, shortcutFor } from "./hud-logic";
import type { SocialStats } from "../../shared/social";
import { statRows, statsVisible } from "./stats-logic";
import "./styles/hud.css";

export { HOTBAR_SIZE };


// ---------- DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { id?: string; className?: string; text?: string; title?: string } = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs.id) e.id = attrs.id;
  if (attrs.className) e.className = attrs.className;
  if (attrs.text !== undefined) e.textContent = attrs.text;
  if (attrs.title) e.title = attrs.title;
  for (const c of children) e.appendChild(c);
  return e;
}

function button(text: string, className: string, id: string | undefined, onClick: () => void): HTMLButtonElement {
  const b = el("button", { id, className, text });
  b.type = "button";
  b.addEventListener("pointerenter", () => uiSound("hover"));
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function layer(name: string): HTMLDivElement {
  return el("div", { className: `hud-layer hud-layer-${name}` });
}

function safe<T>(label: string, make: () => T, fallback: T): T {
  try {
    return make();
  } catch (err) {
    console.error(`HUD: ${label} unavailable`, err);
    return fallback;
  }
}

function itemIcon(item: ItemId): string | null {
  try {
    return iconFor(item);
  } catch {
    return null;
  }
}

function itemName(item: ItemId): string {
  return getItem(item)?.name ?? item;
}

const noopInventory: InventoryPanel = { setInventory() {}, toggle() {}, close() {}, isOpen: () => false };
const noopChat: Chat = { add() {}, focus() {} };
const GUEST_CHAT = "Create an account to chat with everyone.";
const noopShop: ShopDialog = { open() {}, setInventory() {}, close() {} };
const noopGoals: GoalsPanel = { set() {}, setInventory() {}, toggle() {} };
const noopFriends: FriendsPanel = {
  toggle() {},
  open() {},
  close() {},
  isOpen: () => false,
  addByName: async () => {},
  refresh: async () => {},
};

// ---------- mountHud ----------

export function mountHud(root: HTMLElement, game: GameApi): Hud {
  const hud = el("div", { id: "hud", className: "dm-hud" });
  root.appendChild(hud);

  let inv: Inventory | null = null;
  let selected = 0;
  let typing = false;
  let buildMode = false;

  // --- status (top-left)
  const zoneEl = el("span", { id: "hud-zone", className: "hud-zone", text: "…" });
  const connEl = el("span", { id: "hud-conn", className: "hud-conn conn-connecting", title: "Connecting" });
  const coinsEl = el("span", { id: "hud-coins", className: "hud-coins", text: "0" });
  const hpEl = el("span", { id: "hud-hp", className: "hud-hp" });
  const pingEl = el("span", { id: "hud-ping", className: "hud-ping", text: "-- ms" });
  const status = el(
    "div",
    { id: "hud-status", className: "dm-panel hud-status" },
    el("div", { className: "hud-status-row" }, connEl, zoneEl),
    el("div", { className: "hud-status-row" }, hpEl),
    el("div", { className: "hud-status-row hud-status-small" }, el("span", { className: "hud-coin-icon", title: "Coins" }), coinsEl, pingEl),
  );
  hud.appendChild(status);

  // --- menu (top-right)
  const inventoryBtn = button("Bag (I)", "dm-btn dm-btn-small", "hud-btn-inventory", () => toggleInventory());
  const goalsBtn = button("Goals (G)", "dm-btn dm-btn-small", "hud-btn-goals", () => toggleGoals());
  const friendsBtn = button("Friends (O)", "dm-btn dm-btn-small", "hud-btn-friends", () => friends.toggle());
  const wardrobeBtn = game.openWardrobe
    ? button("Wardrobe", "dm-btn dm-btn-small", "hud-btn-wardrobe", () => game.openWardrobe?.())
    : null;
  const creditsBtn = button("Credits", "dm-btn dm-btn-small", "hud-btn-credits", () => {
    uiSound("click");
    openCredits();
  });
  const signOutBtn = button("Sign out", "dm-btn dm-btn-small", "hud-signout", () => void onSignOut());
  const guestBadge = el(
    "div",
    { id: "hud-guest", className: "hud-guest" },
    el("span", { className: "hud-guest-label", text: "Guest", title: "Guest progress stays on this device only" }),
    button("Create account", "dm-btn dm-btn-primary dm-btn-small", "hud-create-account", () => {
      uiSound("click");
      void showAccountPrompt("Create an account to keep your farm and explore Mossbrook.");
    }),
  );
  const menu = el("div", { id: "hud-menu", className: "dm-panel hud-menu" }, guestBadge, inventoryBtn, goalsBtn, friendsBtn);
  if (wardrobeBtn) menu.appendChild(wardrobeBtn);
  menu.appendChild(creditsBtn);
  menu.appendChild(signOutBtn);
  hud.appendChild(menu);
  safe("audio controls", () => mountAudioControls(menu), null);

  // --- global stats (top-right, under the menu; shared zones only)
  const statsEl = el("div", { id: "hud-stats", className: "dm-panel hud-stats" });
  statsEl.setAttribute("aria-label", "Server stats");
  statsEl.hidden = true;
  hud.appendChild(statsEl);
  let stats: SocialStats | null = null;
  let zoneId: ZoneId | null = null;
  function renderStats(): void {
    const show = statsVisible(zoneId, stats);
    statsEl.hidden = !show;
    if (!show || !stats || !zoneId) return;
    // Sit just under the menu, which wraps to two rows on some widths (on narrow screens it moves to the bottom).
    const m = menu.getBoundingClientRect();
    statsEl.style.top = m.height > 0 && m.top < 120 ? `${Math.round(m.bottom + 6)}px` : "";
    clear(statsEl);
    for (const r of statRows(stats, zoneId)) {
      statsEl.appendChild(
        el(
          "div",
          { className: `hud-stat hud-stat-${r.key}` },
          el("span", { className: "hud-stat-icon" }),
          el("span", { className: "hud-stat-value", text: r.value }),
          el("span", { className: "hud-stat-label", text: r.label }),
        ),
      );
    }
  }

  const refreshGuest = (): void => {
    guestBadge.hidden = !safe("isGuest", () => game.isGuest(), false);
  };
  refreshGuest();

  // --- build banner (top-center)
  const buildBanner = el(
    "div",
    { id: "build-banner", className: "dm-panel hud-build-banner" },
    el("span", { className: "dm-title", text: "Build mode" }),
    el("span", { className: "dm-muted", text: "Click to place · R to rotate · Esc to cancel" }),
    button("Done", "dm-btn dm-btn-primary dm-btn-small", "build-done", () => {
      uiSound("confirm");
      game.setBuildItem(null);
    }),
  );
  buildBanner.hidden = true;
  hud.appendChild(buildBanner);

  // --- hotbar (bottom-center)
  const hotbar = el("div", { id: "hotbar", className: "dm-panel hud-hotbar" });
  hotbar.setAttribute("role", "toolbar");
  hotbar.setAttribute("aria-label", "Hotbar");
  const slotEls: HTMLButtonElement[] = [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const b = el("button", { className: "dm-slot hud-slot" });
    b.type = "button";
    b.dataset.slot = String(i);
    b.addEventListener("pointerenter", () => uiSound("hover"));
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      uiSound("select");
      setSelected(i);
      game.selectSlot(i);
    });
    slotEls.push(b);
    hotbar.appendChild(b);
  }
  hud.appendChild(hotbar);

  // --- sub-modules, each in its own layer
  const invLayer = layer("inventory");
  const chatLayer = layer("chat");
  const shopLayer = layer("shop");
  const goalsLayer = layer("goals");
  const friendsLayer = layer("friends");
  const noticesLayer = layer("notices");
  const accountLayer = layer("account");
  for (const l of [invLayer, goalsLayer, friendsLayer, chatLayer, shopLayer, noticesLayer, accountLayer]) hud.appendChild(l);

  const notices: Notices = safe("notices", () => createNotices(noticesLayer), { notice() {} });
  const inventory = safe(
    "inventory",
    () => createInventoryPanel(invLayer, { onItem: (slot) => onInventoryItem(slot) }),
    noopInventory,
  );
  const chat = safe(
    "chat",
    () =>
      createChat(chatLayer, {
        send: (text, tab) => (game.chat ? game.chat(text, tab) : game.send({ t: "chat", text })),
        setTyping: (t) => {
          typing = t;
          game.setTyping(t);
        },
        command: (text) => chatCommand(text),
        emote: (code) => (game.emote ? game.emote(code) : game.send({ t: "emote", code })),
        guest: () => game.isGuest(),
      }),
    noopChat,
  );
  const send = (msg: Parameters<GameApi["send"]>[0]): void => game.send(msg);
  const shop = safe("shop", () => createShop(shopLayer, { send }), noopShop);
  const goals = safe("goals", () => createGoals(goalsLayer, { send }), noopGoals);
  const prefillChat = (text: string): void => chat.prefill?.(text);
  const friends: FriendsPanel = safe(
    "friends",
    () =>
      createFriendsPanel(friendsLayer, {
        // Through the command hook first, so "/invite name" is never broadcast as public chat.
        sendChat: (text) => {
          if (!chatCommand(text)) game.chat ? game.chat(text, "all") : game.send({ t: "chat", text });
        },
        prefillChat,
        notice: (text, kind) => notices.notice(text, kind),
        isGuest: () => safe("isGuest", () => game.isGuest(), false),
        askAccount: () => void showAccountPrompt("Create an account to add friends and see when they're online."),
        onBadge: (n) => {
          const text = badgeText(n);
          if (text) friendsBtn.dataset.badge = text;
          else delete friendsBtn.dataset.badge;
          friendsBtn.title = n > 0 ? `${n} friend request${n === 1 ? "" : "s"}` : "";
        },
      }),
    noopFriends,
  );
  safe(
    "player menu",
    () =>
      createPlayerMenu(friendsLayer, {
        playerNameAt: (x, y) => game.playerNameAt?.(x, y) ?? null,
        addFriend: (name) => void friends.addByName(name),
        whisper: (name) => prefillChat(whisperPrefill(name)),
      }),
    null,
  );
  function chatCommand(text: string): boolean {
    const home = parseHomeCommand(text);
    if (home) {
      if (safe("isGuest", () => game.isGuest(), false)) {
        void showAccountPrompt("Create an account to invite friends to your home.");
      } else {
        void runHomeCommand(home.cmd, home.name, (t, kind) => notices.notice(t, kind));
      }
      return true;
    }
    const cmd = parseFriendCommand(text);
    if (!cmd) return false;
    if (!cmd.name) notices.notice(`Usage: /friend name. ${FRIEND_NAME_HINT}`, "error");
    else void friends.addByName(cmd.name);
    return true;
  }
  const account: AccountPrompt = safe("account prompt", () => createAccountPrompt(accountLayer), {
    show: async () => false,
  });

  // --- behaviour
  function renderHotbar(): void {
    const slots = hotbarSlots(inv);
    slots.forEach((s, i) => {
      const b = slotEls[i]!;
      clear(b);
      b.appendChild(el("span", { className: "dm-key", text: String(i + 1) }));
      b.classList.toggle("selected", i === selected);
      b.setAttribute("aria-pressed", String(i === selected));
      if (!s) {
        b.title = `Slot ${i + 1}: empty`;
        b.classList.add("empty");
        return;
      }
      b.classList.remove("empty");
      const name = itemName(s.item);
      b.title = s.qty > 1 ? `${name} ×${s.qty}` : name;
      const src = itemIcon(s.item);
      if (src) {
        const img = el("img");
        img.alt = name;
        img.draggable = false;
        img.src = src;
        b.appendChild(img);
      } else {
        b.appendChild(el("span", { className: "hud-slot-letter", text: name.charAt(0).toUpperCase() }));
      }
      if (s.qty > 1) b.appendChild(el("span", { className: "dm-qty", text: String(s.qty) }));
    });
  }

  function setSelected(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) return;
    selected = slot;
    slotEls.forEach((b, i) => {
      b.classList.toggle("selected", i === slot);
      b.setAttribute("aria-pressed", String(i === slot));
    });
  }

  function onInventoryItem(slot: number): void {
    const s = inv?.slots[slot];
    if (!s) return;
    if (getItem(s.item)?.kind === "furniture" && game.zone() === "home") {
      uiSound("select");
      game.setBuildItem(slot);
      inventory.close();
      return;
    }
    if (slot < HOTBAR_SIZE) {
      uiSound("select");
      setSelected(slot);
      game.selectSlot(slot);
      return;
    }
    notices.notice(`${itemName(s.item)} isn't on your hotbar (slots 1-8).`, "info");
  }

  function toggleInventory(): void {
    // Panels play their own open/close sounds.
    inventory.toggle();
  }

  function toggleGoals(): void {
    goals.toggle();
  }

  let signOutArmed: ReturnType<typeof setTimeout> | null = null;
  async function onSignOut(): Promise<void> {
    if (!signOutArmed) {
      uiSound("click");
      signOutBtn.textContent = safe("isGuest", () => game.isGuest(), false) ? "Lose guest farm?" : "Sure?";
      signOutBtn.classList.add("dm-btn-accent");
      signOutArmed = setTimeout(disarmSignOut, 3000);
      return;
    }
    disarmSignOut();
    uiSound("confirm");
    signOutBtn.disabled = true;
    try {
      await game.signOut();
    } catch (err) {
      console.error(err);
      uiSound("error");
      notices.notice("Could not sign out. Try again.", "error");
    } finally {
      signOutBtn.disabled = false;
    }
  }
  function disarmSignOut(): void {
    if (signOutArmed) clearTimeout(signOutArmed);
    signOutArmed = null;
    signOutBtn.textContent = "Sign out";
    signOutBtn.classList.remove("dm-btn-accent");
  }

  let accountOpen: Promise<boolean> | null = null;
  function showAccountPrompt(reason: string): Promise<boolean> {
    if (accountOpen) return accountOpen;
    accountOpen = account
      .show(reason)
      .catch((err: unknown) => {
        console.error(err);
        return false;
      })
      .then((ok) => {
        accountOpen = null;
        if (ok) guestBadge.hidden = true;
        else refreshGuest();
        return ok;
      });
    return accountOpen;
  }

  const onKey = (e: KeyboardEvent): void => {
    const action = shortcutFor(e, typing);
    if (!action) return;
    if (action === "inventory") {
      e.preventDefault();
      toggleInventory();
    } else if (action === "goals") {
      e.preventDefault();
      toggleGoals();
    } else if (action === "friends") {
      e.preventDefault();
      friends.toggle();
    } else {
      if (inventory.isOpen()) inventory.close();
      friends.close();
    }
  };
  window.addEventListener("keydown", onKey);

  renderHotbar();

  return {
    setZone(zone: ZoneId, title: string) {
      zoneEl.textContent = title || zone;
      hud.dataset.zone = zone;
      zoneId = zone;
      renderStats();
      refreshGuest();
      chat.setGuest?.(safe("isGuest", () => game.isGuest(), false));
    },
    setInventory(next: Inventory) {
      inv = next;
      coinsEl.textContent = next.coins.toLocaleString();
      coinsEl.title = `${next.coins.toLocaleString()} coins`;
      renderHotbar();
      inventory.setInventory(next);
      shop.setInventory(next);
      goals.setInventory(next);
    },
    setSelectedSlot(slot: number) {
      setSelected(slot);
    },
    setHp(hp: number, maxHp: number) {
      const states = heartStates(hp, maxHp);
      clear(hpEl);
      for (const s of states) hpEl.appendChild(el("span", { className: `hud-heart ${s}` }));
      hpEl.title = `${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)} HP`;
      hpEl.classList.toggle("low", maxHp > 0 && hp / maxHp <= 0.25);
    },
    addChat(name, text, kind = "player", opts) {
      chat.add(name, text, kind, opts);
    },
    whisper(name: string) {
      if (safe("isGuest", () => game.isGuest(), false)) {
        chat.add("", GUEST_CHAT, "system");
        return;
      }
      chat.whisper?.(name);
    },
    setStats(next: SocialStats | null) {
      stats = next;
      renderStats();
    },
    notice(text: string, kind: "info" | "error" | "loot") {
      notices.notice(text, kind);
    },
    openShop(npc: string, name: string, offers: ShopOffer[], buys: ItemId[]) {
      shop.open(npc, name, offers, buys, inv ?? { coins: 0, slots: [] });
    },
    closeShop() {
      shop.close();
    },
    setGoals(list: VillageGoal[]) {
      goals.set(list);
    },
    setPing(ms: number) {
      const v = Math.max(0, Math.round(ms));
      pingEl.textContent = `${v} ms`;
      pingEl.dataset.level = pingLevel(v);
    },
    setBuildMode(on: boolean) {
      if (on === buildMode) return;
      buildMode = on;
      buildBanner.hidden = !on;
      hud.classList.toggle("build-mode", on);
      uiSound(on ? "open" : "close");
    },
    setConnection(state: "connecting" | "online" | "offline") {
      connEl.className = `hud-conn conn-${state}`;
      connEl.title = state === "online" ? "Online" : state === "offline" ? "Offline — reconnecting" : "Connecting";
      hud.classList.toggle("offline", state === "offline");
    },
    showAccountPrompt,
    setIconSource(src: (item: ItemId) => string) {
      safe("icons", () => setIconSource(src), undefined);
      renderHotbar();
      if (inv) {
        inventory.setInventory(inv);
        shop.setInventory(inv);
        goals.setInventory(inv);
      }
    },
  };
}
