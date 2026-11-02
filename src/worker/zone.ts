// ZoneRoom Durable Object: one per shared map (idFromName(zoneId): village, riverside, caves and each
// building interior "int_*"). Interiors are ordinary shared zones with no monsters or rocks.
// Authoritative tick loop, players, NPCs, monsters, rocks, shops, goals.
//
// Players are loaded from / saved to their HomeRoom (lease rules in home.ts). Inventory changes
// are applied synchronously and saved right away; position/hp are saved every 5 s when dirty
// and on leave. Guests (H_GUEST=1) are refused with close code 4401.
import { DurableObject } from "cloudflare:workers";
import { devToolsEnabled, H_COPY, H_ZONE, type Env } from "./env";
import type { PlayerSave } from "./home";
import { bumpStat, cleanStats, type PlayerStats } from "../shared/players";
import { decodeClient, type ClientMsg, type ImpactStamp, type ServerMsg, type VillageGoal } from "../shared/protocol";
import { cleanChat, safeSpawnName } from "../shared/validate";
import { getItem } from "../shared/items";
import { getMap } from "../shared/maps";
import {
  isCaveDepthZone,
  SHARED_ZONES,
  TICK_MS,
  type EntityState,
  type Inventory,
  type Look,
  type MapData,
  type MapExit,
  type RockOre,
  type SharedZoneId,
  type ZoneId,
} from "../shared/types";
import { mergeLoot, rollKillDrop } from "../shared/engine/mapDrops";
import { noteCaveArrival, sanitizeCaveTrail, type CaveTrail } from "../shared/caveLevels";
import {
  addItem,
  buildCollision,
  canAdd,
  canStand,
  clampStamina,
  dist,
  exitAt,
  facingToTile,
  hurtAmount,
  impactDelayMs,
  KNOCKBACK_HALF_LIFE_MS,
  MAX_STAMINA,
  passOutPenalty,
  PLAYER_IFRAME_MS,
  moveSlot,
  removeFromSlot,
  rockRand,
  rollMonsterDrops,
  staminaCost,
  type CollisionGrid,
} from "../shared/engine";
import { GroundItems, giveOrDrop, viewOf, visibleToUser, type GroundItem } from "./game/groundItems";
import { ForageGrower } from "./game/forage";
import { FORAGE_REACH, GROUND_TARGET_PREFIX } from "../shared/spawns";
import { HOME_FAINT_SPAWN } from "../shared/maps/home";
import { canChangeLook, savedLook, shownLook } from "./game/look";
import { entityIdFor, readAttachment, readIdentity, type SocketAttachment } from "./game/identity";
import { cloneInventory, clampHp, isZoneId, sanitizeInventory } from "./game/sanitize";
import { ChatGuards } from "./game/chat";
import { HOME_COMMAND_NOTICE, parseHomeCommand } from "../shared/visits";
import { reportPresence } from "./social/hooks";
import { Throttle } from "./throttle";
import { EMOTE_MIN_INTERVAL_MS } from "../shared/emotes";
import { Motion } from "./game/motion";
import { CoalescingSaver, SaveDebouncer, type SaveOutcome } from "./game/saver";
import { CLOSE_ABUSE, SocketLimiter } from "./game/rateLimit";
import { arrivedFrom, resolveSpawn, routeExit, transferHonoured } from "./game/spawn";
import { CLOSE_SESSION_ENDED, recheckDue, sessionStillValid } from "./game/session";
import { timeout } from "./game/timeout";
import { stripControls } from "./npc/text";
import { scheduleHour } from "../shared/npcSchedule";
import { EntityDiffer } from "./game/diff";
import { applyHeld } from "./game/held";
import { AIMED_REACH, MonsterPool, strikeTargets } from "./game/monsterPool";
import type { MonsterState } from "../shared/engine/monsters";
import { INTERACT_TEXT, NpcRunner, type NpcHost } from "./game/npcRunner";
import { agentMind } from "./npc/think/client";
import { isSitting, SeatBook, sitDown, standSpots, standUp } from "./game/seats";
import { SEAT_FACING } from "../shared/maps/interiors/props";
import { RockField } from "./game/rockField";
import { ChestField, isRareLoot, rollChestLoot } from "./game/chestField";
import { CHEST_REACH, CHEST_TARGET_PREFIX } from "../shared/chests";
import { bondChat, bondGift, bondGiftRefusal, bondHearts, bondList, bondReset, bondTalk, npcName, type BondOutcome } from "./game/bonds";
import { CONVO_RANGE, type ChatVerdict } from "../shared/npcChat";
import { giftLine } from "./npc/giftTables";
import { giftTaste, isNpcId } from "./npc/bible";
import { heartCurve, MAX_HEARTS, newBond, sanitizeBonds, type Bonds } from "../shared/hearts";
import { rockDrops } from "./game/rocks";
import { parseDropRates, type DropRates } from "../shared/engine/dropRate";
import { TreeField } from "./game/treeField";
import {
  classifyTarget,
  facingToward,
  HitTracker,
  hitsNeeded,
  isSwingTool,
  resolveToolUse,
  rollDrops,
  STUMP_RULE,
  toolKeyOf,
  TREE_RULES,
  weaponStats,
  type ToolKey,
  type ToolTarget,
  type WeaponStats,
} from "../shared/engine/toolRules";
import { endPose, POSE_ACT, POSE_MIN_INTERVAL_MS, poseRefusal, witnesses, type PoseCode } from "../shared/poses";
import { TRAVEL_SPAWN, travelBlock, type TravelZone } from "../shared/travel";
import { capFromEnv, copyName, FULL_HEADER, FULL_STATUS, hasRoom, isCopyNumber, parseCopy } from "../shared/zoneCopies";
import { PlayerInterest } from "./game/interest";
import { scoldLine } from "./npc/scold";
import { boulderAt, nextWrongToolStreak, wrongToolCost, wrongToolNotice, type WrongToolStreak } from "../shared/engine/wrongTool";
import { buyFrom, sellTo, shopToday } from "./game/shop";
import { donate, GOAL_DEFS, goalsView, sanitizeProgress, type GoalProgress } from "./game/goals";
import { regen } from "./game/vitals";
import { distToRect, inToolReach, NPC_CHAT_RANGE, NPC_TALK_RANGE, PROP_REACH, SHOP_RANGE } from "./game/range";
import {
  closeQuietly,
  CLOSE_GUEST,
  CLOSE_IDLE,
  CLOSE_LEASE_LOST,
  CLOSE_REPLACED,
  IDLE_TIMEOUT_MS,
  isWebSocketUpgrade,
  refuseSocket,
  send,
} from "./game/net";

const SAVE_EVERY_MS = 5000;
const BAG_FULL_NOTICE_MS = 30_000;
const USE_COOLDOWN_MS = 250;
const SHOP_DEDUP_MS = 1500;
/** One gift per NPC per player this often (the item is gone either way; this stops spam). */
const GIFT_NPC_COOLDOWN_MS = 5000;
/** Rebuilding players after a wake must not stall the zone on one slow HomeRoom. */
const LOAD_TIMEOUT_MS = 5000;
/** Riverside/caves show the village goals from a short-lived copy instead of an RPC per click. */
const GOALS_CACHE_MS = 5000;
/** Village side: remembered donation request ids, so a retried RPC is counted once. */
const DONATION_IDS_MAX = 1000;
/** Treasure chests per zone (only the caves have any). */
const CHESTS_PER_ZONE: Partial<Record<SharedZoneId, number>> = { caves: 4 };

/** Deeper cave levels roll the caves' own kill drops (gems, seeds) before their map's extras. */
const dropZoneOf = (zone: SharedZoneId): string => (isCaveDepthZone(zone) ? "caves" : zone);

interface ZPlayer {
  ws: WebSocket;
  userId: string;
  name: string;
  sprite: string;
  /** The save's chosen look (undefined until picked); entity.look falls back to the default. */
  look: Look | undefined;
  lastLook: number;
  /** Selected hotbar slot (the `hold` intent); its tool shows in the hand as entity.held. */
  heldSlot: number | null;
  maxHp: number;
  lease: string;
  entity: EntityState;
  inv: Inventory;
  /** Lifetime counters (player card); saved with the inventory. */
  stats: PlayerStats;
  motion: Motion;
  saver: CoalescingSaver<PlayerSave>;
  saveSoon: SaveDebouncer;
  limiter: SocketLimiter;
  /** Last message other than ping (AFK timeout). */
  lastInput: number;
  sid: string | null;
  authCheckedAt: number;
  /** Set while a cross-zone donation is in flight: exits wait and the final save waits for it. */
  donation: Promise<void> | null;
  dirty: boolean;
  lastUse: number;
  /** Last /sleep or /piss (ms), to throttle them. */
  lastPose?: number;
  lastTravel?: number;
  /** Wrong-tool hits in a row (axe on a rock...): each one tires you more. */
  wrongTool?: WrongToolStreak;
  lastHurt: number;
  lastRegen: number;
  /** No monster can hurt them before this (after each hit). */
  iframeUntil: number;
  /** Tool stamina, carried from the home save (mining and chopping cost it here too). */
  stamina: number;
  /** While seated: where the player stood before sitting (they get up there). */
  standBack?: { x: number; y: number };
  lastAck: number | undefined;
  /** Near changes every tick, far ones batched (game/interest.ts). */
  interest: PlayerInterest;
  lastShop: Map<string, number>;
  /** Friendship with each villager (saved with the player). */
  bonds: Bonds;
  /** Cave levels: the map above each one this player came down from (a shared way up returns there). */
  caveTrail: CaveTrail;
}

interface World {
  zone: SharedZoneId;
  map: MapData;
  grid: CollisionGrid;
  rocks: RockField;
  trees: TreeField;
  /** Hit progress on rocks, trees and stumps. */
  hits: HitTracker;
  monsters: MonsterPool;
  npcs: NpcRunner;
  seats: SeatBook;
  chests: ChestField | null;
  /** Overflow loot and forage lying around. */
  ground: GroundItems;
  forage: ForageGrower | null;
}

/** A knockback velocity as the total slide it makes (tiles), for clients to play at once. */
function slideOf(kb: { vx: number; vy: number }): { x: number; y: number } {
  const k = KNOCKBACK_HALF_LIFE_MS / Math.LN2;
  return { x: Math.round(kb.vx * k * 1000) / 1000, y: Math.round(kb.vy * k * 1000) / 1000 };
}

const isSharedZone = (z: unknown): z is SharedZoneId => (SHARED_ZONES as unknown[]).includes(z);

export class ZoneRoom extends DurableObject<Env> {
  private world: World | null = null;
  /** Which copy of the zone this object runs (shared/zoneCopies.ts); 1 is the original. */
  private copy = 1;
  /** Joins still loading their save: they count against ZONE_CAP too. */
  private joining = 0;
  /** Ticks since the loop started, and the next player's far-flush phase. */
  private tickNo = 0;
  private nextPhase = 0;
  private players = new Map<WebSocket, ZPlayer>();
  private differ = new EntityDiffer();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastSave = 0;
  private goals: GoalProgress = {};
  private goalsLoaded = false;
  private goalsCache: { at: number; goals: VillageGoal[] } | null = null;
  private donationIds = new Map<string, number>();
  private chatGuards = new ChatGuards();
  private emotes = new Throttle(EMOTE_MIN_INTERVAL_MS);
  /** The "bag full, loot on the ground" notice once in a while, not on every kill. */
  private bagFullNotes = new Throttle(BAG_FULL_NOTICE_MS);

  /** Drop-rate multipliers from env (DROP_RATE*), read once per instance. */
  private readonly rates: DropRates;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.rates = parseDropRates(env as unknown as Record<string, unknown>);
    ctx.blockConcurrencyWhile(async () => {
      const zone = await ctx.storage.get<string>("zone");
      const copy = await ctx.storage.get<number>("copy");
      if (isCopyNumber(copy)) this.copy = copy;
      if (isSharedZone(zone)) await this.initWorld(zone);
      await this.loadGoals();
      // Woken from hibernation (or evicted): rebuild players from the sockets that survived,
      // loading them in parallel and giving up on any HomeRoom that doesn't answer in time.
      const survivors: { ws: WebSocket; att: SocketAttachment }[] = [];
      for (const ws of ctx.getWebSockets()) {
        const att = readAttachment(ws);
        if (!att || !this.world || att.guest) closeQuietly(ws, CLOSE_GUEST, "reconnect");
        else survivors.push({ ws, att });
      }
      const loads = await Promise.allSettled(
        survivors.map(({ att }) => timeout(this.home(att.userId).loadPlayer(att.userId, att.name), LOAD_TIMEOUT_MS)),
      );
      loads.forEach((r, i) => {
        const { ws, att } = survivors[i];
        if (r.status === "rejected") return closeQuietly(ws, 1011, "load failed");
        // authCheckedAt 0: re-check the session on the first message after the wake.
        this.addPlayer(ws, att, r.value, att.x !== undefined && att.y !== undefined ? { x: att.x, y: att.y } : null, 0);
      });
      if (this.players.size > 0) this.startTick();
    });
  }

  // ------------------------------------------------------------------ setup

  private async initWorld(zone: SharedZoneId): Promise<void> {
    const map = getMap(zone);
    const rocks = new RockField(map, zone, this.rates);
    const unbroken = rocks.load(await this.ctx.storage.get<Record<string, number>>("rocks"), await this.ctx.storage.get("rockSpawns"));
    const grid = buildCollision(map, { rocks: unbroken });
    const trees = new TreeField(map);
    trees.load(await this.ctx.storage.get("trees"));
    trees.applyTo(grid);
    const rand = Math.random;
    const host: NpcHost = {
      players: () => this.playerEntities(),
      others: () => [...this.world!.monsters.alive()],
      chat: (from, text, to) => this.broadcast({ t: "chat", from: from.id, name: from.name, text, at: Date.now(), ...(to ? { to } : {}) }),
      openShop: (entityId, npcId) => {
        const p = this.playerByEntity(entityId);
        if (p) this.sendShop(p, npcId);
      },
      give: (entityId, item, qty) => {
        const p = this.playerByEntity(entityId);
        if (!p || !canAdd(p.inv, item, qty)) return false;
        addItem(p.inv, item, qty);
        this.inventoryChanged(p, `+${qty} ${getItem(item)?.name ?? item}`);
        return true;
      },
      worldFacts: () => this.worldFacts(),
      notice: (entityId, text) => {
        const p = this.playerByEntity(entityId);
        if (p) send(p.ws, { t: "notice", text, kind: "info" });
      },
      hearts: (userId, npcId) => {
        for (const p of this.players.values()) if (p.userId === userId) return bondHearts(p.bonds, npcId, Date.now());
        return 0;
      },
      judged: (entityId, npcId, verdict) => this.onJudged(entityId, npcId, verdict),
    };
    const seats = new SeatBook(map.seats ?? []);
    const chestCount = CHESTS_PER_ZONE[zone] ?? map.chests ?? 0;
    const chests = chestCount > 0 ? new ChestField(map, chestCount) : null;
    chests?.load(await this.ctx.storage.get("chests"), grid, rand);
    const npcs = new NpcRunner(map, grid, this.env, this.ctx.storage, host, rand, agentMind(this.env), seats);
    await npcs.load();
    if (devToolsEnabled(this.env)) {
      const offset = await this.ctx.storage.get<number>("devHourOffset");
      if (typeof offset === "number") npcs.setHourOffset(offset, Date.now());
    }
    const ground = new GroundItems();
    ground.load(await this.ctx.storage.get("ground"), Date.now());
    const forage = ForageGrower.forZone(zone, map, grid);
    const monsters = new MonsterPool(map, grid, rand, zone, Date.now());
    this.world = { zone, map, grid, rocks, trees, hits: new HitTracker(), monsters, npcs, seats, chests, ground, forage };
  }

  private async loadGoals(): Promise<void> {
    if (this.goalsLoaded) return;
    this.goals = sanitizeProgress(await this.ctx.storage.get("goals"));
    this.goalsLoaded = true;
  }

  private home(userId: string) {
    return this.env.HOME.get(this.env.HOME.idFromName(userId));
  }

  // ------------------------------------------------------------------ connect

  async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) return new Response("Expected WebSocket", { status: 426 });
    const id = readIdentity(request);
    if (!id) return new Response("Unauthorized", { status: 401 });
    if (id.guest) return refuseSocket(CLOSE_GUEST, "Create an account to leave home.");

    const zone = request.headers.get(H_ZONE);
    if (!this.world) {
      if (!isSharedZone(zone)) return new Response("Unknown zone", { status: 404 });
      const copy = parseCopy(request.headers.get(H_COPY)) ?? 1;
      this.copy = copy;
      await this.ctx.storage.put({ zone, copy });
      await this.initWorld(zone);
      // The original keeps a count of its copies so sign-out can reach every one.
      if (copy > 1) void this.original(zone).noteCopy(copy).catch(() => {});
    } else if (zone !== null && zone !== this.world.zone) {
      return new Response("Wrong zone", { status: 400 });
    }
    // Full: the Worker tries the next copy. Someone already here (a second tab) may still replace themselves.
    const here = [...this.players.values()].some((p) => p.userId === id.userId);
    if (!here && !hasRoom(this.players.size, this.joining, capFromEnv((this.env as unknown as Record<string, unknown>).ZONE_CAP))) {
      return new Response("Zone full", { status: FULL_STATUS, headers: { [FULL_HEADER]: "1" } });
    }

    let save: PlayerSave;
    this.joining++;
    try {
      save = await this.home(id.userId).loadPlayer(id.userId, id.name);
    } catch {
      return new Response("Could not load player", { status: 503 });
    } finally {
      this.joining--;
    }
    // A second tab replaces the first; the new lease already invalidated the old one.
    for (const p of [...this.players.values()]) {
      if (p.userId !== id.userId) continue;
      this.players.delete(p.ws);
      closeQuietly(p.ws, CLOSE_REPLACED, "Connected from another tab.");
    }

    const world = this.world!;
    // A named spawn is honoured only for the exit the player actually took (HomeRoom recorded
    // it); otherwise resume the saved position, so neither a reload nor a crafted URL teleports.
    const spawn = safeSpawnName(world.map.spawns, id.spawn);
    const transfer = save.transfer && "at" in save.transfer ? save.transfer : null;
    const at = resolveSpawn(world.map.spawns, world.zone, spawn, save, transfer, Date.now());
    const from = arrivedFrom(spawn, transferHonoured(world.map.spawns, world.zone, spawn, transfer, Date.now()), isZoneId);

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const att: SocketAttachment = {
      userId: id.userId,
      name: save.name || id.name,
      entityId: entityIdFor(id.userId),
      guest: false,
      ...(id.sessionId ? { sid: id.sessionId } : {}),
    };
    server.serializeAttachment(att);
    const p = this.addPlayer(server, att, save, at, Date.now());
    const trail = noteCaveArrival(p.caveTrail, world.zone, from);
    if (trail !== p.caveTrail) {
      p.caveTrail = trail;
      p.saveSoon.schedule();
    }
    reportPresence(this.env, p.userId, world.zone, true);
    send(server, {
      t: "welcome",
      ...(this.copy > 1 ? { copy: this.copy } : {}),
      zone: world.zone,
      you: p.entity.id,
      entities: this.allEntities(),
      inventory: p.inv,
      brokenRocks: world.rocks.brokenIds(),
      rockOres: world.rocks.oreOverrides(),
      trees: world.trees.stages(),
      goals: goalsView(this.goals),
      needsLook: !p.look,
      bonds: bondList(p.bonds, Date.now()),
      ...(world.chests ? { chests: world.chests.views(p.userId) } : {}),
      ground: world.ground.visibleTo(p.userId),
      ...(devToolsEnabled(this.env) ? { devTools: true } : {}),
      serverTime: Date.now(),
    });
    this.sendStamina(p);
    this.deliverInvites(p);
    this.startTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  private addPlayer(
    ws: WebSocket,
    att: SocketAttachment,
    save: PlayerSave,
    at: { x: number; y: number } | null,
    authCheckedAt: number,
  ): ZPlayer {
    const world = this.world!;
    const pos = at && canStand(world.grid, at.x, at.y) ? at : world.map.spawns.default;
    const maxHp = save.maxHp > 0 ? save.maxHp : 100;
    const p: ZPlayer = {
      ws,
      userId: att.userId,
      name: save.name || att.name,
      sprite: save.sprite,
      look: savedLook(save.look),
      lastLook: 0,
      heldSlot: null,
      maxHp,
      lease: save.lease ?? "",
      entity: {
        id: att.entityId,
        kind: "player",
        name: save.name || att.name,
        sprite: save.sprite,
        x: pos.x,
        y: pos.y,
        facing: "down",
        moving: false,
        hp: clampHp(save.hp, maxHp),
        maxHp,
        look: shownLook(save.look),
      },
      inv: sanitizeInventory(save.inventory),
      stats: cleanStats(save.stats),
      motion: new Motion(),
      saver: new CoalescingSaver<PlayerSave>(async (s) => (await this.home(s.userId).savePlayer(s)) !== false),
      saveSoon: new SaveDebouncer(() => {
        if (this.players.get(ws) === p) void this.save(p);
      }),
      limiter: new SocketLimiter(Date.now()),
      lastInput: Date.now(),
      sid: att.sid ?? null,
      authCheckedAt,
      donation: null,
      dirty: false,
      lastUse: 0,
      lastHurt: 0,
      lastRegen: 0,
      iframeUntil: 0,
      stamina: clampStamina(save.stamina),
      lastAck: undefined,
      interest: new PlayerInterest(this.nextPhase++),
      lastShop: new Map(),
      bonds: sanitizeBonds(save.bonds),
      caveTrail: sanitizeCaveTrail(save.caveTrail),
    };
    this.players.set(ws, p);
    return p;
  }

  // ------------------------------------------------------------------ socket events

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const p = this.players.get(ws);
    if (!p || typeof message !== "string") return;
    const now = Date.now();
    const verdict = p.limiter.check(now);
    if (verdict === "close") return this.kick(p, CLOSE_ABUSE, "Too many messages.");
    const msg = decodeClient(message);
    if (!msg) return;
    if (verdict === "reject") return this.reject(p, msg, "Slow down a little.");
    if (verdict === "drop") return;
    if (msg.t !== "ping") p.lastInput = now;
    this.maybeRecheckSession(p, now);
    this.handle(p, msg, now);
  }

  /** Re-validates the session every few minutes; a revoked one ends the socket. */
  private maybeRecheckSession(p: ZPlayer, now: number): void {
    if (!p.sid || !recheckDue(p.authCheckedAt, now)) return;
    p.authCheckedAt = now;
    void sessionStillValid(this.env, p.sid, p.userId, now).then((ok) => {
      if (!ok) this.kick(p, CLOSE_SESSION_ENDED, "Your session ended. Please sign in again.");
    });
  }

  /** RPC (sign-out hook): close this session's socket, if it is in this zone. */
  /** RPC (on the original): a copy of this zone exists; remembers the highest copy number. */
  async noteCopy(n: number): Promise<void> {
    if (!isCopyNumber(n)) return;
    const known = (await this.ctx.storage.get<number>("copies")) ?? 1;
    if (n > known) await this.ctx.storage.put("copies", n);
  }

  /** RPC (on the original): how many copies of this zone have ever run (at least 1). */
  async copies(): Promise<number> {
    const n = await this.ctx.storage.get<number>("copies");
    return isCopyNumber(n) ? n : 1;
  }

  private original(zone: string) {
    return this.env.ZONE.get(this.env.ZONE.idFromName(copyName(zone, 1)));
  }

  /** Village goals live in the original village only; copies read and donate through it. */
  private holdsGoals(): boolean {
    return this.world?.zone === "village" && this.copy === 1;
  }

  async closeSession(userId: string, sessionId: string): Promise<void> {
    if (!sessionId) return;
    for (const p of [...this.players.values()]) {
      if (p.userId === userId && p.sid === sessionId) this.kick(p, CLOSE_SESSION_ENDED, "You signed out.");
    }
  }

  /** Removes a player, tells them why, closes the socket and saves them (after any donation). */
  private kick(p: ZPlayer, code: number, reason: string): void {
    if (this.players.get(p.ws) !== p) return;
    this.players.delete(p.ws);
    if (this.players.size === 0) this.stopTick();
    this.left(p);
    send(p.ws, { t: "notice", text: reason, kind: "error" });
    closeQuietly(p.ws, code, reason);
    void this.finalSave(p);
  }

  private async finalSave(p: ZPlayer): Promise<void> {
    if (p.donation) await p.donation;
    p.saveSoon.cancel();
    await p.saver.request(() => this.snapshot(p));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  private async leave(ws: WebSocket): Promise<void> {
    const p = this.players.get(ws);
    if (!p) return;
    this.players.delete(ws);
    if (this.players.size === 0) this.stopTick();
    this.left(p);
    await this.finalSave(p);
  }

  /** Tells SocialRoom (presence) and forgets per-player throttles. */
  private left(p: ZPlayer): void {
    this.emotes.drop(p.userId);
    this.bagFullNotes.drop(p.userId);
    if (this.world) reportPresence(this.env, p.userId, this.world.zone, false);
  }

  // ------------------------------------------------------------------ tick

  private startTick(): void {
    if (this.timer || this.players.size === 0) return;
    this.lastTick = Date.now();
    this.lastSave = this.lastTick;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTick(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const world = this.world;
    if (!world || this.players.size === 0) return this.stopTick();
    const now = Date.now();
    const dt = Math.min(250, Math.max(0, now - this.lastTick));
    this.lastTick = now;

    const acks = new Map<ZPlayer, number | undefined>();
    for (const p of [...this.players.values()]) {
      if (now - p.lastInput > IDLE_TIMEOUT_MS) {
        this.kick(p, CLOSE_IDLE, "idle");
        continue;
      }
      acks.set(p, p.motion.step(p.entity, world.grid, now));
      if (p.motion.takeMoved()) p.dirty = true;
      const exit = exitAt(world.map, p.entity.x, p.entity.y);
      // A donation in flight finishes first (its refund must land in this zone's save).
      if (exit && !p.donation) void this.takeExit(p, exit);
    }
    if (this.players.size === 0) return;

    for (const hit of world.monsters.tick(this.playerEntities(), dt, now)) {
      const p = this.playerByEntity(hit.playerId);
      if (p) this.hurt(p, hit.damage, now);
    }
    this.tickGround(now);
    for (const p of this.players.values()) {
      if (regen(p.entity, now, p.lastHurt, p.lastRegen)) {
        p.lastRegen = now;
        p.dirty = true;
      }
    }

    world.npcs.tick(dt, now);
    world.seats.retain(new Set(this.allEntities().map((e) => e.id)));

    if (world.chests?.respawnDue(world.grid, now, this.allEntities(), Math.random)) {
      void this.ctx.storage.put("chests", world.chests.record());
      for (const p of this.players.values()) send(p.ws, { t: "chests", chests: world.chests.views(p.userId) });
    }

    const restored = world.rocks.respawnDue(world.grid, now, this.allEntities());
    if (restored.length > 0) {
      for (const id of restored) {
        const rock = world.rocks.byId(id);
        this.broadcast({ t: "rock", id, broken: false, ...(rock ? { ore: rock.ore } : {}) });
      }
      void this.ctx.storage.put("rocks", world.rocks.record());
    }
    const regrown = world.trees.regrowDue(world.grid, now, this.allEntities());
    if (regrown.length > 0) {
      for (const id of regrown) this.broadcast({ t: "tree", id, stage: "tree", hits: 0 });
      void this.ctx.storage.put("trees", world.trees.record());
    }

    const all = this.differ.diff(this.allEntities());
    const tickNo = this.tickNo++;
    for (const p of this.players.values()) {
      const ack = acks.get(p);
      const { upd, del } = p.interest.filter(all.upd, all.del, p.entity, tickNo);
      if (upd.length === 0 && del.length === 0 && ack === p.lastAck) continue;
      p.lastAck = ack;
      const msg: ServerMsg = { t: "tick", at: now, upd, del };
      if (ack !== undefined) {
        msg.ack = ack;
        msg.ackMs = p.motion.ackMs(now);
      }
      send(p.ws, msg);
    }

    if (now - this.lastSave >= SAVE_EVERY_MS) {
      this.lastSave = now;
      for (const p of this.players.values()) if (p.dirty) this.save(p);
    }
  }

  /** A monster's bite: ignored while the player is still invincible from the last one. */
  private hurt(p: ZPlayer, damage: number, now: number): void {
    if (now < p.iframeUntil || this.players.get(p.ws) !== p) return;
    const max = p.entity.maxHp ?? p.maxHp;
    const dmg = hurtAmount(damage, Math.random);
    p.iframeUntil = now + PLAYER_IFRAME_MS;
    p.lastHurt = now;
    p.dirty = true;
    p.entity.hp = Math.max(0, (p.entity.hp ?? max) - dmg);
    this.broadcast({ t: "hurt", id: p.entity.id, dmg, ms: PLAYER_IFRAME_MS });
    if (p.entity.hp <= 0) this.faint(p);
  }

  /**
   * Out cold: a tenth of the coins (at most 100) is gone and the player wakes up at home in bed,
   * healed. The trip home goes through the normal exit path so the save lands first.
   */
  private faint(p: ZPlayer): void {
    const lost = passOutPenalty(p.inv.coins);
    p.inv.coins -= lost;
    p.entity.hp = p.entity.maxHp ?? p.maxHp;
    send(p.ws, { t: "inventory", inventory: p.inv });
    send(p.ws, {
      t: "notice",
      text: lost > 0 ? `You fainted and lost ${lost} coins. Someone carried you home to bed.` : "You fainted. Someone carried you home to bed.",
      kind: "error",
    });
    void this.takeExit(p, { x: 0, y: 0, w: 0, h: 0, to: "home", spawn: HOME_FAINT_SPAWN });
  }

  private sendStamina(p: ZPlayer): void {
    send(p.ws, { t: "stamina", stamina: p.stamina, max: MAX_STAMINA });
  }

  /** Mining and chopping cost stamina like at home; false (and a reject) when too tired. */
  private spendStamina(p: ZPlayer, msg: ClientMsg, tool: Parameters<typeof staminaCost>[0]): boolean {
    const cost = staminaCost(tool);
    if (cost <= 0) return true;
    if (p.stamina < cost) {
      this.reject(p, msg, "You're too tired. Eat something or go home to bed.");
      return false;
    }
    p.stamina -= cost;
    p.dirty = true;
    this.sendStamina(p);
    return true;
  }

  // ------------------------------------------------------------------ ground items

  /** Walk-over pickup of your own drops, expiry, and the forage top-up. */
  private tickGround(now: number): void {
    const world = this.world!;
    let changed = false;
    for (const p of this.players.values()) {
      for (const g of world.ground.ownedNear(p.userId, p.entity)) {
        if (!addItem(p.inv, g.item, g.qty)) continue;
        world.ground.take(g.id);
        changed = true;
        this.groundGone(g);
        this.inventoryChanged(p, `+${g.qty} ${getItem(g.item)?.name ?? g.item}`);
      }
    }
    for (const g of world.ground.expire(now)) {
      changed = true;
      this.groundGone(g);
    }
    if (world.forage) {
      const grown = world.forage.refill(world.ground, this.playerEntities(), now, Math.random, this.rates);
      for (const g of grown) this.groundAdded(g);
      if (grown.length > 0) changed = true;
    }
    if (changed) this.saveGround();
  }

  private saveGround(): void {
    void this.ctx.storage.put("ground", this.world!.ground.record());
  }

  /** Tells whoever can see `g` that it appeared. */
  private groundAdded(g: GroundItem): void {
    for (const p of this.players.values()) if (visibleToUser(g, p.userId)) send(p.ws, { t: "ground", upd: [viewOf(g)], del: [] });
  }

  private groundGone(g: GroundItem): void {
    for (const p of this.players.values()) if (visibleToUser(g, p.userId)) send(p.ws, { t: "ground", upd: [], del: [g.id] });
  }

  /**
   * Loot for `p`: into the bag, and what doesn't fit onto the ground at `at` (theirs for a few
   * minutes). Returns the loot line for the notice.
   */
  private grantLoot(p: ZPlayer, items: readonly { item: string; qty: number }[], at: { x: number; y: number }, now: number): string {
    const { given, dropped } = giveOrDrop(p.inv, this.world!.ground, p.userId, items, at, now, Math.random);
    for (const g of dropped) this.groundAdded(g);
    if (dropped.length > 0) {
      this.saveGround();
      if (this.bagFullNotes.allow(p.userId, now)) send(p.ws, { t: "notice", text: "Your bag is full, so some loot dropped on the ground. Walk over it once you've made room.", kind: "info" });
    }
    return given.map((d) => `+${d.qty} ${getItem(d.item)?.name ?? d.item}`).join(", ");
  }

  /** Interact on forage: first come, first served. */
  private onForage(p: ZPlayer, id: string): void {
    const world = this.world!;
    const g = world.ground.get(id);
    if (!g || g.owner !== null) return;
    if (dist(p.entity, g) > FORAGE_REACH) return send(p.ws, { t: "notice", text: "Walk a little closer.", kind: "info" });
    if (!canAdd(p.inv, g.item, g.qty)) return send(p.ws, { t: "notice", text: "Your bag is full.", kind: "error" });
    world.ground.take(id);
    addItem(p.inv, g.item, g.qty);
    this.groundGone(g);
    this.saveGround();
    send(p.ws, { t: "loot", at: { x: g.x, y: g.y }, items: [g.item] });
    this.inventoryChanged(p, `+${g.qty} ${getItem(g.item)?.name ?? g.item}`);
  }

  // ------------------------------------------------------------------ entities & messaging

  private playerEntities(): EntityState[] {
    return [...this.players.values()].map((p) => p.entity);
  }

  private allEntities(): EntityState[] {
    const w = this.world;
    if (!w) return [];
    return [...this.playerEntities(), ...w.npcs.entities(), ...w.monsters.alive()];
  }

  private playerByEntity(id: string): ZPlayer | undefined {
    for (const p of this.players.values()) if (p.entity.id === id) return p;
    return undefined;
  }

  private broadcast(msg: ServerMsg): void {
    for (const p of this.players.values()) send(p.ws, msg);
  }

  private reject(p: ZPlayer, msg: ClientMsg, reason: string): void {
    const r: ServerMsg = { t: "reject", action: msg.t, reason };
    if ("req" in msg && msg.req !== undefined) r.req = msg.req;
    send(p.ws, r);
  }

  // ------------------------------------------------------------------ persistence

  private snapshot(p: ZPlayer, override?: Partial<PlayerSave>): PlayerSave {
    return {
      userId: p.userId,
      name: p.name,
      inventory: cloneInventory(p.inv),
      hp: p.entity.hp ?? p.maxHp,
      maxHp: p.maxHp,
      sprite: p.sprite,
      zone: this.world?.zone,
      // Seated players are inside a chair tile: save where they'll stand up instead.
      x: isSitting(p.entity) && p.standBack ? p.standBack.x : p.entity.x,
      y: isSitting(p.entity) && p.standBack ? p.standBack.y : p.entity.y,
      lease: p.lease,
      stamina: p.stamina,
      stats: { ...p.stats },
      bonds: p.bonds,
      caveTrail: p.caveTrail,
      ...(p.look ? { look: p.look } : {}),
      ...override,
    };
  }

  private save(p: ZPlayer, override?: Partial<PlayerSave>): Promise<SaveOutcome> {
    p.saveSoon.cancel();
    p.dirty = false;
    try {
      const att = readAttachment(p.ws);
      if (att) p.ws.serializeAttachment({ ...att, x: p.entity.x, y: p.entity.y });
    } catch {
      // socket gone
    }
    const done = p.saver.request(() => this.snapshot(p, override));
    void done.then((o) => {
      if (o === "stale") this.leaseLost(p);
      else if (o === "error") p.dirty = true;
    });
    return done;
  }

  /** Another session (home or another zone) took over this player's save: drop this one. */
  private leaseLost(p: ZPlayer): void {
    if (this.players.get(p.ws) !== p) return;
    this.players.delete(p.ws);
    p.saveSoon.cancel();
    send(p.ws, { t: "notice", text: "You are playing somewhere else now.", kind: "error" });
    closeQuietly(p.ws, CLOSE_LEASE_LOST, "Session moved.");
    if (this.players.size === 0) this.stopTick();
  }

  private inventoryChanged(p: ZPlayer, loot?: string): void {
    applyHeld(p.entity, p.inv, p.heldSlot);
    send(p.ws, { t: "inventory", inventory: p.inv });
    if (loot) send(p.ws, { t: "notice", text: loot, kind: "loot" });
    // Bursts (mining, selling a stack, loot) coalesce into one HomeRoom call.
    p.saveSoon.schedule();
  }

  private async takeExit(p: ZPlayer, taken: MapExit): Promise<void> {
    if (this.players.get(p.ws) !== p) return;
    const above = p.caveTrail[this.world!.zone];
    const exit = routeExit(taken, this.world!.zone, isZoneId(above) ? above : undefined);
    // Out of the zone at once (entity disappears next tick), but keep the socket until saved.
    this.players.delete(p.ws);
    if (this.players.size === 0) this.stopTick();
    p.motion.stop();
    p.saveSoon.cancel();
    const dest = getMap(exit.to);
    const spawn = safeSpawnName(dest.spawns, exit.spawn);
    const pos = dest.spawns[spawn];
    const snap = () => this.snapshot(p, { zone: exit.to, x: pos.x, y: pos.y, transfer: { to: exit.to, spawn } });
    let outcome = await p.saver.request(snap);
    if (outcome === "error") outcome = await p.saver.request(snap);
    if (outcome === "stale") return closeQuietly(p.ws, CLOSE_LEASE_LOST, "Session moved.");
    send(p.ws, { t: "zone", to: exit.to, spawn });
    closeQuietly(p.ws, 1000, "zone change");
  }

  // ------------------------------------------------------------------ client messages

  private handle(p: ZPlayer, msg: ClientMsg, now: number): void {
    const world = this.world!;
    switch (msg.t) {
      case "move":
        if (msg.dx !== 0 || msg.dy !== 0) this.getUp(p);
        p.motion.onMove(p.entity, world.grid, msg.dx, msg.dy, msg.seq, now);
        return;
      case "moveTo":
        this.getUp(p);
        if (!p.motion.onMoveTo(world.grid, p.entity, msg.x, msg.y, msg.seq, now)) this.reject(p, msg, "Can't walk there.");
        return;
      case "chat":
        return this.onChat(p, msg.text, now);
      case "npcSay":
        return this.onNpcSay(p, msg, now);
      case "use":
        this.getUp(p);
        return this.onUse(p, msg, now);
      case "interact":
        return this.onInteract(p, msg.target, now);
      case "buy":
        return this.onBuy(p, msg);
      case "sell":
        return this.onSell(p, msg);
      case "donate":
        return this.onDonate(p, msg);
      case "giftNpc":
        return this.onGiftNpc(p, msg, now);
      case "place":
      case "moveObject":
      case "pickup":
        return this.reject(p, msg, "You can only do that at home.");
      case "moveSlot":
        return this.onMoveSlot(p, msg);
      case "setLook":
        return this.onSetLook(p, msg, now);
      case "hold":
        p.heldSlot = msg.slot;
        applyHeld(p.entity, p.inv, p.heldSlot);
        return;
      case "pose":
        return this.onPose(p, msg.pose, now);
      case "travel":
        return this.onTravel(p, msg.to, now);
      case "emote":
        // Everyone here sees it; spam just gets dropped.
        if (this.emotes.allow(p.userId, now)) this.broadcast({ t: "emote", from: p.entity.id, code: msg.code });
        return;
      case "ping":
        send(p.ws, { t: "pong", at: msg.at, serverTime: now });
        return;
    }
  }

  private onMoveSlot(p: ZPlayer, msg: Extract<ClientMsg, { t: "moveSlot" }>): void {
    if (!moveSlot(p.inv, msg.from, msg.to, msg.qty)) {
      this.reject(p, msg, "Can't move that there.");
      // Resync: the client moved it optimistically.
      return send(p.ws, { t: "inventory", inventory: p.inv });
    }
    this.inventoryChanged(p);
  }

  /** Saved through the HomeRoom like inventory; everyone here sees it in the next tick's diff. */
  private onSetLook(p: ZPlayer, msg: Extract<ClientMsg, { t: "setLook" }>, now: number): void {
    if (!canChangeLook(p.lastLook, now)) return this.reject(p, msg, "Slow down a little.");
    p.lastLook = now;
    p.look = { ...msg.look };
    p.entity.look = p.look;
    this.save(p);
  }

  /** Home invitations that arrived while the player was away (or without a social socket). */
  private deliverInvites(p: ZPlayer): void {
    void this.home(p.userId)
      .pendingInvitesFor(p.userId)
      .then((invites) => {
        if (invites.length > 0 && this.players.get(p.ws) === p) send(p.ws, { t: "invites", invites });
      })
      .catch(() => {});
  }

  private onChat(p: ZPlayer, raw: string, now: number): void {
    const text = cleanChat(stripControls(raw));
    if (!text) return;
    const hourCmd = /^\/hour(?:\s+(\d{1,2}))?$/.exec(text);
    if (hourCmd && devToolsEnabled(this.env)) return void this.devSetHour(p, hourCmd[1], now);
    const heartsCmd = /^\/hearts\s+(\d{1,2})$/.exec(text);
    if (heartsCmd && devToolsEnabled(this.env)) return this.devSetHearts(p, Number(heartsCmd[1]));
    const warpCmd = /^\/warp\s+([a-z0-9_]{1,32})(?:\s+([a-z0-9_]{1,32}))?$/.exec(text);
    if (warpCmd && devToolsEnabled(this.env)) return this.devWarp(p, warpCmd[1]!, warpCmd[2]);
    // The client sends /invite, /kick and /uninvite over HTTP; never broadcast one that slips through.
    if (parseHomeCommand(text)) return send(p.ws, { t: "notice", text: HOME_COMMAND_NOTICE, kind: "error" });
    const guard = this.chatGuards.get(p.userId, now);
    const verdict = guard.check(text, now);
    if (verdict === "tooFast") return send(p.ws, { t: "reject", action: "chat", reason: "Slow down a little." });
    if (verdict === "muted") {
      const s = Math.ceil(guard.mutedFor(now) / 1000);
      return send(p.ws, { t: "notice", text: `You are muted for ${s}s (repeating yourself).`, kind: "error" });
    }
    this.broadcast({ t: "chat", from: p.entity.id, name: p.name, text, at: now });
    const npc = this.world!.npcs.nearest(p.entity, NPC_CHAT_RANGE);
    if (npc) {
      this.world!.npcs.talk(npc, { userId: p.userId, entityId: p.entity.id, name: p.name }, text, now);
      // Overheard zone chat: hearts move, but the conversation window opens only on interact.
      this.bondChanged(p, npc.entity, bondTalk(p.bonds, npc.id, p.inv, now, Math.random, this.rates), false);
    }
  }

  /**
   * A reply typed in the conversation window: said aloud like chat (same spam guard), answered
   * by that villager, and judged for hearts (onJudged) just before the answer.
   */
  private onNpcSay(p: ZPlayer, msg: Extract<ClientMsg, { t: "npcSay" }>, now: number): void {
    const text = cleanChat(stripControls(msg.text));
    if (!text) return;
    // Commands belong in the chat box; never say one aloud (home commands carry names).
    if (text.startsWith("/")) return this.reject(p, msg, "Type commands in the chat box.");
    const npc = this.world!.npcs.byEntityId(msg.npc);
    if (!npc || !npc.def) return this.reject(p, msg, "They aren't here any more.");
    if (dist(npc.entity, p.entity) > CONVO_RANGE) return this.reject(p, msg, "Walk a little closer.");
    const guard = this.chatGuards.get(p.userId, now);
    const verdict = guard.check(text, now);
    if (verdict === "tooFast") return this.reject(p, msg, "Slow down a little.");
    if (verdict === "muted") return this.reject(p, msg, `You are muted for ${Math.ceil(guard.mutedFor(now) / 1000)}s (repeating yourself).`);
    this.broadcast({ t: "chat", from: p.entity.id, name: p.name, text, at: now });
    this.world!.npcs.talk(npc, { userId: p.userId, entityId: p.entity.id, name: p.name }, text, now, { judge: true });
  }

  /** The villager made up their mind about a reply: move this player's hearts (if still here). */
  private onJudged(entityId: string, npcId: string, verdict: ChatVerdict): void {
    const p = this.playerByEntity(entityId);
    const npc = this.world?.npcs.byEntityId(npcId);
    if (!p || !npc) return;
    const now = Date.now();
    this.bondChanged(p, npc.entity, bondChat(p.bonds, npc.id, verdict, p.inv, now, Math.random, this.rates), false);
  }

  private onUse(p: ZPlayer, msg: Extract<ClientMsg, { t: "use" }>, now: number): void {
    if (now - p.lastUse < USE_COOLDOWN_MS) return this.reject(p, msg, "Too fast.");
    p.lastUse = now;
    const slot = p.inv.slots[msg.slot];
    const def = slot ? getItem(slot.item) : undefined;
    if (!def) return this.reject(p, msg, "Nothing in that slot.");
    const key = toolKeyOf(def.id);
    // A tool swings toward the tile whether or not it does anything there.
    if (isSwingTool(key)) {
      p.entity.facing = facingToward(p.entity, msg, p.entity.facing);
      p.entity.act = { k: key, at: now, item: def.id };
    }
    if (!inToolReach(p.entity, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    if (!isSwingTool(key)) p.entity.facing = facingToTile(p.entity, msg.x, msg.y);
    const world = this.world!;
    const weapon = weaponStats(def.id);
    // A sword sweeps the arc in front of you: everything in it is hit, whatever tile you aimed at.
    if (weapon?.arc && world.monsters.inArc(p.entity, p.entity.facing).length > 0) {
      return this.strikeAtImpact(p, weapon, null, key);
    }
    const aimed = world.monsters.targetAt(msg.x, msg.y);
    const monster = aimed && !weapon?.arc && dist(aimed, p.entity) <= AIMED_REACH ? aimed : null;
    const rock = world.rocks.at(msg.x, msg.y);
    const tree = world.trees.at(msg.x, msg.y);
    const target = classifyTarget(
      {
        monster: !!monster,
        rock: rock?.ore ?? null,
        tree: tree ? { stage: tree.stage, size: tree.size } : null,
        boulder: boulderAt(world.map.props, msg.x, msg.y),
      },
      now,
    );
    const out = resolveToolUse(key, target, { farm: false, power: def.power });
    if (!out.ok) {
      if (out.bounce) return this.wrongToolHit(p, msg, out.reason, key, now);
      if (out.reason) this.reject(p, msg, out.reason);
      return;
    }
    p.wrongTool = undefined;
    // Applied now; clients show it when the swing lands (see ImpactStamp).
    const stamp: ImpactStamp = { by: p.entity.id, impactAt: now + impactDelayMs(key, p.entity.facing) };
    if (out.effect === "hitMonster" && monster && weapon) return this.strikeAtImpact(p, weapon, monster.id, key);
    if (out.effect === "hitRock" && rock) {
      if (!this.spendStamina(p, msg, def.tool)) return;
      return this.mine(p, msg, rock, target, now, stamp);
    }
    if (out.effect === "hitTree" || out.effect === "hitStump") {
      if (!this.spendStamina(p, msg, def.tool)) return;
      return this.chop(p, msg, target, now, stamp);
    }
  }

  /**
   * /sleep lies down on the ground until you move; /piss stands and pees for a moment. Every
   * villager close enough to see the second one resets your hearts with them to zero, glares,
   * shows an angry emote and says so.
   */
  private onPose(p: ZPlayer, pose: PoseCode, now: number): void {
    if (now - (p.lastPose ?? 0) < POSE_MIN_INTERVAL_MS) return;
    const why = poseRefusal(p.entity, now);
    if (why) return send(p.ws, { t: "notice", text: why, kind: "error" });
    p.lastPose = now;
    p.entity.act = { k: POSE_ACT[pose], at: now };
    if (pose !== "pee") return;
    const world = this.world!;
    const present = world.npcs.present();
    const seen = witnesses(present.map((n) => ({ id: n.id, x: n.entity.x, y: n.entity.y })), p.entity);
    const roll = Math.random();
    const opener = () => roll;
    for (const [nth, id] of seen.entries()) {
      const n = present.find((x) => x.id === id);
      if (!n) continue;
      world.npcs.glareAt(n, p.entity, now);
      this.broadcast({ t: "emote", from: n.entity.id, code: "angry" });
      this.broadcast({ t: "chat", from: n.entity.id, name: n.entity.name, text: scoldLine(opener, nth), at: now });
      const out = bondReset(p.bonds, n.id, p.inv, now, Math.random, this.rates);
      if (out) {
        this.bondChanged(p, n.entity, out, false);
        if (out.heartsBefore > 0 || out.delta < 0) {
          send(p.ws, { t: "notice", text: `${n.entity.name} saw that. Your friendship is gone.`, kind: "error" });
        }
      }
    }
  }

  /** The tool rebounded: tire the player (more for each wrong hit in a row) and let others see it. */
  private wrongToolHit(p: ZPlayer, msg: Extract<ClientMsg, { t: "use" }>, reason: string, key: ToolKey, now: number): void {
    const streak = nextWrongToolStreak(p.wrongTool, now);
    p.wrongTool = streak;
    const cost = Math.min(p.stamina, wrongToolCost(streak.count));
    if (cost > 0) {
      p.stamina -= cost;
      p.dirty = true;
      this.sendStamina(p);
    }
    this.reject(p, msg, wrongToolNotice(reason, streak.count));
    const bounce: ServerMsg = { t: "bounce", x: msg.x, y: msg.y, by: p.entity.id, impactAt: now + impactDelayMs(key, p.entity.facing) };
    for (const o of this.players.values()) if (o !== p) send(o.ws, bounce);
  }

  private mine(
    p: ZPlayer,
    msg: Extract<ClientMsg, { t: "use" }>,
    rock: { id: string; x: number; y: number; ore: RockOre },
    target: ToolTarget,
    now: number,
    stamp: ImpactStamp,
  ): void {
    const world = this.world!;
    const need = hitsNeeded(target);
    const left = need - world.hits.progress(rock.id, now);
    void msg;
    const drops = left <= 1 ? rockDrops(rock.ore, rockRand(world.zone, rock.id, world.rocks.spawnOf(rock.id)), this.rates) : [];
    const hit = world.hits.hit(rock.id, need, now);
    if (!hit.done) return this.broadcast({ t: "rock", id: rock.id, broken: false, hits: hit.hits, need, ...stamp });
    bumpStat(p.stats, "oresMined");
    world.rocks.breakRock(rock, world.grid, now);
    void this.ctx.storage.put({ rocks: world.rocks.record(), rockSpawns: world.rocks.spawnRecord() });
    this.broadcast({ t: "rock", id: rock.id, broken: true, hits: hit.hits, need, drops: drops.map((d) => d.item), ...stamp });
    // A full bag no longer blocks the last hit: what doesn't fit waits on the ground.
    this.inventoryChanged(p, this.grantLoot(p, drops, { x: rock.x + 0.5, y: rock.y + 0.6 }, now));
  }

  /** An axe hit on a standing tree (fells it to a stump) or a stump (clears it). */
  private chop(p: ZPlayer, msg: Extract<ClientMsg, { t: "use" }>, target: ToolTarget, now: number, stamp: ImpactStamp): void {
    const world = this.world!;
    const found = world.trees.at(msg.x, msg.y);
    if (!found) return;
    const { tree, stage, size } = found;
    const need = hitsNeeded(target);
    const key = `${tree.id}:${stage}`;
    const left = need - world.hits.progress(key, now);
    const drops = left <= 1 ? rollDrops(stage === "tree" ? TREE_RULES[size].drops : STUMP_RULE.drops, Math.random, this.rates) : [];
    const hit = world.hits.hit(key, need, now);
    if (!hit.done) return this.broadcast({ t: "tree", id: tree.id, stage, hits: hit.hits, need, ...stamp });
    if (stage === "tree") world.trees.fell(tree, now);
    else world.trees.clearStump(tree, world.grid);
    void this.ctx.storage.put("trees", world.trees.record());
    const next = stage === "tree" ? "stump" : "gone";
    this.broadcast({ t: "tree", id: tree.id, stage: next, hits: hit.hits, need, drops: drops.map((d) => d.item), ...stamp });
    // Like rocks: a full bag doesn't stop the tree falling; the wood that doesn't fit waits on the ground.
    if (drops.length) this.inventoryChanged(p, this.grantLoot(p, drops, { x: tree.x + 0.5, y: tree.y + 1.1 }, now) || undefined);
  }

  /**
   * Lands a weapon swing at its impact frame (shared/engine/toolTiming.ts), not when the click
   * arrives: whoever is in the arc then (or the aimed monster, if still in reach) takes the hit,
   * so damage numbers, knockback and kills show as the tool comes down.
   */
  private strikeAtImpact(p: ZPlayer, weapon: WeaponStats, aimedId: string | null, key: string): void {
    const facing = p.entity.facing;
    const land = () => {
      const world = this.world;
      if (!world || this.players.get(p.ws) !== p) return;
      const targets = strikeTargets(world.monsters, p.entity, facing, weapon, aimedId);
      if (targets.length > 0) this.attack(p, targets, weapon, Date.now());
    };
    const delay = impactDelayMs(key, facing);
    if (delay <= 0) land();
    else setTimeout(land, delay);
  }

  /**
   * One swing at `targets`: each hit is broadcast (damage numbers, knockback); on a kill every
   * player with a big enough share of the damage rolls their own loot.
   */
  private attack(p: ZPlayer, targets: MonsterState[], weapon: WeaponStats, now: number): void {
    const world = this.world!;
    for (const h of world.monsters.strike(p.entity, targets, weapon, now)) {
      const at = { x: Math.round(h.m.x * 1000) / 1000, y: Math.round(h.m.y * 1000) / 1000 };
      this.broadcast({
        t: "hit",
        id: h.m.id,
        by: p.entity.id,
        dmg: h.dmg,
        at,
        ...(h.crit ? { crit: true } : {}),
        ...(h.miss ? { miss: true } : {}),
        ...(h.kb ? { kb: slideOf(h.kb) } : {}),
        ...(h.killedFor ? { kill: true } : {}),
      });
      if (!h.killedFor) continue;
      for (const id of h.killedFor) {
        const winner = this.playerByEntity(id);
        if (!winner) continue;
        bumpStat(winner.stats, "monstersDefeated");
        winner.saveSoon.schedule();
        const items = mergeLoot(rollMonsterDrops(h.m.type, Math.random, dropZoneOf(world.zone), this.rates), rollKillDrop(world.map.drops, Math.random, this.rates));
        if (items.length === 0) continue;
        send(winner.ws, { t: "loot", at, items: items.map((d) => d.item) });
        this.inventoryChanged(winner, this.grantLoot(winner, items, at, now));
      }
    }
  }

  private onInteract(p: ZPlayer, target: string, now: number): void {
    const world = this.world!;
    const npc = world.npcs.byEntityId(target);
    if (npc) {
      if (dist(npc.entity, p.entity) > NPC_TALK_RANGE) {
        return send(p.ws, { t: "notice", text: "Walk a little closer.", kind: "info" });
      }
      if (npc.def?.shop) this.sendShop(p, npc.id);
      world.npcs.talk(npc, { userId: p.userId, entityId: p.entity.id, name: p.name }, INTERACT_TEXT, now);
      this.bondChanged(p, npc.entity, bondTalk(p.bonds, npc.id, p.inv, now, Math.random, this.rates), true);
      return;
    }
    if (target.startsWith(CHEST_TARGET_PREFIX)) return this.onChest(p, target.slice(CHEST_TARGET_PREFIX.length), now);
    if (target.startsWith(GROUND_TARGET_PREFIX)) return this.onForage(p, target.slice(GROUND_TARGET_PREFIX.length));
    const prop = world.map.props.find((pr) => pr.id === target);
    if (!prop || distToRect(p.entity, prop) > PROP_REACH) return;
    if (SEAT_FACING[prop.type]) return this.onSeat(p, prop.id, now);
    if (prop.type === "market_stall") {
      const keeper = this.shopkeeperNear(prop);
      if (keeper) this.sendShop(p, keeper);
      else send(p.ws, { t: "notice", text: "Nobody is minding this stall.", kind: "info" });
      return;
    }
    if (prop.type === "notice_board" || prop.type === "shrine" || prop.type === "bridge_broken") {
      void this.villageGoals().then((goals) => send(p.ws, { t: "goals", goals }));
    }
  }

  /** Interact on a chair or stool: sit down if it's free; on your own seat, get up. */
  private onSeat(p: ZPlayer, seatId: string, now: number): void {
    const seats = this.world!.seats;
    const seat = seats.get(seatId);
    if (!seat) return;
    if (seats.of(p.entity.id)?.id === seatId) return this.getUp(p);
    if (!seats.isFree(seatId)) return send(p.ws, { t: "notice", text: "Someone's sitting there.", kind: "info" });
    const back = isSitting(p.entity) && p.standBack ? p.standBack : { x: p.entity.x, y: p.entity.y };
    if (!seats.take(seatId, p.entity.id)) return;
    p.motion.stop();
    p.standBack = back;
    sitDown(p.entity, seat, now);
    p.dirty = true;
  }

  /** Stands a seated player up beside the chair (where they came from when that's still free). */
  /**
   * Fast travel: the same handoff as walking through an exit. takeExit saves the player to their
   * HomeRoom with the destination and default spawn and waits for it, and only then sends
   * {t:"zone"}; the client opens the next zone's socket after that, so the next Durable Object
   * always loads the saved state and no late save from here can be refused as stale.
   */
  private onTravel(p: ZPlayer, to: TravelZone, now: number): void {
    const why = travelBlock(to, this.world!.zone, now, p.lastTravel ?? 0);
    if (why) return send(p.ws, { t: "notice", text: why, kind: "error" });
    p.lastTravel = now;
    this.getUp(p);
    void this.takeExit(p, { x: 0, y: 0, w: 0, h: 0, to, spawn: TRAVEL_SPAWN });
  }

  private getUp(p: ZPlayer): void {
    // Moving or swinging ends a pose (lying on the ground, peeing).
    endPose(p.entity);
    if (!isSitting(p.entity)) return;
    const world = this.world!;
    const seat = world.seats.of(p.entity.id);
    world.seats.release(p.entity.id);
    const back = p.standBack && canStand(world.grid, p.standBack.x, p.standBack.y) ? p.standBack : null;
    const spot = back ?? (seat ? standSpots(world.grid, seat, p.standBack)[0] : undefined) ?? world.map.spawns.default!;
    standUp(p.entity, spot);
    p.standBack = undefined;
    p.dirty = true;
  }

  /** The shop NPC closest to a stall (stalls have no owner field in map data); only one who is here. */
  private shopkeeperNear(prop: { x: number; y: number; w: number; h: number }): string | null {
    let best: string | null = null;
    let bd = Infinity;
    for (const n of this.world!.npcs.present()) {
      if (!n.def?.shop) continue;
      const d = distToRect({ x: n.spawn.x + 0.5, y: n.spawn.y + 0.5 }, prop);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  private sendShop(p: ZPlayer, npcId: string): void {
    const n = this.world!.npcs.byEntityId(npcId);
    const shop = n?.def?.shop;
    if (!n || !shop) return;
    const now = Date.now();
    if (now - (p.lastShop.get(n.id) ?? 0) < SHOP_DEDUP_MS) return;
    p.lastShop.set(n.id, now);
    const today = shopToday(shop, now);
    send(p.ws, { t: "shop", npc: n.id, name: n.entity.name, offers: today.sells, buys: today.buys });
  }

  private shopFor(p: ZPlayer, npcId: string) {
    const n = this.world!.npcs.byEntityId(npcId);
    if (!n?.def?.shop) return { error: "They don't run a shop." } as const;
    if (dist(n.entity, p.entity) > SHOP_RANGE) return { error: "You're too far from the shop." } as const;
    return { shop: shopToday(n.def.shop, Date.now()) } as const;
  }

  private onBuy(p: ZPlayer, msg: Extract<ClientMsg, { t: "buy" }>): void {
    const s = this.shopFor(p, msg.npc);
    if ("error" in s) return this.reject(p, msg, s.error!);
    const r = buyFrom(p.inv, s.shop, msg.item, msg.qty);
    if (!r.ok) return this.reject(p, msg, r.reason);
    this.inventoryChanged(p, r.text);
  }

  private onSell(p: ZPlayer, msg: Extract<ClientMsg, { t: "sell" }>): void {
    const s = this.shopFor(p, msg.npc);
    if ("error" in s) return this.reject(p, msg, s.error!);
    const r = sellTo(p.inv, s.shop, msg.slot, msg.qty);
    if (!r.ok) return this.reject(p, msg, r.reason);
    this.inventoryChanged(p, r.text);
  }

  /** Takes one item now (sync) and lets the NPC react; the item is a gift, nothing comes back. */
  private onGiftNpc(p: ZPlayer, msg: Extract<ClientMsg, { t: "giftNpc" }>, now: number): void {
    const world = this.world!;
    const npc = world.npcs.byEntityId(msg.npc);
    if (!npc?.def) return this.reject(p, msg, "Nobody to give that to.");
    if (dist(npc.entity, p.entity) > NPC_TALK_RANGE) return this.reject(p, msg, "Walk a little closer.");
    const slot = p.inv.slots[msg.slot];
    const def = slot ? getItem(slot.item) : undefined;
    if (!slot || !def) return this.reject(p, msg, "Nothing in that slot.");
    if (def.kind === "tool") return this.reject(p, msg, "You'll need that yourself.");
    if (world.npcs.giftedRecently(npc.id, p.userId, now, GIFT_NPC_COOLDOWN_MS)) return this.reject(p, msg, "Give them a moment.");
    const limit = bondGiftRefusal(p.bonds, npc.id, now);
    if (limit === "day") return this.reject(p, msg, `${npc.def.name} already had a gift from you today.`);
    if (limit === "week") return this.reject(p, msg, `${npc.def.name} had two gifts from you this week. Try again on Sunday.`);
    const quality = slot.quality ?? def.quality ?? 0;
    if (!removeFromSlot(p.inv, msg.slot, 1)) return this.reject(p, msg, "Nothing in that slot.");
    this.inventoryChanged(p, `Gave ${npc.def.name} a ${def.name}.`);
    void world.npcs.receiveGift(npc, { userId: p.userId, entityId: p.entity.id, name: p.name }, def.id, now);
    if (isNpcId(npc.id)) {
      const out = bondGift(p.bonds, npc.id, giftTaste(npc.id, def.id), p.inv, now, Math.random, { quality, rates: this.rates });
      this.bondChanged(p, npc.entity, out, false);
    }
  }

  /**
   * Tells the player how a friendship moved, and hands over milestone furniture: the villager says
   * a line (to this player only) and the piece goes in the bag, or waits with them if it is full.
   */
  private bondChanged(p: ZPlayer, npc: EntityState, out: BondOutcome | null, talk: boolean): void {
    if (!out) return;
    send(p.ws, {
      t: "bond",
      view: out.view,
      delta: out.delta,
      from: npc.id,
      ...(talk ? { talk: true } : {}),
      ...(out.delivered.length > 0 ? { gifts: out.delivered } : {}),
    });
    // Always: the Relationships rows show "talked today" and gift markers, not just hearts.
    send(p.ws, { t: "bonds", list: bondList(p.bonds, Date.now()) });
    const who = npcName(out.npc);
    for (const item of out.delivered) {
      send(p.ws, { t: "chat", from: npc.id, name: npc.name, text: giftLine(item, Math.random), at: Date.now(), to: p.entity.id });
    }
    if (out.delivered.length > 0) {
      this.holdUp(p, out.delivered[0]!);
      this.inventoryChanged(p, out.delivered.map((i) => `+1 ${getItem(i)?.name ?? i} (gift from ${who})`).join(", "));
    }
    if (out.owed.length > 0) this.mailGifts(p, out.npc, who, out.owed);
    p.saveSoon.schedule();
  }

  /**
   * Gifts that didn't fit the bag go to the player's mailbox at home. If the home can't be
   * reached they stay with the villager (Bond.pending) and come with the next chat instead.
   */
  private mailGifts(p: ZPlayer, npc: string, who: string, items: string[]): void {
    const what = items.map((i) => getItem(i)?.name ?? i).join(", ");
    void this.home(p.userId)
      .mailGift(p.userId, who, items)
      .then((ok) => {
        if (!ok) throw new Error("not mailed");
        const b = p.bonds[npc];
        for (const item of items) {
          const i = b ? b.pending.indexOf(item) : -1;
          if (i >= 0) b!.pending.splice(i, 1);
        }
        p.saveSoon.schedule();
        if (this.players.get(p.ws) !== p) return;
        send(p.ws, { t: "notice", text: `Your bag is full, so ${who} sent ${what} to your mailbox at home.`, kind: "info" });
        send(p.ws, { t: "bonds", list: bondList(p.bonds, Date.now()) });
      })
      .catch(() => {
        if (this.players.get(p.ws) !== p) return;
        send(p.ws, { t: "notice", text: `${who} has a gift for you (${what}), but your bag is full. Make room and talk to them again.`, kind: "info" });
      });
  }

  /** The player lifts a newly received item over their head (everyone here sees it). */
  private holdUp(p: ZPlayer, item: string): void {
    p.entity.act = { k: "holdUp", at: Date.now(), item };
  }

  /** Opens a cave chest for this player: their own loot, once per chest spawn. */
  private onChest(p: ZPlayer, id: string, now: number): void {
    const chests = this.world!.chests;
    const chest = chests?.get(id);
    if (!chests || !chest) return;
    if (dist(p.entity, { x: chest.x + 0.5, y: chest.y + 0.5 }) > CHEST_REACH + 0.5) {
      return send(p.ws, { t: "notice", text: "Walk a little closer.", kind: "info" });
    }
    if (chest.openedBy.includes(p.userId)) {
      return send(p.ws, { t: "notice", text: "You've emptied this one. Chests turn up somewhere new now and then.", kind: "info" });
    }
    const loot = rollChestLoot(Math.random, this.rates);
    if (!chests.open(chest, p.userId, now)) return;
    p.inv.coins += loot.coins;
    void this.ctx.storage.put("chests", chests.record());
    const got = this.grantLoot(p, loot.items, { x: chest.x + 0.5, y: chest.y + 1.3 }, now);
    const lines = [`+${loot.coins} coins`, ...(got ? [got] : [])];
    send(p.ws, { t: "chestOpened", id: chest.id, loot: lines });
    const rare = loot.items.find((d) => isRareLoot(d.item));
    if (rare) this.holdUp(p, rare.item);
    this.inventoryChanged(p, lines.join(", "));
  }

  /** Generic village news for NPC memory: goal status only, never anything about players. */
  private worldFacts(): string[] {
    const goals = this.holdsGoals() ? goalsView(this.goals) : (this.goalsCache?.goals ?? []);
    return goals.map((g) => (g.done ? `The village finished: ${g.name}.` : `The village is still working on: ${g.name}.`));
  }

  // ------------------------------------------------------------------ village goals

  private onDonate(p: ZPlayer, msg: Extract<ClientMsg, { t: "donate" }>): void {
    if (!GOAL_DEFS.some((g) => g.id === msg.goal)) return this.reject(p, msg, "Unknown goal.");
    if (p.donation) return this.reject(p, msg, "One donation at a time.");
    const slot = p.inv.slots[msg.slot];
    if (!slot || slot.qty < msg.qty) return this.reject(p, msg, "You don't have that many.");
    const item = slot.item;

    if (this.holdsGoals()) {
      const accepted = donate(this.goals, msg.goal, item, msg.qty);
      if (accepted === 0) return this.reject(p, msg, "That goal doesn't need this.");
      removeFromSlot(p.inv, msg.slot, accepted);
      this.goalsChanged();
      this.inventoryChanged(p, `Donated ${accepted} ${getItem(item)?.name ?? item}. Thank you!`);
      return;
    }

    // Other zones: take the items now (sync), and only once that is saved let the village record
    // them; refund what it didn't need. Exits and the final save wait for this to finish.
    if (!removeFromSlot(p.inv, msg.slot, msg.qty)) return this.reject(p, msg, "You don't have that many.");
    p.donation = this.remoteDonate(p, msg, item).finally(() => {
      p.donation = null;
    });
  }

  private async remoteDonate(p: ZPlayer, msg: Extract<ClientMsg, { t: "donate" }>, item: string): Promise<void> {
    send(p.ws, { t: "inventory", inventory: p.inv });
    const saved = await this.save(p);
    if (saved !== "saved") {
      // Not durable: give the items back and don't touch the goal (stale = lease lost, gone anyway).
      addItem(p.inv, item, msg.qty);
      if (saved === "error") this.reject(p, msg, "Couldn't donate right now. Try again.");
      send(p.ws, { t: "inventory", inventory: p.inv });
      return;
    }
    // One request id across the retry: if the first call landed but its answer was lost, the
    // village returns the recorded result instead of counting the items twice.
    const reqId = crypto.randomUUID();
    let result: { accepted: number; goals: VillageGoal[] } | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await this.village().donateGoal(msg.goal, item, msg.qty, reqId);
      } catch {
        result = null;
      }
    }
    const accepted = Math.max(0, Math.min(msg.qty, result?.accepted ?? 0));
    const refund = msg.qty - accepted;
    if (refund > 0 && !addItem(p.inv, item, refund)) {
      send(p.ws, { t: "notice", text: "Your bag is full; a refund was lost.", kind: "error" });
    }
    if (accepted === 0) this.reject(p, msg, result ? "That goal doesn't need this." : "Couldn't reach the village. Try again.");
    this.inventoryChanged(p, accepted > 0 ? `Donated ${accepted} ${getItem(item)?.name ?? item}. Thank you!` : undefined);
    if (result) {
      this.goalsCache = { at: Date.now(), goals: result.goals };
      this.broadcast({ t: "goals", goals: result.goals });
    }
  }

  private village() {
    return this.env.ZONE.get(this.env.ZONE.idFromName("village"));
  }

  private async villageGoals(): Promise<VillageGoal[]> {
    if (this.holdsGoals()) return goalsView(this.goals);
    const now = Date.now();
    if (this.goalsCache && now - this.goalsCache.at < GOALS_CACHE_MS) return this.goalsCache.goals;
    try {
      const goals = await this.village().getGoals();
      this.goalsCache = { at: Date.now(), goals };
      return goals;
    } catch {
      return this.goalsCache?.goals ?? goalsView({});
    }
  }

  private goalsChanged(): void {
    void this.ctx.storage.put("goals", this.goals);
    this.broadcast({ t: "goals", goals: goalsView(this.goals) });
  }

  /**
   * RPC (village instance): record a donation made in another zone. Returns how many were used.
   * `reqId` makes retries idempotent: a repeated id returns the first answer without donating again.
   */
  async donateGoal(
    goal: string,
    item: string,
    qty: number,
    reqId?: string,
  ): Promise<{ accepted: number; goals: VillageGoal[] }> {
    await this.loadGoals();
    const id = typeof reqId === "string" && reqId.length <= 64 ? reqId : null;
    const seen = id !== null ? this.donationIds.get(id) : undefined;
    if (seen !== undefined) return { accepted: seen, goals: goalsView(this.goals) };
    const accepted = typeof qty === "number" ? donate(this.goals, String(goal), String(item), Math.min(qty, 999)) : 0;
    if (id !== null) {
      this.donationIds.set(id, accepted);
      if (this.donationIds.size > DONATION_IDS_MAX) this.donationIds.delete(this.donationIds.keys().next().value!);
    }
    if (accepted > 0) this.goalsChanged();
    return { accepted, goals: goalsView(this.goals) };
  }

  /**
   * Local dev only: "/hour N" makes NPC routines run as if it were N o'clock UTC, in every shared
   * zone (each one evaluates the same schedule, so they all need the same offset).
   */
  private async devSetHour(p: ZPlayer, arg: string | undefined, now: number): Promise<void> {
    const world = this.world!;
    if (arg === undefined) {
      send(p.ws, { t: "notice", text: `Routine hour: ${world.npcs.hour(now)}:00`, kind: "info" });
      return;
    }
    const want = Number(arg);
    if (!(want >= 0 && want < 24)) return;
    const offset = (want - scheduleHour(now) + 24) % 24;
    await Promise.allSettled(
      SHARED_ZONES.map((z) =>
        z === world.zone ? this.setDevHourOffset(offset) : this.env.ZONE.get(this.env.ZONE.idFromName(z)).setDevHourOffset(offset),
      ),
    );
    send(p.ws, { t: "notice", text: `Routine hour set to ${want}:00 in every zone.`, kind: "info" });
  }

  /**
   * Local dev only: "/hearts N" puts the nearest villager one point short of N hearts (talk
   * counters reset), so the next chat reaches N and rolls its milestone gifts.
   */
  /** Local dev only: "/warp caves_3_top [spawn]" walks you through an exit to anywhere shared. */
  private devWarp(p: ZPlayer, zone: string, spawn: string | undefined): void {
    if (!isZoneId(zone) || zone === "home") return send(p.ws, { t: "notice", text: "Usage: /warp zone_id [spawn]", kind: "info" });
    void this.takeExit(p, { x: 0, y: 0, w: 0, h: 0, to: zone, spawn: spawn ?? "default" });
  }

  private devSetHearts(p: ZPlayer, hearts: number): void {
    const npc = this.world!.npcs.nearest(p.entity, NPC_CHAT_RANGE);
    if (!npc || !isNpcId(npc.id) || hearts < 1 || hearts > MAX_HEARTS) {
      return send(p.ws, { t: "notice", text: "Stand next to a villager: /hearts 1-10", kind: "info" });
    }
    const b = (p.bonds[npc.id] ??= newBond());
    Object.assign(b, { pts: heartCurve(npc.id).at[hearts]! - 1, day: 0, talkPts: 0, gifts: 0, talked: false, weekGifts: 0, lastTalk: 0 });
    b.milestones = b.milestones.filter((m) => m < hearts);
    send(p.ws, { t: "bonds", list: bondList(p.bonds, Date.now()) });
    send(p.ws, { t: "notice", text: `${npc.def?.name ?? npc.id}: one point short of ${hearts} hearts.`, kind: "info" });
  }

  /** RPC (local dev only): shift this zone's NPC routine clock. */
  async setDevHourOffset(offset: number): Promise<void> {
    if (!devToolsEnabled(this.env) || typeof offset !== "number" || !Number.isInteger(offset)) return;
    const h = ((offset % 24) + 24) % 24;
    await this.ctx.storage.put("devHourOffset", h);
    this.world?.npcs.setHourOffset(h, Date.now());
  }

  /** RPC (village instance): current goal progress. */
  async getGoals(): Promise<VillageGoal[]> {
    await this.loadGoals();
    return goalsView(this.goals);
  }
}
