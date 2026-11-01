// DOM UI: start screen (guest / sign in / sign up with Turnstile) and the HUD.
// The game only uses the exports of THIS file. Sub-modules and their contracts:
//   ui/auth.ts      -> mountAuth, mountAccountForm
//   ui/hud.ts       -> mountHud shell, status bar, hotbar    (hud builder; composes the others)
//   ui/inventory.ts -> createInventoryPanel
//   ui/icons.ts     -> setIconSource, iconFor
//   ui/chat.ts      -> createChat
//   ui/dialogs.ts   -> createShop, createGoals, createNotices, createAccountPrompt
//   ui/styles/*.css -> one file per module; ui/styles/theme.css holds CSS variables
import type { BondView } from "../../shared/hearts";
import type { ClientMsg, ServerMsg, ShopOffer, VillageGoal } from "../../shared/protocol";
import type { SlashContext } from "./slash-commands";
import type { Inventory, ItemId, ZoneId } from "../../shared/types";
import type { ChatChannel, ChatTab, SocialStats } from "../../shared/social";
import type { EmoteCode } from "../../shared/emotes";
import type { PlayerHit } from "./player-card-logic";
import type { MuteSet } from "./mute-logic";
import type { SlotDrag } from "./slot-drag";
export type { PlayerHit } from "./player-card-logic";

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  /** Guests (Better Auth anonymous) may only play at home. */
  isGuest: boolean;
}

// ---------- auth (ui/auth.ts) ----------
/**
 * Start screen. If a session exists, resolves immediately. Otherwise shows:
 *  - "Play as guest": name field + Turnstile (invisible/managed) -> POST /api/auth/sign-in/anonymous with the token,
 *    then sets the display name.
 *  - "Sign in" / "Create account": email, password (+ name on sign-up) + Turnstile widget.
 * Turnstile site key comes from GET /api/config -> { turnstileSiteKey: string | null } (null = disabled in local dev).
 * The token is sent in the "x-captcha-response" header (Better Auth captcha plugin).
 * Stable ids: #auth-guest-name, #auth-guest-submit, #auth-tab-guest, #auth-tab-signin, #auth-tab-signup,
 * #auth-name, #auth-email, #auth-password, #auth-submit, #auth-error.
 */
export { mountAuth, mountAccountForm } from "./auth";
/** mountAccountForm(container, { reason }): the same sign-up/sign-in form inside a dialog to upgrade a guest; resolves with the new user or null if cancelled. */

// ---------- HUD (ui/hud.ts) ----------
export interface GameApi {
  send(msg: ClientMsg): void;
  /** Select hotbar slot (0..7). */
  selectSlot(slot: number): void;
  /** Enter build mode with the furniture in inventory slot, or null to leave it. Home only. */
  setBuildItem(slot: number | null): void;
  /** Chat box focused -> game must ignore WASD. */
  setTyping(typing: boolean): void;
  signOut(): Promise<void>;
  zone(): ZoneId | null;
  isGuest(): boolean;
  /** Opens the character creator (HUD "Wardrobe" button, #hud-btn-wardrobe). Optional: no button without it. */
  openWardrobe?(): void;
  /** Opens the controls card (HUD "Controls" button, #hud-btn-controls). Optional: no button without it. */
  openControls?(): void;
  /** Player drawn under a viewport point (right-click / long-press card), yourself included; else null. */
  playerAt?(clientX: number, clientY: number): PlayerHit | null;
  /** A player in view by name (right-click on a chat name), else null. */
  playerByName?(name: string): PlayerHit | null;
  /** Tiles from you to that entity, or null once it is out of view (the card closes). */
  playerDistance?(entityId: string): number | null;
  /** Small portrait of a player entity (their composited look), or null. */
  playerPortrait?(entityId: string): HTMLCanvasElement | null;
  /** Typed chat line from the given tab (handles /w, /r, /world, /emote...). Without it the HUD sends zone chat. */
  chat?(text: string, tab: ChatTab): void;
  /** Emote picker choice. */
  emote?(code: EmoteCode): void;
  /** Where the player is, for the chat "/" command suggestions. */
  slashContext?(): SlashContext;
}

/** Where a chat line belongs (tabs) and, for whispers, which way it went. */
export interface ChatLineOpts {
  channel?: ChatChannel;
  pm?: "in" | "out";
}

export interface Hud {
  setZone(zone: ZoneId, title: string): void;
  setInventory(inv: Inventory): void;
  setSelectedSlot(slot: number): void;
  setHp(hp: number, maxHp: number): void;
  addChat(name: string, text: string, kind?: "player" | "npc" | "system", opts?: ChatLineOpts): void;
  /** Prefills "/w name " in the chat input and focuses it. */
  whisper(name: string): void;
  /** Global stats panel (#hud-stats, top-right). Shown only in shared zones; null hides it. */
  setStats(stats: SocialStats | null): void;
  notice(text: string, kind: "info" | "error" | "loot"): void;
  openShop(npc: string, name: string, offers: ShopOffer[], buys: ItemId[]): void;
  closeShop(): void;
  setGoals(goals: VillageGoal[]): void;
  setPing(ms: number): void;
  setBuildMode(on: boolean): void;
  setConnection(state: "connecting" | "online" | "offline"): void;
  /** Guest tried to leave home: "Create an account to explore". Resolves true once upgraded (game reconnects). */
  showAccountPrompt(reason: string): Promise<boolean>;
  /** Called by the game once art is loaded, so the HUD can show item icons. */
  setIconSource(src: (item: ItemId) => string): void;
  /** Who you muted: the game hides their zone chat, bubbles, world chat and emotes. */
  readonly mutes?: MuteSet;
  /** Friendship (ui/bonds.ts): every villager met, one villager's change, and their lines. */
  setBonds?(list: BondView[]): void;
  bond?(view: BondView, delta: number, talk: boolean, entityId?: string, gifts?: ItemId[]): void;
  npcSaid?(entityId: string, text: string): void;
}

/**
 * Overlay HUD (pointer-events only on panels): top-left zone title, coins (#hud-coins), hp, ping, connection dot,
 * zone name (#hud-zone); bottom-center hotbar of 8 (#hotbar); inventory (#inventory-panel, I key);
 * chat bottom-left (#chat-input, #chat-log); shop (#shop-dialog); goals (#goals-panel, G key); notices;
 * build-mode banner; account prompt (#account-prompt); sign-out button.
 */
export { mountHud } from "./hud";

// ---------- component contracts used by ui/hud.ts ----------
export interface InventoryPanel {
  setInventory(inv: Inventory): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}
/** ui/inventory.ts. onItem: clicked slot (furniture at home -> build mode; others -> select into hotbar). */
export type CreateInventoryPanel = (
  root: HTMLElement,
  opts: { onItem(slot: number): void; /** Drag and drop between slots (ui/slot-drag.ts). */ drag?: SlotDrag },
) => InventoryPanel;

export interface Chat {
  add(name: string, text: string, kind: "player" | "npc" | "system", opts?: ChatLineOpts): void;
  focus(): void;
  /** Puts text in the input and focuses it (Whisper button). */
  prefill?(text: string): void;
  whisper?(name: string): void;
  setGuest?(guest: boolean): void;
}
/**
 * ui/chat.ts. Enter focuses / sends; Esc blurs. Text is inserted with textContent only.
 * Tabs All/World/Zone/PM (#chat-tab-<tab>) with unread dots; names are clickable (whisper);
 * #chat-emote opens the emote picker (#chat-emotes).
 */
export type CreateChat = (
  root: HTMLElement,
  opts: {
    send(text: string, tab: ChatTab): void;
    setTyping(typing: boolean): void;
    /** Local command hook: return true when the line was handled and must not be sent. */
    command?(text: string): boolean;
    emote?(code: EmoteCode): void;
    guest?(): boolean;
    /** Where the player is, for the "/" command suggestions. Without it every non-dev command is offered. */
    slashContext?(): SlashContext;
  },
) => Chat;

export interface ShopDialog {
  open(npc: string, name: string, offers: ShopOffer[], buys: ItemId[], inv: Inventory): void;
  setInventory(inv: Inventory): void;
  close(): void;
}
export interface GoalsPanel {
  set(goals: VillageGoal[]): void;
  setInventory(inv: Inventory): void;
  toggle(): void;
}
export interface Notices {
  notice(text: string, kind: "info" | "error" | "loot"): void;
}
export interface AccountPrompt {
  show(reason: string): Promise<boolean>;
}
/** ui/dialogs.ts */
export type CreateShop = (root: HTMLElement, opts: { send(msg: ClientMsg): void }) => ShopDialog;
export type CreateGoals = (root: HTMLElement, opts: { send(msg: ClientMsg): void }) => GoalsPanel;
export type CreateNotices = (root: HTMLElement) => Notices;
export type CreateAccountPrompt = (root: HTMLElement) => AccountPrompt;

/** ui/icons.ts: icon source shared by hotbar, inventory, shop and goals. Falls back to a lettered tile. */
export { setIconSource, iconFor } from "./icons";

export type { ServerMsg };
