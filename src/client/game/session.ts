// Session orchestrator: wires app, art, store, connection, prediction, input, camera, per-zone
// renderers and the HUD, runs the frame loop and zone switching. See ../contracts.ts.
import { loadArt } from "../art";
import { createLookCompositor } from "../art/compositor";
import { lookResolver } from "../render/look-characters";
import { openCreator, type CreatorHandle } from "../ui/creator";
import { DEFAULT_LOOK, validateLook } from "../../shared/look";
import type { Camera, GameSession, Input, Predictor } from "../contracts";
import { createConnection } from "../net/connection";
import { createCamera } from "../render/camera";
import { createStore } from "../state/store";
import { mountHud, type GameApi, type Hud, type SessionUser } from "../ui";
import { createHomeUi } from "../ui/homeui";
import { createVisitsUi } from "../ui/visits";
import { visitsApi } from "../ui/visits-api";
import type { InviteNotice, VisitInfo, VisitorEntry } from "../../shared/visits";
import { clockMinutes, dayPhase, farmNow, formatClock, type HomeClock } from "../../shared/engine/homeclock";
import { getItem } from "../../shared/items";
import type { HomeServerMsg } from "../../shared/home";
import { footstep } from "../audio/player";
import { getMap } from "../../shared/maps";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import { Ground, type EntityState, type MapData, type Vec2, type ZoneId } from "../../shared/types";
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
  usableItem,
  useTarget,
  withinInteract,
} from "./actions";
import { createGameApp } from "./app";
import { appearanceOf, applyAppearance } from "./appearance";
import { playSfx, setAudioHooks, setMusicZone, type AudioHooks } from "./audio";
import { installDebug } from "./debug";
import { createCombatSfx } from "./combat-sfx";
import { createInput } from "./input";
import { every, startLoop } from "./loop";
import { createPredictor } from "./prediction";
import { createWorld, type World } from "./world";
import { createSocialConnection } from "../net/social";
import { emitSocial, onSocial as onSocialEvent } from "../social-events";
import { parseChatInput, type ChatTab, type SocialServerMsg } from "../../shared/social";
import type { EmoteCode } from "../../shared/emotes";
import { emoteLine } from "../ui/chat";

const HOTBAR_SLOTS = 8;
/** Stats panel refresh while in a shared zone. */
const STATS_MS = 10_000;
const GUEST_CHAT = "Create an account to chat with everyone.";

export interface SessionOptions {
  /** Audio module hooks; same as calling setAudioHooks() before starting. */
  audio?: Partial<AudioHooks>;
  /** First zone to join. Default: "village" for accounts, "home" for guests. */
  startZone?: ZoneId;
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

  const game = await createGameApp(mount.game);
  // Character layers load alongside the art pack, so composited players are ready on first draw.
  const looks = createLookCompositor();
  const [art] = await Promise.all([loadArt(game.app), looks.load()]);
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
  /** Home clock + vitals from the last homeState (null outside home). */
  let home: Extract<HomeServerMsg, { t: "homeState" }> | null = null;
  let typing = false;
  let sleepAsked = false;
  /** Set while you're a visitor in someone else's home (welcome.visit). */
  let visiting: VisitInfo | null = null;
  /** The visit being connected to, and where to go back to if it's refused. */
  let visitTarget: { ownerId: string; from: ZoneId } | null = null;
  /** Farm engine time: at home crops follow the home day, not real time (see homeclock.farmNow). */
  const farmTime = () => (store.zone === "home" && home ? farmNow(home.clock.day) : serverNow());
  const unbrokenRocks = (): Vec2[] =>
    (map()?.rocks ?? []).filter((r) => !store.brokenRocks.has(r.id)).map((r) => ({ x: r.x, y: r.y }));

  const predictor: Predictor = createPredictor(map, () => ({
    objects: [...store.objects.values()],
    rocks: unbrokenRocks(),
  }));
  const camera: Camera = createCamera(game.layers, { w: game.width(), h: game.height() });
  const input: Input = createInput(game.app.canvas, (sx, sy) => camera.screenToTile(sx, sy));

  /** Your entity: authoritative fields + predicted position, with the creator's look applied locally. */
  function you(): EntityState | null {
    const id = store.youId;
    if (!id) return null;
    const base = store.latest(id);
    if (!base) return null;
    // Seated: the server places you on the chair; nothing to predict.
    if (base.act?.k === "sit") return applyAppearance({ ...base, moving: false }, appearance);
    const p = predictor.state();
    return applyAppearance({ ...base, x: p.x, y: p.y, facing: p.facing, moving: p.moving }, appearance);
  }

  function visibleEntities(): EntityState[] {
    const list = store.sample(performance.now());
    const me = you();
    return me ? [...list, me] : list;
  }

  function send(msg: ClientMsg): void {
    conn.send(msg);
  }

  function sendTagged(msg: ClientMsg & { req?: string }, kind: ActionReq): void {
    const req = nextReq();
    pendingReqs.set(req, kind);
    if (pendingReqs.size > 64) pendingReqs.delete(pendingReqs.keys().next().value!);
    send({ ...msg, req } as ClientMsg);
  }

  function notice(text: string, kind: "info" | "error" | "loot" = "info"): void {
    hud.notice(text, kind);
    const me = you();
    if (me && world) world.effects.floatText({ x: me.x, y: me.y - 1.5 }, text, kind);
  }

  function selectSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOTS) return;
    selectedSlot = slot;
    hud.setSelectedSlot(slot);
    refreshEdible();
    // Keep the input module's own notion of the slot in step (it numbers hotbar keys relative to it).
    input.setSlot?.(slot);
  }

  function syncBuildBanner(): void {
    hud.setBuildMode(!!world?.build.active());
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
    playerNameAt(clientX, clientY) {
      if (!world) return null;
      const r = game.app.canvas.getBoundingClientRect();
      const id = world.entities.entityAt(camera.screenToTile(clientX - r.left, clientY - r.top));
      const st = id && id !== store.youId ? store.latest(id) : null;
      return st?.kind === "player" ? st.name : null;
    },
    chat: (text, tab) => onChatInput(text, tab),
    emote: (code) => sendEmote(code),
  };
  const hud: Hud = mountHud(mount.ui, gameApi);
  hud.setIconSource((item) => art.iconUrl(item));
  hud.setSelectedSlot(selectedSlot);
  const homeUi = createHomeUi(mount.ui, {
    unship: () => sendTagged({ t: "unship" }, "use"),
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
          hud.addChat(l.name, l.text, "player", { channel: "world" });
        }
        if (store.zone) social.send({ t: "here", zone: store.zone });
        requestStats();
        break;
      case "world":
        lastWorldAt = Math.max(lastWorldAt, msg.at);
        hud.addChat(msg.name, msg.text, "player", { channel: "world" });
        sayByName(msg.name, msg.text);
        break;
      case "pm":
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
    onState: (s) => hud.setConnection(s),
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
    pendingZone = zone;
    visitTarget = null;
    world?.build.exit();
    hud.setConnection("connecting");
    conn.connect(zone, spawn);
  }

  /** Connects to /ws/visit/<ownerId>; their home arrives as zone "home" with welcome.visit set. */
  function joinVisit(ownerId: string): void {
    const from: ZoneId = visiting?.returnTo ?? store.zone ?? "village";
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

  function handleMessage(msg: ServerMsg): void {
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
        break;
      case "farm":
        world?.farm.setFarm(store.farm.values(), farmTime());
        break;
      case "homeState":
        home = msg;
        homeUi.setVitals(msg.stamina, msg.maxStamina, msg.water, msg.maxWater);
        world?.farm.setFarm(store.farm.values(), farmTime());
        break;
      case "farmAll":
        store.farm.clear();
        for (const t of msg.tiles) store.farm.set(`${t.x},${t.y}`, t);
        world?.farm.setFarm(store.farm.values(), farmTime());
        break;
      case "bin":
        homeUi.setBin(msg.items, msg.total, !!msg.open);
        break;
      case "sleeping":
        homeUi.sleeping(msg.host, msg.endsAt, serverNow);
        break;
      case "daySummary":
        playSfx("goal_complete");
        homeUi.showSummary(msg.summary);
        break;
      case "objects":
        world?.farm.setObjects(store.objects.values());
        break;
      case "rock": {
        const m = map();
        if (world && m) world.farm.setRocks(m, store.brokenRocks);
        const rock = m?.rocks?.find((r) => r.id === msg.id);
        if (rock && msg.broken) {
          playSfx("rock_break");
          world?.effects.burst({ x: rock.x + 0.5, y: rock.y + 0.5 }, "dust");
        }
        break;
      }
      case "goals":
        hud.setGoals(store.goals);
        break;
      case "chat": {
        const kind = chatKind(msg.from);
        hud.addChat(msg.name, msg.text, kind);
        if (kind !== "system") world?.overlays.say(msg.from, msg.text);
        if (kind === "npc") playSfx("chat");
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
        world?.overlays.emote?.(msg.from, msg.code);
        const who = store.latest(msg.from)?.name ?? (msg.from === store.youId ? "You" : "Someone");
        hud.addChat("", emoteLine(who, msg.code), "system", { channel: "zone" });
        break;
      }
      case "pong":
        break;
    }
  }

  function onWelcome(msg: Extract<ServerMsg, { t: "welcome" }>): void {
    pendingZone = null;
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
    );
    if (msg.zone !== "home") home = null;
    visiting = msg.visit ?? null;
    homeUi.setAtHome(msg.zone === "home");
    homeUi.setVisiting?.(!!visiting);
    visitsUi.setVisiting(visiting?.ownerName ?? null);
    visitsUi.setAtHome(msg.zone === "home" && !visiting);
    if (msg.zone !== "home") homeUi.closeBin();
    world.farm.setFarm(store.farm.values(), farmTime());
    world.farm.setRocks(m, store.brokenRocks);
    world.farm.setObjects(store.objects.values());

    const me = msg.entities.find((e) => e.id === msg.you);
    const start = me ?? { x: m.spawns.default?.x ?? m.width / 2, y: m.spawns.default?.y ?? m.height / 2, facing: "down" as const };
    predictor.reset({ x: start.x, y: start.y }, start.facing);
    camera.setBounds(m.width, m.height);
    camera.follow(start.x, start.y, true);

    // A shop belongs to an NPC in the zone we just left.
    hud.closeShop();
    hud.setZone(msg.zone, visiting ? `${visiting.ownerName}'s home` : m.name);
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
    const mine = store.youId ? msg.upd.find((e) => e.id === store.youId) : undefined;
    if (mine?.act?.k === "sit") {
      // On a chair: follow the server exactly, so standing up starts from the seat.
      predictor.reset({ x: mine.x, y: mine.y }, mine.facing);
      if (mine.hp !== undefined) hud.setHp(mine.hp, mine.maxHp ?? mine.hp);
    } else if (mine) {
      predictor.reconcile(mine, msg.ack);
      if (mine.hp !== undefined) hud.setHp(mine.hp, mine.maxHp ?? mine.hp);
    } else if (msg.ack !== undefined && store.youId) {
      // Ack without a position change (e.g. blocked move): still let the predictor drop acked inputs.
      const latest = store.latest(store.youId);
      if (latest) predictor.reconcile(latest, msg.ack);
    }
  }

  function onReject(msg: Extract<ServerMsg, { t: "reject" }>): void {
    const kind = msg.req ? pendingReqs.get(msg.req) : undefined;
    if (msg.req) pendingReqs.delete(msg.req);
    if (msg.action === "move" || msg.action === "moveTo") {
      const latest = store.youId ? store.latest(store.youId) : undefined;
      if (latest) predictor.reconcile(latest, undefined);
    }
    if (kind === "place" || kind === "moveObject" || msg.action === "place" || msg.action === "moveObject") {
      // Server state wins: redraw the furniture from the store, dropping any optimistic ghost.
      world?.build.exit();
      world?.farm.setObjects(store.objects.values());
      syncBuildBanner();
    }
    if (msg.reason) notice(msg.reason, "error");
    playSfx("error");
  }

  // ------------------------------------------------------------ actions
  function useAt(tile: Vec2): void {
    const inv = store.inventory;
    // Visitors carry nothing here; their `use` only ever helps harvest (server-checked).
    if (!visiting && !inv.slots[selectedSlot]) {
      notice("Nothing in that slot.", "error");
      return;
    }
    sendTagged({ t: "use", slot: selectedSlot, x: tile.x, y: tile.y }, "use");
    const sfx = sfxForUse(inv, selectedSlot);
    if (sfx === "tool_sword") combatSfx.swing(tile, store.sample(performance.now()));
    else playSfx(sfx);
    const kind = usableItem(inv, selectedSlot) === "watering_can" ? "water" : "dust";
    world?.effects.burst({ x: tile.x + 0.5, y: tile.y + 0.5 }, kind);
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
    playSfx("harvest");
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
        if (world.build.active()) world.build.rotate();
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

    const prop = world.props.propAt(tile);
    if (prop) {
      if (withinInteract(me, { x: tile.x + 0.5, y: tile.y + 0.5 })) interact(propTarget(map(), prop, selectedSlot));
      else moveTo(tile.x + 0.5, tile.y + 1.5);
      return;
    }

    if (inUseRange(me, p.tile) && usableHere(store.inventory, selectedSlot, store.zone)) {
      return useAt(useTarget(me, me.facing, p.tile));
    }
    moveTo(tile.x + 0.5, tile.y + 0.5);
  }

  const unsubs = [
    input.onAction(onAction),
    input.onSlot(selectSlot),
    input.onClick(onClick),
    input.onPointerMove((p) => {
      if (world?.build.active()) world.build.pointer(floorTile(p.tile));
    }),
  ];

  // ------------------------------------------------------------ frame loop
  const refreshCrops = every(10_000, () => world?.farm.setFarm(store.farm.values(), farmTime()));
  let clockLabel = "";
  /** Home lights that glow at night: placed lamps and the map's lantern posts (tile coords). */
  function homeLights(): Vec2[] {
    const out: Vec2[] = [];
    for (const o of store.objects.values()) if (o.item === "lamp") out.push({ x: o.x + 0.5, y: o.y + 0.3 });
    for (const pr of map()?.props ?? []) if (pr.type === "lantern_post") out.push({ x: pr.x + pr.w / 2, y: pr.y + 0.2 });
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
  const refreshStats = every(STATS_MS, requestStats);

  function frame(dt: number): void {
    refreshPing(dt);
    refreshStats(dt);
    if (!world || pendingZone) return;
    const { dx, dy } = input.dir();
    const step = predictor.step(dx, dy, dt);
    if (step.send) send(step.send);

    const states = visibleEntities();
    world.entities.sync(states, dt);
    world.overlays.sync(states, (id) => world!.entities.headOf(id), store.youId);
    const me = states.find((e) => e.id === store.youId) ?? null;
    if (me) camera.follow(me.x, me.y);
    // The audio module rate-limits steps itself, so calling every moving frame is fine.
    if (me?.moving) footstep(groundNameAt(me.x, me.y));
    combatSfx.frame(states, me, performance.now());
    camera.update(dt);
    world.effects.update(dt, me ? { x: me.x, y: me.y } : null);
    updateHomeClock();
    world.doorHint.update(world.map, me);
    refreshCrops(dt);
  }
  const stopLoop = startLoop(game.app.ticker, frame);

  const onResize = () => camera.resize(game.width(), game.height());
  window.addEventListener("resize", onResize);
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
      rocks: () => (map()?.rocks ?? []).filter((r) => !store.brokenRocks.has(r.id)),
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
      stopLoop();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onEatKey);
      homeUi.destroy();
      visitsUi.destroy();
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
