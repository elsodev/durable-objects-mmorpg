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
import { createPlayerCard } from "./player-card";
import { createMuteStore, type MuteStore } from "./mutes";
import { parseMuteCommand } from "../../shared/players";
import { createBondsUi, type BondsUi } from "./bonds";
import { createConvo, type ConvoUi } from "./convo";
import { createAnimalCard, type AnimalCard } from "./animals";
import { foodTaste } from "../../shared/animals";
import { badgeText, whisperPrefill } from "./friends-logic";
import { FRIEND_NAME_HINT, parseFriendCommand } from "../../shared/friends";
import { parseHomeCommand } from "../../shared/visits";
import { runHomeCommand } from "./visits-api";
import { uiSound } from "./sound";
import { createGameMenu, type GameMenu } from "./game-menu";
import { createMapPane, type MapPane } from "./map-pane";
import type { TravelId } from "./map-pane-logic";
import { createSlotDrag, type SlotDrag } from "./slot-drag";
import { planMove } from "./slot-drag-logic";
import { openCredits } from "./credits";
import { mountAudioControls } from "../audio/player";
import { menuIcon, type MenuIconName } from "./menu-icons";
import { HOTBAR_SIZE, heartStates, hotbarSlots, pingLevel, shortcutFor } from "./hud-logic";
import type { SocialStats } from "../../shared/social";
import { statRows, statsVisible } from "./stats-logic";
import { itemTip } from "./item-tip";
import { createNameFlash, itemTitle, type NameFlash } from "./item-tip-logic";
import { gaugeLabel, holdsWater, waterGauge, type WaterLevel } from "./water-gauge";
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

/**
 * A top-menu button: pixel icon, label and shortcut-key badge. The key is set in the body font: in
 * the pixel font G, B and O read as 6, 8 and 0. The label and badge hide on narrow screens, so the
 * button names itself with aria-label and shows the key in its tooltip.
 */
function menuButton(label: string, icon: MenuIconName, id: string, key: string | null, onClick: () => void): HTMLButtonElement {
  const b = button("", "dm-btn dm-btn-small hud-menu-btn", id, onClick);
  b.appendChild(menuIcon(icon));
  b.appendChild(el("span", { className: "dm-btn-label", text: label }));
  if (key) {
    b.appendChild(el("span", { className: "dm-btn-key", text: key }));
    b.setAttribute("aria-keyshortcuts", key);
  }
  b.setAttribute("aria-label", label);
  b.title = key ? `${label} (${key})` : label;
  return b;
}

/** Changes a menu button's visible label and accessible name together. */
function setMenuLabel(b: HTMLButtonElement, label: string): void {
  const span = b.querySelector(".dm-btn-label");
  if (span) span.textContent = label;
  else b.textContent = label;
  b.setAttribute("aria-label", label);
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
  let water: WaterLevel | null = null;
  let selected = 0;
  // Set once the card is built; the hotbar and inventory may update before that.
  let animalCardRef: AnimalCard | null = null;
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
  const inventoryBtn = menuButton("Bag", "bag", "hud-btn-inventory", "I", () => toggleInventory());
  const goalsBtn = menuButton("Goals", "goals", "hud-btn-goals", "G", () => toggleGoals());
  const friendsBtn = menuButton("Friends", "friends", "hud-btn-friends", "O", () => menu.toggle("friends"));
  const bondsBtn = menuButton("Hearts", "hearts", "hud-btn-bonds", "H", () => menu.toggle("hearts"));
  const mapBtn = menuButton("Map", "map", "hud-btn-map", "M", () => menu.toggle("map"));
  const optionsBtn = menuButton("Options", "options", "hud-btn-options", null, () => menu.toggle("options"));
  bondsBtn.title = "Hearts (H): relationships with villagers";
  const wardrobeBtn = game.openWardrobe
    ? button("Wardrobe", "dm-btn dm-btn-small", "hud-btn-wardrobe", () => game.openWardrobe?.())
    : null;
  const controlsBtn = game.openControls
    ? button("Controls", "dm-btn dm-btn-small", "hud-btn-controls", () => game.openControls?.())
    : null;
  const creditsBtn = button("Credits", "dm-btn dm-btn-small", "hud-btn-credits", () => {
    uiSound("click");
    openCredits();
  });
  const signOutBtn = menuButton("Sign out", "signout", "hud-signout", null, () => void onSignOut());
  const guestBadge = el(
    "div",
    { id: "hud-guest", className: "hud-guest" },
    el("span", { className: "hud-guest-label", text: "Guest", title: "Guest progress stays on this device only" }),
    button("Create account", "dm-btn dm-btn-primary dm-btn-small", "hud-create-account", () => {
      uiSound("click");
      void showAccountPrompt("Create an account to keep your farm and explore Mossbrook.");
    }),
  );
  const topMenu = el("div", { id: "hud-menu", className: "dm-panel hud-menu" }, guestBadge, inventoryBtn, goalsBtn, friendsBtn, bondsBtn, mapBtn, optionsBtn);
  topMenu.appendChild(signOutBtn);
  hud.appendChild(topMenu);
  safe("audio controls", () => mountAudioControls(topMenu), null);
  // Wardrobe, controls and credits live in the menu's Options tab.
  const optionsPane = el("div", { id: "options-pane", className: "options-pane" });
  optionsPane.hidden = true;
  const optionButtons = el("div", { className: "options-buttons" });
  if (wardrobeBtn) optionButtons.appendChild(wardrobeBtn);
  if (controlsBtn) optionButtons.appendChild(controlsBtn);
  optionButtons.appendChild(creditsBtn);
  optionsPane.appendChild(optionButtons);
  optionsPane.appendChild(
    el("p", { className: "options-keys dm-muted", text: "Keys: I bag · H hearts · O friends · M map · G goals · Esc closes. Drag items between slots; Shift-drag splits a stack." }),
  );

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
    const m = topMenu.getBoundingClientRect();
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
    el("span", { className: "dm-muted", text: "Click to place · R or wheel to rotate · Esc to cancel" }),
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
  hotbar.dataset.tipFrame = "";
  const slotEls: HTMLButtonElement[] = [];
  /** The slot a click just picked: the game echoes it back through setSelectedSlot. */
  let clickEcho: number | null = null;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const b = el("button", { className: "dm-slot hud-slot" });
    b.type = "button";
    b.dataset.slot = String(i);
    b.addEventListener("pointerenter", () => uiSound("hover"));
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      uiSound("select");
      setSelected(i, true);
      clickEcho = i;
      game.selectSlot(i);
      clickEcho = null;
    });
    safe("item tip", () => itemTip().attach(b, () => inv?.slots[i] ?? null), undefined);
    slotEls.push(b);
    hotbar.appendChild(b);
  }
  hud.appendChild(hotbar);

  // --- the selected item's name, flashed above the hotbar for a moment
  const flashText = el("span", { className: "hud-item-flash-text" });
  const flashEl = el("div", { id: "hud-item-flash", className: "hud-item-flash" }, flashText);
  // Screen readers get the name from the slot's aria-label and aria-pressed.
  flashEl.setAttribute("aria-hidden", "true");
  flashEl.hidden = true;
  hud.appendChild(flashEl);
  const nameFlash: NameFlash = createNameFlash({
    show(text) {
      flashText.textContent = text;
      flashEl.hidden = false;
      flashEl.classList.remove("is-fading");
    },
    fade() {
      flashEl.classList.add("is-fading");
    },
    hide() {
      flashEl.hidden = true;
      flashEl.classList.remove("is-fading");
    },
  });

  // --- drag and drop between bag slots (hotbar + inventory panel)
  const drag: SlotDrag | null = safe(
    "slot drag",
    () =>
      createSlotDrag({
        iconOf: (slot) => {
          const s = inv?.slots[slot];
          return s ? itemIcon(s.item) : null;
        },
        enabled: () => !buildMode,
        onDrop: (from, to, split) => moveBagSlot(from, to, split),
      }),
    null,
  );
  if (drag) slotEls.forEach((b, i) => drag.attach(b, i));

  /** Optimistic move; the server answers with the real bag (or a reject and the old one). */
  function moveBagSlot(from: number, to: number, split: boolean): void {
    const plan = planMove(inv, from, to, split);
    if (!plan) {
      uiSound("error");
      return;
    }
    uiSound(plan.result === "swap" ? "select" : "click");
    applyInventory(plan.next);
    game.send(plan.msg);
  }

  // --- sub-modules, each in its own layer
  const invLayer = layer("inventory");
  const chatLayer = layer("chat");
  const shopLayer = layer("shop");
  const goalsLayer = layer("goals");
  const friendsLayer = layer("friends");
  const bondsLayer = layer("bonds");
  const convoLayer = layer("convo");
  const animalLayer = layer("animals");
  const noticesLayer = layer("notices");
  const accountLayer = layer("account");
  for (const l of [invLayer, goalsLayer, friendsLayer, bondsLayer, chatLayer, convoLayer, animalLayer, shopLayer, noticesLayer, accountLayer]) hud.appendChild(l);

  const bonds: BondsUi = safe("bonds", () => createBondsUi(bondsLayer), {
    setList() {},
    bond() {},
    toggle() {},
    close() {},
    isOpen: () => false,
  });
  const convo: ConvoUi = safe(
    "conversation",
    () =>
      createConvo(convoLayer, {
        say: (npc, text) => game.send({ t: "npcSay", npc, text }),
        setTyping: (t) => {
          typing = t;
          game.setTyping(t);
        },
        distance: (id) => (game.playerDistance ? game.playerDistance(id) : 0),
        portrait: (id) => game.npcPortrait?.(id) ?? null,
      }),
    { bond() {}, said() {}, failed() {}, close() {}, isOpen: () => false },
  );
  const animalCard: AnimalCard = safe(
    "animal card",
    () =>
      createAnimalCard(animalLayer, {
        pet: (animal) => game.send({ t: "petAnimal", animal }),
        feed: (animal) => game.send({ t: "feedAnimal", animal, slot: selected }),
        adopt: (animal) => game.send({ t: "adoptAnimal", animal }),
        feedItem: (species) => {
          const s = inv?.slots[selected];
          return s && species !== "chicken" && foodTaste(species, s.item) ? itemName(s.item) : null;
        },
        distance: (id) => (game.playerDistance ? game.playerDistance(id) : 0),
      }),
    { show() {}, close() {}, isOpen: () => false, refresh() {} },
  );
  animalCardRef = animalCard;
  const notices: Notices = safe("notices", () => createNotices(noticesLayer), { notice() {} });
  const inventory = safe(
    "inventory",
    () => createInventoryPanel(invLayer, { onItem: (slot) => onInventoryItem(slot), drag: drag ?? undefined }),
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
        slashContext: game.slashContext ? () => game.slashContext!() : undefined,
      }),
    noopChat,
  );
  const send = (msg: Parameters<GameApi["send"]>[0]): void => game.send(msg);
  const shop = safe("shop", () => createShop(shopLayer, { send }), noopShop);
  const goals = safe("goals", () => createGoals(goalsLayer, { send }), noopGoals);
  const prefillChat = (text: string): void => chat.prefill?.(text);
  const mutes: MuteStore = createMuteStore({ isGuest: () => safe("isGuest", () => game.isGuest(), false) });
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
        mutes,
        onBadge: (n) => {
          const text = badgeText(n);
          if (text) friendsBtn.dataset.badge = text;
          else delete friendsBtn.dataset.badge;
          friendsBtn.title = n > 0 ? `Friends (O): ${n} friend request${n === 1 ? "" : "s"}` : "Friends (O)";
          friendsBtn.setAttribute("aria-label", n > 0 ? `Friends, ${n} request${n === 1 ? "" : "s"}` : "Friends");
        },
      }),
    noopFriends,
  );
  const inviteHome = (name: string): void =>
    void runHomeCommand("invite", name, (t, kind) => notices.notice(t, kind));
  safe(
    "player card",
    () =>
      createPlayerCard(friendsLayer, {
        playerAt: (x, y) => game.playerAt?.(x, y) ?? null,
        playerByName: (name) => game.playerByName?.(name) ?? null,
        distanceTo: (id) => (game.playerDistance ? game.playerDistance(id) : 0),
        portrait: (id) => game.playerPortrait?.(id) ?? null,
        context: () => ({
          viewerGuest: safe("isGuest", () => game.isGuest(), false),
          homeOwner: safe("slashContext", () => game.slashContext?.().homeOwner ?? false, false),
        }),
        addFriend: (name) => friends.addByName(name),
        friendsChanged: () => void friends.refresh(),
        prefillChat,
        inviteHome,
        mutes,
        notice: (text, kind) => notices.notice(text, kind),
      }),
    null,
  );
  async function muteCommand(cmd: "mute" | "unmute", name: string): Promise<void> {
    const say = (t: string, kind: "info" | "error"): void => notices.notice(t, kind);
    if (!name) return say(`Usage: /${cmd} name. ${FRIEND_NAME_HINT}`, "error");
    if (cmd === "mute") {
      const r = await mutes.mute({ name });
      return "error" in r ? say(r.error, "error") : say(`Muted ${r.name}. You won't see their chat.`, "info");
    }
    const id = mutes.set.idByName(name);
    if (!id) return say(`${name} isn't muted.`, "error");
    const r = await mutes.unmute(id);
    return "error" in r ? say(r.error, "error") : say(`Unmuted ${r.name || name}.`, "info");
  }
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
    const mute = parseMuteCommand(text);
    if (mute) {
      if (safe("isGuest", () => game.isGuest(), false)) void showAccountPrompt("Create an account to keep a mute list.");
      else void muteCommand(mute.cmd, mute.name);
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

  // --- the tabbed menu: Bag, Hearts, Friends, Map, Options
  const panelIn = (layerEl: HTMLElement, id: string): HTMLElement => {
    const found = layerEl.querySelector<HTMLElement>(`#${id}`);
    if (found) return found;
    const blank = el("div", { id });
    blank.hidden = true;
    return blank;
  };
  const travel = game.travel
    ? (to: TravelId): void => {
        menu.close();
        game.travel?.(to);
      }
    : undefined;
  const mapPane: MapPane = safe("map", () => createMapPane({ zone: () => zoneId, ...(travel ? { travel } : {}) }), {
    el: el("div"),
    show() {},
    hide() {},
    refresh() {},
  });
  const menuLayer = layer("menu");
  hud.appendChild(menuLayer);
  const menu: GameMenu = safe(
    "menu",
    () =>
      createGameMenu(menuLayer, {
        bag: {
          el: panelIn(invLayer, "inventory-panel"),
          show: () => {
            if (!inventory.isOpen()) inventory.toggle();
          },
          hide: () => inventory.close(),
        },
        hearts: {
          el: panelIn(bondsLayer, "bonds-panel"),
          show: () => {
            if (!bonds.isOpen()) bonds.toggle();
          },
          hide: () => bonds.close(),
        },
        friends: { el: panelIn(friendsLayer, "friends-panel"), show: () => friends.open(), hide: () => friends.close() },
        map: mapPane,
        options: {
          el: optionsPane,
          show: () => {
            optionsPane.hidden = false;
          },
          hide: () => {
            optionsPane.hidden = true;
          },
        },
      }),
    { toggle() {}, open() {}, close() {}, isOpen: () => false, tab: () => "bag", destroy() {} },
  );

  // --- behaviour
  function applyInventory(next: Inventory): void {
    inv = next;
    animalCardRef?.refresh();
    coinsEl.textContent = next.coins.toLocaleString();
    coinsEl.title = `${next.coins.toLocaleString()} coins`;
    renderHotbar();
    inventory.setInventory(next);
    shop.setInventory(next);
    goals.setInventory(next);
    safe("item tip", () => itemTip().refresh(), undefined);
  }

  function renderHotbar(): void {
    const slots = hotbarSlots(inv);
    slots.forEach((s, i) => {
      const b = slotEls[i]!;
      clear(b);
      b.appendChild(el("span", { className: "dm-key", text: String(i + 1) }));
      b.classList.toggle("selected", i === selected);
      b.setAttribute("aria-pressed", String(i === selected));
      if (!s) {
        b.setAttribute("aria-label", `Slot ${i + 1}: empty`);
        b.classList.add("empty");
        return;
      }
      b.classList.remove("empty");
      const name = itemName(s.item);
      const level = water && holdsWater(s.item) ? `, ${gaugeLabel(water)}` : "";
      b.setAttribute("aria-label", `Slot ${i + 1}: ${itemTitle(s.item, s.qty)}${level}`);
      const src = itemIcon(s.item);
      if (src) {
        const img = el("img");
        // The button already names the item; an alt would read it twice.
        img.alt = "";
        img.draggable = false;
        img.src = src;
        b.appendChild(img);
      } else {
        b.appendChild(el("span", { className: "hud-slot-letter", text: name.charAt(0).toUpperCase() }));
      }
      if (s.qty > 1) b.appendChild(el("span", { className: "dm-qty", text: String(s.qty) }));
      const gauge = waterGauge(s.item, water);
      if (gauge) b.appendChild(gauge);
    });
  }

  /** `announce`: the player picked it (click, number key, wheel), so flash the item's name. */
  function setSelected(slot: number, announce = false): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) return;
    if (announce) {
      const s = inv?.slots[slot];
      nameFlash.flash(s && !buildMode ? itemName(s.item) : null);
    }
    selected = slot;
    animalCardRef?.refresh();
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
    menu.toggle("bag");
  }

  function toggleGoals(): void {
    goals.toggle();
  }

  let signOutArmed: ReturnType<typeof setTimeout> | null = null;
  async function onSignOut(): Promise<void> {
    if (!signOutArmed) {
      uiSound("click");
      setMenuLabel(signOutBtn, safe("isGuest", () => game.isGuest(), false) ? "Lose guest farm?" : "Sure?");
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
    setMenuLabel(signOutBtn, "Sign out");
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
      menu.toggle("friends");
    } else if (action === "bonds") {
      e.preventDefault();
      menu.toggle("hearts");
    } else if (action === "map") {
      e.preventDefault();
      menu.toggle("map");
    } else {
      menu.close();
    }
  };
  window.addEventListener("keydown", onKey);

  renderHotbar();

  return {
    get mutes() {
      return mutes.set;
    },
    setZone(zone: ZoneId, title: string) {
      zoneEl.textContent = title || zone;
      hud.dataset.zone = zone;
      zoneId = zone;
      renderStats();
      mapPane.refresh();
      refreshGuest();
      chat.setGuest?.(safe("isGuest", () => game.isGuest(), false));
    },
    setWater(level: number, max: number) {
      if (water && water.water === level && water.max === max) return;
      water = { water: level, max };
      renderHotbar();
      inventory.setWater?.(water);
    },
    setInventory(next: Inventory) {
      applyInventory(next);
    },
    setSelectedSlot(slot: number) {
      // Keys and the wheel arrive here (pressing the current slot's key again re-shows its name);
      // a click already flashed before the game echoed it back.
      setSelected(slot, slot !== clickEcho);
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
      // The banner sits where the flash does.
      if (on) nameFlash.cancel();
      hud.classList.toggle("build-mode", on);
      uiSound(on ? "open" : "close");
    },
    setConnection(state: "connecting" | "online" | "offline") {
      connEl.className = `hud-conn conn-${state}`;
      connEl.title = state === "online" ? "Online" : state === "offline" ? "Offline — reconnecting" : "Connecting";
      hud.classList.toggle("offline", state === "offline");
    },
    showAccountPrompt,
    setBonds(list) {
      bonds.setList(list);
    },
    bond(view, delta, talk, entityId, gifts) {
      bonds.bond(view);
      convo.bond(view, delta, talk, entityId, gifts);
    },
    animal(view, open) {
      animalCard.show(view, open);
    },
    npcSaid(entityId, text) {
      convo.said(entityId, text);
    },
    npcSayFailed(reason) {
      convo.failed(reason);
    },
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
