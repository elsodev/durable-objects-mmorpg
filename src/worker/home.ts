// HomeRoom Durable Object: one per player (idFromName(userId)).
// Holds the player's save: inventory, coins, hp, farm tiles, placed objects. Hosts the private home map.
// Only the owner may connect (Worker enforces, DO re-checks H_USER_ID === stored owner).
//
// Identity + consistency rules for the implementation (security review):
// - The Worker ALWAYS resolves this DO as env.HOME.idFromName(session.user.id). The owner id is
//   written to ctx.storage once, on the first Worker-routed fetch, from the verified H_USER_ID
//   header, and never changes afterwards.
// - loadPlayer/savePlayer throw if userId / save.userId !== stored owner (owner unset: loadPlayer
//   may set it, since the stub was resolved via idFromName(userId)).
// - savePlayer persists only inventory, hp and the optional zone/x/y; userId, name, maxHp and
//   sprite in the payload are ignored.
// - Session lease: every loadPlayer issues a fresh `lease` and invalidates earlier ones.
//   savePlayer with a stale or missing lease is rejected (returns false), so a zone the player
//   already left (or a second tab) can't roll back or duplicate items. Zones save after every
//   inventory change, and AWAIT the final save before sending the {t:"zone"} redirect.
//   While a zone holds the lease, a home socket takes the lease itself (loadPlayer semantics).
//
// Visitors (see src/worker/visit): invited accounts may join the owner's home while the owner is
// here. A visitor socket never takes a lease or touches the visitor's own save (their own HomeRoom
// keeps both); it can walk, chat and help harvest ready crops for the owner, nothing else.
import { DurableObject } from "cloudflare:workers";
import { devToolsEnabled, H_VISIT_LOOK, H_VISIT_OWNER, H_VISIT_RETURN, H_VISIT_SPRITE, type Env } from "./env";
import type { Inventory, Look, ZoneId } from "../shared/types";
import { Ground, TICK_MS, type EntityState, type FarmTile, type MapExit, type PlacedObject } from "../shared/types";
import type { DaySummary, HomeServerMsg } from "../shared/home";
import { decodeClient, type ClientMsg, type ServerMsg } from "../shared/protocol";
import { cleanChat, safeSpawnName } from "../shared/validate";
import { getItem, starterInventory, type ItemDef } from "../shared/items";
import { getMap } from "../shared/maps";
import {
  addItem,
  buildCollision,
  canAdd,
  canPlace,
  canStand,
  dist,
  exitAt,
  clampStamina,
  clampWater,
  clockAtMinutes,
  dayEndsAt,
  dayOver,
  eatGain,
  farmNow,
  harvestCrop,
  harvestYield,
  isFarmable,
  MAX_STAMINA,
  MAX_WATER,
  objectRect,
  plantTile,
  staminaCost,
  type HomeClock,
  pointInRect,
  removeFromSlot,
  tillTile,
  waterTile,
  type CollisionGrid,
} from "../shared/engine";
import {
  cleanName,
  entityIdFor,
  PLAYER_MAX_HP,
  PLAYER_SPRITES,
  readAttachment,
  readIdentity,
  spriteForUser,
  type SocketAttachment,
} from "./game/identity";
import { clampHp, cloneInventory, isZoneId, objSeqFor, sanitizeFarm, sanitizeInventory, sanitizeObjects } from "./game/sanitize";
import { Motion } from "./game/motion";
import { canChangeLook, savedLook, shownLook } from "./game/look";
import { EntityDiffer } from "./game/diff";
import { RockField } from "./game/rockField";
import { canMine, rockDrops } from "./game/rocks";
import { binPayout, sanitizeBin, shipSlot, unshipLast, type BinEntry } from "./game/shipping";
import { endHomeDay, type DayEndKind } from "./game/homeDay";
import { sanitizeClock } from "./game/homeState";
import { reportPresence, reportStat } from "./social/hooks";
import { EMOTE_MIN_INTERVAL_MS } from "../shared/emotes";
import { distToRect, inToolReach, PROP_REACH } from "./game/range";
import { CLOSE_ABUSE, SocketLimiter } from "./game/rateLimit";
import { resolveSpawn, sanitizeTransfer, type PendingTransfer } from "./game/spawn";
import { CLOSE_SESSION_ENDED, recheckDue, sessionStillValid } from "./game/session";
import { stripControls } from "./npc/text";
import { ChatGuards } from "./game/chat";
import { SLEEP_COUNTDOWN_MS } from "./game/homeTiming";
import {
  addInvite as addHostInvite,
  addToInbox,
  findInvite,
  findInviteByName,
  liveInbox,
  markLeft,
  markVisiting,
  removeFromInbox,
  revokeInvite,
  sanitizeInbox,
  sanitizeInvites,
  takeInviteQuota as takeQuota,
  type Invite,
} from "./visit/invites";
import { visitorVerdict } from "./visit/permissions";
import { canCredit, creditHarvest, HarvestTally } from "./visit/harvest";
import { sleepCountdownFor, VisitorSet, type VisitAttachment, type Visitor } from "./visit/visitors";
import { HOME_COMMAND_NOTICE, INVITE_TTL_MS, MAX_VISITORS, parseHomeCommand, type InviteCheck, type InviteNotice, type VisitorEntry } from "../shared/visits";
import {
  closeQuietly,
  CLOSE_FORBIDDEN,
  CLOSE_LEASE_LOST,
  CLOSE_REPLACED,
  isWebSocketUpgrade,
  send,
} from "./game/net";

export interface PlayerSave {
  userId: string;
  name: string;
  inventory: Inventory;
  hp: number;
  maxHp: number;
  sprite: string;
  /** Chosen in the character creator; absent until the player saves one (client then shows the creator). */
  look?: Look;
  /** Last zone + position, for reconnects without a spawn name. Saved on leave / periodically. */
  zone?: ZoneId;
  x?: number;
  y?: number;
  /** Session lease issued by loadPlayer; must be passed back to savePlayer. */
  lease?: string;
  /** Home simulation: stamina (0..100) and water left in the watering can. Absent = full. */
  stamina?: number;
  water?: number;
  /**
   * savePlayer: the exit just taken (recorded so the next join may use that spawn).
   * loadPlayer: the pending transfer, if any (consumed by the call).
   */
  transfer?: PendingTransfer | { to: ZoneId; spawn: string };
}

export interface HomeExport {
  save: PlayerSave;
  farm: import("../shared/types").FarmTile[];
  objects: import("../shared/types").PlacedObject[];
}

const HOME_MAP = getMap("home");
const USE_COOLDOWN_MS = 200;
/** Decorating works from across the room, not across the map. */
const PLACE_REACH = 10;
/** place / moveObject / pickup share one cooldown, like use. */
const BUILD_COOLDOWN_MS = 200;
/** A broken rock the player is standing on retries its respawn this much later. */
const ROCK_RETRY_MS = 5000;
const GUEST_REASON = "Create a free account to visit Mossbrook village.";
/** Every home has a bed; this one can be moved but not picked up. */
const DEFAULT_BED: PlacedObject = { id: "bed", item: "bed_simple", x: 4, y: 6, rotation: 0 };
/** How close (tiles) you must stand to a bed to sleep. */
const BED_REACH = 2.5;
export { SLEEP_COUNTDOWN_MS };
/** What the host's home shows a visitor in place of an inventory (they can't use items here). */
const VISITOR_INVENTORY = { coins: 0, slots: [] };
/** A visitor's own save, read without a lease (peekPlayer). */
export interface PlayerPeek {
  name: string;
  zone: ZoneId;
  sprite: string;
  look?: Look;
}


interface HPlayer {
  ws: WebSocket;
  guest: boolean;
  entity: EntityState;
  motion: Motion;
  lastAck: number | undefined;
  lastUse: number;
  /** Last hotbar slot used, so a plain "shipping_bin" interact knows which stack to sell. */
  lastSlot: number | null;
  lastLook: number;
  leaving: boolean;
  lastBuild: number;
  /** Last emote time (rate limit). */
  lastEmote: number;
  limiter: SocketLimiter;
  /** Better Auth session id behind the socket, and when it was last confirmed. */
  sid: string | null;
  authCheckedAt: number;
}

export class HomeRoom extends DurableObject<Env> {
  private owner: string | null = null;
  private save: Omit<PlayerSave, "lease"> | null = null;
  private lease: string | null = null;
  private farm: FarmTile[] = [];
  private objects: PlacedObject[] = [];
  private objSeq = 0;
  private transfer: PendingTransfer | null = null;
  private rocks = new RockField(HOME_MAP);
  private grid: CollisionGrid = buildCollision(HOME_MAP);
  private player: HPlayer | null = null;
  private differ = new EntityDiffer();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private clock: HomeClock = { day: 1, startAt: 0 };
  private bin: BinEntry[] = [];
  /** When a sleep countdown ends the day (null: nobody is going to sleep). */
  private sleepAt: number | null = null;
  /** Other players visiting (only while the owner is home). */
  private visitors = new VisitorSet();
  /** Who may visit (this home as host). */
  private invites: Invite[] = [];
  /** Invitations to other homes (this home's owner as guest): shown on their next connect. */
  private inbox: InviteNotice[] = [];
  private inviteTimes: number[] = [];
  /** The owner's name as of their last invite, for messages before this home has a save. */
  private hostName: string | null = null;
  private tally = new HarvestTally();
  private chatGuards = new ChatGuards();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      await this.loadState();
      const sockets = ctx.getWebSockets();
      const ownerSockets = sockets.filter((ws) => {
        const a = readAttachment(ws);
        return !!a && !a.visit && a.userId === this.owner;
      });
      const newest = ownerSockets[ownerSockets.length - 1];
      for (const ws of sockets) {
        const att = readAttachment(ws);
        if (att?.visit) continue;
        // Keep only the newest socket of the owner.
        if (!att || ws !== newest || !this.save) {
          closeQuietly(ws, CLOSE_REPLACED, "reconnect");
          continue;
        }
        const pos = att.x !== undefined && att.y !== undefined ? { x: att.x, y: att.y } : null;
        // authCheckedAt 0: re-check the session on the first message after a wake.
        this.player = this.makePlayer(ws, att, pos, 0);
      }
      const now = Date.now();
      for (const ws of sockets) {
        const att = readAttachment(ws);
        if (!att?.visit) continue;
        const pos = { x: att.x ?? HOME_MAP.spawns.default.x, y: att.y ?? HOME_MAP.spawns.default.y };
        const v = this.visitors.add(ws, att as SocketAttachment & { visit: VisitAttachment }, pos, 0, now);
        // Visitors only stay while their host is home and their invite still stands.
        if (!this.player || att.userId === this.owner || this.visitors.byUser(att.userId) !== v || !findInvite(this.invites, att.userId, now)) {
          this.visitors.sendHome(v, "The visit is over.");
          markLeft(this.invites, att.userId, now, true);
        }
      }
      // An invite marked "in use" whose visitor is gone (e.g. after a restart) runs out normally.
      for (const inv of this.invites) {
        if (inv.expiresAt === null && !this.visitors.byUser(inv.userId)) markLeft(this.invites, inv.userId, now, false);
      }
      if (this.player) this.startTick();
    });
  }

  // ------------------------------------------------------------------ state

  private async loadState(): Promise<void> {
    const got = await this.ctx.storage.get([
      "owner",
      "save",
      "lease",
      "farm",
      "objects",
      "rocks",
      "objSeq",
      "transfer",
      "clock",
      "bin",
      "invites",
      "inbox",
      "inviteTimes",
      "hostName",
    ]);
    const owner = got.get("owner");
    this.owner = typeof owner === "string" ? owner : null;
    this.save = (got.get("save") as Omit<PlayerSave, "lease"> | undefined) ?? null;
    if (this.save) this.save.inventory = sanitizeInventory(this.save.inventory);
    const lease = got.get("lease");
    this.lease = typeof lease === "string" ? lease : null;
    this.farm = sanitizeFarm(got.get("farm"));
    this.objects = sanitizeObjects(got.get("objects"));
    this.objSeq = objSeqFor(this.objects, got.get("objSeq"));
    this.transfer = sanitizeTransfer(got.get("transfer"));
    this.clock = sanitizeClock(got.get("clock"), Date.now());
    this.bin = sanitizeBin(got.get("bin"));
    this.invites = sanitizeInvites(got.get("invites"));
    this.inbox = sanitizeInbox(got.get("inbox"), Date.now());
    const times = got.get("inviteTimes");
    this.inviteTimes = Array.isArray(times) ? times.filter((t): t is number => typeof t === "number").slice(-100) : [];
    const hostName = got.get("hostName");
    this.hostName = typeof hostName === "string" ? hostName : null;
    if (this.save) this.ensureBed();
    const unbroken = this.rocks.load(got.get("rocks") as Record<string, number> | undefined);
    this.grid = buildCollision(HOME_MAP, { objects: this.objects, rocks: unbroken });
    await this.scheduleRockAlarm();
  }

  /**
   * Rock respawns and, while the owner is home, 2:00 (pass out) run from a storage alarm, so an
   * idle home needs no tick for them.
   */
  private async scheduleRockAlarm(now = Date.now()): Promise<void> {
    const times: number[] = [];
    if (this.rocks.broken.size > 0) {
      const next = Math.min(...this.rocks.broken.values());
      times.push(next <= now ? now + ROCK_RETRY_MS : next);
    }
    if (this.player) times.push(Math.max(now + 1000, dayEndsAt(this.clock)));
    if (times.length > 0) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const p = this.player;
    const restored = this.rocks.respawnDue(this.grid, now, this.entities());
    for (const id of restored) this.toAll({ t: "rock", id, broken: false });
    if (restored.length > 0) this.persist({ rocks: true });
    if (p && !p.leaving && dayOver(this.clock, now)) this.endDay("passout", now);
    await this.scheduleRockAlarm(now);
  }

  /** Adds the default bed if this home has none (old saves, or a fresh home). */
  private ensureBed(): void {
    if (this.objects.some((o) => o.id === DEFAULT_BED.id)) return;
    const interior = HOME_MAP.floorArea?.[0];
    const spots = [{ x: DEFAULT_BED.x, y: DEFAULT_BED.y }];
    if (interior) {
      for (let y = interior.y; y < interior.y + interior.h; y++)
        for (let x = interior.x; x < interior.x + interior.w; x++) spots.push({ x, y });
    }
    for (const at of spots) {
      if (canPlace(HOME_MAP, this.objects, this.farm, DEFAULT_BED.item, at.x, at.y, 0).ok) {
        this.objects.push({ ...DEFAULT_BED, ...at });
        this.persist({ objects: true });
        return;
      }
    }
  }

  private setTransfer(t: PendingTransfer | null): void {
    this.transfer = t;
    void (t ? this.ctx.storage.put("transfer", t) : this.ctx.storage.delete("transfer"));
  }

  /** The pending transfer, consumed: one exit grants one named spawn. */
  private takeTransfer(): PendingTransfer | null {
    const t = this.transfer;
    if (t) this.setTransfer(null);
    return t;
  }

  private rebuildGrid(): void {
    this.grid = buildCollision(HOME_MAP, { objects: this.objects, rocks: this.rocks.unbroken() });
  }

  private persist(keys: {
    save?: boolean;
    farm?: boolean;
    objects?: boolean;
    rocks?: boolean;
    day?: boolean;
    invites?: boolean;
    inbox?: boolean;
  }): void {
    const entries: Record<string, unknown> = {};
    if (keys.save && this.save) entries.save = this.save;
    if (keys.farm) entries.farm = this.farm;
    if (keys.objects) {
      entries.objects = this.objects;
      entries.objSeq = this.objSeq;
    }
    if (keys.rocks) entries.rocks = this.rocks.record();
    if (keys.day) {
      entries.clock = this.clock;
      entries.bin = this.bin;
    }
    if (keys.invites) {
      entries.invites = this.invites;
      entries.inviteTimes = this.inviteTimes;
      if (this.hostName) entries.hostName = this.hostName;
    }
    if (keys.inbox) entries.inbox = this.inbox;
    if (Object.keys(entries).length > 0) void this.ctx.storage.put(entries);
  }

  /** Throws unless `userId` is (or may become) the owner of this home. */
  private async assertOwner(userId: string, mayClaim: boolean): Promise<void> {
    if (typeof userId !== "string" || !userId) throw new Error("bad user");
    if (this.owner === null && mayClaim) {
      this.owner = userId;
      await this.ctx.storage.put("owner", userId);
      return;
    }
    if (this.owner !== userId) throw new Error("not the owner of this home");
  }

  private ensureSave(userId: string, name: string): Omit<PlayerSave, "lease"> {
    if (!this.save) {
      this.save = {
        userId,
        name: cleanName(name),
        inventory: starterInventory(),
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        sprite: spriteForUser(userId),
      };
      this.ensureBed();
      this.rebuildGrid();
    } else if (name && cleanName(name) !== this.save.name) {
      this.save.name = cleanName(name);
    }
    return this.save;
  }

  private async newLease(): Promise<string> {
    this.lease = crypto.randomUUID();
    await this.ctx.storage.put("lease", this.lease);
    return this.lease;
  }

  // ------------------------------------------------------------------ RPC

  /** RPC: load (or create) the player's save. Called by ZoneRoom on join. */
  async loadPlayer(userId: string, name: string): Promise<PlayerSave> {
    await this.assertOwner(userId, true);
    const save = this.ensureSave(userId, name);
    const lease = await this.newLease();
    await this.ctx.storage.put("save", save);
    // A zone now owns the session; a home socket still open would act on a stale copy.
    this.dropPlayer(CLOSE_LEASE_LOST, "You are playing somewhere else now.");
    const transfer = this.takeTransfer();
    return { ...structuredClone(save), lease, ...(transfer ? { transfer } : {}) };
  }

  /**
   * RPC: persist inventory/hp (and zone/x/y) changes made while the player is in a shared zone.
   * Resolves to false (nothing written) if save.lease is not the current lease.
   */
  async savePlayer(save: PlayerSave): Promise<boolean | void> {
    if (!save || typeof save !== "object") throw new Error("bad save");
    await this.assertOwner(save.userId, false);
    if (!this.save || !save.lease || save.lease !== this.lease) return false;
    this.save.inventory = sanitizeInventory(save.inventory);
    this.save.hp = clampHp(save.hp, this.save.maxHp);
    // Zones only send a look the player changed there; never clear a saved one.
    const look = savedLook(save.look);
    if (look) this.save.look = look;
    if (isZoneId(save.zone) && Number.isFinite(save.x) && Number.isFinite(save.y)) {
      this.save.zone = save.zone;
      this.save.x = save.x;
      this.save.y = save.y;
    }
    const t = save.transfer;
    if (t && isZoneId(t.to) && typeof t.spawn === "string" && t.spawn.length <= 64) {
      this.setTransfer({ to: t.to, spawn: t.spawn, at: Date.now() });
    }
    await this.ctx.storage.put("save", this.save);
    return true;
  }

  /** RPC (guest upgrade): full home export (save, farm, objects) for moving to a new account, or null if empty. */
  async exportHome(ownerId: string): Promise<HomeExport | null> {
    if (this.owner === null || !this.save) return null;
    if (this.owner !== ownerId) throw new Error("not the owner of this home");
    return { save: structuredClone(this.save), farm: structuredClone(this.farm), objects: structuredClone(this.objects) };
  }

  /** RPC (guest upgrade): import into a fresh home owned by newOwnerId; renames owner, keeps progress. */
  async importHome(newOwnerId: string, name: string, data: HomeExport): Promise<void> {
    await this.assertOwner(newOwnerId, true);
    const src = (data?.save ?? {}) as Partial<PlayerSave>;
    const sprite = (PLAYER_SPRITES as readonly string[]).includes(src.sprite ?? "") ? src.sprite! : spriteForUser(newOwnerId);
    this.save = {
      userId: newOwnerId,
      name: cleanName(name),
      inventory: sanitizeInventory(src.inventory),
      hp: clampHp(src.hp, PLAYER_MAX_HP),
      maxHp: PLAYER_MAX_HP,
      sprite,
      zone: "home",
    };
    const look = savedLook(src.look);
    if (look) this.save.look = look;
    this.farm = sanitizeFarm(data?.farm).filter((t) => isFarmable(HOME_MAP, t.x, t.y));
    this.objects = [];
    for (const o of sanitizeObjects(data?.objects)) {
      if (canPlace(HOME_MAP, this.objects, this.farm, o.item, o.x, o.y, o.rotation).ok) this.objects.push(o);
    }
    this.objSeq = objSeqFor(this.objects);
    this.ensureBed();
    this.rebuildGrid();
    this.dropPlayer(CLOSE_REPLACED, "Your home moved to your new account.");
    this.lease = null;
    await this.ctx.storage.put({
      save: this.save,
      farm: this.farm,
      objects: this.objects,
      objSeq: this.objSeq,
      rocks: this.rocks.record(),
    });
    await this.ctx.storage.delete("lease");
  }

  /** RPC: delete everything (guest cleanup / after transfer). */
  async wipe(ownerId: string): Promise<void> {
    if (this.owner !== null && this.owner !== ownerId) throw new Error("not the owner of this home");
    this.dropPlayer(CLOSE_REPLACED, "This home was removed.");
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_REPLACED, "wiped");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.owner = null;
    this.transfer = null;
    this.save = null;
    this.lease = null;
    this.farm = [];
    this.objects = [];
    this.objSeq = 0;
    this.clock = sanitizeClock(null, Date.now());
    this.bin = [];
    this.sleepAt = null;
    this.invites = [];
    this.inbox = [];
    this.inviteTimes = [];
    this.rocks.load(undefined);
    this.rebuildGrid();
  }

  // ------------------------------------------------------------------ RPC: visits (this home as host)

  /** Throws unless `ownerId` owns this home (the Worker resolved the stub by idFromName(ownerId)). */
  private async assertHost(ownerId: string): Promise<void> {
    await this.assertOwner(ownerId, true);
  }

  /** RPC: counts one invite attempt against this home's quota; false when over it. */
  async takeInviteQuota(ownerId: string, now = Date.now()): Promise<boolean> {
    await this.assertHost(ownerId);
    const ok = takeQuota(this.inviteTimes, now);
    this.persist({ invites: true });
    return ok;
  }

  /**
   * RPC: invite `target` (an account the Worker looked up by name). Accounts only; the Worker
   * refuses guests before calling. Returns the invite or why not.
   */
  async createInvite(
    ownerId: string,
    ownerName: string,
    target: { id: string; name: string },
    now = Date.now(),
  ): Promise<{ ok: true; invite: Invite } | { ok: false; status: number; reason: string }> {
    await this.assertHost(ownerId);
    this.hostName = cleanName(ownerName);
    const r = addHostInvite(this.invites, { id: ownerId, name: ownerName, guest: false }, { ...target, guest: false }, now);
    this.persist({ invites: true });
    if (!r.ok) return r;
    return { ok: true, invite: { ...r.invite } };
  }

  /** RPC: may `visitorId` come in right now? (Worker, before forwarding /ws/visit/<ownerId>.) */
  async checkInvite(ownerId: string, visitorId: string, now = Date.now()): Promise<InviteCheck> {
    if (this.owner === null || this.owner !== ownerId) return { ok: false, reason: "That invite is no longer valid." };
    return this.inviteCheck(visitorId, now);
  }

  private inviteCheck(visitorId: string, now: number): InviteCheck {
    const host = this.save?.name ?? this.hostName ?? "Your friend";
    if (visitorId === this.owner) return { ok: false, reason: "This is your own home." };
    if (!findInvite(this.invites, visitorId, now)) return { ok: false, reason: "That invite is no longer valid." };
    if (!this.player || this.player.leaving) return { ok: false, reason: `${host} isn't home right now. Try again later.` };
    if (this.visitors.full && !this.visitors.byUser(visitorId)) {
      return { ok: false, reason: `${host}'s home is full (${MAX_VISITORS} visitors).` };
    }
    return { ok: true, ownerName: host };
  }

  /** RPC: withdraw the invite of the player called `name` (sends them home if visiting). */
  async revokeInviteByName(ownerId: string, name: string, now = Date.now()): Promise<VisitorEntry | null> {
    await this.assertHost(ownerId);
    const v = this.visitors.byName(name);
    const inv = v ? findInvite(this.invites, v.userId, now) : findInviteByName(this.invites, name, now);
    const userId = v?.userId ?? inv?.userId;
    if (!userId) return null;
    const who = { userId, name: v?.name ?? inv!.name };
    revokeInvite(this.invites, userId);
    this.persist({ invites: true });
    if (v) this.endVisit(v, `${this.save?.name ?? "The owner"} withdrew your invite.`);
    return who;
  }

  /** RPC: send a visitor home now (by user id or name); their invite is used up. */
  async kickVisitor(ownerId: string, who: { userId?: string; name?: string }): Promise<VisitorEntry | null> {
    await this.assertHost(ownerId);
    const v = who.userId ? this.visitors.byUser(who.userId) : who.name ? this.visitors.byName(who.name) : undefined;
    if (!v) return null;
    this.endVisit(v, `${this.save?.name ?? "The owner"} asked you to head home.`);
    return { userId: v.userId, name: v.name };
  }

  /** RPC: the invitee said no; the invite is withdrawn and the owner (if home) is told. */
  async declineInvite(ownerId: string, visitorId: string): Promise<void> {
    if (this.owner === null || this.owner !== ownerId) return;
    const inv = revokeInvite(this.invites, visitorId);
    if (!inv) return;
    this.persist({ invites: true });
    if (this.player) send(this.player.ws, { t: "notice", text: `${inv.name} can't come over right now.`, kind: "info" });
  }

  // ------------------------------------------------------------------ RPC: visits (this home's owner as guest)

  /** RPC: an invitation from another home, kept until it runs out or is answered. */
  async addInvite(fromId: string, fromName: string, expiresAt = Date.now() + INVITE_TTL_MS): Promise<void> {
    const now = Date.now();
    if (fromId === this.owner) return;
    const n: InviteNotice = { fromId, fromName, expiresAt };
    this.inbox = addToInbox(this.inbox, n, now);
    this.persist({ inbox: true });
    // Already at home: show it right away (the social socket may be missing).
    if (this.player) send(this.player.ws, { t: "invites", invites: [this.inbox[this.inbox.length - 1]!] });
  }

  /** RPC: invitations waiting for this home's owner (zones and the home send them after welcome). */
  async pendingInvitesFor(userId: string): Promise<InviteNotice[]> {
    // Unclaimed: the stub was still resolved by idFromName(userId).
    if (this.owner !== null && userId !== this.owner) return [];
    return liveInbox(this.inbox, Date.now());
  }

  /** RPC: the owner answered (or the inviter withdrew) the invitation from `fromId`. */
  async dismissInvite(userId: string, fromId: string): Promise<void> {
    if (this.owner !== null && userId !== this.owner) return;
    const next = removeFromInbox(this.inbox, fromId);
    if (next.length === this.inbox.length) return;
    this.inbox = next;
    this.persist({ inbox: true });
  }

  /**
   * RPC (visit route): read-only look at this player's save for visiting someone else. Takes no
   * lease and writes nothing, so whatever zone holds the session keeps it.
   */
  async peekPlayer(userId: string): Promise<PlayerPeek> {
    if (this.owner !== null && userId !== this.owner) throw new Error("not the owner of this home");
    const save = this.save;
    return {
      name: save?.name ?? "Farmer",
      zone: save && isZoneId(save.zone) ? save.zone : "home",
      sprite: save?.sprite ?? spriteForUser(userId),
      ...(save?.look ? { look: structuredClone(save.look) } : {}),
    };
  }

  // ------------------------------------------------------------------ connect

  async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) return new Response("Expected WebSocket", { status: 426 });
    const id = readIdentity(request);
    if (!id) return new Response("Unauthorized", { status: 401 });
    const visitOwner = request.headers.get(H_VISIT_OWNER);
    if (visitOwner !== null) return this.acceptVisitor(request, id, visitOwner);
    try {
      await this.assertOwner(id.userId, true);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    const save = this.ensureSave(id.userId, id.name);
    // Home takes the session over from whatever zone held it.
    await this.newLease();
    // A second tab of the owner replaces the first; visitors stay.
    this.dropPlayer(CLOSE_REPLACED, "Connected from another tab.", true);

    // A named spawn needs a matching exit; otherwise resume the saved home position.
    const spawn = safeSpawnName(HOME_MAP.spawns, id.spawn);
    const at = resolveSpawn(HOME_MAP.spawns, "home", spawn, save, this.takeTransfer(), Date.now());
    save.zone = "home";
    await this.ctx.storage.put({ save, clock: this.clock, bin: this.bin });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const att: SocketAttachment = {
      userId: id.userId,
      name: save.name,
      entityId: entityIdFor(id.userId),
      guest: id.guest,
      ...(id.sessionId ? { sid: id.sessionId } : {}),
    };
    server.serializeAttachment(att);
    const p = this.makePlayer(server, att, at, Date.now());
    this.player = p;
    reportPresence(this.env, id.userId, "home", true);
    send(server, {
      t: "welcome",
      zone: "home",
      you: p.entity.id,
      entities: this.entities(),
      inventory: save.inventory,
      farm: this.farm,
      objects: this.objects,
      brokenRocks: this.rocks.brokenIds(),
      needsLook: !savedLook(save.look),
      serverTime: Date.now(),
    });
    // A day that ended while the owner was away is settled now that home holds the lease again.
    if (dayOver(this.clock, Date.now())) this.endDay("away", Date.now());
    else {
      this.sendHomeState(p);
      this.sendBin(p);
    }
    this.sendVisitorList();
    const waiting = liveInbox(this.inbox, Date.now());
    if (waiting.length > 0) send(server, { t: "invites", invites: waiting });
    this.startTick();
    void this.scheduleRockAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A visitor's socket, forwarded by the Worker's /ws/visit/<ownerId> route after it checked the
   * session, the invite and read the visitor's look and return zone (headers). Re-checked here,
   * where joining and the invite list can't race. Takes no lease and reads no save of the visitor.
   */
  private acceptVisitor(request: Request, id: ReturnType<typeof readIdentity> & object, ownerId: string): Response {
    const now = Date.now();
    if (this.owner === null || ownerId !== this.owner || id.guest || id.userId === this.owner) {
      return new Response("Forbidden", { status: 403 });
    }
    const check = this.inviteCheck(id.userId, now);
    if (!check.ok) return new Response(check.reason, { status: 403 });
    // Same visitor from a new tab (or a reconnect): the newer socket wins, the invite stays in use.
    const old = this.visitors.byUser(id.userId);
    if (old) {
      this.visitors.remove(old);
      send(old.ws, { t: "notice", text: "Connected from another tab.", kind: "error" });
      closeQuietly(old.ws, CLOSE_REPLACED, "Connected from another tab.");
    }
    const returnTo = request.headers.get(H_VISIT_RETURN);
    const spriteHdr = request.headers.get(H_VISIT_SPRITE) ?? "";
    let look: Look | undefined;
    try {
      look = savedLook(JSON.parse(request.headers.get(H_VISIT_LOOK) ?? "null"));
    } catch {
      look = undefined;
    }
    const visit: VisitAttachment = {
      returnTo: isZoneId(returnTo) ? returnTo : "home",
      sprite: (PLAYER_SPRITES as readonly string[]).includes(spriteHdr) ? spriteHdr : spriteForUser(id.userId),
      ...(look ? { look } : {}),
    };

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const at = HOME_MAP.spawns[safeSpawnName(HOME_MAP.spawns, "from_village")];
    const att: SocketAttachment & { visit: VisitAttachment } = {
      userId: id.userId,
      name: id.name,
      entityId: entityIdFor(id.userId),
      guest: false,
      ...(id.sessionId ? { sid: id.sessionId } : {}),
      visit,
    };
    server.serializeAttachment(att);
    const v = this.visitors.add(server, att, at, now, now);
    markVisiting(this.invites, id.userId);
    this.persist({ invites: true });

    const host = this.save!.name;
    send(server, {
      t: "welcome",
      zone: "home",
      you: v.entity.id,
      entities: this.entities(),
      inventory: VISITOR_INVENTORY,
      farm: this.farm,
      objects: this.objects,
      brokenRocks: this.rocks.brokenIds(),
      visit: { ownerId: this.owner, ownerName: host, returnTo: visit.returnTo },
      serverTime: now,
    });
    send(server, this.visitorHomeState(now));
    if (this.sleepAt !== null) send(server, { t: "sleeping", host, endsAt: this.sleepAt });
    send(server, { t: "notice", text: `Welcome to ${host}'s home! You can help harvest ripe crops.`, kind: "info" });
    if (this.player) send(this.player.ws, { t: "notice", text: `${v.name} came to visit!`, kind: "info" });
    this.sendVisitorList();
    this.startTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  private entities(): EntityState[] {
    return this.player ? [this.player.entity, ...this.visitors.entities()] : this.visitors.entities();
  }

  /** Everyone at home: the owner and any visitors. */
  private toAll(msg: ServerMsg): void {
    if (this.player) send(this.player.ws, msg);
    for (const v of this.visitors.all()) send(v.ws, msg);
  }

  private toVisitors(msg: ServerMsg): void {
    for (const v of this.visitors.all()) send(v.ws, msg);
  }

  private sendVisitorList(): void {
    if (this.player) send(this.player.ws, { t: "visitors", visitors: this.visitors.list(), max: MAX_VISITORS });
  }

  /**
   * Ends one visit and sends the visitor back where they came from. Deliberate ends (kick, exit,
   * owner left) use the invite up.
   */
  private endVisit(v: Visitor, reason: string, deliberate = true): void {
    if (this.visitors.get(v.ws) !== v) return;
    this.visitors.sendHome(v, reason);
    markLeft(this.invites, v.userId, Date.now(), deliberate);
    this.persist({ invites: true });
    if (this.player) send(this.player.ws, { t: "notice", text: `${v.name} headed home.`, kind: "info" });
    this.sendVisitorList();
  }

  /** The owner left or went offline: every visitor goes back. */
  private endAllVisits(reason: string): void {
    if (this.visitors.size === 0) return;
    const now = Date.now();
    for (const v of this.visitors.all()) {
      this.visitors.sendHome(v, reason);
      markLeft(this.invites, v.userId, now, true);
    }
    this.persist({ invites: true });
    this.flushTally(now, true);
  }

  private makePlayer(ws: WebSocket, att: SocketAttachment, at: { x: number; y: number } | null, authCheckedAt: number): HPlayer {
    const save = this.save!;
    const pos = at && canStand(this.grid, at.x, at.y) ? at : HOME_MAP.spawns.default;
    return {
      ws,
      guest: att.guest,
      entity: {
        id: att.entityId,
        kind: "player",
        name: save.name,
        sprite: save.sprite,
        x: pos.x,
        y: pos.y,
        facing: "down",
        moving: false,
        hp: save.hp,
        maxHp: save.maxHp,
        look: shownLook(save.look),
      },
      motion: new Motion(),
      lastAck: undefined,
      lastUse: 0,
      lastSlot: null,
      lastLook: 0,
      leaving: false,
      lastBuild: 0,
      lastEmote: 0,
      limiter: new SocketLimiter(Date.now()),
      sid: att.sid ?? null,
      authCheckedAt,
    };
  }

  /**
   * Closes the current home socket (if any) without touching the lease. Visitors go home too
   * unless the owner is only switching tabs.
   */
  private dropPlayer(code: number, reason: string, keepVisitors = false): void {
    const p = this.player;
    if (!keepVisitors) this.endAllVisits(this.hostGoneReason());
    if (!p) return;
    this.storePosition(p);
    this.player = null;
    this.sleepAt = null;
    this.stopTick();
    if (this.owner) reportPresence(this.env, this.owner, "home", false);
    send(p.ws, { t: "notice", text: reason, kind: "error" });
    closeQuietly(p.ws, code, reason);
  }

  private hostGoneReason(): string {
    return `${this.save?.name ?? "Your host"} left home, so the visit is over.`;
  }

  private storePosition(p: HPlayer): void {
    if (!this.save || p.leaving) return;
    this.save.zone = "home";
    this.save.x = p.entity.x;
    this.save.y = p.entity.y;
    this.persist({ save: true });
  }

  // ------------------------------------------------------------------ socket events

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const v = this.visitors.get(ws);
    if (v) return this.onVisitorMessage(v, message);
    const p = this.player;
    if (!p || p.ws !== ws || p.leaving || typeof message !== "string") return;
    const att = readAttachment(ws);
    if (!att || att.userId !== this.owner) return closeQuietly(ws, CLOSE_FORBIDDEN, "Not your home.");
    const now = Date.now();
    const verdict = p.limiter.check(now);
    if (verdict === "close") return this.kick(p, CLOSE_ABUSE, "Too many messages.");
    const msg = decodeClient(message);
    if (verdict === "reject" && msg) return this.reject(p, msg, "Slow down a little.");
    if (verdict !== "ok") return;
    this.maybeRecheckSession(p, att.userId, now, () => {
      if (this.player === p) this.kick(p, CLOSE_SESSION_ENDED, "Your session ended. Please sign in again.");
    });
    if (msg) this.handle(p, msg, now);
  }

  /** Re-validates the session every few minutes; a revoked one ends the socket. */
  private maybeRecheckSession(p: { sid: string | null; authCheckedAt: number }, userId: string, now: number, end: () => void): void {
    if (!p.sid || !recheckDue(p.authCheckedAt, now)) return;
    p.authCheckedAt = now;
    void sessionStillValid(this.env, p.sid, userId, now).then((ok) => {
      if (!ok) end();
    });
  }

  private kick(p: HPlayer, code: number, reason: string): void {
    if (this.player !== p) return;
    this.closed(p.ws);
    send(p.ws, { t: "notice", text: reason, kind: "error" });
    closeQuietly(p.ws, code, reason);
  }

  /** RPC (sign-out hook): close the socket that belongs to this session. */
  async closeSession(userId: string, sessionId: string): Promise<void> {
    const p = this.player;
    if (!p || userId !== this.owner || !sessionId || p.sid !== sessionId) return;
    this.kick(p, CLOSE_SESSION_ENDED, "You signed out.");
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.closed(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.closed(ws);
  }

  private closed(ws: WebSocket): void {
    const v = this.visitors.get(ws);
    if (v) {
      // A dropped visitor socket keeps the invite for a short while so the client can reconnect.
      this.visitors.remove(v);
      markLeft(this.invites, v.userId, Date.now(), false);
      this.persist({ invites: true });
      if (this.player) send(this.player.ws, { t: "notice", text: `${v.name} left.`, kind: "info" });
      this.sendVisitorList();
      return;
    }
    const p = this.player;
    if (!p || p.ws !== ws) return;
    this.storePosition(p);
    this.player = null;
    this.sleepAt = null;
    this.stopTick();
    if (this.owner) reportPresence(this.env, this.owner, "home", false);
    this.endAllVisits(this.hostGoneReason());
  }

  // ------------------------------------------------------------------ tick

  private startTick(): void {
    if (this.timer || !this.player) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTick(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const p = this.player;
    if (!p) return this.stopTick();
    const now = Date.now();
    const dt = Math.min(250, Math.max(0, now - this.lastTick));
    this.lastTick = now;

    if (this.sleepAt !== null && now >= this.sleepAt) this.endDay("sleep", now);
    const ack = p.motion.step(p.entity, this.grid, dt);
    const exit = this.sleepAt === null ? exitAt(HOME_MAP, p.entity.x, p.entity.y) : null;
    if (exit) this.takeExit(p, exit);

    if (p.leaving) return;
    const acks = new Map<Visitor, number | undefined>();
    for (const v of this.visitors.all()) {
      const a = v.motion.step(v.entity, this.grid, dt);
      // The only way out for a visitor is home: any exit ends the visit.
      if (exitAt(HOME_MAP, v.entity.x, v.entity.y)) this.endVisit(v, "See you next time!");
      else acks.set(v, a);
    }
    this.flushTally(now);

    const { upd, del } = this.differ.diff(this.entities());
    const changed = upd.length > 0 || del.length > 0;
    const sendTick = (ws: WebSocket, a: number | undefined): void => {
      const msg: ServerMsg = { t: "tick", at: now, upd, del };
      if (a !== undefined) msg.ack = a;
      send(ws, msg);
    };
    if (changed || ack !== p.lastAck) sendTick(p.ws, ack);
    p.lastAck = ack;
    for (const [v, a] of acks) {
      if (changed || a !== v.lastAck) sendTick(v.ws, a);
      v.lastAck = a;
    }
    // Nothing moves and nothing is timed (rocks use an alarm): let the home hibernate until input.
    const still = (m: Motion, e: EntityState) => m.idle && !e.moving;
    if (
      !changed &&
      still(p.motion, p.entity) &&
      this.visitors.all().every((v) => still(v.motion, v.entity)) &&
      this.sleepAt === null &&
      this.tally.size === 0
    ) {
      this.stopTick();
    }
  }

  /** Owner notices for harvests visitors did for them (batched). */
  private flushTally(now: number, force = false): void {
    if (this.tally.size === 0) return;
    const lines = this.tally.flush(now, force);
    if (this.player) for (const text of lines) send(this.player.ws, { t: "notice", text, kind: "loot" });
  }

  private takeExit(p: HPlayer, exit: MapExit): void {
    p.motion.stop();
    if (p.guest) {
      // Guests stay home: step them back off the exit and show the sign-up prompt.
      const back = HOME_MAP.spawns[safeSpawnName(HOME_MAP.spawns, "from_village")];
      p.entity.x = back.x;
      p.entity.y = back.y;
      send(p.ws, { t: "needAccount", reason: GUEST_REASON });
      return;
    }
    const dest = getMap(exit.to);
    const spawn = safeSpawnName(dest.spawns, exit.spawn);
    const pos = dest.spawns[spawn];
    if (this.save) {
      this.save.zone = exit.to;
      this.save.x = pos.x;
      this.save.y = pos.y;
      this.persist({ save: true });
    }
    this.setTransfer({ to: exit.to, spawn, at: Date.now() });
    p.leaving = true;
    this.flushTally(Date.now(), true);
    send(p.ws, { t: "zone", to: exit.to, spawn });
    closeQuietly(p.ws, 1000, "zone change");
    this.player = null;
    this.stopTick();
    this.endAllVisits(this.hostGoneReason());
  }

  // ------------------------------------------------------------------ client messages

  private reject(p: { ws: WebSocket }, msg: ClientMsg, reason: string): void {
    const r: ServerMsg = { t: "reject", action: msg.t, reason };
    if ("req" in msg && msg.req !== undefined) r.req = msg.req;
    send(p.ws, r);
  }

  private inventoryChanged(p: HPlayer, loot?: string): void {
    const save = this.save!;
    send(p.ws, { t: "inventory", inventory: save.inventory });
    if (loot) send(p.ws, { t: "notice", text: loot, kind: "loot" });
    this.persist({ save: true });
  }

  private handle(p: HPlayer, msg: ClientMsg, now: number): void {
    switch (msg.t) {
      case "move":
        p.motion.onMove(msg.dx, msg.dy, msg.seq);
        this.startTick();
        return;
      case "moveTo":
        if (!p.motion.onMoveTo(this.grid, p.entity, msg.x, msg.y, msg.seq, now)) this.reject(p, msg, "Can't walk there.");
        this.startTick();
        return;
      case "chat": {
        if (devToolsEnabled(this.env) && this.devCommand(p, msg.text.trim(), now)) return;
        return this.onChat(p, this.owner!, p.entity, msg.text, now);
      }
      case "use":
        return this.onUse(p, msg, now);
      case "interact":
        return this.onInteract(p, msg.target);
      case "place":
      case "moveObject":
      case "pickup":
        if (now - p.lastBuild < BUILD_COOLDOWN_MS) return this.reject(p, msg, "Too fast.");
        p.lastBuild = now;
        if (msg.t === "place") return this.onPlace(p, msg);
        if (msg.t === "moveObject") return this.onMoveObject(p, msg);
        return this.onPickup(p, msg);
      case "buy":
      case "sell":
      case "donate":
        return this.reject(p, msg, "Visit the village for that.");
      case "setLook":
        return this.onSetLook(p, msg, now);
      case "emote":
        if (now - p.lastEmote < EMOTE_MIN_INTERVAL_MS) return;
        p.lastEmote = now;
        this.toAll({ t: "emote", from: p.entity.id, code: msg.code });
        return;
      case "ping":
        send(p.ws, { t: "pong", at: msg.at, serverTime: now });
        return;
      case "eat":
        return this.onEat(p, msg, now);
      case "sleep":
        return this.onSleep(p, now);
      case "unship":
        return this.onUnship(p, msg);
    }
  }

  /** Chat at home goes to everyone here (just the owner when alone, so they see their bubble). */
  private onChat(from: { ws: WebSocket }, userId: string, entity: EntityState, raw: string, now: number): void {
    const text = cleanChat(stripControls(raw));
    if (!text) return;
    if (parseHomeCommand(text)) return send(from.ws, { t: "notice", text: HOME_COMMAND_NOTICE, kind: "error" });
    const guard = this.chatGuards.get(userId, now);
    const verdict = guard.check(text, now);
    if (verdict === "tooFast") return send(from.ws, { t: "reject", action: "chat", reason: "Slow down a little." });
    if (verdict === "muted") {
      const secs = Math.ceil(guard.mutedFor(now) / 1000);
      return send(from.ws, { t: "notice", text: `You are muted for ${secs}s (repeating yourself).`, kind: "error" });
    }
    this.toAll({ t: "chat", from: entity.id, name: entity.name, text, at: now });
  }

  // ------------------------------------------------------------------ visitor messages

  private onVisitorMessage(v: Visitor, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    const now = Date.now();
    const verdict = v.limiter.check(now);
    if (verdict === "close") return this.endVisit(v, "Too many messages.");
    const msg = decodeClient(message);
    if (verdict === "reject" && msg) return this.reject(v, msg, "Slow down a little.");
    if (verdict !== "ok" || !msg) return;
    this.maybeRecheckSession(v, v.userId, now, () => {
      if (this.visitors.get(v.ws) !== v) return;
      this.visitors.remove(v);
      markLeft(this.invites, v.userId, Date.now(), true);
      this.persist({ invites: true });
      send(v.ws, { t: "notice", text: "Your session ended. Please sign in again.", kind: "error" });
      closeQuietly(v.ws, CLOSE_SESSION_ENDED, "session ended");
      this.sendVisitorList();
    });
    this.handleVisitor(v, msg, now);
  }

  /** Every visitor message goes through visitorVerdict first (see visit/permissions.ts). */
  private handleVisitor(v: Visitor, msg: ClientMsg, now: number): void {
    const verdict = visitorVerdict(msg);
    if ("deny" in verdict) return this.reject(v, msg, verdict.deny);
    switch (msg.t) {
      case "move":
        v.motion.onMove(msg.dx, msg.dy, msg.seq);
        this.startTick();
        return;
      case "moveTo":
        if (!v.motion.onMoveTo(this.grid, v.entity, msg.x, msg.y, msg.seq, now)) this.reject(v, msg, "Can't walk there.");
        this.startTick();
        return;
      case "chat":
        return this.onChat(v, v.userId, v.entity, msg.text, now);
      case "emote":
        if (now - v.lastEmote < EMOTE_MIN_INTERVAL_MS) return;
        v.lastEmote = now;
        this.toAll({ t: "emote", from: v.entity.id, code: msg.code });
        return;
      case "ping":
        send(v.ws, { t: "pong", at: msg.at, serverTime: now });
        return;
      case "use":
        return this.visitorHarvest(v, msg, now);
      default:
        return this.reject(v, msg, "Only the owner can do that here.");
    }
  }

  /** A visitor helps harvest: only ready crops, and the crop goes to the owner (bag, else bin). */
  private visitorHarvest(v: Visitor, msg: Extract<ClientMsg, { t: "use" }>, now: number): void {
    if (now - v.lastUse < USE_COOLDOWN_MS) return this.reject(v, msg, "Too fast.");
    v.lastUse = now;
    const save = this.save;
    if (!save || !this.player) return this.reject(v, msg, "Nothing to do here.");
    if (!inToolReach(v.entity, msg.x, msg.y)) return this.reject(v, msg, "Too far away.");
    const tile = this.farm.find((t) => t.x === msg.x && t.y === msg.y);
    const fnow = farmNow(this.clock.day);
    const ready = tile ? harvestYield(tile, fnow, Math.random) : null;
    if (!tile || !ready) return this.reject(v, msg, "Visitors can only help harvest ripe crops.");
    if (!canCredit(save.inventory, this.bin, ready)) {
      return this.reject(v, msg, `${save.name}'s bag and shipping bin are both full.`);
    }
    harvestCrop(tile, fnow);
    const credit = creditHarvest(save.inventory, this.bin, ready)!;
    v.entity.act = { k: "harvest", at: now };
    this.toAll({ t: "farm", tiles: [tile] });
    if (credit === "bag") send(this.player.ws, { t: "inventory", inventory: save.inventory });
    else this.sendBin(this.player);
    this.persist({ farm: true, save: credit === "bag", day: credit === "bin" });
    this.tally.add(v.name, ready, credit, now);
    send(v.ws, { t: "notice", text: `+1 ${getItem(ready)?.name ?? ready} for ${save.name}`, kind: "loot" });
    this.startTick();
  }

  /** Local dev only (see devToolsEnabled): "/day" ends the day now, "/time 21" sets the clock. */
  private devCommand(p: HPlayer, text: string, now: number): boolean {
    if (text === "/day") {
      this.endDay("sleep", now);
      return true;
    }
    const m = /^\/time (\d{1,2})(?::(\d{2}))?$/.exec(text);
    if (!m) return false;
    const h = Number(m[1]);
    this.clock = clockAtMinutes(this.clock, (h < 6 ? h + 24 : h) * 60 + Number(m[2] ?? 0), now);
    this.persist({ day: true });
    this.sendHomeState(p);
    this.toVisitors(this.visitorHomeState(now));
    void this.scheduleRockAlarm(now);
    return true;
  }

  // ------------------------------------------------------------------ day / vitals

  private homeStateMsg(now = Date.now()): HomeServerMsg {
    const save = this.save!;
    return {
      t: "homeState",
      clock: { ...this.clock },
      stamina: clampStamina(save.stamina),
      maxStamina: MAX_STAMINA,
      water: clampWater(save.water),
      maxWater: MAX_WATER,
      serverTime: now,
    };
  }

  private sendHomeState(p: HPlayer): void {
    if (this.save) send(p.ws, this.homeStateMsg());
  }

  /** Visitors see the host's clock (and so its lighting); stamina and water aren't theirs to see. */
  private visitorHomeState(now = Date.now()): HomeServerMsg {
    return {
      t: "homeState",
      clock: { ...this.clock },
      stamina: MAX_STAMINA,
      maxStamina: MAX_STAMINA,
      water: MAX_WATER,
      maxWater: MAX_WATER,
      serverTime: now,
    };
  }

  private sendBin(p: HPlayer, open = false): void {
    const { lines, total } = binPayout(this.bin);
    send(p.ws, { t: "bin", items: lines, total, ...(open ? { open: true } : {}) });
  }

  /** How long others at home get to see "<host> is going to sleep…" before the day ends. */
  protected sleepCountdownMs(): number {
    return sleepCountdownFor(this.visitors.size);
  }

  private nearBed(p: HPlayer): boolean {
    return this.objects.some(
      (o) => o.item === "bed_simple" && distToRect(p.entity, objectRect(o.item, o.x, o.y, o.rotation)) <= BED_REACH,
    );
  }

  private onSleep(p: HPlayer, now: number): void {
    if (this.sleepAt !== null) return;
    if (!this.nearBed(p)) return this.reject(p, { t: "sleep" }, "Walk up to your bed to sleep.");
    const wait = this.sleepCountdownMs();
    if (wait <= 0) return this.endDay("sleep", now);
    this.sleepAt = now + wait;
    p.motion.stop();
    this.toAll({ t: "sleeping", host: p.entity.name, endsAt: this.sleepAt });
    this.startTick();
  }

  /**
   * Ends the current day: farm roll, shipping payout, stamina, next morning. "away" settles a
   * day that ended while the owner was elsewhere (called once they are home holding the lease).
   */
  private endDay(kind: DayEndKind, now: number): void {
    const save = this.save;
    if (!save) return;
    this.sleepAt = null;
    const st = { clock: this.clock, farm: this.farm, objects: this.objects, bin: this.bin };
    // Server-wide "crops shipped today" counts what the bin actually pays out (unshipping can undo a shipment).
    const cropsShipped = this.bin.reduce((n, e) => n + (getItem(e.item)?.kind === "crop" ? e.qty : 0), 0);
    const res = endHomeDay(st, kind, save.inventory.coins, now, Math.random);
    if (cropsShipped > 0) reportStat(this.env, "crops_shipped", cropsShipped);
    this.clock = st.clock;
    this.farm = st.farm;
    this.bin = st.bin;
    save.inventory.coins = Math.max(0, save.inventory.coins + res.coinsDelta);
    save.stamina = res.stamina;
    const p = this.player;
    if (p && kind !== "away") this.wakeByBed(p);
    this.persist({ save: true, farm: true, day: true });
    if (p) this.sendMorning(p, res.summary);
    void this.scheduleRockAlarm(now);
  }

  private sendMorning(p: HPlayer, summary: DaySummary): void {
    this.toVisitors({ t: "farmAll", tiles: this.farm });
    this.toVisitors(this.visitorHomeState());
    this.toVisitors({ t: "notice", text: `A new day begins at ${this.save!.name}'s home.`, kind: "info" });
    send(p.ws, { t: "farmAll", tiles: this.farm });
    send(p.ws, { t: "inventory", inventory: this.save!.inventory });
    this.sendHomeState(p);
    this.sendBin(p);
    send(p.ws, { t: "daySummary", summary });
  }

  /** Mornings start next to the bed. */
  private wakeByBed(p: HPlayer): void {
    const bed = this.objects.find((o) => o.id === DEFAULT_BED.id) ?? this.objects.find((o) => o.item === "bed_simple");
    p.motion.stop();
    if (!bed) return;
    const r = objectRect(bed.item, bed.x, bed.y, bed.rotation);
    const spots = [
      { x: r.x + r.w + 0.5, y: r.y + r.h - 0.5 },
      { x: r.x - 0.5, y: r.y + r.h - 0.5 },
      { x: r.x + 0.5, y: r.y + r.h + 0.5 },
    ];
    const at = spots.find((s) => canStand(this.grid, s.x, s.y));
    if (at) {
      p.entity.x = at.x;
      p.entity.y = at.y;
      p.entity.facing = "down";
    }
  }

  private stamina(): number {
    return clampStamina(this.save!.stamina);
  }

  /** Spends tool stamina; false (and a reject) when too tired. */
  private spendStamina(p: HPlayer, msg: ClientMsg, def: ItemDef): boolean {
    const cost = staminaCost(def.tool);
    if (cost <= 0) return true;
    const have = this.stamina();
    if (have < cost) {
      this.reject(p, msg, "You're too tired. Eat something or go to bed.");
      return false;
    }
    this.save!.stamina = have - cost;
    return true;
  }

  private act(p: HPlayer, k: string, now: number, item?: string): void {
    p.entity.act = item ? { k, at: now, item } : { k, at: now };
    this.startTick();
  }

  private onEat(p: HPlayer, msg: Extract<ClientMsg, { t: "eat" }>, now: number): void {
    if (now - p.lastUse < USE_COOLDOWN_MS) return this.reject(p, msg, "Too fast.");
    p.lastUse = now;
    const inv = this.save!.inventory;
    const slot = inv.slots[msg.slot];
    const def = slot ? getItem(slot.item) : undefined;
    if (!slot || !def?.eat) return this.reject(p, msg, "You can't eat that.");
    const gain = eatGain(def.id, this.stamina());
    if (gain <= 0) return this.reject(p, msg, "You're not hungry.");
    if (!removeFromSlot(inv, msg.slot, 1)) return this.reject(p, msg, "Nothing in that slot.");
    this.save!.stamina = this.stamina() + gain;
    this.act(p, "eat", now);
    this.sendHomeState(p);
    this.inventoryChanged(p, `Ate ${def.name} (+${gain} stamina)`);
  }

  private onUnship(p: HPlayer, msg: Extract<ClientMsg, { t: "unship" }>): void {
    const bin = HOME_MAP.props.find((pr) => pr.type === "shipping_bin");
    if (!bin || distToRect(p.entity, bin) > PROP_REACH + 1) return this.reject(p, msg, "Walk up to the shipping bin.");
    const r = unshipLast(this.save!.inventory, this.bin);
    if (!r.ok) return this.reject(p, msg, r.reason);
    this.persist({ day: true });
    this.sendBin(p, true);
    this.inventoryChanged(p, r.text);
  }

  /** Watering can refills on water tiles and at the well. */
  private isWaterSource(x: number, y: number): boolean {
    if (x >= 0 && y >= 0 && x < HOME_MAP.width && y < HOME_MAP.height && HOME_MAP.ground[y * HOME_MAP.width + x] === Ground.Water) return true;
    return HOME_MAP.props.some((pr) => pr.type === "well" && pointInRect(pr, x, y));
  }

  /** Guests may dress up too; the look lives in the save and shows on the entity next tick. */
  private onSetLook(p: HPlayer, msg: Extract<ClientMsg, { t: "setLook" }>, now: number): void {
    if (!canChangeLook(p.lastLook, now)) return this.reject(p, msg, "Slow down a little.");
    p.lastLook = now;
    const save = this.save!;
    save.look = { ...msg.look };
    p.entity.look = save.look;
    this.persist({ save: true });
  }

  private onUse(p: HPlayer, msg: Extract<ClientMsg, { t: "use" }>, now: number): void {
    if (now - p.lastUse < USE_COOLDOWN_MS) return this.reject(p, msg, "Too fast.");
    p.lastUse = now;
    const save = this.save!;
    const inv = save.inventory;
    const slot = inv.slots[msg.slot];
    const def = slot ? getItem(slot.item) : undefined;
    if (!slot || !def) return this.reject(p, msg, "Nothing in that slot.");
    p.lastSlot = msg.slot;
    if (!inToolReach(p.entity, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    // Farm functions run on the home day, not on real time (see homeclock.farmNow).
    const fnow = farmNow(this.clock.day);

    if (def.tool === "pickaxe") {
      const rock = this.rocks.at(msg.x, msg.y);
      if (rock) return this.mine(p, msg, rock, def, now);
    }

    if (def.tool === "water" && this.isWaterSource(msg.x, msg.y)) {
      if (clampWater(save.water) >= MAX_WATER) return this.reject(p, msg, "Your watering can is already full.");
      save.water = MAX_WATER;
      this.act(p, "water", now, def.id);
      this.sendHomeState(p);
      send(p.ws, { t: "notice", text: "Watering can refilled", kind: "info" });
      return this.persist({ save: true });
    }

    const tile = this.farm.find((t) => t.x === msg.x && t.y === msg.y);
    if (tile) {
      const ready = harvestYield(tile, fnow, Math.random);
      if (ready) {
        if (!canAdd(inv, ready, 1)) return this.reject(p, msg, "Your bag is full.");
        harvestCrop(tile, fnow);
        addItem(inv, ready, 1);
        this.act(p, "harvest", now);
        reportStat(this.env, "crops_harvested", 1);
        this.toAll({ t: "farm", tiles: [tile] });
        this.persist({ farm: true });
        return this.inventoryChanged(p, `+1 ${getItem(ready)?.name ?? ready}`);
      }
      if (def.tool === "water") {
        if (!tile.crop) return this.reject(p, msg, "Nothing to water.");
        if (tile.lastWateredDay === this.clock.day) return this.reject(p, msg, "Already watered today.");
        if (clampWater(save.water) <= 0) return this.reject(p, msg, "Your watering can is empty. Refill it at the well or pond.");
        if (!this.spendStamina(p, msg, def)) return;
        if (!waterTile(tile, fnow)) return this.reject(p, msg, "Already watered today.");
        save.water = clampWater(save.water) - 1;
        this.act(p, "water", now, def.id);
        this.toAll({ t: "farm", tiles: [tile] });
        this.sendHomeState(p);
        return this.persist({ farm: true, save: true });
      }
      if (def.kind === "seed") {
        if (!plantTile(tile, def.id, fnow)) return this.reject(p, msg, "Something is already growing here.");
        tile.dryDays = 0;
        removeFromSlot(inv, msg.slot, 1);
        this.act(p, "plant", now);
        this.toAll({ t: "farm", tiles: [tile] });
        this.persist({ farm: true });
        return this.inventoryChanged(p);
      }
      return this.reject(p, msg, def.tool === "hoe" ? "Already tilled." : "Nothing to do here.");
    }

    if (def.tool === "hoe") {
      const blocked = this.rocks.at(msg.x, msg.y) !== null;
      if (blocked || !isFarmable(HOME_MAP, msg.x, msg.y, this.objects)) return this.reject(p, msg, "You can't till here.");
      if (!this.spendStamina(p, msg, def)) return;
      const t = tillTile(msg.x, msg.y);
      this.farm.push(t);
      this.act(p, "hoe", now, def.id);
      this.toAll({ t: "farm", tiles: [t] });
      this.sendHomeState(p);
      return this.persist({ farm: true, save: true });
    }

    const bin = HOME_MAP.props.find((pr) => pr.type === "shipping_bin" && pointInRect(pr, msg.x, msg.y));
    if (bin && !def.tool) return this.ship(p, msg, msg.slot);
    this.reject(p, msg, "Nothing to do here.");
  }

  private mine(
    p: HPlayer,
    msg: Extract<ClientMsg, { t: "use" }>,
    rock: { id: string; x: number; y: number; ore: "stone" | "copper" | "iron" | "gem" },
    def: ItemDef,
    now: number,
  ): void {
    if (!canMine(rock.ore, def.power ?? 1)) return this.reject(p, msg, "You need a stronger pickaxe.");
    const save = this.save!;
    const drops = rockDrops(rock.ore, Math.random);
    const trial = cloneInventory(save.inventory);
    if (!drops.every((d) => addItem(trial, d.item, d.qty))) return this.reject(p, msg, "Your bag is full.");
    if (!this.spendStamina(p, msg, def)) return;
    save.inventory = trial;
    this.act(p, "pickaxe", now, def.id);
    this.sendHomeState(p);
    this.rocks.breakRock(rock, this.grid, now);
    this.toAll({ t: "rock", id: rock.id, broken: true });
    this.persist({ rocks: true });
    void this.scheduleRockAlarm(now);
    this.inventoryChanged(p, drops.map((d) => `+${d.qty} ${getItem(d.item)?.name ?? d.item}`).join(", "));
  }

  /** Puts a whole stack in the shipping bin; it is paid at the end of the day. */
  private ship(p: HPlayer, msg: ClientMsg, slot: number): void {
    const r = shipSlot(this.save!.inventory, this.bin, slot);
    if (!r.ok) return this.reject(p, msg, r.reason);
    this.persist({ day: true });
    this.sendBin(p, true);
    this.inventoryChanged(p, r.text);
  }

  /** Targets: "shipping_bin" (sells the last used slot) or "shipping_bin:<slot>". */
  private onInteract(p: HPlayer, target: string): void {
    const [propId, slotStr] = target.split(":");
    const prop = HOME_MAP.props.find((pr) => pr.id === propId);
    if (!prop || distToRect(p.entity, prop) > PROP_REACH) return;
    if (prop.type !== "shipping_bin") return;
    const slot = slotStr !== undefined && /^\d{1,2}$/.test(slotStr) ? Number(slotStr) : p.lastSlot;
    const item = slot === null ? undefined : this.save!.inventory.slots[slot];
    const def = item ? getItem(item.item) : undefined;
    // Holding something shippable ships it; anything else just opens the bin.
    if (slot === null || !def || def.sell <= 0 || def.kind === "tool") return this.sendBin(p, true);
    this.ship(p, { t: "interact", target }, slot);
  }

  private inPlaceReach(p: HPlayer, x: number, y: number): boolean {
    return dist(p.entity, { x: x + 0.5, y: y + 0.5 }) <= PLACE_REACH;
  }

  private objectsChanged(p: HPlayer, upd: PlacedObject[], del: string[]): void {
    this.rebuildGrid();
    this.toAll({ t: "objects", upd, del });
    this.persist({ objects: true });
  }

  private onPlace(p: HPlayer, msg: Extract<ClientMsg, { t: "place" }>): void {
    const inv = this.save!.inventory;
    const slot = inv.slots[msg.slot];
    if (!slot) return this.reject(p, msg, "Nothing in that slot.");
    if (!this.inPlaceReach(p, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    const ok = canPlace(HOME_MAP, this.objects, this.farm, slot.item, msg.x, msg.y, msg.rotation, { occupied: this.entities() });
    if (!ok.ok) return this.reject(p, msg, ok.reason);
    const item = slot.item;
    if (!removeFromSlot(inv, msg.slot, 1)) return this.reject(p, msg, "Nothing in that slot.");
    const obj: PlacedObject = { id: `o${++this.objSeq}`, item, x: msg.x, y: msg.y, rotation: msg.rotation };
    this.objects.push(obj);
    this.objectsChanged(p, [obj], []);
    this.inventoryChanged(p);
  }

  private onMoveObject(p: HPlayer, msg: Extract<ClientMsg, { t: "moveObject" }>): void {
    const obj = this.objects.find((o) => o.id === msg.id);
    if (!obj) return this.reject(p, msg, "That isn't here any more.");
    if (!this.inPlaceReach(p, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    const ok = canPlace(HOME_MAP, this.objects, this.farm, obj.item, msg.x, msg.y, msg.rotation, {
      ignoreId: obj.id,
      occupied: this.entities(),
    });
    if (!ok.ok) return this.reject(p, msg, ok.reason);
    Object.assign(obj, { x: msg.x, y: msg.y, rotation: msg.rotation });
    this.objectsChanged(p, [obj], []);
  }

  private onPickup(p: HPlayer, msg: Extract<ClientMsg, { t: "pickup" }>): void {
    const i = this.objects.findIndex((o) => o.id === msg.id);
    if (i < 0) return this.reject(p, msg, "That isn't here any more.");
    const obj = this.objects[i];
    if (obj.id === DEFAULT_BED.id) return this.reject(p, msg, "Your bed stays. You can move it instead.");
    if (!this.inPlaceReach(p, obj.x, obj.y)) return this.reject(p, msg, "Too far away.");
    const inv = this.save!.inventory;
    if (!addItem(inv, obj.item, 1)) return this.reject(p, msg, "Your bag is full.");
    this.objects.splice(i, 1);
    this.objectsChanged(p, [], [obj.id]);
    this.inventoryChanged(p);
  }
}
