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
import { CHAT_HIDDEN_KEY, initialChatHidden, lineWakesDot } from "./chat-toggle-logic";
import type { SocialStats } from "../../shared/social";
import { statRows, statsVisible } from "./stats-logic";
import { itemTip } from "./item-tip";
import { createNameFlash, itemTitle, type NameFlash } from "./item-tip-logic";
import { gaugeLabel, holdsWater, waterGauge, type WaterLevel } from "./water-gauge";
import { createSlotMenu, type SlotMenu } from "./slot-menu";
import { BAG_BUMP_EVENT, replayClass } from "./buy-fx";
import { tradeMenuChoices } from "./slot-menu-logic";
import { parseTradeCommand } from "../../shared/trade";
import { parseAdminCommand } from "../../shared/admin";
import { createShoutBanner, type ShoutBanner } from "./shout-banner";
import { createJailTimer, type JailTimer } from "./jail-timer";
import { createLevelBadge, type LevelBadge } from "./level-badge";
import { createFeedback, type FeedbackUi } from "./feedback";
import { createGamepad, type Gamepad } from "./gamepad";
import "./styles/hud.css";
import "./styles/phone.css";
import "./styles/phone-sheets.css";
import { trackVisualViewport } from "./viewport";

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

/** The guest's "Create account": words on a wide screen, an icon on a phone (the label hides there). */
function accountButton(onClick: () => void): HTMLButtonElement {
  const b = button("", "dm-btn dm-btn-primary dm-btn-small hud-create-account", "hud-create-account", onClick);
  b.appendChild(menuIcon("account", "dm-btn-icon hud-account-icon"));
  b.appendChild(el("span", { className: "dm-btn-label", text: "Create account" }));
  b.setAttribute("aria-label", "Create account");
  b.title = "Create account";
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
  trackVisualViewport();
  const hud = el("div", { id: "hud", className: "dm-hud" });
  root.appendChild(hud);

  let inv: Inventory | null = null;
  let water: WaterLevel | null = null;
  let selected = 0;
  const slotMenu: SlotMenu = safe(
    "slot menu",
    () =>
      createSlotMenu(root, (slot, qty) => game.send({ t: "dropItem", slot, ...(qty !== null ? { qty } : {}) }), {
        extra: (stack) => (safe("tradeOpen", () => game.tradeOpen?.() ?? false, false) ? tradeMenuChoices(stack.qty) : []),
        onTrade: (slot, qty) => {
          const s = inv?.slots[slot];
          if (s) game.tradeAdd?.(slot, qty ?? s.qty);
        },
      }),
    {
      open() {},
      close() {},
    },
  );
  /** Right-click on a filled hotbar or bag slot: Drop 1 / Drop all. */
  function openSlotMenu(slot: number, x: number, y: number): void {
    const s = inv?.slots[slot];
    if (s && !buildMode) slotMenu.open(slot, s, x, y);
  }
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
    el("div", { className: "hud-status-row hud-status-small" }, el("span", { className: "hud-coin-icon dm-coin", title: "Coins" }), coinsEl, pingEl),
  );
  hud.appendChild(status);

  // --- menu (top-right)
  const inventoryBtn = menuButton("Bag", "bag", "hud-btn-inventory", "I", () => toggleInventory());
  const onBagBump = () => {
    // The HUD is rebuilt on sign-in; an old one drops its listener the first time it's bumped.
    if (!inventoryBtn.isConnected) document.removeEventListener(BAG_BUMP_EVENT, onBagBump);
    else replayClass(inventoryBtn, "is-bag-bump");
  };
  document.addEventListener(BAG_BUMP_EVENT, onBagBump);
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
    accountButton(() => {
      uiSound("click");
      void showAccountPrompt("Create an account to keep your farm and explore Mossbrook.");
    }),
  );
  // Phones only (CSS hides it elsewhere): folds the chat away so the world isn't covered.
  let chatHidden = initialChatHidden(() => localStorage.getItem(CHAT_HIDDEN_KEY));
  const chatBtn = menuButton("Chat", "chat", "hud-btn-chat", null, () => {
    uiSound("click");
    setChatHidden(!chatHidden);
  });
  chatBtn.classList.add("hud-chat-toggle");
  chatBtn.appendChild(el("span", { className: "hud-chat-dot" }));
  function setChatHidden(hidden: boolean): void {
    chatHidden = hidden;
    hud.classList.toggle("is-chat-hidden", hidden);
    chatBtn.setAttribute("aria-pressed", String(!hidden));
    if (!hidden) chatBtn.classList.remove("has-unread");
    try {
      localStorage.setItem(CHAT_HIDDEN_KEY, hidden ? "1" : "0");
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  }
  setChatHidden(chatHidden);

  // Phones and touch screens: the on-screen controller and its toggle.
  const pad: Gamepad | null = game.padDir
    ? safe(
        "gamepad",
        () =>
          createGamepad(root.parentElement ?? root, {
            dir: (dx, dy, dash) => game.padDir?.(dx, dy, dash),
            press: (b) => {
              if (b === "bag") return toggleInventory();
              if (b === "map") return menu.toggle("map");
              game.padAction?.(b);
            },
          }),
        null,
      )
    : null;
  const padBtn = menuButton("Controller", "gamepad", "hud-btn-pad", null, () => {
    uiSound("click");
    pad?.toggle();
  });
  padBtn.classList.add("hud-pad-toggle");
  padBtn.hidden = !pad;
  const syncPadBtn = (on: boolean) => padBtn.setAttribute("aria-pressed", String(on));
  syncPadBtn(pad?.isOn() ?? false);
  pad?.onChange(syncPadBtn);

  // Phones: the bar shows the everyday buttons; "More" unfolds the rest.
  const moreBtn = menuButton("More", "more", "hud-btn-more", null, () => {
    uiSound("click");
    setMoreOpen(!topMenu.classList.contains("is-more-open"));
  });
  moreBtn.classList.add("hud-more-toggle");
  function setMoreOpen(open: boolean): void {
    topMenu.classList.toggle("is-more-open", open);
    moreBtn.setAttribute("aria-expanded", String(open));
  }
  // Phones: hide the whole HUD for a clear view of the world (this button stays to bring it back).
  const eyeBtn = menuButton("Hide HUD", "eye", "hud-btn-eye", null, () => {
    uiSound("click");
    setHudHidden(!hud.classList.contains("is-ui-hidden"));
  });
  eyeBtn.classList.add("hud-eye-toggle");
  function setHudHidden(hidden: boolean): void {
    hud.classList.toggle("is-ui-hidden", hidden);
    eyeBtn.setAttribute("aria-pressed", String(hidden));
    setMenuLabel(eyeBtn, hidden ? "Show HUD" : "Hide HUD");
    eyeBtn.title = hidden ? "Show HUD" : "Hide HUD";
    if (hidden) setMoreOpen(false);
  }
  for (const b of [goalsBtn, friendsBtn, bondsBtn, optionsBtn, signOutBtn]) b.classList.add("hud-menu-extra");
  // Picking something from the unfolded menu folds it again.
  for (const b of [goalsBtn, friendsBtn, bondsBtn, optionsBtn, inventoryBtn, mapBtn, chatBtn]) b.addEventListener("click", () => setMoreOpen(false));

  const topMenu = el(
    "div",
    { id: "hud-menu", className: "dm-panel hud-menu" },
    chatBtn,
    guestBadge,
    inventoryBtn,
    goalsBtn,
    friendsBtn,
    bondsBtn,
    mapBtn,
    optionsBtn,
    padBtn,
    moreBtn,
    eyeBtn,
  );
  setMoreOpen(false);
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
  // Admins only (setAdmin): starts a /shout in the chat box.
  const shoutBtn = button("Shout", "dm-btn dm-btn-small", "hud-btn-shout", () => {
    uiSound("click");
    menu.close();
    prefillChat("/shout ");
  });
  shoutBtn.title = "Admin: a banner for everyone online";
  shoutBtn.hidden = true;
  optionButtons.appendChild(shoutBtn);
  optionsPane.appendChild(optionButtons);
  const shoutBanner: ShoutBanner | null = safe(
    "shout banner",
    () =>
      createShoutBanner(hud, {
        // Centred just under the top menu, so the menu stays usable; at the very top where the menu moved to the bottom.
        top: () => {
          const m = topMenu.getBoundingClientRect();
          return m.height > 0 && m.top < 120 ? m.bottom + 8 : null;
        },
      }),
    null,
  );
  const jailTimer: JailTimer | null = safe(
    "jail timer",
    () =>
      createJailTimer(hud, {
        place: () => {
          const r = status.getBoundingClientRect();
          return r.height > 0 ? { x: r.left, y: r.bottom + 8 } : null;
        },
      }),
    null,
  );
  optionsPane.appendChild(
    el("p", { className: "options-keys dm-muted", text: "Keys: I bag · H hearts · O friends · M map · G goals · Esc closes. Drag items between slots; Shift-drag splits a stack." }),
  );

  // --- level and world stats (top-right, under the menu; the stats in shared zones only)
  const rightCol = el("div", { id: "hud-right", className: "hud-right" });
  hud.appendChild(rightCol);
  const level: LevelBadge | null = safe("level", () => createLevelBadge(rightCol), null);
  const statsEl = el("div", { id: "hud-stats", className: "dm-panel hud-stats" });
  statsEl.setAttribute("aria-label", "Server stats");
  statsEl.hidden = true;
  rightCol.appendChild(statsEl);
  /** Just under the menu, which wraps to two rows on some widths (on narrow screens it moves to the bottom). */
  function placeRight(): void {
    const m = topMenu.getBoundingClientRect();
    rightCol.style.top = m.height > 0 && m.top < 120 ? `${Math.round(m.bottom + 6)}px` : "";
  }
  let stats: SocialStats | null = null;
  let zoneId: ZoneId | null = null;
  function renderStats(): void {
    const show = statsVisible(zoneId, stats);
    statsEl.hidden = !show;
    if (!show || !stats || !zoneId) return;
    placeRight();
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
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSlotMenu(i, e.clientX, e.clientY);
    });
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
    () =>
      createInventoryPanel(invLayer, {
        onItem: (slot) => onInventoryItem(slot),
        drag: drag ?? undefined,
        onMenu: (slot, x, y) => openSlotMenu(slot, x, y),
        onSort: () => game.send({ t: "sortBag" }),
      }),
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
        close: () => setChatHidden(true),
      }),
    noopChat,
  );
  const send = (msg: Parameters<GameApi["send"]>[0]): void => game.send(msg);
  const shop = safe("shop", () => createShop(shopLayer, { send }), noopShop);
  const goals = safe("goals", () => createGoals(goalsLayer, { send }), noopGoals);
  const prefillChat = (text: string): void => {
    setChatHidden(false);
    chat.prefill?.(text);
  };
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
          canTrade: !!game.requestTrade && safe("canTrade", () => game.canTrade?.() ?? false, false),
          admin: safe("isAdmin", () => game.isAdmin?.() ?? false, false),
        }),
        trade: (hit) => game.requestTrade?.(hit),
        kick: (name) => game.adminCommand?.({ cmd: "kick", name, reason: "" }),
        jail: (name, minutes) => game.adminCommand?.({ cmd: "jail", name, minutes }),
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
    // Admin commands first: for an admin "/kick name" removes them from the server, not just from home.
    const admin = parseAdminCommand(text);
    if (admin && safe("isAdmin", () => game.isAdmin?.() ?? false, false)) {
      if (admin.cmd === "error") notices.notice(admin.message, "error");
      else game.adminCommand?.(admin);
      return true;
    }
    // Non-admins: never let "/shout ..." or "/unban ..." go out as zone chat.
    if (admin && !/^\/kick\b/i.test(text.trim())) {
      notices.notice("That command is for admins.", "error");
      return true;
    }
    const trade = parseTradeCommand(text);
    if (trade) {
      if (safe("isGuest", () => game.isGuest(), false)) void showAccountPrompt("Create an account to trade with other players.");
      else if (!trade.name) notices.notice("Usage: /trade name. Stand near them out in the valley.", "error");
      else game.requestTrade?.(trade.name);
      return true;
    }
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
  // --- feedback (bottom-right bug button; admins also review)
  const feedback: FeedbackUi | null = safe(
    "feedback",
    () => createFeedback(hud, root, game, (t, kind) => notices.notice(t, kind)),
    null,
  );
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
      if (chatHidden && lineWakesDot(kind)) chatBtn.classList.add("has-unread");
    },
    whisper(name: string) {
      if (safe("isGuest", () => game.isGuest(), false)) {
        chat.add("", GUEST_CHAT, "system");
        return;
      }
      setChatHidden(false);
      chat.whisper?.(name);
    },
    setStats(next: SocialStats | null) {
      stats = next;
      renderStats();
    },
    notice(text: string, kind: "info" | "error" | "loot") {
      notices.notice(text, kind);
    },
    openShop(npc: string, name: string, offers: ShopOffer[], buys: ItemId[], counter?: boolean) {
      shop.open(npc, name, offers, buys, inv ?? { coins: 0, slots: [] }, counter);
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
    closeAll() {
      setMoreOpen(false);
      menu.close();
      shop.close();
      convo.close();
      animalCard.close();
      slotMenu.close();
      feedback?.close();
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
    talkingTo() {
      return convo.talkingTo?.() ?? null;
    },
    npcSayFailed(reason) {
      convo.failed(reason);
    },
    shout(s) {
      shoutBanner?.show(s);
    },
    setAdmin(on) {
      shoutBtn.hidden = !on;
      feedback?.setAdmin(on);
    },
    jail(until, serverTime) {
      jailTimer?.set(until, serverTime);
    },
    setLevel(view, gain) {
      level?.set(view, gain);
      placeRight();
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
