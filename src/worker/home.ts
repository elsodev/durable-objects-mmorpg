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
import { sanitizeCaveTrail, type CaveTrail } from "../shared/caveLevels";
import { DurableObject } from "cloudflare:workers";
import { TRAVEL_SPAWN, travelBlock } from "../shared/travel";
import { devToolsEnabled, H_VISIT_LOOK, H_VISIT_OWNER, H_VISIT_RETURN, H_VISIT_SPRITE, type Env } from "./env";
import type { HomeMapId, Inventory, Look, ZoneId } from "../shared/types";
import { TICK_MS, type EntityState, type Facing, type FarmTile, type MapExit, type PlacedObject, type RockOre, type Vec2 } from "../shared/types";
import { parseDropRates, type DropRates } from "../shared/engine/dropRate";
import type { DaySummary, HomeServerMsg } from "../shared/home";
import { decodeClient, type ClientMsg, type ImpactStamp, type ServerMsg } from "../shared/protocol";
import { cleanChat, safeSpawnName } from "../shared/validate";
import { getItem, isBedItem, isShippable, starterInventory, type ItemDef } from "../shared/items";
import { putIntoStorage, takeFromStorage } from "../shared/engine/storage";
import { boxFor, containerEmpty, orphanedItems, sanitizeContainers, storageMsg, type Containers } from "./home/containers";
import { isRareCrop } from "../shared/seeds";
import { getMap } from "../shared/maps";
import { bumpStat, cleanStats, mergeStats, type PlayerStats, type StatKey } from "../shared/players";
import type { CardPeek } from "./players/card";
import {
  allObjects,
  doorArrival,
  doorTarget,
  emptyObjects,
  entitiesOn,
  HOME_MAPS,
  HOME_OUT,
  homeMap,
  onMap,
  resolveHomeArrival,
  standOn,
  SubMaps,
  toMap,
  type HomeObjects,
} from "./home/submaps";
import { HOME_FAINT_SPAWN } from "../shared/maps/home";
import { addAllOrNothing, moveRefusal, pickupRefusal } from "./home/arrange";
import { checkArrange } from "../shared/engine";
import { BED_ID, BED_ITEM, ensureBed, HOME_LAYOUT, mapForItem, migrateObjects, validateObjects } from "./home/migrate";
import { addNote, addParcel, emptyMail, mailMsg, sanitizeMail, takeParcels, type MailState } from "./home/mailbox";
import { MAILBOX_ID, MAILBOX_TAKE } from "../shared/mail";
import {
  addItem,
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
  facingFor,
  facingToTile,
  farmNow,
  farmingLevel,
  harvestable,
  harvestCrop,
  clearDeadCrop,
  harvestRand,
  impactDelayMs,
  isFarmable,
  isWaterSource,
  MAX_STAMINA,
  MAX_WATER,
  objectRect,
  plantTile,
  rockRand,
  rollHarvest,
  staminaCost,
  EXHAUSTED_NOTICE,
  FARM_LOCKED_NOTICE,
  RESTED_EATING_NOTICE,
  farmLocked,
  isExhausted,
  type HarvestRoll,
  type HomeClock,
  pointInRect,
  removeFromSlot,
  moveSlot,
  tillTile,
  waterTile,
} from "../shared/engine";
import { dropSpot, sortBag, takeForDrop } from "../shared/engine";
import { eatFrom, eatNotice } from "../shared/engine/eating";
import { viewOf } from "./game/groundItems";
import { HomeDrops } from "./home/drops";
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
import { chargeDash, spendEnergy, type EnergyChange, type EnergyState } from "./game/energy";
import { applyHeld } from "./game/held";
import { bondList } from "./game/bonds";
import { sanitizeBonds, type Bonds } from "../shared/hearts";
import { ANIMAL_CARE_REACH, ANIMAL_PREFIX, emptyAnimals, sanitizeAnimals, villageAnimal, type AnimalSave } from "../shared/animals";
import { BARN_ID, BARN_ITEM, BARN_CAPACITY, chickenById, collectEgg, layEggs } from "../shared/ranch";
import { AnimalHerd } from "./game/animalHerd";
import { feedAnimal, petAnimal, petHen, swordAnimal, swordHen, type CareOutcome, type UpsetOutcome } from "./game/animalCare";
import { HitCooldown } from "../shared/animalUpset";
import { eggSpots, eggViews, ensureBarn, yardAnimals } from "./home/ranch";
import { ensureWardrobe, WARDROBE_ID, wardrobeRefusal } from "./home/wardrobe";
import { FORAGE_REACH, GROUND_TARGET_PREFIX } from "../shared/spawns";
import { canChangeLook, savedLook, shownLook } from "./game/look";
import { RockField } from "./game/rockField";
import { rockDrops } from "./game/rocks";
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
} from "../shared/engine/toolRules";
import { endPose, POSE_ACT, POSE_MIN_INTERVAL_MS, poseRefusal } from "../shared/poses";
import { boulderAt, nextWrongToolStreak, wrongToolCost, wrongToolNotice, type WrongToolStreak } from "../shared/engine/wrongTool";
import { binPayout, sanitizeBin, shipSlot, unshipLast, type BinEntry } from "./game/shipping";
import { endHomeDay, type DayEndKind } from "./game/homeDay";
import { sanitizeClock } from "./game/homeState";
import { reportPresence, reportStat } from "./social/hooks";
import { EMOTE_MIN_INTERVAL_MS } from "../shared/emotes";
import { distToRect, inToolReach, PROP_REACH } from "./game/range";
import { CLOSE_ABUSE, SocketLimiter } from "./game/rateLimit";
import { sanitizeTransfer, type PendingTransfer } from "./game/spawn";
import { CLOSE_SESSION_ENDED, recheckDue, sessionStillValid } from "./game/session";
import { CLOSE_REMOVED } from "../shared/admin";
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
import { TRADE_ELSEWHERE, visitorVerdict } from "./visit/permissions";
import { canCredit, creditHarvest, harvestText, HarvestTally } from "./visit/harvest";
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
  /** At home: which home map x/y are on (absent: the yard). */
  homeMap?: HomeMapId;
  /** Session lease issued by loadPlayer; must be passed back to savePlayer. */
  lease?: string;
  /** Home simulation: stamina (0..100) and water left in the watering can. Absent = full. */
  stamina?: number;
  /** Worn out: stamina ran out since the last day reset (slow walk, no dash, no farming). */
  exhausted?: boolean;
  water?: number;
  /** Lifetime counters for the player card (shared/players.ts). Absent = all zero. */
  stats?: PlayerStats;
  /** Friendship with each villager met (shared/hearts.ts); zones change it, the home shows it. */
  bonds?: Bonds;
  /** Cave levels: the map above each one the player last came down from (shared/caveLevels.ts). */
  caveTrail?: CaveTrail;
  /** Animal affection, adopted pets, the barn, hens and eggs (shared/animals.ts). Absent = none. */
  animals?: AnimalSave;
  /**
   * savePlayer: the exit just taken (recorded so the next join may use that spawn).
   * loadPlayer: the pending transfer, if any (consumed by the call).
   */
  transfer?: PendingTransfer | { to: ZoneId; spawn: string };
}

export interface HomeExport {
  save: PlayerSave;
  farm: import("../shared/types").FarmTile[];
  /** Yard furniture (older exports: every object, in the pre-house layout). */
  objects: import("../shared/types").PlacedObject[];
  /** Furniture inside the house; absent in exports from before the house. */
  objectsIn?: import("../shared/types").PlacedObject[];
  /** What is inside storage furniture (fridges), by object id; absent in older exports. */
  containers?: Containers;
}

/** The yard (exits, farm, rocks, shipping bin, mailbox). The house inside is HOME_IN (./home/submaps). */
const HOME_MAP = HOME_OUT;
const USE_COOLDOWN_MS = 200;
/** Decorating works from across the room, not across the map. */
const PLACE_REACH = 10;
/** place / moveObject / pickup share one cooldown, like use. */
const BUILD_COOLDOWN_MS = 200;
/** A broken rock the player is standing on retries its respawn this much later. */
const ROCK_RETRY_MS = 5000;
const GUEST_REASON = "Create a free account to visit Mossbrook village.";
/** Pieces one mailGift call may post. */
const MAX_MAILED_GIFTS = 5;
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
  /** Last /sleep or /piss (ms), to throttle them. */
  lastPose?: number;
  lastTravel?: number;
  /** The home map the owner stands on. */
  map: HomeMapId;
  guest: boolean;
  entity: EntityState;
  motion: Motion;
  lastAck: number | undefined;
  lastUse: number;
  /** Last time the owner ate (EAT_COOLDOWN_MS between bites). */
  lastEat?: number;
  /** Last hotbar slot used, so a plain "shipping_bin" interact knows which stack to sell. */
  lastSlot: number | null;
  lastLook: number;
  /** The storage piece (object id) the owner has open, if any. */
  openStore?: string | null;
  /** Selected hotbar slot (the `hold` intent); its tool shows in the hand as entity.held. */
  heldSlot: number | null;
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
  /** Wrong-tool hits in a row (axe on a rock...): each one tires the owner more. */
  private wrongTool: WrongToolStreak | null = null;
  private lease: string | null = null;
  private farm: FarmTile[] = [];
  /** Placed furniture per home map. */
  private objects: HomeObjects = emptyObjects();
  private objSeq = 0;
  /** Storage furniture contents (fridges), by object id. */
  private containers: Containers = {};
  private drops = new HomeDrops();
  private transfer: PendingTransfer | null = null;
  private rocks = new RockField(HOME_MAP);
  /** Collision grids and entity differs of the yard and the house. */
  private maps = new SubMaps(this.objects);
  private trees = new TreeField(HOME_MAP);
  /** Hit progress on rocks, trees and stumps (not persisted: it fades anyway). */
  private hits = new HitTracker();
  private player: HPlayer | null = null;
  /** One upset per animal every few seconds, however fast the sword swings. */
  private animalHits = new HitCooldown();
  private mail: MailState = emptyMail();
  /** The owner's dash time under one stamina point (not saved: it is less than half a second). */
  private dashCarry = 0;
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
  /** Adopted pets and hens wandering the yard (rebuilt from the save; not persisted). */
  private herd = new AnimalHerd(() => this.maps.grids.home, HOME_MAP.exits, Math.random, HOME_MAP.props);

  /** Drop-rate multipliers from env (DROP_RATE*), read once per instance. */
  private readonly rates: DropRates;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.rates = parseDropRates(env as unknown as Record<string, unknown>);
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
        this.player = this.makePlayer(ws, att, pos, 0, att.homeMap ?? "home");
      }
      const now = Date.now();
      for (const ws of sockets) {
        const att = readAttachment(ws);
        if (!att?.visit) continue;
        const map: HomeMapId = att.homeMap ?? "home";
        const pos = standOn(this.maps.grids[map], map, att.x !== undefined && att.y !== undefined ? { x: att.x, y: att.y } : null);
        const v = this.visitors.add(ws, att as SocketAttachment & { visit: VisitAttachment }, pos, 0, now);
        v.map = map;
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
      "rockSpawns",
      "trees",
      "objSeq",
      "transfer",
      "clock",
      "bin",
      "invites",
      "inbox",
      "inviteTimes",
      "hostName",
      "layout",
      "homeObjects",
      "mail",
      "containers",
      "drops",
    ]);
    const owner = got.get("owner");
    this.owner = typeof owner === "string" ? owner : null;
    this.save = (got.get("save") as Omit<PlayerSave, "lease"> | undefined) ?? null;
    if (this.save) this.save.inventory = sanitizeInventory(this.save.inventory);
    const lease = got.get("lease");
    this.lease = typeof lease === "string" ? lease : null;
    this.farm = sanitizeFarm(got.get("farm"));
    this.mail = sanitizeMail(got.get("mail"));
    this.loadObjects(got.get("layout"), got.get("homeObjects"), got.get("objects"), Date.now());
    this.objSeq = objSeqFor(allObjects(this.objects), got.get("objSeq"));
    this.containers = sanitizeContainers(got.get("containers"), allObjects(this.objects));
    this.drops.load(got.get("drops"), Date.now());
    this.transfer = sanitizeTransfer(got.get("transfer"));
    this.clock = sanitizeClock(got.get("clock"), Date.now());
    this.bin = sanitizeBin(got.get("bin"));
    this.invites = sanitizeInvites(got.get("invites"));
    this.inbox = sanitizeInbox(got.get("inbox"), Date.now());
    const times = got.get("inviteTimes");
    this.inviteTimes = Array.isArray(times) ? times.filter((t): t is number => typeof t === "number").slice(-100) : [];
    const hostName = got.get("hostName");
    this.hostName = typeof hostName === "string" ? hostName : null;
    if (this.save) this.ensureFixtures(Date.now());
    const unbroken = this.rocks.load(got.get("rocks") as Record<string, number> | undefined, got.get("rockSpawns"));
    this.trees.load(got.get("trees"));
    this.maps.rebuild(this.objects, unbroken, this.trees);
    // After a wake the yard's pets and hens start again from their spots.
    if (this.save) this.settleAnimals(Date.now());
    await this.scheduleRockAlarm();
  }

  /**
   * Furniture from storage. Saves from before the house keep one list ("objects") for the old
   * single map: they are split between the yard and the house once (see home/migrate.ts), and
   * whatever fits nowhere goes back to the owner.
   */
  private loadObjects(layout: unknown, perMap: unknown, legacy: unknown, now: number): void {
    if (layout === HOME_LAYOUT) {
      const o = (perMap ?? {}) as Partial<Record<HomeMapId, unknown>>;
      this.objects = { home: sanitizeObjects(o.home), home_in: sanitizeObjects(o.home_in) };
      return;
    }
    const old = sanitizeObjects(legacy);
    const { objects, returned } = migrateObjects(old, this.farm);
    this.objects = objects;
    if (old.length > 0) {
      this.giveBack(returned, now, "Your furniture moved into your new house.");
      this.persist({ objects: true, save: returned.length > 0, mail: true });
    }
  }

  /**
   * Items that no longer have a place: into the bag, and into a mailbox parcel when the bag is
   * full. The owner gets a letter saying what happened (`why`).
   */
  private giveBack(items: string[], now: number, why: string): void {
    const names: string[] = [];
    let parcel = false;
    for (const item of items) {
      if (!this.save || !addItem(this.save.inventory, item, 1)) {
        addParcel(this.mail, item);
        parcel = true;
      }
      names.push(getItem(item)?.name ?? item);
    }
    if (items.length === 0) return void addNote(this.mail, why, now);
    const where = parcel ? "Some are waiting here in a parcel." : "They are back in your bag.";
    addNote(this.mail, `${why} These didn't fit: ${names.join(", ")}. ${where}`, now);
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
    const tree = this.trees.nextRegrow();
    if (tree !== null) times.push(tree <= now ? now + ROCK_RETRY_MS : tree);
    if (this.player) times.push(Math.max(now + 1000, dayEndsAt(this.clock)));
    if (times.length > 0) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const p = this.player;
    const restored = this.rocks.respawnDue(this.maps.grids.home, now, this.entities("home"));
    for (const id of restored) this.toMap("home", { t: "rock", id, broken: false });
    if (restored.length > 0) this.persist({ rocks: true });
    const regrown = this.trees.regrowDue(this.maps.grids.home, now, this.entities("home"));
    for (const id of regrown) this.toMap("home", { t: "tree", id, stage: "tree", hits: 0 });
    if (regrown.length > 0) this.persist({ trees: true });
    if (p && !p.leaving && dayOver(this.clock, now)) this.endDay("passout", now);
    await this.scheduleRockAlarm(now);
  }

  /**
   * Adds the bed and the wardrobe inside the house if this home lacks them (old saves, or a fresh
   * home). Furniture cleared off the wardrobe's spot goes back to the owner with a letter.
   */
  private ensureFixtures(now: number): void {
    const bed = ensureBed(this.objects);
    const wardrobe = ensureWardrobe(this.objects);
    if (wardrobe.returned.length > 0) {
      this.giveBack(wardrobe.returned, now, "Your house now has a wardrobe for changing clothes; it stands by the back wall.");
      this.persist({ save: true, mail: true });
    }
    if (bed || wardrobe.changed) this.persist({ objects: true });
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
    this.maps.rebuild(this.objects, this.rocks.unbroken(), this.trees);
  }

  private persist(keys: {
    save?: boolean;
    farm?: boolean;
    objects?: boolean;
    rocks?: boolean;
    trees?: boolean;
    day?: boolean;
    invites?: boolean;
    inbox?: boolean;
    mail?: boolean;
    containers?: boolean;
    drops?: boolean;
  }): void {
    const entries: Record<string, unknown> = {};
    if (keys.save && this.save) entries.save = this.save;
    if (keys.farm) entries.farm = this.farm;
    if (keys.objects) {
      entries.homeObjects = this.objects;
      entries.layout = HOME_LAYOUT;
      entries.objSeq = this.objSeq;
    }
    if (keys.mail) entries.mail = this.mail;
    if (keys.containers) entries.containers = this.containers;
    if (keys.drops) entries.drops = this.drops.record();
    if (keys.rocks) {
      entries.rocks = this.rocks.record();
      entries.rockSpawns = this.rocks.spawnRecord();
    }
    if (keys.trees) entries.trees = this.trees.record();
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
      this.ensureFixtures(Date.now());
      this.rebuildGrid();
      addNote(this.mail, "Welcome to your new home! Plant on any patch of grass, ship crops in the bin, and rest in your bed inside. — Bram, Mayor of Mossbrook", Date.now());
      this.persist({ mail: true, objects: true });
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
    // Zones spend stamina on mining and chopping too.
    if (save.stamina !== undefined) this.save.stamina = clampStamina(save.stamina);
    // The village well and ponds refill the can away from home.
    if (save.water !== undefined) this.save.water = clampWater(save.water);
    // Zones can wear the player out; only this home's day end clears it.
    if (save.exhausted === true) this.save.exhausted = true;
    // Zones only send a look the player changed there; never clear a saved one.
    const look = savedLook(save.look);
    if (look) this.save.look = look;
    // Counters only grow: take the larger of each, so a late save can't roll one back.
    if (save.stats !== undefined) this.save.stats = mergeStats(this.save.stats, save.stats);
    if (save.bonds !== undefined) this.save.bonds = sanitizeBonds(save.bonds);
    if (save.caveTrail !== undefined) this.save.caveTrail = sanitizeCaveTrail(save.caveTrail);
    // Zones adopt pets and buy the barn and hens; the home lays and collects the eggs.
    if (save.animals !== undefined) this.save.animals = sanitizeAnimals(save.animals);
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
    return {
      save: structuredClone(this.save),
      farm: structuredClone(this.farm),
      objects: structuredClone(this.objects.home),
      objectsIn: structuredClone(this.objects.home_in),
      containers: structuredClone(this.containers),
    };
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
      stats: cleanStats(src.stats),
    };
    const look = savedLook(src.look);
    if (look) this.save.look = look;
    if (src.bonds !== undefined) this.save.bonds = sanitizeBonds(src.bonds);
    if (src.animals !== undefined) this.save.animals = sanitizeAnimals(src.animals);
    this.farm = sanitizeFarm(data?.farm).filter((t) => isFarmable(HOME_MAP, t.x, t.y));
    // Exports from before the house have one list in the old layout: migrate those.
    const moved = Array.isArray(data?.objectsIn)
      ? validateObjects({ home: sanitizeObjects(data.objects), home_in: sanitizeObjects(data.objectsIn) }, this.farm)
      : migrateObjects(sanitizeObjects(data?.objects), this.farm);
    this.objects = moved.objects;
    for (const item of moved.returned) if (!addItem(this.save.inventory, item, 1)) addParcel(this.mail, item);
    const kept = allObjects(this.objects);
    this.containers = sanitizeContainers(data?.containers, kept);
    // Food from a fridge that found no place comes back too.
    for (const s of orphanedItems(data?.containers, kept)) if (!addItem(this.save.inventory, s.item, s.qty, s.quality)) addParcel(this.mail, s.item, s.qty);
    this.objSeq = objSeqFor(allObjects(this.objects));
    this.ensureFixtures(Date.now());
    this.rebuildGrid();
    this.dropPlayer(CLOSE_REPLACED, "Your home moved to your new account.");
    this.lease = null;
    await this.ctx.storage.put({
      save: this.save,
      farm: this.farm,
      homeObjects: this.objects,
      layout: HOME_LAYOUT,
      objSeq: this.objSeq,
      rocks: this.rocks.record(),
      rockSpawns: this.rocks.spawnRecord(),
      mail: this.mail,
      trees: this.trees.record(),
      containers: this.containers,
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
    this.objects = emptyObjects();
    this.containers = {};
    this.mail = emptyMail();
    this.objSeq = 0;
    this.clock = sanitizeClock(null, Date.now());
    this.bin = [];
    this.sleepAt = null;
    this.invites = [];
    this.inbox = [];
    this.inviteTimes = [];
    this.rocks.load(undefined);
    this.trees.load(undefined);
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
    const text = `${inv.name} can't come over right now.`;
    addNote(this.mail, text, Date.now());
    this.persist({ invites: true, mail: true });
    if (this.player) {
      send(this.player.ws, { t: "notice", text, kind: "info" });
      this.sendMail(this.player);
    }
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
    if (this.player) {
      send(this.player.ws, { t: "invites", invites: [this.inbox[this.inbox.length - 1]!] });
      this.sendMail(this.player);
    }
  }

  /**
   * RPC (zones): a villager's furniture gift that didn't fit the owner's bag goes into a mailbox
   * parcel, with a letter from them. Only furniture, a few pieces at a time.
   */
  async mailGift(ownerId: string, from: string, items: string[]): Promise<boolean> {
    await this.assertOwner(ownerId, false);
    // Villagers gift furniture and, now and then, a rare seed.
    const gifts = (Array.isArray(items) ? items : [])
      .filter((i) => typeof i === "string" && (getItem(i)?.kind === "furniture" || isRareCrop(i)))
      .slice(0, MAX_MAILED_GIFTS);
    if (gifts.length === 0) return false;
    for (const item of gifts) addParcel(this.mail, item);
    const who = cleanName(typeof from === "string" ? from : "A friend");
    const names = gifts.map((i) => getItem(i)?.name ?? i).join(", ");
    addNote(this.mail, `${who} wanted you to have this, but your bag was full: ${names}. It's waiting here in a parcel.`, Date.now());
    this.persist({ mail: true });
    if (this.player) this.sendMail(this.player);
    return true;
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
    if (this.player) this.sendMail(this.player);
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

  /**
   * RPC (player card route): this home's day and lifetime counters. Read-only and lease-free, and
   * only numbers: never the inventory, the farm or where the player is.
   */
  async cardPeek(): Promise<CardPeek> {
    if (!this.save) return { homeDay: null, stats: null };
    return { homeDay: this.clock.day, stats: cleanStats(this.save.stats) };
  }

  /**
   * Quality and yield of harvesting `tile` now, or null when nothing is ripe. Seeded by owner, home
   * day and tile, so a retry (or a reconnect) gets the same roll.
   */
  private rollHarvestAt(tile: FarmTile, fnow: number): HarvestRoll | null {
    const crop = harvestable(tile, fnow);
    if (!crop) return null;
    const level = farmingLevel(cleanStats(this.save?.stats).cropsHarvested);
    return rollHarvest(crop, level, harvestRand(this.owner ?? "", this.clock.day, tile.x, tile.y), 0, this.rates);
  }

  /** Adds to one of the owner's lifetime counters (persisted with the next save write). */
  private bumpStat(key: StatKey): void {
    if (!this.save) return;
    this.save.stats = bumpStat(cleanStats(this.save.stats), key);
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
    // A barn bought in town is built before anyone stands on its lot; hens settle and lay.
    this.settleAnimals(Date.now());
    // Home takes the session over from whatever zone held it.
    await this.newLease();
    // A second tab of the owner replaces the first; visitors stay.
    this.dropPlayer(CLOSE_REPLACED, "Connected from another tab.", true);

    // A named spawn needs a matching exit; otherwise resume the saved home position (and map).
    const spawn = safeSpawnName(HOME_MAP.spawns, id.spawn);
    const transfer = this.takeTransfer();
    let arrival = resolveHomeArrival(spawn, save, transfer, Date.now());
    // Fainted in a zone (it recorded that exit): wake up inside, by the bed.
    if (spawn === HOME_FAINT_SPAWN && transfer?.to === "home" && transfer.spawn === HOME_FAINT_SPAWN) {
      const bed = this.bedSide();
      if (bed) arrival = { map: "home_in", at: bed };
    }
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
      ...(id.admin ? { admin: true } : {}),
    };
    server.serializeAttachment(att);
    const p = this.makePlayer(server, att, arrival.at, Date.now(), arrival.map);
    this.player = p;
    reportPresence(this.env, id.userId, "home", true);
    send(server, {
      ...this.welcomeFor(p, Date.now()),
      needsLook: !savedLook(save.look),
      bonds: bondList(sanitizeBonds(save.bonds), Date.now()),
      ...(devToolsEnabled(this.env) ? { devTools: true } : {}),
    });
    this.sendMail(p);
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
      ...(id.admin ? { admin: true } : {}),
      visit,
    };
    server.serializeAttachment(att);
    const v = this.visitors.add(server, att, at, now, now);
    markVisiting(this.invites, id.userId);
    this.persist({ invites: true });

    const host = this.save!.name;
    send(server, this.welcomeFor(v, now));
    send(server, this.visitorHomeState(now));
    if (this.sleepAt !== null) send(server, { t: "sleeping", host, endsAt: this.sleepAt });
    send(server, { t: "notice", text: `Welcome to ${host}'s home! You can help harvest ripe crops.`, kind: "info" });
    if (this.player) send(this.player.ws, { t: "notice", text: `${v.name} came to visit!`, kind: "info" });
    this.sendVisitorList();
    this.startTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Everyone at home, on either map. */
  private present(): (HPlayer | Visitor)[] {
    return this.player ? [this.player, ...this.visitors.all()] : this.visitors.all();
  }

  /** Entities on one home map (default: the yard). */
  private entities(map: HomeMapId = "home"): EntityState[] {
    return entitiesOn(this.present(), map);
  }

  /** Everyone on one home map. */
  private toMap(map: HomeMapId, msg: ServerMsg): void {
    toMap(this.present(), map, msg);
  }

  /**
   * The welcome for `who`'s current home map: its entities and furniture, and the farm and rocks
   * (and trees) in the yard only (the house has none, and must not draw them on its floor).
   */
  private welcomeFor(who: HPlayer | Visitor, now: number): Extract<ServerMsg, { t: "welcome" }> {
    const yard = who.map === "home";
    const isVisitor = who !== this.player;
    const visit = isVisitor ? (who as Visitor) : null;
    return {
      t: "welcome",
      zone: "home",
      homeMap: who.map,
      you: who.entity.id,
      entities: yard ? [...this.entities(who.map), ...this.herd.entities()] : this.entities(who.map),
      inventory: isVisitor ? VISITOR_INVENTORY : this.save!.inventory,
      farm: yard ? this.farm : [],
      objects: this.objects[who.map],
      ground: [...(yard ? eggViews(this.animals(), !isVisitor) : []), ...this.drops.on[who.map].visibleTo(isVisitor ? "" : this.owner!)],
      brokenRocks: yard ? this.rocks.brokenIds() : [],
      trees: yard ? this.trees.stages() : [],
      ...(visit ? { visit: { ownerId: this.owner!, ownerName: this.save!.name, returnTo: visit.returnTo } } : {}),
      serverTime: now,
    };
  }

  /**
   * Walks `who` through a house door onto `to` without a reconnect: a fresh welcome for that map
   * on the same socket. The socket attachment records the map so a woken home puts them back.
   */
  private switchMap(who: HPlayer | Visitor, to: HomeMapId, at: Vec2, now: number): void {
    if (who === this.player) this.closeStore(this.player);
    who.motion.stop();
    who.map = to;
    who.entity.x = at.x;
    who.entity.y = at.y;
    who.entity.moving = false;
    who.entity.facing = to === "home_in" ? "up" : "down";
    delete who.entity.act;
    const att = readAttachment(who.ws);
    if (att) {
      try {
        who.ws.serializeAttachment({ ...att, homeMap: to, x: at.x, y: at.y } satisfies SocketAttachment);
      } catch {
        // A closing socket can't take an attachment; it is about to go anyway.
      }
    }
    send(who.ws, this.welcomeFor(who, now));
    if (who === this.player && to === "home") this.sendMail(who);
    this.startTick();
  }

  private sendMail(p: HPlayer, open = false): void {
    send(p.ws, mailMsg(this.mail, liveInbox(this.inbox, Date.now()), open));
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

  private makePlayer(
    ws: WebSocket,
    att: SocketAttachment,
    at: { x: number; y: number } | null,
    authCheckedAt: number,
    map: HomeMapId = "home",
  ): HPlayer {
    const save = this.save!;
    const pos = standOn(this.maps.grids[map], map, at);
    return {
      ws,
      map,
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
        ...(att.admin ? { admin: true } : {}),
      },
      motion: this.ownerMotion(),
      lastAck: undefined,
      lastUse: 0,
      lastSlot: null,
      lastLook: 0,
      heldSlot: null,
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
    this.closeStore(p);
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
    this.save.homeMap = p.map;
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

  /** RPC (admin /kick via SocialRoom): close the owner's socket if it is theirs, and any visit of theirs here. */
  async removeUser(userId: string, text: string): Promise<number> {
    const why = String(text).slice(0, 120);
    let n = 0;
    const p = this.player;
    if (p && userId === this.owner) {
      this.kick(p, CLOSE_REMOVED, why);
      n++;
    }
    const v = this.visitors.byUser(userId);
    if (v) {
      this.visitors.remove(v);
      markLeft(this.invites, v.userId, Date.now(), true);
      this.persist({ invites: true });
      send(v.ws, { t: "notice", text: why, kind: "error" });
      closeQuietly(v.ws, CLOSE_REMOVED, why);
      this.sendVisitorList();
      n++;
    }
    return n;
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
      // A still home has stopped ticking; the next tick is what takes them off everyone's screen.
      this.startTick();
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
    const acks = new Map<HPlayer | Visitor, number | undefined>();
    acks.set(p, p.motion.step(p.entity, this.maps.grids[p.map], now));
    this.chargeOwnerDash(p, now);
    const exit = this.sleepAt === null ? exitAt(homeMap(p.map), p.entity.x, p.entity.y) : null;
    if (exit) this.takeExit(p, exit, now);

    if (p.leaving) return;
    this.tickDrops(p, now);
    for (const v of this.visitors.all()) {
      const a = v.motion.step(v.entity, this.maps.grids[v.map], now);
      const vexit = exitAt(homeMap(v.map), v.entity.x, v.entity.y);
      const door = vexit ? doorTarget(vexit) : null;
      if (vexit && door) this.switchMap(v, door, doorArrival(door, vexit.spawn, this.maps.grids[door]), now);
      // The only way out for a visitor is home: any other exit ends the visit.
      else if (vexit) {
        this.endVisit(v, "See you next time!");
        continue;
      }
      acks.set(v, a);
    }
    this.flushTally(now);

    // Each home map has its own entity list: people only see (and get ticks for) their own map.
    let changed = false;
    const people = this.present();
    // The animals only wander while someone is out in the yard to see them.
    const watched = onMap(people, "home").length > 0 && this.herd.size > 0;
    if (watched) this.herd.tick(dt, now);
    for (const map of HOME_MAPS) {
      const { upd, del } = this.maps.diff(map, people, map === "home" ? this.herd.entities() : []);
      const mapChanged = upd.length > 0 || del.length > 0;
      changed ||= mapChanged;
      for (const who of onMap(people, map)) {
        const a = acks.get(who);
        if (mapChanged || a !== who.lastAck) {
          const msg: ServerMsg = { t: "tick", at: now, upd, del };
          if (a !== undefined) {
            msg.ack = a;
            msg.ackMs = who.motion.ackMs(now);
          }
          send(who.ws, msg);
        }
        who.lastAck = a;
      }
    }
    // Nothing moves and nothing is timed (rocks use an alarm): let the home hibernate until input.
    const still = (m: Motion, e: EntityState) => m.idle && !e.moving;
    if (
      !changed &&
      !watched &&
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
    for (const text of lines) addNote(this.mail, text, now);
    if (lines.length > 0) this.persist({ mail: true });
    if (this.player) for (const text of lines) send(this.player.ws, { t: "notice", text, kind: "loot" });
    if (this.player && lines.length > 0) this.sendMail(this.player);
  }

  private takeExit(p: HPlayer, exit: MapExit, now = Date.now()): void {
    p.motion.stop();
    // House doors: switch home maps on this connection (guests may roam both).
    const door = doorTarget(exit);
    if (door) return this.switchMap(p, door, doorArrival(door, exit.spawn, this.maps.grids[door]), now);
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
      delete this.save.homeMap;
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

  /** Puts a bag stack on the ground in front of you (see home/drops.ts). */
  private onDropItem(p: HPlayer, msg: Extract<ClientMsg, { t: "dropItem" }>, now: number): void {
    const save = this.save!;
    const pile = this.drops.on[p.map];
    const at = dropSpot(this.maps.grids[p.map], p.entity, p.entity.facing);
    const out = takeForDrop(save.inventory, msg.slot, msg.qty);
    if (!out) {
      this.reject(p, msg, "There's nothing to drop there.");
      return send(p.ws, { t: "inventory", inventory: save.inventory });
    }
    const g = pile.discard(this.owner!, out.item, out.qty, at, now);
    if (!g) {
      addItem(save.inventory, out.item, out.qty);
      this.reject(p, msg, "There's no room on the ground here.");
      return send(p.ws, { t: "inventory", inventory: save.inventory });
    }
    send(p.ws, { t: "ground", upd: [viewOf(g)], del: [] });
    this.persist({ drops: true });
    this.inventoryChanged(p);
    this.startTick();
  }

  /** Walk-over pickup of what the owner dropped, and dropped things running out of time. */
  private tickDrops(p: HPlayer, now: number): void {
    let changed = false;
    for (const m of HOME_MAPS) {
      const pile = this.drops.on[m];
      for (const g of pile.expire(now)) {
        changed = true;
        if (p.map === m) send(p.ws, { t: "ground", upd: [], del: [g.id] });
      }
      if (m !== p.map) continue;
      for (const g of pile.ownedNear(this.owner!, p.entity)) {
        if (!addItem(this.save!.inventory, g.item, g.qty)) continue;
        pile.take(g.id);
        changed = true;
        send(p.ws, { t: "ground", upd: [], del: [g.id] });
        this.inventoryChanged(p, `+${g.qty} ${getItem(g.item)?.name ?? g.item}`);
      }
    }
    if (changed) this.persist({ drops: true });
  }

  private inventoryChanged(p: HPlayer, loot?: string): void {
    const save = this.save!;
    applyHeld(p.entity, save.inventory, p.heldSlot);
    send(p.ws, { t: "inventory", inventory: save.inventory });
    if (loot) send(p.ws, { t: "notice", text: loot, kind: "loot" });
    this.persist({ save: true });
  }

  private handle(p: HPlayer, msg: ClientMsg, now: number): void {
    // Moving or swinging ends a pose (sitting or lying on the ground, dancing, peeing).
    if ((msg.t === "move" && (msg.dx !== 0 || msg.dy !== 0)) || msg.t === "moveTo" || msg.t === "use") endPose(p.entity);
    switch (msg.t) {
      case "move":
        p.motion.onMove(p.entity, this.maps.grids[p.map], msg.dx, msg.dy, msg.seq, now, msg.dash === true);
        this.startTick();
        return;
      case "moveTo":
        if (!p.motion.onMoveTo(this.maps.grids[p.map], p.entity, msg.x, msg.y, msg.seq, now)) this.reject(p, msg, "Can't walk there.");
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
      case "moveObjects":
      case "pickupObjects":
        if (now - p.lastBuild < BUILD_COOLDOWN_MS) return this.reject(p, msg, "Too fast.");
        p.lastBuild = now;
        if (msg.t === "place") return this.onPlace(p, msg);
        if (msg.t === "moveObject") return this.onMoveObject(p, msg);
        if (msg.t === "moveObjects") return this.onMoveObjects(p, msg);
        if (msg.t === "pickupObjects") return this.onPickupObjects(p, msg);
        return this.onPickup(p, msg);
      case "buy":
      case "sell":
      case "donate":
      case "npcSay":
      case "noticePost":
      case "noticeVote":
      case "noticeDelete":
        return this.reject(p, msg, "Visit the village for that.");
      case "tradeRequest":
      case "tradeAnswer":
      case "tradeAdd":
      case "tradeRemove":
      case "tradeCoins":
      case "tradeReady":
      case "tradeConfirm":
      case "tradeCancel":
        return this.reject(p, msg, TRADE_ELSEWHERE);
      case "setLook":
        return this.onSetLook(p, msg, now);
      case "hold":
        p.heldSlot = msg.slot;
        applyHeld(p.entity, this.save!.inventory, p.heldSlot);
        this.startTick();
        return;
      case "emote":
        if (now - p.lastEmote < EMOTE_MIN_INTERVAL_MS) return;
        p.lastEmote = now;
        this.toAll({ t: "emote", from: p.entity.id, code: msg.code });
        return;
      case "travel": {
        // Home owns the save, so takeExit writes it before sending {t:"zone"} (as with the road).
        const why = travelBlock(msg.to, "home", now, p.lastTravel ?? 0);
        if (why) return send(p.ws, { t: "notice", text: why, kind: "error" });
        p.lastTravel = now;
        return this.takeExit(p, { x: 0, y: 0, w: 0, h: 0, to: msg.to, spawn: TRAVEL_SPAWN }, now);
      }
      case "pose": {
        // At home nobody is watching: no villagers live in the yard.
        if (now - (p.lastPose ?? 0) < POSE_MIN_INTERVAL_MS) return;
        const why = poseRefusal(p.entity, now);
        if (why) return this.reject(p, msg, why);
        p.lastPose = now;
        this.act(p, POSE_ACT[msg.pose], now);
        return;
      }
      case "ping":
        send(p.ws, { t: "pong", at: msg.at, serverTime: now });
        return;
      case "eat":
        return this.onEat(p, msg, now);
      case "sleep":
        return this.onSleep(p, now);
      case "unship":
        return this.onUnship(p, msg);
      case "storeOpen":
      case "storePut":
      case "storeTake":
        return this.onStore(p, msg);
      case "storeClose":
        if (p.openStore === msg.id) this.closeStore(p);
        return;
      case "wardrobeOpen":
        return this.onWardrobe(p, msg);
      case "petAnimal":
      case "feedAnimal":
      case "adoptAnimal":
        return this.onAnimal(p, msg, now);
      case "dropItem":
        return this.onDropItem(p, msg, now);
      case "sortBag":
        if (sortBag(this.save!.inventory)) return this.inventoryChanged(p);
        return send(p.ws, { t: "inventory", inventory: this.save!.inventory });
      case "moveSlot":
        if (!moveSlot(this.save!.inventory, msg.from, msg.to, msg.qty)) {
          this.reject(p, msg, "Can't move that there.");
          return send(p.ws, { t: "inventory", inventory: this.save!.inventory });
        }
        return this.inventoryChanged(p);
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
    // Walking or harvesting ends a pose, as it does for the owner.
    if ((msg.t === "move" && (msg.dx !== 0 || msg.dy !== 0)) || msg.t === "moveTo" || msg.t === "use") endPose(v.entity);
    switch (msg.t) {
      case "move":
        v.motion.onMove(v.entity, this.maps.grids[v.map], msg.dx, msg.dy, msg.seq, now);
        this.startTick();
        return;
      case "moveTo":
        if (!v.motion.onMoveTo(this.maps.grids[v.map], v.entity, msg.x, msg.y, msg.seq, now)) this.reject(v, msg, "Can't walk there.");
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
      case "hold":
        return; // a visitor's bag isn't loaded here: nothing to show in their hand
      case "petAnimal":
        return this.visitorPet(v, msg, now);
      case "pose": {
        if (now - (v.lastPose ?? 0) < POSE_MIN_INTERVAL_MS) return;
        const why = poseRefusal(v.entity, now);
        if (why) return this.reject(v, msg, why);
        v.lastPose = now;
        v.entity.act = { k: POSE_ACT[msg.pose], at: now };
        this.startTick();
        return;
      }
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
    if (v.map !== "home") return this.reject(v, msg, "Crops grow outside. Head out to help harvest.");
    if (!inToolReach(v.entity, msg.x, msg.y)) return this.reject(v, msg, "Too far away.");
    const tile = this.farm.find((t) => t.x === msg.x && t.y === msg.y);
    const fnow = farmNow(this.clock.day);
    const roll = tile ? this.rollHarvestAt(tile, fnow) : null;
    if (!tile || !roll) return this.reject(v, msg, "Visitors can only help harvest ripe crops.");
    const first = roll.items[0]!.item;
    if (!canCredit(save.inventory, this.bin, first)) {
      return this.reject(v, msg, `${save.name}'s bag and shipping bin are both full.`);
    }
    harvestCrop(tile, fnow);
    // The owner's level sets the odds; every crop picked still counts toward it.
    this.bumpStat("cropsHarvested");
    let toBag = false;
    let toBin = false;
    for (const { item, qty } of roll.items) {
      for (let i = 0; i < qty; i++) {
        const credit = creditHarvest(save.inventory, this.bin, item);
        if (!credit) break;
        if (credit === "bag") toBag = true;
        else toBin = true;
        this.tally.add(v.name, item, credit, now);
      }
    }
    v.entity.facing = facingToTile(v.entity, msg.x, msg.y);
    v.entity.act = { k: "harvest", at: now };
    this.toMap("home", { t: "farm", tiles: [tile] });
    if (toBag) send(this.player.ws, { t: "inventory", inventory: save.inventory });
    if (toBin) this.sendBin(this.player);
    this.persist({ farm: true, save: true, day: toBin });
    send(v.ws, { t: "notice", text: `${harvestText(roll.items)} for ${save.name}`, kind: "loot" });
    this.startTick();
  }

  /** Local dev only (see devToolsEnabled): "/day" ends the day now, "/time 21" sets the clock, "/give item 3" fills the bag. */
  private devCommand(p: HPlayer, text: string, now: number): boolean {
    if (text === "/day") {
      this.endDay("sleep", now);
      return true;
    }
    const give = /^\/give ([a-z_]{1,32})(?: (\d{1,2}))?$/.exec(text);
    if (give) {
      const item = give[1]!;
      if (!getItem(item) || !addItem(this.save!.inventory, item, Number(give[2] ?? 1))) {
        send(p.ws, { t: "notice", text: "Usage: /give item_id [qty] (with room in the bag)", kind: "error" });
      } else this.inventoryChanged(p);
      return true;
    }
    const coins = /^\/coins (\d{1,5})$/.exec(text);
    if (coins) {
      this.save!.inventory.coins += Number(coins[1]);
      this.inventoryChanged(p, `+${coins[1]} coins (dev)`);
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
      ...(this.exhausted() ? { exhausted: true } : {}),
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

  /** The bed is inside the house. */
  private nearBed(p: HPlayer): boolean {
    if (p.map !== "home_in") return false;
    return this.objects.home_in.some(
      (o) => isBedItem(o.item) && distToRect(p.entity, objectRect(o.item, o.x, o.y, o.rotation)) <= BED_REACH,
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
    // Only yard things (scarecrows) matter to the farm roll.
    const st = { clock: this.clock, farm: this.farm, objects: this.objects.home, bin: this.bin };
    // Server-wide "crops shipped today" counts what the bin actually pays out (unshipping can undo a shipment).
    const cropsShipped = this.bin.reduce((n, e) => n + (getItem(e.item)?.kind === "crop" ? e.qty : 0), 0);
    const res = endHomeDay(st, kind, save.inventory.coins, now, Math.random);
    if (cropsShipped > 0) reportStat(this.env, "crops_shipped", cropsShipped);
    this.clock = st.clock;
    this.farm = st.farm;
    this.bin = st.bin;
    save.inventory.coins = Math.max(0, save.inventory.coins + res.coinsDelta);
    save.stamina = res.stamina;
    // Rest is the only cure for being worn out.
    delete save.exhausted;
    this.dashCarry = 0;
    const p = this.player;
    if (p) p.motion.setTired(p.entity, this.maps.grids[p.map], false, now);
    if (p && kind !== "away") this.wakeByBed(p, now);
    this.persist({ save: true, farm: true, day: true });
    // A new morning: the hens lay.
    if (this.settleAnimals(now)) this.sendEggs();
    if (p) this.sendMorning(p, res.summary);
    void this.scheduleRockAlarm(now);
  }

  private sendMorning(p: HPlayer, summary: DaySummary): void {
    // The farm is only drawn in the yard; people inside get it with the yard's welcome.
    for (const v of onMap(this.visitors.all(), "home")) send(v.ws, { t: "farmAll", tiles: this.farm });
    this.toVisitors(this.visitorHomeState());
    this.toVisitors({ t: "notice", text: `A new day begins at ${this.save!.name}'s home.`, kind: "info" });
    if (p.map === "home") send(p.ws, { t: "farmAll", tiles: this.farm });
    send(p.ws, { t: "inventory", inventory: this.save!.inventory });
    this.sendHomeState(p);
    this.sendBin(p);
    send(p.ws, { t: "daySummary", summary });
  }

  /** Mornings start next to the bed, inside the house (passing out in the yard carries you in). */
  private wakeByBed(p: HPlayer, now: number): void {
    p.motion.stop();
    const grid = this.maps.grids.home_in;
    const at = this.bedSide();
    if (p.map !== "home_in") return this.switchMap(p, "home_in", standOn(grid, "home_in", at ?? null), now);
    if (at) {
      p.entity.x = at.x;
      p.entity.y = at.y;
      p.entity.facing = "down";
    }
  }

  /** A free spot beside the bed inside the house, if there is one. */
  private bedSide(): Vec2 | undefined {
    const inside = this.objects.home_in;
    const bed = inside.find((o) => o.id === BED_ID) ?? inside.find((o) => isBedItem(o.item));
    if (!bed) return undefined;
    const grid = this.maps.grids.home_in;
    const r = objectRect(bed.item, bed.x, bed.y, bed.rotation);
    const spots = [
      { x: r.x + r.w + 0.5, y: r.y + r.h - 0.5 },
      { x: r.x - 0.5, y: r.y + r.h - 0.5 },
      { x: r.x + 0.5, y: r.y + r.h + 0.5 },
    ];
    return spots.find((s) => canStand(grid, s.x, s.y));
  }

  private stamina(): number {
    return clampStamina(this.save!.stamina);
  }

  /** Worn out since the last day reset (or stamina is simply empty). */
  private exhausted(): boolean {
    return isExhausted(this.stamina(), this.save?.exhausted);
  }

  /** The owner's movement, already slowed if they are worn out. */
  private ownerMotion(): Motion {
    return this.save && this.exhausted() ? Motion.tired() : new Motion();
  }

  /**
   * Runs `f` on the owner's energy and writes it back to the save. Running out slows the owner
   * and tells them why; the caller sends homeState and persists as it already does.
   */
  private useEnergy(p: HPlayer, now: number, f: (e: EnergyState) => EnergyChange): EnergyChange {
    const save = this.save!;
    const e: EnergyState = { stamina: this.stamina(), exhausted: this.exhausted(), dashCarry: this.dashCarry };
    const change = f(e);
    save.stamina = e.stamina;
    this.dashCarry = e.dashCarry;
    if (e.exhausted) save.exhausted = true;
    if (change === "exhausted") {
      p.motion.setTired(p.entity, this.maps.grids[p.map], true, now);
      send(p.ws, { t: "notice", text: EXHAUSTED_NOTICE, kind: "error" });
    }
    return change;
  }

  /** Dashing at home drains the owner's stamina as it does in the zones. */
  private chargeOwnerDash(p: HPlayer, now: number): void {
    const change = this.useEnergy(p, now, (e) => chargeDash(e, p.motion.takeDashMs()));
    if (change === "none") return;
    this.sendHomeState(p);
    // Every few points is enough: a lost point or two after an eviction only favours the player.
    if (change === "exhausted" || this.stamina() % 5 === 0) this.persist({ save: true });
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
    this.useEnergy(p, Date.now(), (e) => spendEnergy(e, cost));
    return true;
  }

  private act(p: HPlayer, k: string, now: number, item?: string): void {
    p.entity.act = item ? { k, at: now, item } : { k, at: now };
    this.startTick();
  }

  private onEat(p: HPlayer, msg: Extract<ClientMsg, { t: "eat" }>, now: number): void {
    endPose(p.entity);
    const r = eatFrom(this.save!.inventory, msg.slot, this.stamina(), now, p.lastEat ?? -Infinity);
    if (!r.ok) return this.reject(p, msg, r.reason);
    p.lastEat = now;
    this.save!.stamina = r.stamina;
    this.act(p, "eat", now, r.item);
    this.sendHomeState(p);
    this.inventoryChanged(p, eatNotice(r));
    // Food tops stamina up for mining and chopping, but being worn out lasts until the day resets.
    if (this.exhausted()) send(p.ws, { t: "notice", text: RESTED_EATING_NOTICE, kind: "info" });
  }

  private onUnship(p: HPlayer, msg: Extract<ClientMsg, { t: "unship" }>): void {
    const bin = HOME_MAP.props.find((pr) => pr.type === "shipping_bin");
    if (!bin || p.map !== "home" || distToRect(p.entity, bin) > PROP_REACH + 1) return this.reject(p, msg, "Walk up to the shipping bin.");
    const r = unshipLast(this.save!.inventory, this.bin);
    if (!r.ok) return this.reject(p, msg, r.reason);
    this.persist({ day: true });
    this.sendBin(p, true);
    this.inventoryChanged(p, r.text);
  }

  /** Watering can refills on water tiles and at the well (shared with the client's refill cue). */
  private isWaterSource(x: number, y: number): boolean {
    return isWaterSource(HOME_MAP, x, y);
  }

  /** Turn toward the tile being worked, so tool swings and the refill face the target. */
  private faceTile(p: HPlayer, x: number, y: number): void {
    const dx = x + 0.5 - p.entity.x;
    const dy = y + 0.5 - p.entity.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    p.entity.facing = facingFor(dx, dy, p.entity.facing);
  }

  /** Guests may dress up too; the look lives in the save and shows on the entity next tick. */
  private onSetLook(p: HPlayer, msg: Extract<ClientMsg, { t: "setLook" }>, now: number): void {
    if (!canChangeLook(p.lastLook, now)) return this.reject(p, msg, "Slow down a little.");
    p.lastLook = now;
    const save = this.save!;
    save.look = { ...msg.look };
    p.entity.look = save.look;
    this.persist({ save: true });
    // Standing still at the wardrobe: tick once so everyone here sees the new clothes now.
    this.startTick();
  }

  /** What is on a tile, for the tool rules (shared/engine/toolRules.ts). */
  private targetAt(x: number, y: number, fnow: number): ToolTarget {
    const rock = this.rocks.at(x, y);
    const tree = this.trees.at(x, y);
    return classifyTarget(
      {
        rock: rock?.ore ?? null,
        tree: tree ? { stage: tree.stage, size: tree.size } : null,
        soil: this.farm.find((t) => t.x === x && t.y === y) ?? null,
        water: this.isWaterSource(x, y),
        bin: HOME_MAP.props.some((pr) => pr.type === "shipping_bin" && pointInRect(pr, x, y)),
        farmable: isFarmable(HOME_MAP, x, y, this.objects.home),
        boulder: boulderAt(HOME_MAP.props, x, y),
      },
      fnow,
    );
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
    const key = toolKeyOf(def.id);
    // A tool swings toward the tile whether or not it does anything there.
    if (isSwingTool(key)) {
      p.entity.facing = facingToward(p.entity, msg, p.entity.facing);
      this.act(p, key, now, def.id);
    }
    if (!inToolReach(p.entity, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    // Tools work in the yard; inside the house there is nothing to till, water or break.
    if (p.map !== "home") return this.reject(p, msg, "Nothing to do here.");
    // A sword swung at your own pets or hens: they aren't hurt, but they're upset (scareAnimals).
    if (weaponStats(def.id)?.arc && this.herd.inArc(p.entity, p.entity.facing).length > 0) return this.swordAtAnimals(p, key);
    // Swing at the tile that was clicked, not wherever the player happened to face.
    this.faceTile(p, msg.x, msg.y);
    // Farm functions run on the home day, not on real time (see homeclock.farmNow).
    const fnow = farmNow(this.clock.day);
    const target = this.targetAt(msg.x, msg.y, fnow);
    const out = resolveToolUse(key, target, { farm: true, power: def.power });
    if (!out.ok) {
      if (out.bounce) return this.wrongToolHit(p, msg, out.reason, key, now);
      if (out.reason) this.reject(p, msg, out.reason);
      return;
    }
    if (farmLocked(this.exhausted(), out.effect)) return this.reject(p, msg, FARM_LOCKED_NOTICE);
    this.wrongTool = null;
    // The result is applied now; `impactAt` lets every client show it when the swing lands.
    const stamp = { by: p.entity.id, impactAt: now + impactDelayMs(key, p.entity.facing) };
    const tile = this.farm.find((t) => t.x === msg.x && t.y === msg.y);
    switch (out.effect) {
      case "harvest": {
        const roll = tile ? this.rollHarvestAt(tile, fnow) : null;
        if (!tile || !roll) return this.reject(p, msg, "Nothing to harvest.");
        const trial = cloneInventory(inv);
        if (!roll.items.every((it) => addItem(trial, it.item, it.qty))) return this.reject(p, msg, "Your bag is full.");
        harvestCrop(tile, fnow);
        save.inventory = trial;
        this.act(p, "harvest", now);
        reportStat(this.env, "crops_harvested", roll.count);
        this.bumpStat("cropsHarvested");
        this.toMap("home", { t: "farm", tiles: [tile] });
        this.persist({ farm: true, save: true });
        return this.inventoryChanged(p, harvestText(roll.items));
      }
      case "clear":
        if (!tile || !clearDeadCrop(tile)) return this.reject(p, msg, "Nothing to clear.");
        if (!isSwingTool(key)) this.act(p, "harvest", now);
        this.toMap("home", { t: "farm", tiles: [tile], ...stamp });
        return this.persist({ farm: true });
      case "refill":
        if (clampWater(save.water) >= MAX_WATER) return this.reject(p, msg, "Your watering can is already full.");
        save.water = MAX_WATER;
        this.sendHomeState(p);
        send(p.ws, { t: "notice", text: "Watering can refilled", kind: "info" });
        return this.persist({ save: true });
      case "water":
        if (!tile) return this.reject(p, msg, "Nothing to water.");
        if (tile.lastWateredDay === this.clock.day) return this.reject(p, msg, "Already watered today.");
        if (clampWater(save.water) <= 0) return this.reject(p, msg, "Your watering can is empty. Refill it at the well or pond.");
        if (!this.spendStamina(p, msg, def)) return;
        if (!waterTile(tile, fnow)) return this.reject(p, msg, "Already watered today.");
        save.water = clampWater(save.water) - 1;
        this.toMap("home", { t: "farm", tiles: [tile], ...stamp });
        this.sendHomeState(p);
        return this.persist({ farm: true, save: true });
      case "plant":
        if (!tile || !plantTile(tile, def.id, fnow)) return this.reject(p, msg, "Something is already growing here.");
        removeFromSlot(inv, msg.slot, 1);
        this.act(p, "plant", now);
        this.toMap("home", { t: "farm", tiles: [tile] });
        this.persist({ farm: true });
        return this.inventoryChanged(p);
      case "till": {
        if (!this.spendStamina(p, msg, def)) return;
        const t = tillTile(msg.x, msg.y);
        this.farm.push(t);
        this.toMap("home", { t: "farm", tiles: [t], ...stamp });
        this.sendHomeState(p);
        return this.persist({ farm: true, save: true });
      }
      case "hitRock": {
        const rock = this.rocks.at(msg.x, msg.y);
        return rock ? this.mine(p, msg, rock, target, def, now, stamp) : undefined;
      }
      case "hitTree":
      case "hitStump":
        return this.chop(p, msg, target, def, now, stamp);
      case "ship":
        return this.ship(p, msg, msg.slot);
      case "hitMonster":
        return; // no monsters at home
    }
  }

  /** The tool rebounded: tire the owner (more for each wrong hit in a row) and let visitors see it. */
  private wrongToolHit(p: HPlayer, msg: Extract<ClientMsg, { t: "use" }>, reason: string, key: ToolKey, now: number): void {
    const streak = nextWrongToolStreak(this.wrongTool, now);
    this.wrongTool = streak;
    if (this.useEnergy(p, now, (e) => spendEnergy(e, wrongToolCost(streak.count))) !== "none") {
      this.sendHomeState(p);
      this.persist({ save: true });
    }
    this.reject(p, msg, wrongToolNotice(reason, streak.count));
    const bounce: ServerMsg = { t: "bounce", x: msg.x, y: msg.y, by: p.entity.id, impactAt: now + impactDelayMs(key, p.entity.facing) };
    for (const o of this.present()) if (o !== p && o.map === p.map) send(o.ws, bounce);
  }

  private mine(
    p: HPlayer,
    msg: Extract<ClientMsg, { t: "use" }>,
    rock: { id: string; x: number; y: number; ore: RockOre },
    target: ToolTarget,
    def: ItemDef,
    now: number,
    stamp: ImpactStamp,
  ): void {
    const save = this.save!;
    const need = hitsNeeded(target);
    // The last hit must fit the haul, so check the bag before counting it.
    const left = need - this.hits.progress(rock.id, now);
    const drops = left <= 1 ? rockDrops(rock.ore, rockRand(this.owner ?? "", rock.id, this.rocks.spawnOf(rock.id)), this.rates) : [];
    const trial = cloneInventory(save.inventory);
    if (left <= 1 && !drops.every((d) => addItem(trial, d.item, d.qty))) return this.reject(p, msg, "Your bag is full.");
    if (!this.spendStamina(p, msg, def)) return;
    const hit = this.hits.hit(rock.id, need, now);
    if (!hit.done) {
      this.toMap("home", { t: "rock", id: rock.id, broken: false, hits: hit.hits, need, ...stamp });
      return this.sendHomeState(p);
    }
    save.inventory = trial;
    this.bumpStat("oresMined");
    this.sendHomeState(p);
    this.rocks.breakRock(rock, this.maps.grids.home, now);
    this.toMap("home", { t: "rock", id: rock.id, broken: true, hits: hit.hits, need, drops: drops.map((d) => d.item), ...stamp });
    this.persist({ rocks: true });
    void this.scheduleRockAlarm(now);
    this.inventoryChanged(p, drops.map((d) => `+${d.qty} ${getItem(d.item)?.name ?? d.item}`).join(", "));
  }

  /** An axe hit on a standing tree (fells it to a stump) or a stump (clears it). */
  private chop(p: HPlayer, msg: Extract<ClientMsg, { t: "use" }>, target: ToolTarget, def: ItemDef, now: number, stamp: ImpactStamp): void {
    const found = this.trees.at(msg.x, msg.y);
    if (!found) return;
    const save = this.save!;
    const { tree, stage, size } = found;
    const need = hitsNeeded(target);
    const key = `${tree.id}:${stage}`;
    const left = need - this.hits.progress(key, now);
    const drops = left <= 1 ? rollDrops(stage === "tree" ? TREE_RULES[size].drops : STUMP_RULE.drops, Math.random, this.rates) : [];
    // A full bag doesn't stop the axe: wood that doesn't fit goes to the mailbox (no ground items at home).
    const trial = cloneInventory(save.inventory);
    const posted = drops.filter((d) => !addItem(trial, d.item, d.qty));
    if (!this.spendStamina(p, msg, def)) return;
    const hit = this.hits.hit(key, need, now);
    if (!hit.done) {
      this.toMap("home", { t: "tree", id: tree.id, stage, hits: hit.hits, need, ...stamp });
      return this.sendHomeState(p);
    }
    save.inventory = trial;
    if (stage === "tree") this.trees.fell(tree, now);
    else this.trees.clearStump(tree, this.maps.grids.home);
    const next = stage === "tree" ? "stump" : "gone";
    this.toMap("home", { t: "tree", id: tree.id, stage: next, hits: hit.hits, need, drops: drops.map((d) => d.item), ...stamp });
    this.sendHomeState(p);
    for (const d of posted) addParcel(this.mail, d.item, d.qty);
    this.persist({ trees: true, save: true, ...(posted.length ? { mail: true } : {}) });
    void this.scheduleRockAlarm(now);
    const got = drops.filter((d) => !posted.includes(d));
    this.inventoryChanged(p, got.map((d) => `+${d.qty} ${getItem(d.item)?.name ?? d.item}`).join(", ") || undefined);
    if (posted.length) {
      this.sendMail(p);
      send(p.ws, { t: "notice", text: "Your bag is full, so the wood went to your mailbox.", kind: "info" });
    }
  }

  /** Puts a whole stack in the shipping bin; it is paid at the end of the day. */
  private ship(p: HPlayer, msg: ClientMsg, slot: number): void {
    const r = shipSlot(this.save!.inventory, this.bin, slot);
    if (!r.ok) return this.reject(p, msg, r.reason);
    this.persist({ day: true });
    this.sendBin(p, true);
    this.inventoryChanged(p, r.text);
  }

  /**
   * Targets: "shipping_bin" (sells the last used slot) or "shipping_bin:<slot>"; "mailbox"
   * (opens it) or "mailbox:take" (parcels into the bag).
   */
  private onInteract(p: HPlayer, target: string): void {
    if (target.startsWith(ANIMAL_PREFIX)) return this.onAnimal(p, { t: "petAnimal", animal: target }, Date.now(), true);
    if (target.startsWith(GROUND_TARGET_PREFIX)) return this.onEgg(p, target.slice(GROUND_TARGET_PREFIX.length));
    if (target === BARN_ID) return this.onBarn(p);
    const [propId, slotStr] = target.split(":");
    const prop = homeMap(p.map).props.find((pr) => pr.id === propId);
    if (!prop || distToRect(p.entity, prop) > PROP_REACH) return;
    if (prop.id === MAILBOX_ID) return this.onMailbox(p, target === MAILBOX_TAKE);
    if (prop.type !== "shipping_bin") return;
    const slot = slotStr !== undefined && /^\d{1,2}$/.test(slotStr) ? Number(slotStr) : p.lastSlot;
    const item = slot === null ? undefined : this.save!.inventory.slots[slot];
    const def = item ? getItem(item.item) : undefined;
    // Holding something shippable ships it; anything else just opens the bin.
    if (slot === null || !def || !isShippable(def.id)) return this.sendBin(p, true);
    this.ship(p, { t: "interact", target }, slot);
  }

  /** Opening the mailbox marks everything in it read; "take" moves parcels into the bag. */
  private onMailbox(p: HPlayer, take: boolean): void {
    if (take) {
      const got = takeParcels(this.mail, this.save!.inventory);
      if (got.length === 0) send(p.ws, { t: "notice", text: this.mail.parcels.length ? "Your bag is full." : "The mailbox is empty.", kind: "error" });
      else {
        // Lift the parcel's first item over your head, like any gift that arrives.
        this.act(p, "holdUp", Date.now(), got[0]!.item);
        this.inventoryChanged(p, got.map((g) => `+${g.qty} ${getItem(g.item)?.name ?? g.item}`).join(", "));
      }
    }
    this.mail.readAt = Date.now();
    this.persist({ mail: true });
    this.sendMail(p, true);
  }

  private inPlaceReach(p: HPlayer, x: number, y: number): boolean {
    return dist(p.entity, { x: x + 0.5, y: y + 0.5 }) <= PLACE_REACH;
  }

  private objectsChanged(p: HPlayer, upd: PlacedObject[], del: string[]): void {
    this.rebuildGrid();
    this.toMap(p.map, { t: "objects", upd, del });
    this.persist({ objects: true });
  }

  private onPlace(p: HPlayer, msg: Extract<ClientMsg, { t: "place" }>): void {
    const inv = this.save!.inventory;
    const slot = inv.slots[msg.slot];
    if (!slot) return this.reject(p, msg, "Nothing in that slot.");
    if (slot.item === BARN_ITEM) return this.reject(p, msg, "The town hall builds barns.");
    if (!this.inPlaceReach(p, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    if (getItem(slot.item)?.kind === "furniture" && mapForItem(slot.item) !== p.map) {
      return this.reject(p, msg, p.map === "home" ? "This goes indoors." : "This goes outdoors.");
    }
    const ok = this.canPlaceHere(p, slot.item, msg.x, msg.y, msg.rotation);
    if (!ok.ok) return this.reject(p, msg, ok.reason);
    const item = slot.item;
    if (!removeFromSlot(inv, msg.slot, 1)) return this.reject(p, msg, "Nothing in that slot.");
    const obj: PlacedObject = { id: `o${++this.objSeq}`, item, x: msg.x, y: msg.y, rotation: msg.rotation };
    this.objects[p.map].push(obj);
    this.objectsChanged(p, [obj], []);
    this.inventoryChanged(p);
  }

  /** Placement on the owner's current map: furniture, people and (in the yard) farm tiles. */
  private canPlaceHere(p: HPlayer, item: string, x: number, y: number, rotation: 0 | 1 | 2 | 3, ignoreId?: string) {
    const farm = p.map === "home" ? this.farm : [];
    return canPlace(homeMap(p.map), this.objects[p.map], farm, item, x, y, rotation, {
      ...(ignoreId ? { ignoreId } : {}),
      occupied: this.entities(p.map),
    });
  }

  private onMoveObject(p: HPlayer, msg: Extract<ClientMsg, { t: "moveObject" }>): void {
    // Furniture moves within the map it is on.
    const obj = this.objects[p.map].find((o) => o.id === msg.id);
    if (!obj) return this.reject(p, msg, "That isn't here any more.");
    if (obj.id === BARN_ID) return this.reject(p, msg, "The barn stays where it was built.");
    if (!this.inPlaceReach(p, msg.x, msg.y)) return this.reject(p, msg, "Too far away.");
    const ok = this.canPlaceHere(p, obj.item, msg.x, msg.y, msg.rotation, obj.id);
    if (!ok.ok) return this.reject(p, msg, ok.reason);
    Object.assign(obj, { x: msg.x, y: msg.y, rotation: msg.rotation });
    this.objectsChanged(p, [obj], []);
  }

  private onPickup(p: HPlayer, msg: Extract<ClientMsg, { t: "pickup" }>): void {
    const list = this.objects[p.map];
    const i = list.findIndex((o) => o.id === msg.id);
    if (i < 0) return this.reject(p, msg, "That isn't here any more.");
    const obj = list[i];
    const refusal = pickupRefusal(obj, this.containers);
    if (refusal) return this.reject(p, msg, refusal);
    if (!this.inPlaceReach(p, obj.x, obj.y)) return this.reject(p, msg, "Too far away.");
    const inv = this.save!.inventory;
    if (!addItem(inv, obj.item, 1)) return this.reject(p, msg, "Your bag is full.");
    list.splice(i, 1);
    if (Object.hasOwn(this.containers, obj.id)) {
      delete this.containers[obj.id];
      this.persist({ containers: true });
    }
    if (p.openStore === obj.id) this.closeStore(p);
    this.objectsChanged(p, [], [obj.id]);
    this.inventoryChanged(p);
  }

  /** Edit mode: several pieces move (or turn) at once, or none do. */
  private onMoveObjects(p: HPlayer, msg: Extract<ClientMsg, { t: "moveObjects" }>): void {
    const list = this.objects[p.map];
    if (msg.moves.some((m) => !this.inPlaceReach(p, m.x, m.y))) return this.reject(p, msg, "Too far away.");
    const farm = p.map === "home" ? this.farm : [];
    const ok = checkArrange(homeMap(p.map), list, farm, msg.moves, { occupied: this.entities(p.map), fixed: moveRefusal });
    if (!ok.ok) return this.reject(p, msg, ok.reason);
    const moved: PlacedObject[] = [];
    for (const m of msg.moves) {
      const obj = list.find((o) => o.id === m.id)!;
      Object.assign(obj, { x: m.x, y: m.y, rotation: m.rotation });
      moved.push(obj);
    }
    this.objectsChanged(p, moved, []);
  }

  /** Edit mode: several pieces back into the bag, or none (one that must stay, or a full bag). */
  private onPickupObjects(p: HPlayer, msg: Extract<ClientMsg, { t: "pickupObjects" }>): void {
    const list = this.objects[p.map];
    const picked: PlacedObject[] = [];
    for (const id of msg.ids) {
      const obj = list.find((o) => o.id === id);
      if (!obj) return this.reject(p, msg, "That isn't here any more.");
      const refusal = pickupRefusal(obj, this.containers);
      if (refusal) return this.reject(p, msg, refusal);
      if (!this.inPlaceReach(p, obj.x, obj.y)) return this.reject(p, msg, "Too far away.");
      picked.push(obj);
    }
    const bag = addAllOrNothing(this.save!.inventory, picked.map((o) => o.item));
    if (!bag) return this.reject(p, msg, "Your bag is full.");
    this.save!.inventory = bag;
    const gone = new Set(picked.map((o) => o.id));
    for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1);
    let emptied = false;
    for (const id of gone) {
      if (Object.hasOwn(this.containers, id)) {
        delete this.containers[id];
        emptied = true;
      }
      if (p.openStore === id) this.closeStore(p);
    }
    if (emptied) this.persist({ containers: true });
    this.objectsChanged(p, [], [...gone]);
    this.inventoryChanged(p);
  }

  // ------------------------------------------------------------------ storage furniture (fridge)

  /** Open, put into or take out of a storage piece: owner only, on its map, within reach. */
  private onStore(p: HPlayer, msg: Extract<ClientMsg, { t: "storeOpen" | "storePut" | "storeTake" }>): void {
    const obj = this.objects[p.map].find((o) => o.id === msg.id);
    const box = obj ? boxFor(this.containers, obj) : null;
    if (!obj || !box) return this.reject(p, msg, "There's nothing to open there.");
    if (distToRect(p.entity, objectRect(obj.item, obj.x, obj.y, obj.rotation)) > PROP_REACH) return this.reject(p, msg, "Walk a little closer.");
    if (msg.t === "storeOpen") {
      if (p.openStore && p.openStore !== obj.id) this.closeStore(p);
      if (p.openStore !== obj.id) {
        p.openStore = obj.id;
        this.toMap(p.map, { t: "lid", id: obj.id, open: true });
      }
      return send(p.ws, storageMsg(obj, box, true));
    }
    if (p.openStore !== obj.id) return this.reject(p, msg, "Open it first.");
    const spec = getItem(obj.item)!.storage!;
    const r = msg.t === "storePut" ? putIntoStorage(this.save!.inventory, box, spec, msg.slot, msg.qty) : takeFromStorage(this.save!.inventory, box, msg.index, msg.qty);
    if (!r.ok) {
      this.reject(p, msg, r.reason);
      return send(p.ws, storageMsg(obj, box));
    }
    this.persist({ containers: true });
    send(p.ws, storageMsg(obj, box));
    this.inventoryChanged(p);
  }

  /**
   * Opens the wardrobe: its doors open for everyone on the map and the owner gets the character
   * designer. The look itself comes back as an ordinary `setLook` (rate limited, validated).
   */
  private onWardrobe(p: HPlayer, msg: Extract<ClientMsg, { t: "wardrobeOpen" }>): void {
    const obj = this.objects[p.map].find((o) => o.id === msg.id);
    const why = wardrobeRefusal(obj, p.entity);
    if (why || !obj) return this.reject(p, msg, why ?? "There's no wardrobe there.");
    if (p.openStore && p.openStore !== obj.id) this.closeStore(p);
    if (p.openStore !== obj.id) {
      p.openStore = obj.id;
      this.toMap(p.map, { t: "lid", id: obj.id, open: true });
    }
    send(p.ws, { t: "wardrobe", id: obj.id });
  }

  /** Shuts the owner's open storage piece (the door closes for everyone on that map). */
  private closeStore(p: HPlayer): void {
    const id = p.openStore;
    if (!id) return;
    p.openStore = null;
    this.toMap(p.map, { t: "lid", id, open: false });
  }

  // ------------------------------------------------------------------ animals

  private animals(): AnimalSave {
    return (this.save!.animals ??= emptyAnimals());
  }

  /**
   * Builds a newly bought barn (clearing its lot), settles new hens, lays the day's eggs and
   * syncs the yard's herd with the save. True when eggs were laid.
   */
  private settleAnimals(now: number): boolean {
    if (!this.save) return false;
    const a = this.animals();
    const built = ensureBarn(a, this.objects, this.farm);
    if (built) {
      this.farm = built.farm;
      this.rebuildGrid();
      this.giveBack(built.returned, now, "The town hall built your barn just south of the road. Your hens will live there.");
      this.persist({ objects: true, farm: true, mail: true });
    }
    const barn = this.objects.home.some((o) => o.id === BARN_ID);
    const settling = a.chickens.some((c) => c.day === 0);
    const laid = barn ? layEggs(a, this.clock.day, eggSpots(this.maps.grids.home)) : [];
    if (built || settling || laid.length > 0) this.persist({ save: true });
    this.herd.sync(yardAnimals(a, barn), now);
    return laid.length > 0;
  }

  /** Everyone in the yard gets the eggs lying there (the owner may pick them). */
  private sendEggs(): void {
    const a = this.animals();
    for (const who of onMap(this.present(), "home")) send(who.ws, { t: "ground", upd: eggViews(a, who === this.player), del: [] });
  }

  /** Pet or feed one of your pets or hens (adopting happens in the village). */
  private onAnimal(p: HPlayer, msg: Extract<ClientMsg, { t: "petAnimal" | "feedAnimal" | "adoptAnimal" }>, now: number, open = false): void {
    const a = p.map === "home" ? this.herd.get(msg.animal) : undefined;
    if (!a) return this.reject(p, msg, "That animal isn't here.");
    if (dist(a.entity, p.entity) > ANIMAL_CARE_REACH) return this.reject(p, msg, "Walk a little closer.");
    if (msg.t === "adoptAnimal") return this.reject(p, msg, "They already live with you.");
    const animals = this.animals();
    let out: CareOutcome;
    if (a.spec.species === "chicken") {
      const hen = chickenById(animals, a.spec.id);
      if (!hen) return this.reject(p, msg, "That hen isn't here.");
      if (msg.t === "feedAnimal") return this.reject(p, msg, "Hens find their own food in the grass.");
      out = petHen(hen, a.entity.id, now);
    } else {
      const def = villageAnimal(a.spec.id.replace(/^pet_/, ""));
      if (!def) return this.reject(p, msg, "That animal isn't here.");
      out =
        msg.t === "feedAnimal"
          ? feedAnimal(animals, this.save!.inventory, msg.slot, def, a.entity.id, now, true, Math.random)
          : petAnimal(animals, def, a.entity.id, now, true, Math.random);
    }
    if (!out.ok) return this.reject(p, msg, out.reason);
    p.entity.facing = facingToTile(p.entity, Math.floor(a.entity.x), Math.floor(a.entity.y));
    // An adopted rascal still bolts now and then (less often than in the village).
    const ran = !!out.ran;
    if (ran) this.herd.runAway(a.entity.id, p.entity, now);
    else this.herd.love(a.entity.id, p.entity, now);
    this.toMap("home", { t: "emote", from: a.entity.id, code: ran ? "laugh" : "heart" });
    send(p.ws, { t: "animal", view: out.view, delta: out.delta, ...(open && !ran ? { open: true } : {}), ...(msg.t === "feedAnimal" ? { fed: true } : {}) });
    send(p.ws, { t: "notice", text: out.text, kind: "info" });
    if (msg.t === "feedAnimal") this.inventoryChanged(p);
    else this.persist({ save: true });
    this.startTick();
  }

  /** The sweep lands at the swing's impact frame; whoever is in the arc then is upset. */
  private swordAtAnimals(p: HPlayer, key: ToolKey): void {
    const facing = p.entity.facing;
    const delay = impactDelayMs(key, facing);
    const land = () => {
      if (this.player === p && p.map === "home") this.scareAnimals(p, facing, Date.now());
    };
    if (delay <= 0) land();
    else setTimeout(land, delay);
  }

  /**
   * Each pet in the arc likes you a heart less (hens just take fright); everyone in the yard sees
   * the angry or scared bubble and the animal running off away from you.
   */
  private scareAnimals(p: HPlayer, facing: Facing, now: number): void {
    const animals = this.animals();
    let changed = false;
    for (const a of this.herd.inArc(p.entity, facing)) {
      if (!this.animalHits.allow(a.entity.id, now)) continue;
      let out: UpsetOutcome | null = null;
      if (a.spec.species === "chicken") {
        const hen = chickenById(animals, a.spec.id);
        if (hen) out = swordHen(hen, a.entity.id, now);
      } else {
        const def = villageAnimal(a.spec.id.replace(/^pet_/, ""));
        if (def) out = swordAnimal(animals, def, a.entity.id, now, true);
      }
      if (!out) continue;
      changed ||= out.delta !== 0;
      this.herd.flee(a.entity.id, p.entity, now);
      this.toMap("home", { t: "emote", from: a.entity.id, code: out.emote });
      send(p.ws, { t: "animal", view: out.view, delta: out.delta });
      send(p.ws, { t: "notice", text: out.text, kind: "error" });
    }
    if (changed) this.persist({ save: true });
    this.startTick();
  }

  /** A visitor may pet the animals: they show their love, but no affection is kept for anyone. */
  private visitorPet(v: Visitor, msg: Extract<ClientMsg, { t: "petAnimal" }>, now: number): void {
    const a = v.map === "home" ? this.herd.get(msg.animal) : undefined;
    if (!a || dist(a.entity, v.entity) > ANIMAL_CARE_REACH) return this.reject(v, msg, "Walk a little closer.");
    if (now - v.lastEmote < EMOTE_MIN_INTERVAL_MS) return;
    v.lastEmote = now;
    this.herd.love(a.entity.id, v.entity, now);
    this.toMap("home", { t: "emote", from: a.entity.id, code: "heart" });
    send(v.ws, { t: "notice", text: `${a.spec.name || "The hen"} enjoys the fuss.`, kind: "info" });
    this.startTick();
  }

  /** Picks up an egg lying in the yard. */
  private onEgg(p: HPlayer, id: string): void {
    const a = this.animals();
    const egg = a.eggs.find((e) => e.id === id);
    if (!egg || p.map !== "home") return;
    if (dist(p.entity, egg) > FORAGE_REACH) return send(p.ws, { t: "notice", text: "Walk a little closer.", kind: "info" });
    this.takeEggs(p, [egg]);
  }

  /** The barn: how the hens are doing, and every egg lying in the yard gathered up. */
  private onBarn(p: HPlayer): void {
    const barn = this.objects.home.find((o) => o.id === BARN_ID);
    if (!barn || p.map !== "home" || distToRect(p.entity, objectRect(barn.item, barn.x, barn.y, barn.rotation)) > PROP_REACH) return;
    const a = this.animals();
    const hens = `${a.chickens.length}/${BARN_CAPACITY} hens`;
    if (a.eggs.length === 0) {
      const tip = a.chickens.length === 0 ? " Buy hens at the town hall." : " Hens lay an egg every morning.";
      return send(p.ws, { t: "notice", text: `Your barn: ${hens}. No eggs right now.${tip}`, kind: "info" });
    }
    this.takeEggs(p, [...a.eggs]);
  }

  private takeEggs(p: HPlayer, eggs: { id: string; x: number; y: number }[]): void {
    const a = this.animals();
    const inv = this.save!.inventory;
    const got: string[] = [];
    for (const e of eggs) {
      const r = collectEgg(a, inv, e.id);
      if (r === "full") {
        send(p.ws, { t: "notice", text: "Your bag is full.", kind: "error" });
        break;
      }
      if (r === "ok") got.push(e.id);
    }
    if (got.length === 0) return;
    this.toMap("home", { t: "ground", upd: [], del: got });
    const first = eggs[0]!;
    send(p.ws, { t: "loot", at: { x: first.x, y: first.y }, items: got.map(() => "egg") });
    this.inventoryChanged(p, `+${got.length} Egg${got.length > 1 ? "s" : ""}`);
  }
}
