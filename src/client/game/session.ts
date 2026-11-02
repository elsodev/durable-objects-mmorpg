// Session orchestrator: wires app, art, store, connection, prediction, input, camera, per-zone
// renderers and the HUD, runs the frame loop and zone switching. See ../contracts.ts.
import { copyTitle } from "../../shared/zoneCopies";
import { hasFlashlight } from "../../shared/flashlight";
import { loadArt } from "../art";
import { createLookCompositor } from "../art/compositor";
import { lookResolver } from "../render/look-characters";
import { openCreator, type CreatorHandle } from "../ui/creator";
import { DEFAULT_LOOK, validateLook } from "../../shared/look";
import { heldItemAt } from "../../shared/held";
import type { Camera, GameSession, Input, Predictor } from "../contracts";
import { createConnection } from "../net/connection";
import { createCamera } from "../render/camera";
import { createStore } from "../state/store";
import { mountHud, showRemoved, type GameApi, type Hud, type SessionUser } from "../ui";
import { readShout } from "../../shared/admin";
import { createHomeUi } from "../ui/homeui";
import { createStoragePanel } from "../ui/storage";
import { STORE_WALK_AWAY, storeTarget, wardrobeTarget } from "./storage-target";
import { createVisitsUi } from "../ui/visits";
import { createMailboxUi } from "../ui/mailbox";
import { createNoticeBoardUi } from "../ui/notice-board";
import { createDoorFade } from "../ui/door-fade";
import { createAfkScreen } from "../ui/afk";
import { exitAt } from "../../shared/engine/geometry";
import { MAILBOX_TAKE } from "../../shared/mail";
import { visitsApi } from "../ui/visits-api";
import type { InviteNotice, VisitInfo, VisitorEntry } from "../../shared/visits";
import { clockMinutes, dayPhase, farmNow, formatClock, type HomeClock } from "../../shared/engine/homeclock";
import { getItem, isBedItem, isWardrobeItem, WARDROBE_ID } from "../../shared/items";
import type { HomeServerMsg } from "../../shared/home";
import { footstep } from "../audio/player";
import { getMap, hasMap } from "../../shared/maps";
import type { LoadingScreen } from "../ui/loading";
import { createTutorial } from "../ui/tutorial";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import { Ground, TICK_MS, type EntityState, type HomeMapId, type MapData, type Vec2, type ZoneId } from "../../shared/types";
import {
  chatKind,
  createReqIds,
  exitNear,
  floorTile,
  inUseRange,
  isFurnitureSlot,
  nearestAnimal,
  nearestNpc,
  sfxForUse,
  propTarget,
  usableHere,
  clickUsesTool,
  swingsAtAnimals,
  usableItem,
  useTarget,
  withinInteract,
} from "./actions";
import { captureView, createGameApp } from "./app";
import { appearanceOf, applyAppearance } from "./appearance";
import { playSfx, setAudioHooks, setAudioPaused, setMusicZone, type AudioHooks } from "./audio";
import { createAfkWatch } from "./afk";
import { afkTimesFromQuery } from "./afk-logic";
import { installDebug } from "./debug";
import { createCombatSfx } from "./combat-sfx";
import { createCombatFx } from "./combat-fx";
import { createLevelFx } from "./level-fx";
import { FORAGE_REACH, GROUND_TARGET_PREFIX } from "../../shared/spawns";
import { createInput } from "./input";
import { every, startLoop } from "./loop";
import { chestFor } from "../render/chests";
import { isDrink } from "../render/food-in-hand";
import { CHEST_REACH, CHEST_TARGET_PREFIX } from "../../shared/chests";
import { gainText } from "../ui/bonds-logic";
import { npcPortrait } from "./npc-portrait";
import { createPredictor } from "./prediction";
import { createFarmFx } from "./farm-fx";
import { isWaterSource } from "../../shared/engine";
import { EAT_COOLDOWN_MS } from "../../shared/engine/eating";
import { createWorld, type World } from "./world";
import {
  clearedTreeTiles,
  effectiveAct,
  pendingImpactMs,
  predictUse,
  startSwing,
  swingLocked,
  takeImpact,
  targetAtTile,
  type LocalSwing,
} from "./tool-swing";
import { ImpactQueue, impactDueMs } from "./impact";
import { reboundRecoil, reboundTool, toolContactPoint } from "../render/hit-fx-logic";
import { INTERP_DELAY_MS } from "../state/interp";

type StampedMsg = Extract<ServerMsg, { t: "farm" | "rock" | "tree" }>;

/** Held results that must stay in order: the same rock or tree, or any farm tiles. */
function sameTarget(a: StampedMsg, b: StampedMsg): boolean {
  if (a.t !== b.t) return false;
  return a.t === "farm" || ("id" in a && "id" in b && a.id === b.id);
}
import { isSwingTool, toolKeyOf, type ToolEffect, type ToolOutcome, type ToolTarget } from "../../shared/engine/toolRules";
import { createSocialConnection } from "../net/social";
import { emitSocial, onSocial as onSocialEvent } from "../social-events";
import { parseChatInput, type ChatTab, type SocialClientMsg, type SocialServerMsg } from "../../shared/social";
import { ANIMAL_PREFIX, ANIMAL_REACH } from "../../shared/animals";
import { BARN_ID, BARN_SIZE, BARN_SPOT } from "../../shared/ranch";
import { ANIMAL_HEAR_RANGE, animalLoveSfx } from "../audio/audio-logic";
import { isEmote, type EmoteCode } from "../../shared/emotes";
import { emoteLine } from "../ui/chat";
import { playerHit, tileDistance } from "./player-hit";
import { CLIMB_ACTS } from "../../shared/climb";
import { createEnergy } from "./energy";
import { createEditMode } from "./edit-mode";
import { createEditUi } from "../ui/edit-ui";
import { createTradeUi } from "../ui/trade";
import type { PlayerHit } from "../ui/player-card-logic";

const HOTBAR_SLOTS = 8;
/** Stats panel refresh while in a shared zone. */
const STATS_MS = 10_000;
/**
 * Going AFK keeps drawing this long, so your character visibly lies down to sleep behind the AFK
 * screen, then the render loop stops until you come back.
 */
const AFK_NAP_DRAW_MS = 1500;
const GUEST_CHAT = "Create an account to chat with everyone.";

export interface SessionOptions {
  /** Audio module hooks; same as calling setAudioHooks() before starting. */
  audio?: Partial<AudioHooks>;
  /** First zone to join. Default: "village" for accounts, "home" for guests. */
  startZone?: ZoneId;
  /** Called on the first welcome from the server: the renderer is up and the game is connected. */
  onReady?: () => void;
  /** Loading screen to drive: steps as they finish, zone changes, and when the world is on screen. */
  loading?: Pick<LoadingScreen, "done" | "zone" | "ready"> & Partial<Pick<LoadingScreen, "zoneStep" | "outdated">>;
}

type ActionReq = "use" | "place" | "moveObject" | "pickup";

export async function startSession(
  mount: { game: HTMLElement; ui: HTMLElement },
  user: SessionUser,
  opts: SessionOptions = {},
): Promise<GameSession> {
  if (opts.audio) setAudioHooks(opts.audio);
  const appearance = appearanceOf(user);
  let isGuest = user.isGuest;

  const loading = opts.loading;
  const game = await createGameApp(mount.game);
  loading?.done("renderer");
  // Character layers load alongside the art pack, so composited players are ready on first draw.
  const looks = createLookCompositor();
  const [art] = await Promise.all([loadArt(game.app), looks.load()]);
  loading?.done("art");
  const characterFor = lookResolver(looks);
  let creator: CreatorHandle | null = null;
  let lookPrompted = false;
  const store = createStore();
  const nextReq = createReqIds();
  const pendingReqs = new Map<string, ActionReq>();

  let world: World | null = null;
  let selectedSlot = 0;
  /** An animal you clicked from afar: pet it once you're in reach. */
  let pendingAnimal: string | null = null;
  let pendingZone: ZoneId | null = null;
  let promptOpen = false;
  let destroyed = false;
  /** The social hello said this account is an admin (the server re-checks every admin command). */
  let isAdmin = false;
  /** Set once the session object exists; an admin's kick tears the whole session down through it. */
  let destroySelf: () => void = () => {};
  const lastHp = new Map<string, number>();
  const combatSfx = createCombatSfx(playSfx);

  const map = (): MapData | null => world?.map ?? store.map;
  const serverNow = () => Date.now() + conn.clockOffset();
  const zoneName = (z: ZoneId): string | null => {
    try {
      return getMap(z).name;
    } catch {
      return null;
    }
  };
  /** Home clock + vitals from the last homeState (null outside home). */
  let home: Extract<HomeServerMsg, { t: "homeState" }> | null = null;
  let typing = false;
  let sleepAsked = false;
  /** Set while you're a visitor in someone else's home (welcome.visit). */
  let visiting: VisitInfo | null = null;
  /** The visit being connected to, and where to go back to if it's refused. */
  let visitTarget: { ownerId: string; from: ZoneId } | null = null;
  /** Home map of the last welcome (null outside home): a new welcome on another one is a door. */
  let homeMapNow: HomeMapId | null = null;
  /** Mailbox flag state, kept across world rebuilds. */
  let mailFlag = false;
  /** Farm engine time: at home crops follow the home day, not real time (see homeclock.farmNow). */
  const farmTime = () => (store.zone === "home" && home ? farmNow(home.clock.day) : serverNow());
  const unbrokenRocks = (): Vec2[] =>
    (map()?.rocks ?? []).filter((r) => !store.brokenRocks.has(r.id)).map((r) => ({ x: r.x, y: r.y }));

  /** Open tree tiles, rebuilt only when a tree message changes them. */
  let clearedTrees: Vec2[] = [];
  const refreshClearedTrees = () => {
    clearedTrees = clearedTreeTiles(map(), store.trees);
  };
  const predictor: Predictor = createPredictor(map, () => ({
    objects: [...store.objects.values()],
    // Cave chests block like rocks do.
    rocks: [...unbrokenRocks(), ...(world?.chests.list() ?? [])],
    cleared: clearedTrees,
  }));
  /** Your own tool swing, played locally the moment you press use. */
  let swing: LocalSwing | null = null;
  /** The last act you played locally; keeps the server's older acts from replaying after it. */
  let localAct: LocalSwing["act"] | null = null;
  /** What your pending swing does when it lands (prediction, effects, sound). */
  let onImpact: (() => void) | null = null;
  /** Server results of tool swings held until the swing's impact frame (see impact.ts). */
  const impacts = new ImpactQueue<StampedMsg>();
  /** Rocks and trees your own swing already wobbled at impact: the server's echo stays quiet. */
  const shownHits = new Set<string>();
  const camera: Camera = createCamera(game.layers, { w: game.width(), h: game.height() });
  const combatFx = createCombatFx({ world: () => world, youId: () => store.youId, camera, latest: (id) => store.latest(id) });
  const levelFx = createLevelFx({
    world: () => world,
    hud: { setLevel: (view, gain) => hud.setLevel?.(view, gain) },
    youId: () => store.youId,
    you: () => you(),
    drawnAt: (id) => store.sample(performance.now()).find((e) => e.id === id),
    playSfx,
    reducedMotion: () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    later: (fn, ms) => (ms > 0 ? void setTimeout(fn, ms) : fn()),
  });
  /** Zones: last stamina the server sent (a gentle warning when it runs low). */
  let zoneStamina: number | null = null;
  /** Worn out or not: prediction speed, the dash notice and the farm lock. */
  const energy = createEnergy({ predictor, notice: (text, kind) => notice(text, kind) });
  const input: Input = createInput(game.app.canvas, (sx, sy) => camera.screenToTile(sx, sy));
  /** Set while AFK: your character lies asleep on screen (local only; the server no longer has you). */
  let afkAct: EntityState["act"] | null = null;

  /** Your entity: authoritative fields + predicted position, with the creator's look applied locally. */
  function you(): EntityState | null {
    const id = store.youId;
    if (!id) return null;
    const base = store.latest(id);
    if (!base) return null;
    // Seated: the server places you on the chair; nothing to predict.
    if (base.act?.k === "sit" && !afkAct) return applyAppearance({ ...base, moving: false }, appearance);
    // Your own hand shows the selected tool at once; the server's copy is for everyone else.
    const held = visiting ? undefined : heldItemAt(store.inventory, selectedSlot);
    const p = predictor.state();
    const act = effectiveAct(base.act, localAct);
    const now = performance.now();
    // While your swing plays you face what you swing at.
    const facing = swing && now < swing.endMs && act === swing.act ? swing.facing : p.facing;
    const me: EntityState = { ...base, act, x: p.x, y: p.y, facing, moving: p.moving };
    if (held) me.held = held;
    else delete me.held;
    // Your own run shows from your keys at once; the server's copy is for everyone else.
    if (p.pace) me.pace = p.pace;
    else delete me.pace;
    if (afkAct) {
      me.act = afkAct;
      me.moving = false;
      delete me.pace;
      delete me.held;
    }
    return applyAppearance(me, appearance);
  }

  function visibleEntities(): EntityState[] {
    const list = store.sample(performance.now());
    const me = you();
    return me ? [...list, me] : list;
  }

  function send(msg: ClientMsg): void {
    conn.send(msg);
  }

  function sendTagged(msg: ClientMsg & { req?: string }, kind: ActionReq): string {
    const req = nextReq();
    pendingReqs.set(req, kind);
    if (pendingReqs.size > 64) pendingReqs.delete(pendingReqs.keys().next().value!);
    send({ ...msg, req } as ClientMsg);
    return req;
  }

  /**
   * Shows a notice once: loot ("+1 Turnip …") pops up over your head, everything else is a
   * toast. (Both at once repeated the same words twice.)
   */
  function notice(text: string, kind: "info" | "error" | "loot" = "info"): void {
    const me = you();
    if (kind === "loot" && me && world) world.effects.floatText({ x: me.x, y: me.y - 1.5 }, text, kind);
    else hud.notice(text, kind);
  }

  function selectSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOTS) return;
    // Others see what you hold: tell the server, but only when the selection changes.
    if (slot !== selectedSlot && !visiting) send({ t: "hold", slot });
    selectedSlot = slot;
    hud.setSelectedSlot(slot);
    refreshEdible();
    // Keep the input module's own notion of the slot in step (it numbers hotbar keys relative to it).
    input.setSlot?.(slot);
  }

  function syncBuildBanner(): void {
    const on = !!world?.build.active();
    hud.setBuildMode(on);
    input.setWheelRotates?.(on);
  }

  function setBuildItem(slot: number | null): void {
    if (!world) return;
    // Edit mode places pieces itself: a furniture slot picked in the bag is held there.
    if (editMode.active()) return editMode.hold(slot);
    if (slot === null) {
      world.build.exit();
    } else if (store.zone !== "home") {
      notice("You can only arrange furniture at home.", "error");
    } else if (visiting) {
      notice("Only the owner can arrange furniture.", "error");
    } else if (!isFurnitureSlot(store.inventory, slot)) {
      notice("That isn't furniture.", "error");
    } else {
      world.build.enter(slot);
    }
    syncBuildBanner();
  }

  // ------------------------------------------------------------ HUD
  const gameApi: GameApi = {
    send,
    selectSlot,
    setBuildItem,
    setTyping: (t) => {
      typing = t;
      input.setTyping(t);
    },
    async signOut() {
      try {
        await fetch("/api/auth/sign-out", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } finally {
        location.reload();
      }
    },
    zone: () => store.zone,
    isGuest: () => isGuest,
    openWardrobe: () => openWardrobe(false),
    openControls: () => tutorial.open(),
    travel(to) {
      if (destroyed || pendingZone !== null) return;
      if (isGuest && to !== "home") return void askForAccount("Create an account to explore the valley.", to);
      // A visitor's own save isn't in this home: just leave for the place.
      if (visiting) return joinZone(to);
      // The room we're in saves us with the destination, then answers {t:"zone"} (handled below
      // like any exit), so the next zone always loads what this one saved.
      send({ t: "travel", to });
    },
    playerAt(clientX, clientY) {
      if (!world || editMode.active()) return null;
      const r = game.app.canvas.getBoundingClientRect();
      return playerUnder(camera.screenToTile(clientX - r.left, clientY - r.top));
    },
    playerByName(name) {
      const key = name.toLowerCase();
      const ent = visibleEntities().find((e) => e.kind === "player" && e.name.toLowerCase() === key);
      return ent ? playerHit(ent.id, ent, store.youId) : null;
    },
    playerDistance(entityId) {
      const me = you();
      const them = visibleEntities().find((e) => e.id === entityId);
      return me && them ? tileDistance(me, them) : null;
    },
    playerPortrait: (entityId) => portraitOf(entityId),
    npcPortrait: (entityId) => npcPortrait(art, store.latest(entityId)?.sprite),
    chat: (text, tab) => onChatInput(text, tab),
    emote: (code) => sendEmote(code),
    slashContext: () => ({
      atHome: store.zone === "home",
      homeOwner: store.zone === "home" && !visiting,
      guest: isGuest,
      devTools,
      admin: isAdmin,
    }),
    isAdmin: () => isAdmin,
    adminCommand(cmd) {
      const msg: SocialClientMsg =
        cmd.cmd === "shout"
          ? { t: "shout", text: cmd.text }
          : cmd.cmd === "kick"
            ? { t: "kick", name: cmd.name, ...(cmd.reason ? { reason: cmd.reason } : {}) }
            : cmd.cmd === "jail"
              ? { t: "jail", name: cmd.name, minutes: cmd.minutes }
              : cmd.cmd === "unjail"
                ? { t: "unjail", name: cmd.name }
                : { t: "unban", name: cmd.name };
      if (!social.send(msg)) system("Admin tools are reconnecting. Try again in a moment.");
    },
    tradeOpen: () => tradeUi.isOpen(),
    tradeAdd: (slot, qty) => send({ t: "tradeAdd", slot, qty }),
    requestTrade: (target) => requestTrade(target),
    canTrade: () => !isGuest && store.zone !== null && store.zone !== "home",
    captureView: () => captureView(game.app),
    feedbackContext() {
      const me = you();
      return { zone: store.zone, x: me ? Math.round(me.x) : null, y: me ? Math.round(me.y) : null, renderer: game.renderer };
    },
  };

  /** Ask a player here to trade (player card or /trade name). The server checks it all again. */
  function requestTrade(target: PlayerHit | string): void {
    if (isGuest) return void askForAccount("Create an account to trade with other players.");
    if (store.zone === "home") return notice("Meet in the village to trade.", "error");
    const hit = typeof target === "string" ? gameApi.playerByName?.(target) ?? null : target;
    if (!hit || !hit.entityId) return notice(`${typeof target === "string" ? target : "They"} isn't nearby. Stand close to them to trade.`, "error");
    if (hit.self) return notice("You can't trade with yourself.", "error");
    send({ t: "tradeRequest", target: hit.entityId });
  }
  const tutorial = createTutorial(mount.ui, { userId: user.id, setTyping: (t) => gameApi.setTyping(t) });
  const hud: Hud = mountHud(mount.ui, gameApi);
  hud.setIconSource((item) => art.iconUrl(item));
  hud.setSelectedSlot(selectedSlot);
  const farmFx = createFarmFx({
    world: () => world,
    art,
    map,
    farm: () => store.farm,
    objects: () => [...store.objects.values()],
    rockAt: (x, y) => unbrokenRocks().some((r) => r.x === x && r.y === y),
    you,
    farmTime,
    playSfx,
    closeBinUi: () => homeUi.closeBin(),
  });
  const homeUi = createHomeUi(mount.ui, {
    unship: () => sendTagged({ t: "unship" }, "use"),
    onBinClose: () => farmFx.binClosed(),
    eat: () => eatSelected(),
    moveBed: () => {
      const bed = [...store.objects.values()].find((o) => o.item === "bed_simple");
      if (bed && world) {
        world.build.pick(bed.id);
        syncBuildBanner();
      }
    },
    setTyping: (t) => gameApi.setTyping(t),
  });
  homeUi.setAtHome(false);
  // The fridge (any storage furniture): its shelves beside your bag while the door is open.
  // House edit mode (game/edit-mode.ts): the owner rearranges furniture without walking about.
  const editMode = createEditMode({
    canvas: game.app.canvas,
    art,
    layers: game.layers,
    ui: createEditUi(mount.ui, {
      toggle: () => editMode.toggle(),
      rotate: () => editMode.action("rotate"),
      pickUp: () => editMode.pickUp(),
      deselect: () => editMode.action("cancel"),
      setMulti: (on) => editMode.setMulti(on),
      hold: (slot) => editMode.hold(slot),
    }),
    screenToTile: (sx, sy) => camera.screenToTile(sx, sy),
    tileToScreen: (x, y) => camera.tileToScreen(x, y),
    viewport: () => ({ w: game.width(), h: game.height() }),
    map,
    objects: () => [...store.objects.values()],
    farm: () => [...store.farm.values()],
    occupied: () => visibleEntities().map((e) => floorTile(e)),
    inventory: () => store.inventory,
    you,
    available: () => store.zone === "home" && homeMapNow === "home_in" && !visiting,
    send,
    notice: (text, kind = "info") => notice(text, kind),
    sfx: playSfx,
    dim: (ids) => world?.farm.setDimmed?.(ids),
    changed(on) {
      // Editing: stand still, and the wheel turns pieces instead of stepping the hotbar.
      const stop = predictor.setDir(0, 0, performance.now());
      if (stop) send(stop);
      world?.build.exit();
      syncBuildBanner();
      input.setWheelRotates?.(on);
      // The fridge and bin panels sit over the room: editing starts with a clear view.
      if (on) {
        storageUi.close();
        homeUi.closeBin();
      }
    },
  });
  const storageUi = createStoragePanel(mount.ui, {
    put: (id, slot, qty) => send({ t: "storePut", id, slot, qty }),
    take: (id, index, qty) => send({ t: "storeTake", id, index, qty }),
    onClose: (id) => send({ t: "storeClose", id }),
  });
  const visitsUi = createVisitsUi(mount.ui, {
    accept: (n) => void acceptInvite(n),
    decline: (n) =>
      void visitsApi.respond(n.fromId, false).then((r) => {
        if (!r.ok) notice(r.error, "error");
      }),
    kick: (v: VisitorEntry) =>
      void visitsApi.kick(v.userId).then((r) => notice(r.ok ? `Sent ${v.name} home.` : r.error, r.ok ? "info" : "error")),
    leave: () => {
      if (visiting) joinZone(visiting.returnTo);
    },
    now: () => serverNow(),
  });
  const mailboxUi = createMailboxUi(mount.ui, {
    acceptInvite: (n) => void acceptInvite(n),
    declineInvite: (n) =>
      void visitsApi.respond(n.fromId, false).then((r) => {
        if (!r.ok) notice(r.error, "error");
        else visitsUi.removeInvite(n.fromId);
      }),
    takeParcels: () => send({ t: "interact", target: MAILBOX_TAKE }),
    notice: (text, kind) => notice(text, kind),
    onFlag: (up) => {
      mailFlag = up;
      world?.mailboxFlag?.set(up);
    },
    now: () => serverNow(),
    isGuest: () => isGuest,
  });
  const noticeBoardUi = createNoticeBoardUi(mount.ui, {
    post: (text) => send({ t: "noticePost", text }),
    vote: (id, press) => send({ t: "noticeVote", id, press }),
    remove: (id) => send({ t: "noticeDelete", id }),
    coins: () => store.inventory.coins,
    now: () => serverNow(),
    isGuest: () => isGuest,
  });
  const tradeUi = createTradeUi(mount.ui, {
    answer: (from, accept) => send({ t: "tradeAnswer", from, accept }),
    add: (slot, qty) => send({ t: "tradeAdd", slot, qty }),
    remove: (index, qty) => send({ t: "tradeRemove", index, ...(qty !== undefined ? { qty } : {}) }),
    coins: (coins) => send({ t: "tradeCoins", coins }),
    ready: (ready) => send({ t: "tradeReady", ready }),
    confirm: () => send({ t: "tradeConfirm" }),
    cancel: () => send({ t: "tradeCancel" }),
    setTyping: (t) => gameApi.setTyping(t),
    now: () => serverNow(),
  });
  const doorFade = createDoorFade(mount.ui);
  const socialUnsubs = [
    onSocialEvent("notices", (p) => noticeBoardUi.social(p)),
    onSocialEvent("noticeVotes", (p) => noticeBoardUi.social(p)),
    onSocialEvent("invite", (p) => visitsUi.addInvites([p])),
    onSocialEvent("inviteRevoked", (p) => {
      if (typeof p.fromId === "string") visitsUi.removeInvite(p.fromId);
    }),
  ];

  async function acceptInvite(n: InviteNotice): Promise<void> {
    if (isGuest) return void askForAccount("Create an account to visit friends' homes.");
    const r = await visitsApi.respond(n.fromId, true);
    if (destroyed) return;
    if (!r.ok) return notice(r.error, "error");
    notice(`Heading over to ${n.fromName}'s home…`, "info");
    joinVisit(n.fromId);
  }

  /** The player whose sprite covers a tile point (yourself included), else null. */
  function playerUnder(tile: Vec2) {
    if (!world) return null;
    const id = world.entities.entityAt(tile);
    return playerHit(id, id ? store.latest(id) : undefined, store.youId);
  }

  /** Head-and-shoulders of a player's composited look, facing you, for the player card. */
  function portraitOf(entityId: string): HTMLCanvasElement | null {
    const look = validateLook(store.latest(entityId)?.look);
    const m = looks.manifest();
    const sheet = look ? looks.sheet(look) : null;
    if (!look || !m || !sheet) return null;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const row = m.walk.down;
    const fw = m.frameW;
    const fh = m.frameH;
    // LPC frames are 64x64 with the head in the upper middle: keep the top 40 rows, centred.
    const crop = { x: fw * 0.2, y: fh * 0.08, w: fw * 0.6, h: fh * 0.6 };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, (row.col ?? 0) * fw + crop.x, row.row * fh + crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
    return c;
  }

  /** Muted players' chat, bubbles and emotes are hidden (ui/mutes.ts; the server drops the rest). */
  const mutedEntity = (entityId: string): boolean => !!hud.mutes?.hidesEntity(entityId);
  const mutedName = (name: string): boolean => !!hud.mutes?.hasName(name);

  // ------------------------------------------------------------ social (world chat, whispers, stats)
  let lastWhisper: string | null = null;
  let lastWorldAt = 0;
  const social = createSocialConnection({ onMessage: onSocial, onRemoved: () => removedFromGame() });

  /** An admin removed this account: stop everything and show the removed screen. */
  function removedFromGame(): void {
    if (destroyed) return;
    showRemoved(document.body);
    destroySelf();
  }

  function system(text: string, channel: "system" | "world" | "pm" = "system"): void {
    hud.addChat("", text, "system", { channel });
  }

  function onChatInput(text: string, tab: ChatTab): void {
    const intent = parseChatInput(text, tab, lastWhisper);
    if (!intent) return;
    switch (intent.kind) {
      case "zone":
        return send({ t: "chat", text: intent.text });
      case "emote":
        return sendEmote(intent.code);
      case "pose":
        return send({ t: "pose", pose: intent.pose });
      case "error":
        return system(intent.message);
      case "world":
        if (isGuest) return system(GUEST_CHAT, "world");
        if (!social.send({ t: "world", text: intent.text })) system("World chat is reconnecting. Try again in a moment.");
        return;
      case "pm":
        if (isGuest) return system(GUEST_CHAT, "pm");
        if (!social.send({ t: "pm", to: intent.to, text: intent.text })) system("Whispers are reconnecting. Try again in a moment.");
        return;
    }
  }

  function sendEmote(code: EmoteCode): void {
    send({ t: "emote", code });
  }

  /** Bubble over a world-chat speaker who happens to be in this zone. */
  function sayByName(name: string, text: string): void {
    const key = name.toLowerCase();
    const ent = visibleEntities().find((e) => e.kind === "player" && e.name.toLowerCase() === key);
    if (ent) world?.overlays.say(ent.id, text);
  }

  function onSocial(msg: SocialServerMsg): void {
    switch (msg.t) {
      case "hello":
        // Reconnects resend history: only add lines we haven't shown.
        for (const l of msg.history) {
          if (l.at <= lastWorldAt) continue;
          lastWorldAt = l.at;
          if (mutedName(l.name)) continue;
          hud.addChat(l.name, l.text, "player", { channel: "world" });
        }
        if (store.zone) social.send({ t: "here", zone: store.zone });
        requestStats();
        isAdmin = msg.admin === true;
        hud.setAdmin?.(isAdmin);
        if (msg.shout) {
          const s = readShout(msg.shout);
          if (s) hud.shout?.(s);
        }
        break;
      case "shout": {
        const s = readShout(msg);
        if (s) hud.shout?.(s);
        break;
      }
      case "removed":
        removedFromGame();
        break;
      case "world":
        lastWorldAt = Math.max(lastWorldAt, msg.at);
        if (mutedName(msg.name)) break;
        hud.addChat(msg.name, msg.text, "player", { channel: "world" });
        sayByName(msg.name, msg.text);
        break;
      case "pm":
        // The server already drops these; this covers a mute made a moment ago on another device.
        if (msg.dir === "in" && mutedName(msg.name)) break;
        if (msg.dir === "in") {
          lastWhisper = msg.name;
          playSfx("chat");
        }
        hud.addChat(msg.name, msg.text, "player", { channel: "pm", pm: msg.dir });
        break;
      case "stats":
        hud.setStats(msg);
        break;
      case "notice":
        system(msg.text);
        if (msg.kind === "error") playSfx("error");
        break;
      case "social":
        onSocialPayload(msg.payload);
        break;
      case "pong":
        break;
    }
  }

  /** "+25 ♥" floating over the villager whose friendship moved. */
  function onBondGain(from: string | undefined, delta: number): void {
    const text = gainText(delta);
    const npc = from ? store.latest(from) : null;
    if (!text || !npc || !world) return;
    world.effects.floatText({ x: npc.x, y: npc.y - 0.4 }, text, delta > 0 ? "love" : "info");
    if (delta > 0) world.effects.burst({ x: npc.x, y: npc.y - 1.6 }, "sparkle");
  }

  /** A petted or fed animal barks, purrs or clucks (a bolting husky yips) for everyone close enough to hear. */
  function animalSound(entity: string, code: string): void {
    const a = store.latest(entity);
    const me = you();
    const key = a ? animalLoveSfx(a.sprite, code) : null;
    if (key && me && Math.hypot(a!.x - me.x, a!.y - me.y) <= ANIMAL_HEAR_RANGE) playSfx(key);
  }

  /** Clicking a cat, dog or hen: pet it (the server opens its card) in reach, else walk up and then pet it. */
  function animalClick(me: EntityState, at: Vec2): boolean {
    const id = world?.entities.entityAt(at);
    const st = id ? store.latest(id) : null;
    if (!st || st.kind !== "animal") return false;
    // A sword is swung, not a hand held out: in reach it swings (the server decides what it hits).
    if (!visiting && swingsAtAnimals(store.inventory, selectedSlot)) {
      pendingAnimal = null;
      if (inUseRange(me, st)) useAt(floorTile(st));
      else moveTo(st.x, st.y + 0.8);
      return true;
    }
    if (Math.hypot(st.x - me.x, st.y - me.y) <= ANIMAL_REACH) {
      pendingAnimal = null;
      interact(st.id);
    } else {
      pendingAnimal = st.id;
      moveTo(st.x, st.y + 0.8);
    }
    return true;
  }

  /** Walking up to a clicked animal: pet it once in reach (it may have wandered on meanwhile). */
  function approachAnimal(me: EntityState | null, states: readonly EntityState[]): void {
    if (!pendingAnimal || !me) return;
    const st = states.find((e) => e.id === pendingAnimal);
    if (!st) {
      pendingAnimal = null;
      return;
    }
    if (Math.hypot(st.x - me.x, st.y - me.y) <= ANIMAL_REACH) {
      pendingAnimal = null;
      interact(st.id);
    } else if (!me.moving) pendingAnimal = null;
  }

  /** Picks forage on a tile when it is in reach, else walks up to it. */
  function forageInteract(me: EntityState, tile: Vec2): boolean {
    const g = world?.groundItems.forageAt(tile);
    if (!g) return false;
    if (tileDistance(me, g) <= FORAGE_REACH) interact(`${GROUND_TARGET_PREFIX}${g.id}`);
    else moveTo(g.x, g.y + 0.6);
    return true;
  }

  /** Opens a cave chest when it is in reach, else walks up to it. */
  function chestInteract(me: EntityState, tile: Vec2): boolean {
    const c = world?.chests.at(tile);
    if (!c) return false;
    if (withinInteract(me, { x: c.x + 0.5, y: c.y + 0.5 })) interact(`${CHEST_TARGET_PREFIX}${c.id}`);
    else moveTo(c.x + 0.5, c.y + 1.5);
    return true;
  }

  /** Payloads other Durable Objects push through SocialRoom.notify go to the client bus (../social-events). */
  function onSocialPayload(payload: { t: string } & Record<string, unknown>): void {
    emitSocial(payload);
  }

  function requestStats(): void {
    if (store.zone && store.zone !== "home") social.send({ t: "stats" });
  }

  // ------------------------------------------------------------ network
  const conn = createConnection({
    onMessage: handleMessage,
    onState: (s) => {
      hud.setConnection(s);
      if (s === "online") loading?.zoneStep?.("connected");
    },
    // The socket to a shared zone was refused (guest): go back home unless they upgrade.
    onForbidden: (zone) => {
      if (visitTarget) {
        // The invite ran out or the host left: back to where we were.
        const back = visitTarget.from;
        notice("That visit isn't possible any more.", "error");
        return joinZone(back);
      }
      void askForAccount("Create an account to explore the valley.", zone, true);
    },
    // The server closed a socket that sent no input for a long while: same screen as going AFK here.
    onIdle: () => goAfk(),
    onRemoved: () => removedFromGame(),
  });

  // ------------------------------------------------------------ AFK
  // Away (no input for a while, or the tab hidden): close every socket and stop drawing, so the
  // browser stops waking Durable Objects and the zone can hibernate. "Go back online" rejoins.
  /** Where to rejoin; set while AFK. */
  let afk: { zone: ZoneId; visit: string | null } | null = null;
  let napTimer: ReturnType<typeof setTimeout> | null = null;
  const afkScreen = createAfkScreen(mount.ui, { onResume: () => backOnline() });
  const afkWatch = createAfkWatch({
    onAway: () => goAfk(),
    // Choosing a look or filling in the account form is not being away.
    blocked: () => creator !== null || promptOpen,
  });

  /** Draws for a moment (the character settles into its nap), then stops the render loop. */
  function napDraw(): void {
    if (napTimer !== null) clearTimeout(napTimer);
    game.app.ticker.start();
    napTimer = setTimeout(() => {
      napTimer = null;
      if (afk && !destroyed) game.app.ticker.stop();
    }, AFK_NAP_DRAW_MS);
  }

  function goAfk(): void {
    if (afk || destroyed) return;
    const zone = pendingZone ?? store.zone;
    if (!zone) return;
    // Mid-way to another home, the visit being joined; otherwise the one you're in, if any.
    const visit = pendingZone ? (visitTarget?.ownerId ?? null) : (visiting?.ownerId ?? null);
    afk = { zone, visit };
    hud.closeAll?.();
    storageUi.close();
    world?.build.exit();
    syncBuildBanner();
    conn.close();
    social.close();
    setAudioPaused(true);
    afkAct = { k: "lie", at: serverNow() };
    afkScreen.show();
    napDraw();
  }

  function backOnline(): void {
    if (!afk || destroyed) return;
    const to = afk;
    afk = null;
    afkAct = null;
    if (napTimer !== null) clearTimeout(napTimer);
    napTimer = null;
    afkScreen.hide();
    game.app.ticker.start();
    setAudioPaused(false);
    social.start();
    // A visit whose invite ran out meanwhile is refused, and onForbidden takes you back.
    if (to.visit) joinVisit(to.visit);
    else joinZone(to.zone);
    afkWatch.resume();
  }

  // A hidden tab draws nothing, so the nap is drawn again when the tab comes back.
  const onAfkVisibility = () => {
    if (afk && document.visibilityState === "visible") napDraw();
  };
  document.addEventListener("visibilitychange", onAfkVisibility);

  function joinZone(zone: ZoneId, spawn?: string): void {
    if (!hasMap(zone)) return pageOutdated(zone);
    loading?.zone(zoneName(zone));
    pendingZone = zone;
    visitTarget = null;
    world?.build.exit();
    hud.setConnection("connecting");
    conn.connect(zone, spawn);
  }

  /** The server named a map this page can't draw: the page is older than the server. */
  function pageOutdated(mapId: string): void {
    console.warn(`[DurableMMO] unknown map "${mapId}": this page is older than the server`);
    conn.close();
    loading?.outdated?.();
  }

  /** Connects to /ws/visit/<ownerId>; their home arrives as zone "home" with welcome.visit set. */
  function joinVisit(ownerId: string): void {
    const from: ZoneId = visiting?.returnTo ?? store.zone ?? "village";
    loading?.zone(null);
    pendingZone = "home";
    visitTarget = { ownerId, from };
    world?.build.exit();
    hud.setConnection("connecting");
    conn.connect("home", undefined, ownerId);
  }

  async function askForAccount(reason: string, target?: ZoneId, refused = false): Promise<void> {
    if (promptOpen || destroyed) return;
    promptOpen = true;
    const me = you();
    const m = map();
    // Remember where the guest was heading before the prompt (they may walk away meanwhile).
    const exit = m && me ? exitNear(m, me, target) : null;
    try {
      const upgraded = await hud.showAccountPrompt(reason);
      if (destroyed) return;
      if (!upgraded) {
        if (refused) joinZone("home");
        return;
      }
      isGuest = false;
      // The social socket still carries the guest session: reopen it as the new account.
      social.close();
      social.start();
      const to = target ?? exit?.to;
      if (to) joinZone(to, exit && exit.to === to ? exit.spawn : undefined);
    } finally {
      promptOpen = false;
    }
  }

  /**
   * Character creator; firstTime when the save has no look yet (welcome.needsLook). `piece`: the
   * placed wardrobe it was opened from, whose doors shut again when the creator closes.
   */
  function openWardrobe(firstTime: boolean, piece?: string): void {
    if (creator || destroyed) return;
    world?.build.exit();
    syncBuildBanner();
    hud.closeShop();
    const mine = store.youId ? store.latest(store.youId) : undefined;
    creator = openCreator(mount.ui, {
      initial: validateLook(mine?.look) ?? { ...DEFAULT_LOOK },
      firstTime,
      manifest: looks.manifest(),
      sheet: (look) => looks.sheet(look),
      onSave: (look) => send({ t: "setLook", look }),
      setTyping: (t) => input.setTyping(t),
    });
    void creator.done.then(() => {
      creator = null;
      if (piece) send({ t: "storeClose", id: piece });
    });
  }

  /** Ground under a point, as a lowercase name ("grass", "stone"...) for footstep sounds. */
  function groundNameAt(x: number, y: number): string {
    const m = map();
    if (!m) return "grass";
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return "grass";
    const g = m.ground[ty * m.width + tx];
    return g === undefined ? "grass" : (Ground[g] ?? "grass").toLowerCase();
  }

  /** Event sounds that need the state from BEFORE the message is applied. */
  function sfxBefore(msg: ServerMsg): void {
    if (msg.t === "farm") {
      const harvested = msg.tiles.some((t) => t.crop === null && store.farm.get(`${t.x},${t.y}`)?.crop);
      if (harvested) playSfx("harvest");
    } else if (msg.t === "goals") {
      const wasDone = new Set(store.goals.filter((g) => g.done).map((g) => g.id));
      if (msg.goals.some((g) => g.done && !wasDone.has(g.id))) playSfx("goal_complete");
    }
  }

  /** Holds a tool swing's result until its impact frame; everything else applies at once. */
  function handleMessage(msg: ServerMsg): void {
    if (msg.t === "farm" || msg.t === "rock" || msg.t === "tree" || msg.t === "farmAll") {
      const now = performance.now();
      if (msg.t !== "farmAll" && msg.impactAt !== undefined) {
        const due = impactDueMs(msg, {
          youId: store.youId,
          nowMs: now,
          serverNow: serverNow(),
          localImpactMs: pendingImpactMs(swing),
          // Others' swings are drawn behind: interpolation, the tick they ride in, half the trip.
          remoteLagMs: INTERP_DELAY_MS + TICK_MS / 2 + conn.rtt() / 2,
        });
        impacts.push(due, msg);
        return applyDueImpacts(now);
      }
      // An unstamped change to the same things must not overtake a held one.
      for (const held of impacts.flush()) applyMessage(held);
    }
    applyMessage(msg);
  }

  function applyDueImpacts(now: number): void {
    for (const m of impacts.take(now, sameTarget)) applyMessage(m);
  }

  function applyMessage(msg: ServerMsg): void {
    if (msg.t === "welcome" && !hasMap(msg.homeMap ?? msg.zone)) return pageOutdated(msg.homeMap ?? msg.zone);
    sfxBefore(msg);
    store.apply(msg, performance.now());
    switch (msg.t) {
      case "welcome":
        onWelcome(msg);
        break;
      case "tick":
        onTick(msg);
        break;
      case "inventory":
        editMode.refresh();
        hud.setInventory(store.inventory);
        storageUi.setInventory(store.inventory);
        tradeUi.setInventory(store.inventory);
        noticeBoardUi.refresh();
        refreshEdible();
        world?.effects.setFlashlight?.(hasFlashlight(store.inventory));
        break;
      case "farm":
        farmFx.farmChanged(msg.tiles);
        break;
      case "homeState":
        home = msg;
        homeUi.setVitals(msg.stamina, msg.maxStamina, msg.water, msg.maxWater, !visiting && !!msg.exhausted);
        if (!visiting) energy.setExhausted(!!msg.exhausted);
        // A visitor is sent a full can that isn't theirs.
        if (!visiting) hud.setWater?.(msg.water, msg.maxWater);
        farmFx.homeState(msg);
        farmFx.redraw();
        break;
      case "farmAll":
        store.farm.clear();
        for (const t of msg.tiles) store.farm.set(`${t.x},${t.y}`, t);
        farmFx.farmChanged(null);
        break;
      case "storage":
        storageUi.setInventory(store.inventory);
        storageUi.set(msg.id, msg.item, msg.slots, msg.accepts, !!msg.open);
        break;
      case "lid": {
        world?.farm.setLid?.(msg.id, msg.open);
        const it = store.objects.get(msg.id)?.item;
        if (it && getItem(it)?.storage) playSfx(msg.open ? "bin_open" : "bin_close");
        break;
      }
      case "wardrobe":
        if (creator) send({ t: "storeClose", id: msg.id });
        else openWardrobe(false, msg.id);
        break;
      case "bin":
        homeUi.setBin(msg.items, msg.total, !!msg.open);
        farmFx.bin(msg);
        break;
      case "sleeping":
        homeUi.sleeping(msg.host, msg.endsAt, serverNow);
        break;
      case "mail":
        mailboxUi.set(msg);
        break;
      case "notices":
        noticeBoardUi.set(msg);
        break;
      case "daySummary":
        playSfx("goal_complete");
        homeUi.showSummary(msg.summary);
        break;
      case "objects":
        world?.farm.setObjects(store.objects.values(), map());
        editMode.refresh();
        break;
      case "rock": {
        const m = map();
        if (world && m) world.farm.setRocks(m, store.brokenRocks, store.rockOres);
        const rock = m?.rocks?.find((r) => r.id === msg.id);
        if (rock && world) onRockMsg(world, rock, msg);
        break;
      }
      case "tree": {
        refreshClearedTrees();
        // Your own plain hit already wobbled the tree when your swing landed.
        if (!msg.drops && msg.hits > 0 && ownShownHit(msg)) break;
        const from = store.youId ? you() : null;
        world?.trees.update(msg.id, msg.stage, msg.hits, msg.drops, from);
        if (msg.stage === "stump" && msg.hits > 0) playSfx("tree_fall");
        else if (msg.stage === "gone") playSfx("rock_break");
        else if (msg.hits > 0) playSfx("tree_chop");
        break;
      }
      case "goals":
        hud.setGoals(store.goals);
        break;
      case "chat": {
        if (mutedEntity(msg.from)) break;
        const kind = chatKind(msg.from);
        hud.addChat(msg.name, msg.text, kind);
        if (kind !== "system") world?.overlays.say(msg.from, msg.text);
        if (kind === "npc") {
          playSfx("chat");
          // Only lines answering you belong in your conversation window.
          if (msg.to && msg.to === store.youId) hud.npcSaid?.(msg.from, msg.text);
        }
        break;
      }
      case "notice":
        notice(msg.text, msg.kind);
        if (msg.kind !== "info") playSfx(msg.kind);
        break;
      case "shop":
        hud.openShop(msg.npc, msg.name, msg.offers, msg.buys);
        break;
      case "zone":
        playSfx("door");
        joinZone(msg.to, msg.spawn);
        break;
      case "jail":
        hud.jail?.(msg.until, msg.serverTime);
        break;
      case "xp":
        levelFx.onXp(msg);
        break;
      case "levelUp":
        levelFx.onLevelUp(msg);
        break;
      case "reject":
        onReject(msg);
        break;
      case "bounce":
        onBounceMsg(msg);
        break;
      case "needAccount":
        void askForAccount(msg.reason);
        break;
      case "invites":
        visitsUi.addInvites(msg.invites);
        break;
      case "visitors":
        visitsUi.setVisitors(msg.visitors, msg.max);
        break;
      case "emote": {
        if (mutedEntity(msg.from)) break;
        world?.overlays.emote?.(msg.from, msg.code);
        // An animal's love heart is only a bubble and its happy noise, not a chat line.
        if (msg.from.startsWith(ANIMAL_PREFIX)) {
          animalSound(msg.from, msg.code);
          break;
        }
        // Server-only bubbles (a frightened animal) have no chat line.
        if (!isEmote(msg.code)) break;
        const who = store.latest(msg.from)?.name ?? (msg.from === store.youId ? "You" : "Someone");
        hud.addChat("", emoteLine(who, msg.code), "system", { channel: "zone" });
        break;
      }
      case "bond":
        hud.bond?.(msg.view, msg.delta, !!msg.talk, msg.from, msg.gifts);
        onBondGain(msg.from, msg.delta);
        break;
      case "bonds":
        hud.setBonds?.(msg.list);
        break;
      case "animal":
        hud.animal?.(msg.view, !!msg.open || !!msg.adopted);
        if (msg.delta) onBondGain(msg.view.entity, msg.delta);
        if (msg.fed && msg.view.species === "cat") playSfx("cat_meow");
        break;
      case "chests":
        world?.chests.set(msg.chests);
        break;
      case "hit":
        combatFx.onHit(msg);
        break;
      case "hurt":
        combatFx.onHurt(msg);
        break;
      case "loot":
        combatFx.onLoot(msg);
        playSfx("loot");
        break;
      case "ground":
        world?.groundItems.update(msg.upd, msg.del);
        break;
      case "stamina":
        if (zoneStamina !== null && msg.stamina <= msg.max * 0.2 && zoneStamina > msg.max * 0.2) {
          notice("You're getting tired. Eat something, or rest at home.", "info");
        }
        zoneStamina = msg.stamina;
        energy.setExhausted(!!msg.exhausted);
        if (msg.water !== undefined && msg.maxWater !== undefined) {
          hud.setWater?.(msg.water, msg.maxWater);
          if (store.zone !== "home") farmFx.waterLevel(msg.water, msg.maxWater);
        }
        if (store.zone !== "home") homeUi.setZoneStamina?.(msg.stamina, msg.max, !!msg.exhausted);
        break;
      case "chestOpened": {
        world?.chests.open(msg.id);
        const c = world?.chests.list().find((x) => x.id === msg.id);
        if (c) world?.effects.burst({ x: c.x + 0.5, y: c.y + 0.6 }, "sparkle");
        playSfx("loot");
        break;
      }
      case "tradeAsk":
        tradeUi.ask(msg.from, msg.name, msg.expiresAt);
        break;
      case "tradeAskGone":
        tradeUi.askGone(msg.from);
        break;
      case "trade":
        // Nothing may change behind the trade window: a shop dialog closes.
        if (!tradeUi.isOpen()) hud.closeShop();
        tradeUi.set(msg.view);
        break;
      case "tradeEnd":
        tradeUi.end();
        notice(msg.reason, msg.done ? "loot" : "info");
        if (msg.done) playSfx("loot");
        break;
      case "pong":
        break;
    }
  }

  /** Two animation frames: by then Pixi has drawn the new world at least once. */
  function afterFrame(fn: () => void): void {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!destroyed) fn();
    }));
  }
  let firstWorldShown = false;
  /** welcome.devTools: this server runs the /day, /time and /hour dev commands. */
  let devTools = false;

  function onWelcome(msg: Extract<ServerMsg, { t: "welcome" }>): void {
    opts.onReady?.();
    const nextHomeMap: HomeMapId | null = msg.zone === "home" ? (msg.homeMap ?? "home") : null;
    // Walking through the house door: same socket, the other home map.
    const throughDoor = homeMapNow !== null && nextHomeMap !== null && nextHomeMap !== homeMapNow;
    homeMapNow = nextHomeMap;
    pendingZone = null;
    devTools = msg.devTools === true;
    const afkTimes = afkTimesFromQuery(location.search, devTools);
    if (afkTimes) afkWatch.setTimes(afkTimes);
    afkWatch.start();
    loading?.done("world");
    loading?.zoneStep?.("arrived");
    afterFrame(() => {
      loading?.ready();
      if (!firstWorldShown) {
        firstWorldShown = true;
        // New characters pick a look first; the controls card follows once the creator closes.
        if (creator) void creator.done.then(() => !destroyed && tutorial.openFirstTime());
        else tutorial.openFirstTime();
      }
    });
    editMode.exit();
    world?.destroy();
    world = null;
    lastHp.clear();
    combatSfx.reset();

    const m = store.map ?? getMap(msg.zone);
    world = createWorld(
      game,
      art,
      m,
      {
        map,
        objects: () => [...store.objects.values()],
        farm: () => [...store.farm.values()],
        inventory: () => store.inventory,
        occupied: () => visibleEntities().map((e) => floorTile(e)),
        notice: (text) => notice(text, "error"),
      },
      characterFor,
      { beat: itemPoseBeat },
    );
    world.effects.setFlashlight?.(hasFlashlight(store.inventory));
    if (msg.zone !== "home") home = null;
    visiting = msg.visit ?? null;
    homeUi.setAtHome(msg.zone === "home");
    homeUi.setVisiting?.(!!visiting);
    energy.setVisiting(!!visiting);
    refreshEdible();
    visitsUi.setVisiting(visiting?.ownerName ?? null);
    visitsUi.setAtHome(msg.zone === "home" && !visiting);
    // Each room starts with empty hands: say what is selected so others see it.
    if (!visiting) send({ t: "hold", slot: selectedSlot });
    if (msg.zone !== "home") homeUi.closeBin();
    storageUi.close();
    // A new room: any trade or request belonged to the last one.
    tradeUi.end();
    tradeUi.setInventory(store.inventory);
    farmFx.reset();
    farmFx.redraw();
    world.farm.setRocks(m, store.brokenRocks, store.rockOres);
    world.chests.set(msg.chests ?? []);
    world.groundItems.set(msg.ground ?? []);
    hud.setBonds?.(msg.bonds ?? []);
    world.farm.setObjects(store.objects.values(), map());
    world.trees.sync(store.trees);
    refreshClearedTrees();
    swing = null;
    localAct = null;
    onImpact = null;
    impacts.clear();
    shownHits.clear();
    world.mailboxFlag?.set(mailFlag);
    noticeBoardUi.close();
    if (nextHomeMap !== "home" || visiting) mailboxUi.close();
    else void mailboxUi.refreshRequests();
    if (throughDoor) {
      playSfx("door");
      doorFade.reveal();
    }

    const me = msg.entities.find((e) => e.id === msg.you);
    const start = me ?? { x: m.spawns.default?.x ?? m.width / 2, y: m.spawns.default?.y ?? m.height / 2, facing: "down" as const };
    predictor.reset({ x: start.x, y: start.y }, start.facing);
    camera.setBounds(m.width, m.height);
    camera.follow(start.x, start.y, true);

    // A shop belongs to an NPC in the zone we just left.
    hud.closeShop();
    hud.setZone(msg.zone, visiting ? `${visiting.ownerName}'s ${nextHomeMap === "home_in" ? "house" : "home"}` : copyTitle(m.name, msg.copy));
    hud.setInventory(store.inventory);
    hud.setGoals(store.goals);
    if (me?.hp !== undefined) hud.setHp(me.hp, me.maxHp ?? me.hp);
    syncBuildBanner();
    editMode.refresh();
    setMusicZone(msg.zone);
    social.send({ t: "here", zone: msg.zone });
    if (msg.zone === "home") hud.setStats(null);
    else requestStats();
    exposeDebug();
    if (msg.needsLook && !lookPrompted) {
      lookPrompted = true;
      openWardrobe(true);
    }
  }

  function onTick(msg: Extract<ServerMsg, { t: "tick" }>): void {
    for (const e of msg.upd) {
      if (e.hp === undefined) continue;
      const prev = lastHp.get(e.id);
      if (prev !== undefined && e.hp < prev) world?.entities.flash(e.id);
      lastHp.set(e.id, e.hp);
    }
    for (const id of msg.del) lastHp.delete(id);
    combatSfx.onTick(msg.upd, msg.del, store.youId, performance.now());
    farmFx.tick();
    // Walking away from the open fridge shuts it.
    const openStore = storageUi.openId();
    if (openStore) {
      const o = store.objects.get(openStore);
      const me = you();
      if (!o || !me || storeTarget([o], me, me, STORE_WALK_AWAY) !== o.id) storageUi.close();
    }
    const mine = store.youId ? msg.upd.find((e) => e.id === store.youId) : undefined;
    if (mine?.act && (mine.act.k === "sit" || CLIMB_ACTS.has(mine.act.k))) {
      // On a chair or a ladder: follow the server exactly, so standing up starts from the seat
      // and a climb plays where everyone else sees it (not on the tile the walk was heading to).
      predictor.reset({ x: mine.x, y: mine.y }, mine.facing);
      if (mine.hp !== undefined) hud.setHp(mine.hp, mine.maxHp ?? mine.hp);
    } else if (mine) {
      predictor.reconcile(mine, msg.ack, msg.ackMs);
      if (mine.hp !== undefined) hud.setHp(mine.hp, mine.maxHp ?? mine.hp);
    } else if (msg.ack !== undefined && store.youId) {
      // Ack without a position change (e.g. blocked move): still let the predictor drop acked inputs.
      const latest = store.latest(store.youId);
      if (latest) predictor.reconcile(latest, msg.ack, msg.ackMs);
    }
  }

  function onReject(msg: Extract<ServerMsg, { t: "reject" }>): void {
    const kind = msg.req ? pendingReqs.get(msg.req) : undefined;
    farmFx.rejected(msg.req);
    editMode.rejected(msg.req);
    if (msg.req) pendingReqs.delete(msg.req);
    if (msg.action === "move" || msg.action === "moveTo") {
      const latest = store.youId ? store.latest(store.youId) : undefined;
      if (latest) predictor.reconcile(latest, undefined);
    }
    if (kind === "place" || kind === "moveObject" || msg.action === "place" || msg.action === "moveObject") {
      // Server state wins: redraw the furniture from the store, dropping any optimistic ghost.
      world?.build.exit();
      world?.farm.setObjects(store.objects.values(), map());
      syncBuildBanner();
    }
    if (msg.action === "npcSay" && hud.npcSayFailed) hud.npcSayFailed(msg.reason);
    else if (msg.reason) notice(msg.reason, "error");
    playSfx("error");
  }

  // ------------------------------------------------------------ actions
  /** What the rules say about using the selected item on a tile, from what the client knows. */
  function probeAt(tile: Vec2): { target: ToolTarget; outcome: ToolOutcome } | null {
    const m = map();
    const s = store.inventory.slots[selectedSlot];
    if (!m || !s) return null;
    const farm = store.zone === "home" && !visiting;
    const monsters = store.sample(performance.now()).filter((e) => e.kind === "monster");
    const target = targetAtTile(
      { map: m, farm, farmTiles: store.farm, objects: store.objects.values(), brokenRocks: store.brokenRocks, rockOres: store.rockOres, trees: store.trees, monsters },
      tile,
      farmTime(),
    );
    return { target, outcome: predictUse(s.item, target, farm, getItem(s.item)?.power) };
  }
  const predictAt = (tile: Vec2): ToolOutcome | null => probeAt(tile)?.outcome ?? null;

  function useAt(tile: Vec2): void {
    const now = performance.now();
    // Nothing else happens until the swing lands.
    if (swingLocked(swing, now)) return;
    const inv = store.inventory;
    // Visitors carry nothing here; their `use` only ever helps harvest (server-checked).
    if (!visiting && !inv.slots[selectedSlot]) {
      notice("Nothing in that slot.", "error");
      return;
    }
    const item = visiting ? null : (inv.slots[selectedSlot]?.item ?? null);
    // Using prepared food eats it, unless you're putting it in the shipping bin.
    if (item && getItem(item)?.kind === "food" && !isBinAt(tile)) return eatSelected();
    const atHome = store.zone === "home" && !visiting;
    const outcome = item ? predictAt(tile) : null;
    // Worn out: no farm work until the day resets (the server refuses it too).
    if (energy.blocksUse(outcome, atHome)) {
      playSfx("error");
      return;
    }
    const me = you();
    // Swing right away (even at nothing): the server's answer only adds the results.
    const s = me ? startSwing(item, me, tile, now, serverNow()) : null;
    if (s) {
      swing = s;
      localAct = s.act;
      predictor.face?.(s.facing);
    }
    const req = sendTagged({ t: "use", slot: selectedSlot, x: tile.x, y: tile.y }, "use");
    const used = usableItem(inv, selectedSlot);
    const water = home?.water ?? null;
    const sfx = sfxForUse(inv, selectedSlot);
    const clunk = !!s && !!outcome && !outcome.ok && !!outcome.reason;
    // The sword's whoosh starts with the swing; everything else is the sound of it landing.
    if (sfx === "tool_sword" && !clunk) combatSfx.swing(tile, store.sample(now));
    const land = (): void => {
      farmFx.used(used, tile, req, water, atHome);
      if (clunk) playSfx("tool_clunk");
      else if (sfx !== "tool_sword") playSfx(sfx);
      if (outcome?.ok) impactFx(tile, outcome.effect, used);
      else if (outcome?.bounce && store.youId) reboundFx(tile, store.youId, item);
    };
    // Seeds and other non-swings land at once; a swing lands at its impact frame (see frame()).
    if (s) onImpact = land;
    else land();
  }

  function isBinAt(tile: Vec2): boolean {
    const id = world?.props.propAt(tile);
    return !!id && map()?.props.find((p) => p.id === id)?.type === "shipping_bin";
  }

  /** What your own swing shows the moment it lands, before the server's answer. */
  function impactFx(tile: Vec2, effect: ToolEffect, used: string | null): void {
    const w = world;
    const m = map();
    if (!w || !m) return;
    const at = { x: tile.x + 0.5, y: tile.y + 0.5 };
    if (effect === "till" || effect === "water" || effect === "plant" || effect === "clear") {
      w.effects.burst(at, used === "watering_can" ? "water" : "dust");
    } else if (effect === "hitRock") {
      const rock = m.rocks?.find((r) => r.x === tile.x && r.y === tile.y && !store.brokenRocks.has(r.id));
      if (!rock) return;
      w.hitFx.shake(w.farm.rockSprite?.(rock.id));
      w.hitFx.chips({ x: rock.x, y: rock.y }, "stone", 6);
      shownHits.add(rock.id);
    } else if (effect === "hitTree" || effect === "hitStump") {
      const tree = m.props.find((p) => p.type === "tree" && p.x === tile.x && p.y === tile.y);
      if (!tree) return;
      w.trees.hit(tree.id);
      shownHits.add(tree.id);
    }
  }

  /** The selected hoe, when the tile holds something solid it would rebound off; else null. */
  function hoeAtSolid(tile: Vec2): string | null {
    const item = usableItem(store.inventory, selectedSlot);
    if (!item || getItem(item)?.tool !== "hoe") return null;
    const k = probeTarget(tile)?.kind;
    return k === "rock" || k === "tree" || k === "stump" || k === "boulder" ? item : null;
  }

  /** A tool rebounded off `tile`: a spark and grit where it struck, and the swinger jolts back. */
  function reboundFx(tile: Vec2, by: string, item?: string | null): void {
    const w = world;
    const m = map();
    if (!w || !m) return;
    const t = probeTarget(tile);
    const wood = t?.kind === "tree" || t?.kind === "stump";
    const who = by === store.youId ? you() : store.sample(performance.now()).find((e) => e.id === by);
    // The spark goes where the blade meets the thing, in front of the swinger at arm height, so
    // their own head doesn't hide it.
    const at = who ? toolContactPoint(who, who.facing) : { x: tile.x + 0.5, y: tile.y + 0.5 };
    // Each tool has its own rebound (sparks, steel flash, a puff of dirt...): from the swing's item.
    const used = item ?? who?.act?.item ?? who?.held ?? null;
    w.hitFx.rebound(at, wood ? "wood" : "stone", reboundTool(used));
    if (who) w.entities.nudge?.(by, reboundRecoil(who, { x: tile.x + 0.5, y: tile.y + 0.5 }));
  }

  /** What sits on a tile, as the rules see it (ignores the selected item). */
  function probeTarget(tile: Vec2): ToolTarget | null {
    const m = map();
    if (!m) return null;
    const farm = store.zone === "home" && !visiting;
    return targetAtTile(
      { map: m, farm, farmTiles: store.farm, objects: store.objects.values(), brokenRocks: store.brokenRocks, rockOres: store.rockOres, trees: store.trees, monsters: [] },
      tile,
      farmTime(),
    );
  }

  /** Someone else's tool rebounded: show it when their swing lands. */
  function onBounceMsg(msg: Extract<ServerMsg, { t: "bounce" }>): void {
    if (msg.by === store.youId || !msg.by) return;
    const now = performance.now();
    const due = impactDueMs(msg, {
      youId: store.youId,
      nowMs: now,
      serverNow: serverNow(),
      localImpactMs: null,
      remoteLagMs: INTERP_DELAY_MS + TICK_MS / 2 + conn.rtt() / 2,
    });
    const w = world;
    const by = msg.by;
    setTimeout(() => {
      if (!destroyed && world === w) {
        reboundFx({ x: msg.x, y: msg.y }, by);
        playSfx("tool_clunk");
      }
    }, Math.max(0, due - now));
  }

  /** True (once) when `msg` is the server's echo of a hit your swing already showed. */
  function ownShownHit(msg: { id: string; by?: string }): boolean {
    return msg.by !== undefined && msg.by === store.youId && shownHits.delete(msg.id);
  }

  /** Rock hit (shake, chips, cracks), break (burst and drops) or respawn. */
  function onRockMsg(w: World, rock: { id: string; x: number; y: number }, msg: Extract<ServerMsg, { t: "rock" }>): void {
    const at = { x: rock.x, y: rock.y };
    if (!msg.broken && (msg.hits ?? 0) > 0) {
      // Your own swing already shook it and threw chips at impact: just deepen the cracks.
      if (ownShownHit(msg)) return w.hitFx.crack(rock.id, at, msg.hits!, msg.need ?? 2);
      w.hitFx.shake(w.farm.rockSprite?.(rock.id));
      w.hitFx.chips(at, "stone", 6);
      w.hitFx.crack(rock.id, at, msg.hits!, msg.need ?? 2);
      playSfx("tool_pickaxe");
      return;
    }
    w.hitFx.crack(rock.id, at, 0, 0);
    if (msg.broken) {
      playSfx("rock_break");
      w.hitFx.chips(at, "stone", 16, 0.3);
      w.effects.burst({ x: rock.x + 0.5, y: rock.y + 0.5 }, "dust");
      if (msg.drops?.length) w.hitFx.drops({ x: rock.x + 0.5, y: rock.y + 0.9 }, msg.drops);
    }
  }

  /** Starts loading the selected tool's action sheet, so its first swing isn't lost. */
  let preloaded = "";
  function preloadSelectedTool(): void {
    const me = you();
    const item = store.inventory.slots[selectedSlot]?.item;
    if (!me || !item || !isSwingTool(toolKeyOf(item))) return;
    const key = `${me.sprite}|${JSON.stringify(me.look ?? null)}|${item}`;
    if (key === preloaded) return;
    // action() starts the load and returns null until the images are in; ask again later.
    if (characterFor(art, me).action?.(item)) preloaded = key;
  }

  /** Edible item in the selected slot (not while visiting someone's home), for the Eat button / Q key. */
  function edibleSelected(): string | null {
    if (visiting) return null;
    const s = store.inventory.slots[selectedSlot];
    return s && getItem(s.item)?.eat ? s.item : null;
  }

  function refreshEdible(): void {
    homeUi.setEdible(edibleSelected());
  }

  /** When you last asked to eat: the server refuses a bite inside EAT_COOLDOWN_MS anyway. */
  let lastEatSent = -Infinity;

  function eatSelected(): void {
    if (!edibleSelected()) return;
    const now = performance.now();
    if (now - lastEatSent < EAT_COOLDOWN_MS) return;
    lastEatSent = now;
    sendTagged({ t: "eat", slot: selectedSlot }, "use");
  }

  /** A bite (crunch), a sip (gulp) or a hold-up (fanfare and sparkles), heard when it's you or near you. */
  function itemPoseBeat(id: string, kind: "eat" | "hold", item?: string): void {
    const me = you();
    const e = id === store.youId ? me : store.latest(id);
    if (!me || !e || Math.hypot(e.x - me.x, e.y - me.y) > 10) return;
    if (kind === "eat") return playSfx(isDrink(item) ? "drink" : "eat");
    playSfx("goal");
    world?.effects.burst({ x: e.x, y: e.y - 1.8 }, "sparkle");
  }

  /** Asks "Go to sleep? The day will end." and sends sleep on yes. */
  async function askSleep(): Promise<void> {
    if (sleepAsked || store.zone !== "home" || visiting) return;
    sleepAsked = true;
    try {
      const answer = await homeUi.confirmSleep();
      if (answer === "sleep") send({ t: "sleep" });
      else if (answer === "move") {
        const bed = [...store.objects.values()].find((o) => o.item === "bed_simple");
        if (bed && world) {
          world.build.pick(bed.id);
          syncBuildBanner();
        }
      }
    } finally {
      sleepAsked = false;
    }
  }

  function isBed(objId: string | null): boolean {
    const item = objId ? store.objects.get(objId)?.item : undefined;
    return !!item && isBedItem(item);
  }

  function interact(target: string): void {
    send({ t: "interact", target });
    playSfx("interact");
  }

  function moveTo(x: number, y: number): void {
    send(predictor.moveTo({ x, y }));
  }

  function onAction(a: Parameters<Parameters<Input["onAction"]>[0]>[0]): void {
    if (editMode.active()) return editMode.action(a);
    const me = you();
    if (!world || !me) return;
    switch (a) {
      case "use":
        useAt(useTarget(me, me.facing));
        break;
      case "interact": {
        const npc = nearestNpc(me, store.sample(performance.now()));
        if (npc) return interact(npc);
        const pet = nearestAnimal(me, store.sample(performance.now()), ANIMAL_REACH);
        if (pet) return interact(pet);
        const ahead = useTarget(me, me.facing);
        if (store.zone === "home" && world.farm.objectAt(ahead) === BARN_ID) return interact(BARN_ID);
        if (store.zone === "home" && !visiting && (isBed(world.farm.objectAt(ahead)) || isBed(world.farm.objectAt(floorTile(me))))) {
          void askSleep();
          break;
        }
        // Visitors ask too: the server answers with a polite refusal.
        const wardrobe = store.zone === "home" ? wardrobeTarget(store.objects.values(), me, ahead) : null;
        if (wardrobe) return void send({ t: "wardrobeOpen", id: wardrobe });
        if (store.zone === "home" && !visiting) {
          const box = storeTarget(store.objects.values(), me, ahead);
          if (box) return void send({ t: "storeOpen", id: box });
        }
        const herb = world.groundItems.nearestForage(me, FORAGE_REACH);
        if (herb) return interact(`${GROUND_TARGET_PREFIX}${herb.id}`);
        const chest = chestFor(world.chests.list(), me, ahead, CHEST_REACH);
        if (chest) return interact(`${CHEST_TARGET_PREFIX}${chest.id}`);
        const prop = world.props.propAt(ahead) ?? world.props.propAt(floorTile(me));
        if (prop) interact(propTarget(map(), prop, selectedSlot));
        break;
      }
      case "gift": {
        // Q eats at home (onEatKey). In the shared zones it gives the item to a villager or an
        // animal next to you, and eats food when nobody is there to give it to.
        if (store.zone === "home") break;
        const npc = nearestNpc(me, store.sample(performance.now()));
        const pet = npc ? null : nearestAnimal(me, store.sample(performance.now()), ANIMAL_REACH);
        // Prepared food is for eating: Q eats it even with a villager beside you.
        const selected = store.inventory.slots[selectedSlot]?.item;
        if (selected && getItem(selected)?.kind === "food" && edibleSelected()) return eatSelected();
        if (!npc && !pet && edibleSelected()) return eatSelected();
        if (pet) {
          if (!store.inventory.slots[selectedSlot]) return notice("Pick some food in your hotbar first.", "error");
          send({ t: "feedAnimal", animal: pet, slot: selectedSlot });
          playSfx("interact");
          break;
        }
        if (!npc) return notice("Stand next to a villager to give a gift.", "info");
        if (!store.inventory.slots[selectedSlot]) return notice("Pick an item in your hotbar first.", "error");
        send({ t: "giftNpc", npc, slot: selectedSlot });
        playSfx("interact");
        break;
      }
      case "build":
        if (world.build.active()) setBuildItem(null);
        else setBuildItem(selectedSlot);
        break;
      case "rotate":
      case "rotateBack":
        if (world.build.active()) world.build.rotate(a === "rotate" ? 1 : -1);
        break;
      case "cancel":
        if (world.build.active()) setBuildItem(null);
        else hud.closeShop();
        break;
      // inventory / goals / chat keys are owned by the HUD.
      default:
        break;
    }
  }

  /** A click on a wardrobe opens it in reach, else walks up to it. True when it was one. */
  function wardrobeClick(me: Vec2, tile: Vec2): boolean {
    const id = world?.farm.objectAt(tile);
    const o = id ? store.objects.get(id) : undefined;
    if (!o || !isWardrobeItem(o.item)) return false;
    if (wardrobeTarget([o], me, me)) send({ t: "wardrobeOpen", id: o.id });
    else moveTo(tile.x + 0.5, o.y + 1.5);
    return true;
  }

  function onClick(p: Parameters<Parameters<Input["onClick"]>[0]>[0]): void {
    // Edit mode reads the canvas pointer itself: no walking, tools or pickups.
    if (editMode.active()) return;
    const me = you();
    if (!world || !me) return;
    const tile = floorTile(p.tile);
    // Right-click on a player opens their card (ui/player-card.ts): never a pickup, tool or step.
    if (p.button === 2 && !world.build.active() && playerUnder(p.tile)) return;

    if (world.build.active()) {
      if (p.button === 2) return setBuildItem(null);
      const msg = world.build.click(tile);
      if (msg) {
        const { req: _ignored, ...rest } = msg as ClientMsg & { req?: string };
        sendTagged(rest as ClientMsg, msg.t === "moveObject" ? "moveObject" : "place");
        playSfx("place");
        world.build.exit();
        syncBuildBanner();
      }
      return;
    }

    if (p.button !== 2 && animalClick(me, p.tile)) return;

    if (store.zone === "home" && p.button !== 2 && wardrobeClick(me, tile)) return;
    if (visiting) {
      // A visitor's click helps harvest a crop in reach, or walks.
      if (p.button === 2) return;
      if (store.farm.get(`${tile.x},${tile.y}`)?.crop && inUseRange(me, p.tile)) return useAt(tile);
      return moveTo(tile.x + 0.5, tile.y + 0.5);
    }
    if (store.zone === "home") {
      const obj = world.farm.objectAt(tile);
      if (obj === BARN_ID) {
        if (p.button === 2) return;
        if (withinInteract(me, { x: tile.x + 0.5, y: tile.y + 0.5 })) interact(BARN_ID);
        else moveTo(BARN_SPOT.x + BARN_SIZE.w / 2, BARN_SPOT.y + BARN_SIZE.h + 0.5);
        return;
      }
      const objItem = obj ? store.objects.get(obj)?.item : undefined;
      if (obj && objItem && getItem(objItem)?.storage && p.button !== 2) {
        if (storeTarget([store.objects.get(obj)!], me, me)) send({ t: "storeOpen", id: obj });
        else moveTo(tile.x + 0.5, tile.y + 1.5);
        return;
      }
      if (obj && isBed(obj) && p.button !== 2) {
        if (withinInteract(me, { x: tile.x + 0.5, y: tile.y + 0.5 })) void askSleep();
        else moveTo(tile.x + 0.5, tile.y + 1.5);
        return;
      }
      if (obj) {
        // The house's own wardrobe can't be picked up: right-click moves it instead.
        if (p.button === 2 && obj !== WARDROBE_ID) {
          sendTagged({ t: "pickup", id: obj }, "pickup");
          playSfx("pickup");
        } else {
          world.build.pick(obj);
          syncBuildBanner();
        }
        return;
      }
    }
    if (p.button === 2) return;

    const ent = world.entities.entityAt(p.tile);
    if (ent && ent !== store.youId) {
      const st = store.latest(ent);
      if (st?.kind === "npc") {
        if (withinInteract(me, st)) interact(ent);
        else moveTo(st.x, st.y + 1);
        return;
      }
      if (st?.kind === "monster" && inUseRange(me, st)) return useAt(floorTile(st));
      // Clicking another player starts a whisper to them.
      if (st?.kind === "player" && st.name) return hud.whisper(st.name);
    }

    if (forageInteract(me, tile)) return;
    if (chestInteract(me, tile)) return;
    const prop = world.props.propAt(tile);
    // The well is a prop, but with the watering can in hand clicking it refills the can.
    const m = map();
    if (prop && m && store.zone === "home" && usableItem(store.inventory, selectedSlot) === "watering_can" && isWaterSource(m, tile.x, tile.y)) {
      if (inUseRange(me, p.tile)) return useAt(tile);
      return moveTo(tile.x + 0.5, tile.y + 1.5);
    }
    if (prop) {
      if (withinInteract(me, { x: tile.x + 0.5, y: tile.y + 0.5 })) interact(propTarget(map(), prop, selectedSlot));
      else moveTo(tile.x + 0.5, tile.y + 1.5);
      return;
    }

    // Left click with a tool (or seeds at home) uses it on the clicked tile when it is in reach;
    // further away it walks there.
    // Inside the house there is nothing to till, water or mine: clicks walk.
    const indoors = world.map.ambient === "indoor" && store.zone === "home";
    const inReach = !indoors && inUseRange(me, p.tile);
    // A hoe away from home still swings at something solid (and rebounds off it).
    const tool = inReach ? (usableHere(store.inventory, selectedSlot, store.zone) ?? hoeAtSolid(useTarget(me, me.facing, p.tile))) : null;
    if (tool) {
      const t = useTarget(me, me.facing, p.tile);
      const probe = probeAt(t);
      if (clickUsesTool(tool, probe?.outcome ?? null, probe?.target ?? null)) return useAt(t);
    }
    if (swingLocked(swing, performance.now())) return;
    moveTo(tile.x + 0.5, tile.y + 0.5);
  }

  const unsubs = [
    input.onAction(onAction),
    input.onSlot(selectSlot),
    input.onClick(onClick),
    input.onPointerMove((p) => {
      if (editMode.active()) return;
      if (world?.build.active()) world.build.pointer(floorTile(p.tile));
      else cursorHint(p.tile);
    }),
  ];

  /** Pointer cursor over a tile the selected tool would do something to (and is in reach). */
  let hintKey = "";
  function cursorHint(at: Vec2): void {
    const me = you();
    const tile = floorTile(at);
    const key = `${tile.x},${tile.y}|${selectedSlot}`;
    if (key === hintKey || !me) return;
    hintKey = key;
    const tool = inUseRange(me, at) ? usableHere(store.inventory, selectedSlot, store.zone) : null;
    const probe = tool ? probeAt(tile) : null;
    game.app.canvas.style.cursor = probe?.outcome.ok ? "pointer" : "";
  }

  // ------------------------------------------------------------ frame loop
  const refreshCrops = every(10_000, () => world?.farm.setFarm(store.farm.values(), farmTime()));
  let clockLabel = "";
  function updateHomeClock(): void {
    if (!world?.daylight) return;
    // Every lamp, lantern and fire on the map and among the placed furniture, centred on its flame.
    const lights = [...(world.props.lights?.() ?? []), ...(world.farm.lights?.() ?? [])];
    if (!home) {
      // Caves have no clock: their lamps always burn, so any time will do.
      if (world.map.ambient === "cave") world.daylight.update(0, lights, game.width(), game.height(), performance.now());
      return;
    }
    const clock: HomeClock = home.clock;
    const minutes = clockMinutes(clock, serverNow());
    world.daylight.update(minutes, lights, game.width(), game.height(), performance.now());
    const label = `${clock.day}|${formatClock(minutes)}`;
    if (label !== clockLabel) {
      clockLabel = label;
      homeUi.setClock(clock.day, formatClock(minutes), dayPhase(minutes) === "night");
    }
  }
  const refreshPing = every(1_000, () => hud.setPing(Math.round(conn.rtt())));
  const refreshPreload = every(400, preloadSelectedTool);
  const refreshStats = every(STATS_MS, requestStats);

  // Pixi applies a resize on its next frame (and the mount can change size without a window
  // resize), so the camera follows the canvas size read each frame, not window "resize" events.
  let viewW = -1;
  let viewH = -1;
  function syncViewport(): void {
    const w = game.width();
    const h = game.height();
    if (w === viewW && h === viewH) return;
    viewW = w;
    viewH = h;
    camera.resize(w, h);
  }

  function frame(dt: number): void {
    syncViewport();
    refreshPing(dt);
    refreshStats(dt);
    if (!world || pendingZone) return;
    const nowMs = performance.now();
    // Your swing's effect lands at its impact frame, then any held server results that are due.
    if (takeImpact(swing, nowMs)) {
      const land = onImpact;
      onImpact = null;
      land?.();
    }
    applyDueImpacts(nowMs);
    // Movement pauses while a swing plays out, and while editing the house (keys pan the view).
    const locked = swingLocked(swing, nowMs) || editMode.active();
    const { dx, dy, dash } = locked ? { dx: 0, dy: 0, dash: false } : input.dir();
    const step = predictor.step(dx, dy, dt, performance.now(), dash);
    refreshPreload(dt);
    if (step.send) send(step.send);

    const states = visibleEntities();
    world.entities.sync(states, dt);
    world.overlays.sync(states, (id) => world!.entities.headOf(id), store.youId);
    world.itemPoses.sync(states, (id) => world!.entities.headOf(id), performance.now(), dt, (id) => world!.entities.foodOf?.(id) ?? null);
    const me = states.find((e) => e.id === store.youId) ?? null;
    approachAnimal(me, states);
    // Edit mode moves the view itself (keys, a finger, or dragging to the edge).
    editMode.update(dt);
    const focus = editMode.focus() ?? me;
    if (focus) camera.follow(focus.x, focus.y);
    // A step sounds when the walk art puts a foot down, so it matches walking, dashing and tired.
    if (me && world.entities.footstepOf?.(me.id)) footstep(groundNameAt(me.x, me.y));
    combatSfx.frame(states, me, performance.now());
    camera.update(dt);
    world.effects.update(dt, me ? { x: me.x, y: me.y } : null);
    updateHomeClock();
    world.doorHint.update(world.map, me);
    // Stepping onto the house door: start the fade now, the server's welcome finishes it.
    if (me && homeMapNow && exitAt(world.map, me.x, me.y)?.map) doorFade.cover();
    refreshCrops(dt);
  }
  const stopLoop = startLoop(game.app.ticker, frame);
  // Key presses go out at once (not on the next frame), stamped with the event time.
  const stopDir = input.onDir((d, at) => {
    if (!world || pendingZone) return;
    if (editMode.active()) return editMode.pan(d);
    const msg = predictor.setDir(d.dx, d.dy, Math.min(at, performance.now()), d.dash);
    if (msg?.t === "move" && d.dash) energy.dashPressed(performance.now());
    if (msg) send(msg);
  });

  const onEatKey = (e: KeyboardEvent) => {
    // Away from home Q goes through the "gift" action, which eats when nobody is near.
    if (store.zone !== "home") return;
    if (e.code !== "KeyQ" || typing || editMode.active() || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    eatSelected();
  };
  window.addEventListener("keydown", onEatKey);

  function exposeDebug(): void {
    installDebug({
      renderer: game.renderer,
      zone: () => store.zone,
      you,
      entities: visibleEntities,
      inventory: () => store.inventory,
      send,
      moveTo,
      tileToScreen: (x, y) => camera.tileToScreen(x, y),
      rocks: () => (map()?.rocks ?? []).filter((r) => !store.brokenRocks.has(r.id)).map((r) => ({ ...r, ore: store.rockOres.get(r.id) ?? r.ore })),
      props: () => (map()?.props ?? []).map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, w: p.w, h: p.h })),
    });
  }
  exposeDebug();

  social.start();
  // Accounts arrive in the village square; guests can only be at home.
  joinZone(opts.startZone ?? (isGuest ? "home" : "village"));

  const handle = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      creator?.close();
      tutorial.destroy();
      stopLoop();
      stopDir();
      afkWatch.destroy();
      afkScreen.destroy();
      if (napTimer !== null) clearTimeout(napTimer);
      document.removeEventListener("visibilitychange", onAfkVisibility);
      window.removeEventListener("keydown", onEatKey);
      editMode.destroy();
      homeUi.destroy();
      storageUi.destroy();
      visitsUi.destroy();
      mailboxUi.destroy();
      noticeBoardUi.destroy();
      tradeUi.destroy();
      doorFade.destroy();
      for (const u of socialUnsubs) u();
      for (const u of unsubs) u();
      conn.close();
      social.close();
      world?.destroy();
      world = null;
      input.destroy();
      setMusicZone(null);
      installDebug(null);
      game.destroy();
    },
  };
  destroySelf = () => handle.destroy();
  return handle;
}
