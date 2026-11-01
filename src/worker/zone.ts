// ZoneRoom Durable Object: one per shared map (idFromName(zoneId): village, riverside, caves and each
// building interior "int_*"). Interiors are ordinary shared zones with no monsters or rocks.
// Authoritative tick loop, players, NPCs, monsters, rocks, shops, goals.
//
// Players are loaded from / saved to their HomeRoom (lease rules in home.ts). Inventory changes
// are applied synchronously and saved right away; position/hp are saved every 5 s when dirty
// and on leave. Guests (H_GUEST=1) are refused with close code 4401.
import { DurableObject } from "cloudflare:workers";
import { devToolsEnabled, H_ZONE, type Env } from "./env";
import type { PlayerSave } from "./home";
import { decodeClient, type ClientMsg, type ServerMsg, type VillageGoal } from "../shared/protocol";
import { cleanChat, safeSpawnName } from "../shared/validate";
import { getItem } from "../shared/items";
import { getMap } from "../shared/maps";
import {
  SHARED_ZONES,
  TICK_MS,
  type EntityState,
  type Inventory,
  type Look,
  type MapData,
  type MapExit,
  type SharedZoneId,
} from "../shared/types";
import { addItem, buildCollision, canAdd, canStand, dist, exitAt, removeFromSlot, type CollisionGrid } from "../shared/engine";
import { canChangeLook, savedLook, shownLook } from "./game/look";
import { entityIdFor, readAttachment, readIdentity, type SocketAttachment } from "./game/identity";
import { cloneInventory, clampHp, sanitizeInventory } from "./game/sanitize";
import { ChatGuards } from "./game/chat";
import { HOME_COMMAND_NOTICE, parseHomeCommand } from "../shared/visits";
import { reportPresence } from "./social/hooks";
import { Throttle } from "./throttle";
import { EMOTE_MIN_INTERVAL_MS } from "../shared/emotes";
import { Motion } from "./game/motion";
import { CoalescingSaver, SaveDebouncer, type SaveOutcome } from "./game/saver";
import { CLOSE_ABUSE, SocketLimiter } from "./game/rateLimit";
import { resolveSpawn } from "./game/spawn";
import { CLOSE_SESSION_ENDED, recheckDue, sessionStillValid } from "./game/session";
import { timeout } from "./game/timeout";
import { stripControls } from "./npc/text";
import { scheduleHour } from "../shared/npcSchedule";
import { EntityDiffer } from "./game/diff";
import { MonsterPool } from "./game/monsterPool";
import { INTERACT_TEXT, NpcRunner, type NpcHost } from "./game/npcRunner";
import { agentMind } from "./npc/think/client";
import { isSitting, SeatBook, sitDown, standSpots, standUp } from "./game/seats";
import { SEAT_FACING } from "../shared/maps/interiors/props";
import { RockField } from "./game/rockField";
import { canMine, rockDrops } from "./game/rocks";
import { buyFrom, sellTo } from "./game/shop";
import { donate, GOAL_DEFS, goalsView, sanitizeProgress, type GoalProgress } from "./game/goals";
import { applyDamage, regen } from "./game/vitals";
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

interface ZPlayer {
  ws: WebSocket;
  userId: string;
  name: string;
  sprite: string;
  /** The save's chosen look (undefined until picked); entity.look falls back to the default. */
  look: Look | undefined;
  lastLook: number;
  maxHp: number;
  lease: string;
  entity: EntityState;
  inv: Inventory;
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
  lastHurt: number;
  lastRegen: number;
  /** While seated: where the player stood before sitting (they get up there). */
  standBack?: { x: number; y: number };
  lastAck: number | undefined;
  lastShop: Map<string, number>;
}

interface World {
  zone: SharedZoneId;
  map: MapData;
  grid: CollisionGrid;
  rocks: RockField;
  monsters: MonsterPool;
  npcs: NpcRunner;
  seats: SeatBook;
}

const isSharedZone = (z: unknown): z is SharedZoneId => (SHARED_ZONES as unknown[]).includes(z);

export class ZoneRoom extends DurableObject<Env> {
  private world: World | null = null;
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const zone = await ctx.storage.get<string>("zone");
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
    const rocks = new RockField(map);
    const unbroken = rocks.load(await this.ctx.storage.get<Record<string, number>>("rocks"));
    const grid = buildCollision(map, { rocks: unbroken });
    const rand = Math.random;
    const host: NpcHost = {
      players: () => this.playerEntities(),
      others: () => [...this.world!.monsters.alive()],
      chat: (from, text) => this.broadcast({ t: "chat", from: from.id, name: from.name, text, at: Date.now() }),
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
    };
    const seats = new SeatBook(map.seats ?? []);
    const npcs = new NpcRunner(map, grid, this.env, this.ctx.storage, host, rand, agentMind(this.env), seats);
    await npcs.load();
    if (devToolsEnabled(this.env)) {
      const offset = await this.ctx.storage.get<number>("devHourOffset");
      if (typeof offset === "number") npcs.setHourOffset(offset, Date.now());
    }
    this.world = { zone, map, grid, rocks, monsters: new MonsterPool(map, grid, rand), npcs, seats };
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
      await this.ctx.storage.put("zone", zone);
      await this.initWorld(zone);
    } else if (zone !== null && zone !== this.world.zone) {
      return new Response("Wrong zone", { status: 400 });
    }

    let save: PlayerSave;
    try {
      save = await this.home(id.userId).loadPlayer(id.userId, id.name);
    } catch {
      return new Response("Could not load player", { status: 503 });
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
    reportPresence(this.env, p.userId, world.zone, true);
    send(server, {
      t: "welcome",
      zone: world.zone,
      you: p.entity.id,
      entities: this.allEntities(),
      inventory: p.inv,
      brokenRocks: world.rocks.brokenIds(),
      goals: goalsView(this.goals),
      needsLook: !p.look,
      serverTime: Date.now(),
    });
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
      lastAck: undefined,
      lastShop: new Map(),
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
      const before = { x: p.entity.x, y: p.entity.y };
      acks.set(p, p.motion.step(p.entity, world.grid, dt));
      if (before.x !== p.entity.x || before.y !== p.entity.y) p.dirty = true;
      const exit = exitAt(world.map, p.entity.x, p.entity.y);
      // A donation in flight finishes first (its refund must land in this zone's save).
      if (exit && !p.donation) void this.takeExit(p, exit);
    }
    if (this.players.size === 0) return;

    for (const hit of world.monsters.tick(this.playerEntities(), dt, now)) {
      const p = this.playerByEntity(hit.playerId);
      if (p) this.hurt(p, hit.damage, now);
    }
    for (const p of this.players.values()) {
      if (regen(p.entity, now, p.lastHurt, p.lastRegen)) {
        p.lastRegen = now;
        p.dirty = true;
      }
    }

    world.npcs.tick(dt, now);
    world.seats.retain(new Set(this.allEntities().map((e) => e.id)));

    const restored = world.rocks.respawnDue(world.grid, now, this.allEntities());
    if (restored.length > 0) {
      for (const id of restored) this.broadcast({ t: "rock", id, broken: false });
      void this.ctx.storage.put("rocks", world.rocks.record());
    }

    const { upd, del } = this.differ.diff(this.allEntities());
    for (const p of this.players.values()) {
      const ack = acks.get(p);
      if (upd.length === 0 && del.length === 0 && ack === p.lastAck) continue;
      p.lastAck = ack;
      const msg: ServerMsg = { t: "tick", at: now, upd, del };
      if (ack !== undefined) msg.ack = ack;
      send(p.ws, msg);
    }

    if (now - this.lastSave >= SAVE_EVERY_MS) {
      this.lastSave = now;
      for (const p of this.players.values()) if (p.dirty) this.save(p);
    }
  }

  private hurt(p: ZPlayer, damage: number, now: number): void {
    p.lastHurt = now;
    p.dirty = true;
    if (!applyDamage(p.entity, damage)) return;
    const spawn = this.world!.map.spawns.default;
    p.motion.stop();
    p.entity.x = spawn.x;
    p.entity.y = spawn.y;
    send(p.ws, { t: "notice", text: "You fainted... and woke up feeling rested.", kind: "error" });
    this.save(p);
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
    send(p.ws, { t: "inventory", inventory: p.inv });
    if (loot) send(p.ws, { t: "notice", text: loot, kind: "loot" });
    // Bursts (mining, selling a stack, loot) coalesce into one HomeRoom call.
    p.saveSoon.schedule();
  }

  private async takeExit(p: ZPlayer, exit: MapExit): Promise<void> {
    if (this.players.get(p.ws) !== p) return;
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
        p.motion.onMove(msg.dx, msg.dy, msg.seq);
        return;
      case "moveTo":
        this.getUp(p);
        if (!p.motion.onMoveTo(world.grid, p.entity, msg.x, msg.y, msg.seq, now)) this.reject(p, msg, "Can't walk there.");
        return;
      case "chat":
        return this.onChat(p, msg.text, now);
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
      case "setLook":
        return this.onSetLook(p, msg, now);
      case "emote":
        // Everyone here sees it; spam just gets dropped.
        if (this.emotes.allow(p.userId, now)) this.broadcast({ t: "emote", from: p.entity.id, code: msg.code });
        return;
      case "ping":
        send(p.ws, { t: "pong", at: msg.at, serverTime: now });
        return;
    }
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
    if (npc) this.world!.npcs.talk(npc, { userId: p.userId, entityId: p.entity.id, name: p.name }, text, now);
  }

  private onUse(p: ZPlayer, msg: Extract<ClientMsg, { t: "use" }>, now: number): void {
    if (now - p.lastUse < USE_COOLDOWN_MS) return this.reject(p, msg, "Too fast.");
    p.lastUse = now;
    const slot = p.inv.slots[msg.slot];
    const def = slot ? getItem(slot.item) : undefined;
    if (!def) return this.reject(p, msg, "Nothing in that slot.");
    if (!inToolReach(p.entity, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    if (def.tool === "pickaxe" || def.tool === "sword") p.entity.act = { k: def.tool, at: now, item: def.id };
    if (def.tool === "pickaxe") return this.mine(p, msg, def.power ?? 1, now);
    if (def.tool === "sword") return this.attack(p, msg, def.power ?? 1, now);
    const farming = def.kind === "seed" || def.tool === "hoe" || def.tool === "water";
    this.reject(p, msg, farming ? "That's for your farm at home." : "Nothing to do with that here.");
  }

  private mine(p: ZPlayer, msg: Extract<ClientMsg, { t: "use" }>, power: number, now: number): void {
    const world = this.world!;
    const rock = world.rocks.at(msg.x, msg.y);
    if (!rock) return this.reject(p, msg, "There's no rock there.");
    if (!canMine(rock.ore, power)) return this.reject(p, msg, "You need a stronger pickaxe.");
    const drops = rockDrops(rock.ore, Math.random);
    // Check the whole haul fits before breaking anything.
    const trial = cloneInventory(p.inv);
    if (!drops.every((d) => addItem(trial, d.item, d.qty))) return this.reject(p, msg, "Your bag is full.");
    p.inv = trial;
    world.rocks.breakRock(rock, world.grid, now);
    void this.ctx.storage.put("rocks", world.rocks.record());
    this.broadcast({ t: "rock", id: rock.id, broken: true });
    this.inventoryChanged(p, drops.map((d) => `+${d.qty} ${getItem(d.item)?.name ?? d.item}`).join(", "));
  }

  private attack(p: ZPlayer, msg: Extract<ClientMsg, { t: "use" }>, power: number, now: number): void {
    const world = this.world!;
    const m = world.monsters.targetAt(msg.x, msg.y);
    if (!m || dist(m, p.entity) > 2.5) return this.reject(p, msg, "Missed.");
    const drops = world.monsters.hit(m, power, now);
    if (!drops) return;
    const got: string[] = [];
    for (const d of drops) if (addItem(p.inv, d.item, d.qty)) got.push(`+${d.qty} ${getItem(d.item)?.name ?? d.item}`);
    if (got.length < drops.length) send(p.ws, { t: "notice", text: "Your bag is full; some loot was lost.", kind: "error" });
    if (got.length > 0) this.inventoryChanged(p, got.join(", "));
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
      return;
    }
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
  private getUp(p: ZPlayer): void {
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
    send(p.ws, { t: "shop", npc: n.id, name: n.entity.name, offers: shop.sells, buys: shop.buys });
  }

  private shopFor(p: ZPlayer, npcId: string) {
    const n = this.world!.npcs.byEntityId(npcId);
    if (!n?.def?.shop) return { error: "They don't run a shop." } as const;
    if (dist(n.entity, p.entity) > SHOP_RANGE) return { error: "You're too far from the shop." } as const;
    return { shop: n.def.shop } as const;
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
    if (!removeFromSlot(p.inv, msg.slot, 1)) return this.reject(p, msg, "Nothing in that slot.");
    this.inventoryChanged(p, `Gave ${npc.def.name} a ${def.name}.`);
    void world.npcs.receiveGift(npc, { userId: p.userId, entityId: p.entity.id, name: p.name }, def.id, now);
  }

  /** Generic village news for NPC memory: goal status only, never anything about players. */
  private worldFacts(): string[] {
    const goals = this.world?.zone === "village" ? goalsView(this.goals) : (this.goalsCache?.goals ?? []);
    return goals.map((g) => (g.done ? `The village finished: ${g.name}.` : `The village is still working on: ${g.name}.`));
  }

  // ------------------------------------------------------------------ village goals

  private onDonate(p: ZPlayer, msg: Extract<ClientMsg, { t: "donate" }>): void {
    if (!GOAL_DEFS.some((g) => g.id === msg.goal)) return this.reject(p, msg, "Unknown goal.");
    if (p.donation) return this.reject(p, msg, "One donation at a time.");
    const slot = p.inv.slots[msg.slot];
    if (!slot || slot.qty < msg.qty) return this.reject(p, msg, "You don't have that many.");
    const item = slot.item;

    if (this.world!.zone === "village") {
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
    if (this.world?.zone === "village") return goalsView(this.goals);
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
