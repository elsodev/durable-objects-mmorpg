// Session orchestrator: wires app, art, store, connection, prediction, input, camera, per-zone
// renderers and the HUD, runs the frame loop and zone switching. See ../contracts.ts.
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
import { mountHud, type GameApi, type Hud, type SessionUser } from "../ui";
import { createHomeUi } from "../ui/homeui";
import { createVisitsUi } from "../ui/visits";
import { createMailboxUi } from "../ui/mailbox";
import { createDoorFade } from "../ui/door-fade";
import { exitAt } from "../../shared/engine/geometry";
import { MAILBOX_TAKE } from "../../shared/mail";
import { visitsApi } from "../ui/visits-api";
import type { InviteNotice, VisitInfo, VisitorEntry } from "../../shared/visits";
import { clockMinutes, dayPhase, farmNow, formatClock, type HomeClock } from "../../shared/engine/homeclock";
import { getItem } from "../../shared/items";
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
  nearestNpc,
  sfxForUse,
  propTarget,
  usableHere,
  clickUsesTool,
  usableItem,
  useTarget,
  withinInteract,
} from "./actions";
import { createGameApp } from "./app";
import { appearanceOf, applyAppearance } from "./appearance";
import { playSfx, setAudioHooks, setMusicZone, type AudioHooks } from "./audio";
import { installDebug } from "./debug";
import { createCombatSfx } from "./combat-sfx";
import { createCombatFx } from "./combat-fx";
import { FORAGE_REACH, GROUND_TARGET_PREFIX } from "../../shared/spawns";
import { createInput } from "./input";
import { every, startLoop } from "./loop";
import { chestFor } from "../render/chests";
import { CHEST_REACH, CHEST_TARGET_PREFIX } from "../../shared/chests";
import { gainText } from "../ui/bonds-logic";
import { npcPortrait } from "./npc-portrait";
import { createPredictor } from "./prediction";
import { createFarmFx } from "./farm-fx";
import { isWaterSource } from "../../shared/engine";
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
import { parseChatInput, type ChatTab, type SocialServerMsg } from "../../shared/social";
import type { EmoteCode } from "../../shared/emotes";
import { emoteLine } from "../ui/chat";
import { playerHit, tileDistance } from "./player-hit";

const HOTBAR_SLOTS = 8;
/** Stats panel refresh while in a shared zone. */
const STATS_MS = 10_000;
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
  let pendingZone: ZoneId | null = null;
  let promptOpen = false;
  let destroyed = false;
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
  /** Zones: last stamina the server sent (a gentle warning when it runs low). */
  let zoneStamina: number | null = null;
  const input: Input = createInput(game.app.canvas, (sx, sy) => camera.screenToTile(sx, sy));

  /** Your entity: authoritative fields + predicted position, with the creator's look applied locally. */
  function you(): EntityState | null {
    const id = store.youId;
    if (!id) return null;
    const base = store.latest(id);
    if (!base) return null;
    // Seated: the server places you on the chair; nothing to predict.
    if (base.act?.k === "sit") return applyAppearance({ ...base, moving: false }, appearance);
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
      if (!world) return null;
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
    }),
  };
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
  const doorFade = createDoorFade(mount.ui);
  const socialUnsubs = [
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
  const social = createSocialConnection({ onMessage: onSocial });

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
    onIdle: (zone) => {
      notice("You were idle — press any key or click to reconnect.", "error");
      const back = () => {
        removeEventListener("keydown", back, true);
        removeEventListener("pointerdown", back, true);
        if (!destroyed) joinZone(zone);
      };
      addEventListener("keydown", back, true);
      addEventListener("pointerdown", back, true);
    },
  });

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

  /** Character creator; firstTime when the save has no look yet (welcome.needsLook). */
  function openWardrobe(firstTime: boolean): void {
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
        hud.setInventory(store.inventory);
        refreshEdible();
        world?.effects.setFlashlight?.(hasFlashlight(store.inventory));
        break;
      case "farm":
        farmFx.farmChanged(msg.tiles);
        break;
      case "homeState":
        home = msg;
        homeUi.setVitals(msg.stamina, msg.maxStamina, msg.water, msg.maxWater);
        farmFx.homeState(msg);
        farmFx.redraw();
        break;
      case "farmAll":
        store.farm.clear();
        for (const t of msg.tiles) store.farm.set(`${t.x},${t.y}`, t);
        farmFx.farmChanged(null);
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
      case "daySummary":
        playSfx("goal_complete");
        homeUi.showSummary(msg.summary);
        break;
      case "objects":
        world?.farm.setObjects(store.objects.values(), map());
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
        if (store.zone !== "home") homeUi.setZoneStamina?.(msg.stamina, msg.max);
        break;
      case "chestOpened": {
        world?.chests.open(msg.id);
        const c = world?.chests.list().find((x) => x.id === msg.id);
        if (c) world?.effects.burst({ x: c.x + 0.5, y: c.y + 0.6 }, "sparkle");
        playSfx("loot");
        break;
      }
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
    visitsUi.setVisiting(visiting?.ownerName ?? null);
    visitsUi.setAtHome(msg.zone === "home" && !visiting);
    // Each room starts with empty hands: say what is selected so others see it.
    if (!visiting) send({ t: "hold", slot: selectedSlot });
    if (msg.zone !== "home") homeUi.closeBin();
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
    hud.setZone(msg.zone, visiting ? `${visiting.ownerName}'s ${nextHomeMap === "home_in" ? "house" : "home"}` : m.name);
    hud.setInventory(store.inventory);
    hud.setGoals(store.goals);
    if (me?.hp !== undefined) hud.setHp(me.hp, me.maxHp ?? me.hp);
    syncBuildBanner();
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
    const mine = store.youId ? msg.upd.find((e) => e.id === store.youId) : undefined;
    if (mine?.act?.k === "sit") {
      // On a chair: follow the server exactly, so standing up starts from the seat.
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
    const atHome = store.zone === "home" && !visiting;
    const outcome = item ? predictAt(tile) : null;
    const sfx = sfxForUse(inv, selectedSlot);
    const clunk = !!s && !!outcome && !outcome.ok && !!outcome.reason;
    // The sword's whoosh starts with the swing; everything else is the sound of it landing.
    if (sfx === "tool_sword" && !clunk) combatSfx.swing(tile, store.sample(now));
    const land = (): void => {
      if (atHome) farmFx.used(used, tile, req, water);
      if (clunk) playSfx("tool_clunk");
      else if (sfx !== "tool_sword") playSfx(sfx);
      if (outcome?.ok) impactFx(tile, outcome.effect, used);
      else if (outcome?.bounce && store.youId) reboundFx(tile, store.youId, item);
    };
    // Seeds and other non-swings land at once; a swing lands at its impact frame (see frame()).
    if (s) onImpact = land;
    else land();
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

  /** Edible item in the selected slot (home only), for the Eat button / Q key. */
  function edibleSelected(): string | null {
    if (store.zone !== "home" || visiting) return null;
    const s = store.inventory.slots[selectedSlot];
    return s && getItem(s.item)?.eat ? s.item : null;
  }

  function refreshEdible(): void {
    homeUi.setEdible(edibleSelected());
  }

  function eatSelected(): void {
    if (!edibleSelected()) return;
    sendTagged({ t: "eat", slot: selectedSlot }, "use");
  }

  /** A bite (crunch) or a hold-up (fanfare and sparkles), heard when it's you or near you. */
  function itemPoseBeat(id: string, kind: "eat" | "hold"): void {
    const me = you();
    const e = id === store.youId ? me : store.latest(id);
    if (!me || !e || Math.hypot(e.x - me.x, e.y - me.y) > 10) return;
    if (kind === "eat") return playSfx("eat");
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
    return !!objId && store.objects.get(objId)?.item === "bed_simple";
  }

  function interact(target: string): void {
    send({ t: "interact", target });
    playSfx("interact");
  }

  function moveTo(x: number, y: number): void {
    send(predictor.moveTo({ x, y }));
  }

  function onAction(a: Parameters<Parameters<Input["onAction"]>[0]>[0]): void {
    const me = you();
    if (!world || !me) return;
    switch (a) {
      case "use":
        useAt(useTarget(me, me.facing));
        break;
      case "interact": {
        const npc = nearestNpc(me, store.sample(performance.now()));
        if (npc) return interact(npc);
        const ahead = useTarget(me, me.facing);
        if (store.zone === "home" && !visiting && (isBed(world.farm.objectAt(ahead)) || isBed(world.farm.objectAt(floorTile(me))))) {
          void askSleep();
          break;
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
        // Q eats at home (onEatKey); it only gives gifts in the shared zones.
        if (store.zone === "home") break;
        const npc = nearestNpc(me, store.sample(performance.now()));
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

  function onClick(p: Parameters<Parameters<Input["onClick"]>[0]>[0]): void {
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

    if (visiting) {
      // A visitor's click helps harvest a crop in reach, or walks.
      if (p.button === 2) return;
      if (store.farm.get(`${tile.x},${tile.y}`)?.crop && inUseRange(me, p.tile)) return useAt(tile);
      return moveTo(tile.x + 0.5, tile.y + 0.5);
    }
    if (store.zone === "home") {
      const obj = world.farm.objectAt(tile);
      if (obj && isBed(obj) && p.button !== 2) {
        if (withinInteract(me, { x: tile.x + 0.5, y: tile.y + 0.5 })) void askSleep();
        else moveTo(tile.x + 0.5, tile.y + 1.5);
        return;
      }
      if (obj) {
        if (p.button === 2) {
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
  /** Home lights that glow at night: placed lamps and the map's lantern posts (tile coords). */
  function homeLights(): Vec2[] {
    const out: Vec2[] = [];
    for (const o of store.objects.values()) if (o.item === "lamp") out.push({ x: o.x + 0.5, y: o.y + 0.3 });
    for (const pr of map()?.props ?? []) {
      if (pr.type === "lantern_post" || pr.type === "wall_sconce") out.push({ x: pr.x + pr.w / 2, y: pr.y + 0.2 });
      else if (pr.type === "hearth" || pr.type === "fireplace") out.push({ x: pr.x + pr.w / 2, y: pr.y + 0.5 });
    }
    return out;
  }
  function updateHomeClock(): void {
    if (!world?.daylight || !home) return;
    const clock: HomeClock = home.clock;
    const minutes = clockMinutes(clock, serverNow());
    world.daylight.update(minutes, homeLights(), game.width(), game.height(), performance.now());
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
    // Movement pauses while a swing plays out.
    const locked = swingLocked(swing, nowMs);
    const { dx, dy } = locked ? { dx: 0, dy: 0 } : input.dir();
    const step = predictor.step(dx, dy, dt, performance.now());
    refreshPreload(dt);
    if (step.send) send(step.send);

    const states = visibleEntities();
    world.entities.sync(states, dt);
    world.overlays.sync(states, (id) => world!.entities.headOf(id), store.youId);
    world.itemPoses.sync(states, (id) => world!.entities.headOf(id), performance.now(), dt);
    const me = states.find((e) => e.id === store.youId) ?? null;
    if (me) camera.follow(me.x, me.y);
    // The audio module rate-limits steps itself, so calling every moving frame is fine.
    if (me?.moving) footstep(groundNameAt(me.x, me.y));
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
    const msg = predictor.setDir(d.dx, d.dy, Math.min(at, performance.now()));
    if (msg) send(msg);
  });

  const onEatKey = (e: KeyboardEvent) => {
    if (e.code !== "KeyQ" || typing || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
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

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      creator?.close();
      tutorial.destroy();
      stopLoop();
      stopDir();
      window.removeEventListener("keydown", onEatKey);
      homeUi.destroy();
      visitsUi.destroy();
      mailboxUi.destroy();
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
}
