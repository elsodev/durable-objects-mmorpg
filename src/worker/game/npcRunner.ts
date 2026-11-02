// NPCs of one shared zone: wandering, reacting to chat/interact, and the AI spend limits.
// Conversations run async next to the tick; the tick never awaits them.
import { isInteriorZone, type EntityState, type Facing, type MapData, type NpcSpawn, type Seat, type SharedZoneId, type Vec2 } from "../../shared/types";
import { msToNextHour, npcNextZone, npcPresent, npcPrevZone, scheduleHour } from "../../shared/npcSchedule";
import { pickStop, roamsOutdoors } from "../../shared/npcHangouts";
import { BUILDING_DOORS } from "../../shared/maps/interiors/doors";
import { bumps, canStand, dist, facingFor, findPath, isBlocked, NPC_SPEED, stepToward, withPeople, type CollisionGrid } from "../../shared/engine";
import { isSitting, SeatBook, sitDown, standSpots, standUp, talkSpots } from "./seats";
import { cleanChat } from "../../shared/validate";
import type { Env } from "../env";
import type { ItemId } from "../../shared/types";
import { decide, idleLine, speak, type BrainEnv, type Decision, type NpcAction, type NpcContext, type NpcDef } from "../npc/brain";
import { NPCS } from "../npc/catalog";
import { isNpcId, NPC_BIRTHDAYS, type NpcId } from "../npc/bible";
import type { Situation } from "../npc/dialogue";
import { isBirthday, worldDate, worldHour } from "../../shared/calendar";
import { giftReply } from "../npc/think/scripted";
import { intentsToActions, validateIntents } from "../npc/think/tools";
import type { GoalId, ConverseResult } from "../npc/think/types";
import { NpcGate, AGENT_UNITS, JEV_UNITS, SPEAK_UNITS, staleGiftKeys, TalkQueue, utcDay } from "./npcGate";
import { EMOTE_STATUS, sanitizeActions, type ActionScope } from "./npcActions";
import type { NpcMind } from "./npcMind";
import { placeTarget } from "./npcPlaces";

const MEMORY_LEN = 10;
const THINKING = "...";
/** How long an NPC stands facing someone who talked to it before wandering again. */
const TALK_PAUSE_MS = 5000;
const EMOTE_MS = 3000;
const LEASH_EXTRA = 4;
const FOLLOW_GAP = 1.2;
const CONVERSATION_TIMEOUT_MS = 9000;
const IDLE_LINE_EVERY_MS = 45_000;
const IDLE_LINE_RANGE = 6;
const NEARBY_RANGE = 8;
/** Indoors: how long an NPC stays seated. */
export const SIT_MIN_MS = 30_000;
export const SIT_MAX_MS = 90_000;
/** Indoors: how long an NPC lingers at the fire or the bar. */
const LINGER_MIN_MS = 5_000;
const LINGER_MAX_MS = 15_000;
/** Someone in the way: wait this long for them to move, then find another way (or give up). */
const BLOCKED_WAIT_MS = 1200;
/** Outdoors: how long a villager stays at a spot (the fountain, the pond, their garden). */
export const OUT_LINGER_MIN_MS = 15_000;
export const OUT_LINGER_MAX_MS = 40_000;
/** Outdoors: someone this close at the next spot is chatted with (both turn to face each other). */
const CHAT_RANGE = 2.6;
/** Outdoors: a villager due indoors next hour walks to that door this long before the hour turns. */
export const HEAD_HOME_MS = 4 * 60_000;

/** A place worth walking to indoors, and which way to face once there. */
interface Poi {
  x: number;
  y: number;
  face: Facing;
}

/** Who works the room and stays at their post (behind the bar) instead of sitting about. */
const INDOOR_KEEPERS: Partial<Record<string, string>> = { int_inn: "rue" };

type Goal = { kind: "seat"; seatId: string } | { kind: "poi"; face: Facing; spot?: string } | { kind: "wander" };
/** NpcAgent RPC budget (its own model turn stops at 5 s). */
export const MIND_TIMEOUT_MS = 6000;
const GIFT_TIMEOUT_MS = 3000;
/** Per-pair recent lines kept in memory for Jev / the legacy prompt; never shared between players. */
const MAX_PAIRS = 500;
/** Interact text ZoneRoom sends for a click/F press (not typed chat). */
export const INTERACT_TEXT = "(walks up to talk to you)";
const GIFT_EMOTE: Record<string, string> = { loved: "love", liked: "happy", disliked: "sad", hated: "angry", neutral: "happy" };

export interface NpcHost {
  /** Players currently in the zone (entity state, live objects). */
  players(): EntityState[];
  others(): EntityState[];
  chat(from: EntityState, text: string): void;
  openShop(playerEntityId: string, npcId: string): void;
  /** Adds the gift to the player's inventory; false if it doesn't fit. */
  give(playerEntityId: string, item: string, qty: number): boolean;
  /** Generic world facts for NPC memory (village goal status). Must not contain player data. */
  worldFacts?(): string[];
  /** A private notice to one player (quest pointers). */
  notice?(playerEntityId: string, text: string): void;
  /** Hearts this player has with this villager (0..10), for the NPC's situation. */
  hearts?(userId: string, npcId: string): number;
}

export interface Speaker {
  userId: string;
  entityId: string;
  name: string;
}

interface NpcState {
  id: string;
  def: NpcDef | undefined;
  spawn: NpcSpawn;
  entity: EntityState;
  target: Vec2 | null;
  idleUntil: number;
  follow: { id: string; until: number } | null;
  statusUntil: number;
  nextIdleLine: number;
  /** Emote chosen by a decision, shown once the line is spoken ("..." stays up until then). */
  pendingEmote: string | null;
  /** In this zone right now, per its daily routine (absent NPCs are hidden and ignored). */
  here: boolean;
  /** Indoors: A* waypoints being walked, and what for. */
  path: Vec2[] | null;
  goal: Goal | null;
  /** Seated until then (indoors). */
  sitUntil: number;
  standBack: Vec2 | null;
  /** When someone first stood in this NPC's way (0 = the way is clear). */
  blockedSince: number;
  /** This walk was already re-planned around someone once (a second block gives it up). */
  rerouted: boolean;
}

const FALLBACK: Decision = { intent: "smalltalk", actions: [], mood: "neutral", source: "fallback" };

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

export class NpcRunner {
  readonly npcs: NpcState[] = [];
  private readonly gate = new NpcGate();
  private readonly waiting = new TalkQueue<Speaker>();
  /** Recent lines per (NPC, player) pair, so no prompt ever sees another player's chat. */
  private memory = new Map<string, string[]>();
  private readonly zone: SharedZoneId;
  /** Local dev only (/hour): shifts the routine clock by whole hours. */
  private hourOffset = 0;
  /** Indoors NPCs walk A* paths between seats, the fire, the bar and open floor. */
  private readonly indoor: boolean;
  /** Outdoors: the map has spots villagers walk between (the village). */
  private readonly hangouts: NonNullable<MapData["hangouts"]>;
  private readonly pois: Poi[];
  private readonly floorTiles: Vec2[];
  private readonly lastGiftIn = new Map<string, number>();

  /** Everyone present this tick (players and NPCs): soft obstacles for walking NPCs. */
  private crowd: EntityState[] = [];

  constructor(
    private readonly map: MapData,
    private readonly grid: CollisionGrid,
    private readonly env: Env,
    private readonly storage: DurableObjectStorage,
    private readonly host: NpcHost,
    private readonly rand: () => number,
    private readonly mind?: NpcMind,
    readonly seats: SeatBook = new SeatBook(map.seats ?? []),
  ) {
    this.zone = map.zone as SharedZoneId;
    this.indoor = isInteriorZone(this.zone);
    this.hangouts = this.indoor ? [] : (map.hangouts ?? []);
    this.pois = this.indoor ? interiorPois(map, grid) : [];
    this.floorTiles = this.indoor ? openTiles(map, grid) : [];
    const hour = scheduleHour(Date.now());
    for (const s of map.npcs) {
      const def = Object.hasOwn(NPCS, s.npcId) ? NPCS[s.npcId] : undefined;
      this.npcs.push({
        id: s.npcId,
        def,
        spawn: s,
        entity: {
          id: `n:${s.npcId}`,
          kind: "npc",
          name: def?.name ?? s.npcId,
          sprite: def?.sprite ?? "villager_old",
          x: s.x + 0.5,
          y: s.y + 0.5,
          facing: "down",
          moving: false,
        },
        target: null,
        idleUntil: 0,
        follow: null,
        statusUntil: 0,
        nextIdleLine: 0,
        pendingEmote: null,
        here: npcPresent(s.npcId, this.zone, hour),
        path: null,
        blockedSince: 0,
        rerouted: false,
        goal: null,
        sitUntil: 0,
        standBack: null,
      });
    }
  }

  async load(): Promise<void> {
    await this.pruneGifts();
    // Older builds kept one shared transcript per NPC (every player's lines). Memory is per player
    // now (NpcAgent), so those keys are deleted rather than read.
    const legacy = this.npcs.map((n) => `mem:${n.id}`);
    if (legacy.length > 0) await this.storage.delete(legacy).catch(() => 0);
  }

  private pairKey(npcId: string, userId: string): string {
    return `${npcId}\u0000${userId}`;
  }

  private pairMemory(npcId: string, userId: string): string[] {
    return this.memory.get(this.pairKey(npcId, userId)) ?? [];
  }

  private rememberLines(npcId: string, userId: string, lines: string[]): void {
    const key = this.pairKey(npcId, userId);
    const mem = [...(this.memory.get(key) ?? []), ...lines.map((l) => l.slice(0, 240))].slice(-MEMORY_LEN);
    this.memory.delete(key);
    this.memory.set(key, mem);
    while (this.memory.size > MAX_PAIRS) this.memory.delete(this.memory.keys().next().value!);
  }

  /** Daily gift markers are only compared with today, so old ones are dead weight. */
  private async pruneGifts(): Promise<void> {
    try {
      const got = await this.storage.list<string>({ prefix: "gift:", limit: 2000 });
      const stale = staleGiftKeys(got, Date.now());
      for (let i = 0; i < stale.length; i += 128) await this.storage.delete(stale.slice(i, i + 128));
    } catch {
      // best effort; retried on next wake
    }
  }

  byEntityId(id: string): NpcState | undefined {
    return this.npcs.find((n) => n.here && (n.entity.id === id || n.id === id));
  }

  /** A villager saw something shocking: stop, glare at it and stay put for a moment. */
  glareAt(n: NpcState, at: Vec2, now: number, ms = 5000): void {
    n.target = null;
    n.entity.moving = false;
    if (n.entity.act?.k !== "sit") n.entity.facing = facingFor(at.x - n.entity.x, at.y - n.entity.y, n.entity.facing);
    n.idleUntil = Math.max(n.idleUntil, now + ms);
  }

  /** NPCs currently in this zone. */
  present(): NpcState[] {
    return this.npcs.filter((n) => n.here);
  }

  setHourOffset(hours: number, now: number): void {
    this.hourOffset = hours;
    this.updatePresence(now);
  }

  /** The routine hour this zone runs on (UTC, plus any dev offset). */
  hour(now: number): number {
    return scheduleHour(now, this.hourOffset);
  }

  /**
   * Applies daily routines: an NPC due elsewhere vanishes from this zone; one due here appears at
   * its spot in this map. Every zone runs the same pure schedule, so it shows up in the other
   * zone at the same moment.
   */
  private updatePresence(now: number): void {
    const hour = this.hour(now);
    for (const n of this.npcs) {
      const here = npcPresent(n.id, this.zone, hour);
      if (here === n.here) continue;
      n.here = here;
      this.leaveSeat(n);
      n.target = null;
      n.path = null;
      n.goal = null;
      n.follow = null;
      n.entity.moving = false;
      delete n.entity.status;
      if (here) {
        const from = this.arrivalSpot(n, hour);
        n.entity.x = from.x;
        n.entity.y = from.y;
        n.entity.facing = "down";
        n.idleUntil = now + 2000;
      }
    }
  }

  /**
   * Where an NPC appears when its routine brings it here: on the doorstep of the building it just
   * left when that building is on this map (villagers come out of their houses in the morning),
   * else its spot.
   */
  private arrivalSpot(n: NpcState, hour: number): Vec2 {
    const prev = this.indoor ? null : npcPrevZone(n.id, hour);
    const p = prev ? this.wayTo(prev) : null;
    return p && canStand(this.grid, p.x, p.y) ? p : { x: n.spawn.x + 0.5, y: n.spawn.y + 0.5 };
  }

  /** Outdoors: where you stand to go to `zone` (the doorstep of its building, or the map exit). */
  private wayTo(zone: SharedZoneId): Vec2 | null {
    const door = BUILDING_DOORS.find((d) => d.zone === zone);
    if (door && this.map.exits.some((e) => e.to === door.zone)) return { x: door.door.x + 0.5, y: door.door.y + 1.5 };
    const spawn = this.map.spawns[`from_${zone}`];
    return spawn && this.map.exits.some((e) => e.to === zone) ? { x: spawn.x, y: spawn.y } : null;
  }

  /** Outdoors: walks between spots (benches, the fountain, the pond...) instead of a short wander. */
  private roams(n: NpcState): boolean {
    return !this.indoor && this.hangouts.length > 0 && n.spawn.wander > 0 && roamsOutdoors(n.id);
  }

  nearest(p: Vec2, range: number): NpcState | null {
    let best: NpcState | null = null;
    let bd = range;
    for (const n of this.npcs) {
      if (!n.here) continue;
      const d = dist(n.entity, p);
      if (d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  entities(): EntityState[] {
    return this.npcs.filter((n) => n.here).map((n) => n.entity);
  }

  tick(dtMs: number, now: number): void {
    this.updatePresence(now);
    const players = this.host.players();
    this.crowd = [...players, ...this.entities()];
    for (const n of this.npcs) {
      if (!n.here) continue;
      if (n.statusUntil && now >= n.statusUntil && n.entity.status !== THINKING) {
        delete n.entity.status;
        n.statusUntil = 0;
      }
      if (this.gate.busy(n.id)) {
        n.entity.moving = false;
        continue;
      }
      this.move(n, players, dtMs, now);
      this.maybeIdleLine(n, players, now);
    }
  }

  private leash(n: NpcState): number {
    return n.spawn.wander + LEASH_EXTRA;
  }

  private move(n: NpcState, players: EntityState[], dtMs: number, now: number): void {
    const home = { x: n.spawn.x + 0.5, y: n.spawn.y + 0.5 };
    if (n.follow && isSitting(n.entity)) this.getUp(n, now);
    if (n.follow) {
      const p = players.find((e) => e.id === n.follow!.id);
      if (!p || now >= n.follow.until) n.follow = null;
      else if (dist(n.entity, p) > FOLLOW_GAP && dist(p, home) <= this.leash(n) * 2) {
        this.stepTo(n, p, dtMs, now);
        return;
      } else {
        n.entity.moving = false;
        n.entity.facing = facingFor(p.x - n.entity.x, p.y - n.entity.y, n.entity.facing);
        return;
      }
    }
    if ((this.indoor || this.roams(n)) && !n.target) return this.moveIndoors(n, dtMs, now);
    if (!n.target) {
      n.entity.moving = false;
      if (now < n.idleUntil) return;
      n.idleUntil = now + 2000 + this.rand() * 5000;
      if (n.spawn.wander <= 0) return;
      for (let i = 0; i < 6; i++) {
        const a = this.rand() * Math.PI * 2;
        const r = this.rand() * n.spawn.wander;
        const p = { x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r };
        if (canStand(this.grid, p.x, p.y)) {
          n.target = p;
          break;
        }
      }
      return;
    }
    const arrived = this.stepTo(n, n.target, dtMs, now);
    if (arrived) n.target = null;
    else if (!n.entity.moving && !this.holdingOn(n, now)) {
      // Stuck on a wall, or someone has stood in the way too long: pick a new stroll later.
      n.target = null;
      n.blockedSince = 0;
    }
  }

  /**
   * Indoor routine (and outdoors for villagers who roam the village): sit a while at a free seat (often, in the inn of an evening), warm up at the
   * fire, lean on the bar, or stroll to some open floor. Every walk is an A* path on the room's
   * collision grid, so nobody cuts through furniture.
   */
  private moveIndoors(n: NpcState, dtMs: number, now: number): void {
    if (isSitting(n.entity)) {
      if (now >= n.sitUntil) this.getUp(n, now);
      return;
    }
    if (n.path) {
      const wp = n.path[0]!;
      const arrived = this.stepTo(n, wp, dtMs, now);
      if (arrived) n.path.shift();
      else if (!n.entity.moving) {
        if (this.holdingOn(n, now)) return;
        // Still blocked: walk around whoever is there, else give this walk up.
        if (n.blockedSince === 0 || !this.repath(n)) return this.abandon(n, now);
        return;
      }
      if (n.path.length === 0) this.arrive(n, now);
      return;
    }
    n.entity.moving = false;
    if (now < n.idleUntil) return;
    this.plan(n, now);
  }

  private plan(n: NpcState, now: number): void {
    n.idleUntil = now + 2000 + this.rand() * 4000;
    if (!this.indoor) return this.planOutdoors(n, now);
    const keeper = INDOOR_KEEPERS[this.zone] === n.id;
    const evening = this.hour(now) >= 18 || this.hour(now) < 2;
    const sitChance = keeper ? 0 : this.zone === "int_inn" && evening ? 0.75 : 0.35;
    const roll = this.rand();
    if (roll < sitChance && this.walkToSeat(n)) return;
    if (!keeper && roll < sitChance + 0.25 && this.pois.length > 0) {
      const poi = this.pois[Math.floor(this.rand() * this.pois.length)]!;
      if (this.walk(n, poi, { kind: "poi", face: poi.face })) return;
    }
    // Shopkeepers keep near their spot; everyone else roams the room.
    const home = { x: n.spawn.x + 0.5, y: n.spawn.y + 0.5 };
    const range = keeper ? Math.max(1, n.spawn.wander) : Infinity;
    const near = this.floorTiles.filter((t) => dist(t, home) <= range);
    if (near.length === 0) return;
    const to = near[Math.floor(this.rand() * near.length)]!;
    this.walk(n, to, { kind: "wander" });
  }

  /**
   * Outdoor routine: near the end of the hour, a villager due indoors walks to that door; otherwise
   * it picks its next stop (a spot it likes, a free bench, or back to its post).
   */
  private planOutdoors(n: NpcState, now: number): void {
    const hour = this.hour(now);
    const next = npcNextZone(n.id, hour);
    const way = next && msToNextHour(now) <= HEAD_HOME_MS ? this.wayTo(next) : null;
    if (way) {
      if (dist(n.entity, way) > 0.3) this.walk(n, way, { kind: "poi", face: isInteriorZone(next!) ? "up" : "down" });
      return;
    }
    const busy = new Set<string>();
    for (const o of this.npcs) if (o !== n && o.here && o.goal?.kind === "poi" && o.goal.spot) busy.add(o.goal.spot);
    for (const o of this.npcs) {
      if (o === n || !o.here) continue;
      const at = this.hangouts.find((h) => Math.floor(o.entity.x) === h.x && Math.floor(o.entity.y) === h.y);
      if (at) busy.add(at.id);
    }
    const stop = pickStop(n.id, this.hangouts, this.seats.free(), this.rand, busy);
    if (stop?.kind === "seat") {
      if (this.walkToSeat(n, [stop.seat])) return;
    } else if (stop?.kind === "hangout") {
      const h = stop.hangout;
      if (this.walk(n, { x: h.x + 0.5, y: h.y + 0.5 }, { kind: "poi", face: h.face, spot: h.id })) return;
    }
    // Back to (somewhere near) their own spot.
    const home = { x: n.spawn.x + 0.5, y: n.spawn.y + 0.5 };
    for (let i = 0; i < 6; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * n.spawn.wander;
      const p = { x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r };
      if (canStand(this.grid, p.x, p.y) && this.walk(n, p, { kind: "poi", face: "down" })) return;
    }
  }

  private walkToSeat(n: NpcState, among?: Seat[]): boolean {
    const free = among ? among.filter((s) => this.seats.isFree(s.id)) : this.seats.free();
    for (let i = 0; i < 4 && free.length > 0; i++) {
      const seat = free.splice(Math.floor(this.rand() * free.length), 1)[0]!;
      const spot = standSpots(this.grid, seat, n.entity)[0];
      if (!spot || !this.seats.take(seat.id, n.entity.id)) continue;
      if (this.walk(n, spot, { kind: "seat", seatId: seat.id })) return true;
      this.seats.release(n.entity.id);
    }
    return false;
  }

  /** Starts an A* walk around walls and anyone standing about; false if there's no way there. */
  private walk(n: NpcState, to: Vec2, goal: Goal): boolean {
    const path = findPath(this.gridAround(n, to), n.entity, to) ?? findPath(this.grid, n.entity, to);
    if (!path) return false;
    n.path = path.length > 0 ? path : [to];
    n.goal = goal;
    n.rerouted = false;
    return true;
  }

  /** Collision grid with everyone but `n` blocked (their tiles), keeping `n`'s tile and goal free. */
  private gridAround(n: NpcState, goal: Vec2): CollisionGrid {
    return withPeople(this.grid, this.crowd.filter((e) => e !== n.entity), [n.entity, goal]);
  }

  /** True while someone has been in `n`'s way for less than BLOCKED_WAIT_MS. */
  private holdingOn(n: NpcState, now: number): boolean {
    return n.blockedSince > 0 && now - n.blockedSince < BLOCKED_WAIT_MS;
  }

  /** Re-plans the current walk around people in the way; false if there's no way round. */
  private repath(n: NpcState): boolean {
    const to = n.path?.[n.path.length - 1];
    if (!to || n.rerouted) return false;
    n.rerouted = true;
    const path = findPath(this.gridAround(n, to), n.entity, to);
    if (!path) return false;
    n.path = path.length > 0 ? path : [to];
    n.blockedSince = 0;
    return true;
  }

  private arrive(n: NpcState, now: number): void {
    const goal = n.goal;
    n.path = null;
    n.goal = null;
    n.entity.moving = false;
    if (goal?.kind === "seat") {
      const seat = this.seats.get(goal.seatId);
      if (!seat || this.seats.of(n.entity.id)?.id !== goal.seatId) return;
      n.standBack = { x: n.entity.x, y: n.entity.y };
      sitDown(n.entity, seat, now);
      n.sitUntil = now + SIT_MIN_MS + this.rand() * (SIT_MAX_MS - SIT_MIN_MS);
    } else if (goal?.kind === "poi") {
      n.entity.facing = goal.face;
      if (this.indoor) n.idleUntil = now + LINGER_MIN_MS + this.rand() * (LINGER_MAX_MS - LINGER_MIN_MS);
      else {
        n.idleUntil = now + OUT_LINGER_MIN_MS + this.rand() * (OUT_LINGER_MAX_MS - OUT_LINGER_MIN_MS);
        this.chatWithNeighbour(n);
      }
    }
  }

  /** Outdoors: someone standing about close by? Turn to each other for a chat. */
  private chatWithNeighbour(n: NpcState): void {
    let best: NpcState | null = null;
    let bd = CHAT_RANGE;
    for (const o of this.npcs) {
      if (o === n || !o.here || o.path || o.entity.moving || isSitting(o.entity) || o.follow) continue;
      const d = dist(o.entity, n.entity);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) return;
    n.entity.facing = facingFor(best.entity.x - n.entity.x, best.entity.y - n.entity.y, n.entity.facing);
    best.entity.facing = facingFor(n.entity.x - best.entity.x, n.entity.y - best.entity.y, best.entity.facing);
    best.idleUntil = Math.max(best.idleUntil, n.idleUntil - 5000);
  }

  private abandon(n: NpcState, now: number): void {
    if (n.goal?.kind === "seat") this.seats.release(n.entity.id);
    n.path = null;
    n.goal = null;
    n.entity.moving = false;
    n.idleUntil = now + 1000;
  }

  /**
   * Gets up off the seat onto a free tile beside it: the one nearest `toward` (someone who came
   * to talk) when given, else where the NPC stood before sitting down.
   */
  private getUp(n: NpcState, now: number, toward?: Vec2): void {
    const seat = this.seats.of(n.entity.id);
    this.seats.release(n.entity.id);
    const back = !toward && n.standBack && canStand(this.grid, n.standBack.x, n.standBack.y) ? n.standBack : null;
    const spots = !seat ? [] : toward ? talkSpots(this.grid, seat, toward) : standSpots(this.grid, seat, n.standBack ?? undefined);
    const spot = back ?? spots[0] ?? {
      x: n.spawn.x + 0.5,
      y: n.spawn.y + 0.5,
    };
    standUp(n.entity, spot);
    n.standBack = null;
    n.idleUntil = now + 2000 + this.rand() * 4000;
  }

  /** Off the seat without walking anywhere (leaving the zone). */
  private leaveSeat(n: NpcState): void {
    this.seats.release(n.entity.id);
    if (isSitting(n.entity)) delete n.entity.act;
    n.standBack = null;
  }

  /** Seat the NPC sits on right now, if any (tests, contact sheet). */
  seatOf(n: NpcState): string | undefined {
    return this.seats.of(n.entity.id)?.id;
  }

  /** One step toward `to`. Never walks into a player or another NPC: it stops and waits instead. */
  private stepTo(n: NpcState, to: Vec2, dtMs: number, now: number): boolean {
    const r = stepToward(n.entity, to, NPC_SPEED, dtMs, this.grid);
    if (r.moving && bumps(n.entity, r, this.crowd.filter((e) => e !== n.entity))) {
      Object.assign(n.entity, { facing: r.facing, moving: false });
      if (n.blockedSince === 0) n.blockedSince = now;
      return false;
    }
    n.blockedSince = 0;
    Object.assign(n.entity, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
    return r.arrived;
  }

  private maybeIdleLine(n: NpcState, players: EntityState[], now: number): void {
    if (!n.def || now < n.nextIdleLine) return;
    n.nextIdleLine = now + IDLE_LINE_EVERY_MS * (0.5 + this.rand());
    if (!players.some((p) => dist(p, n.entity) <= IDLE_LINE_RANGE)) return;
    let line: string | null = null;
    try {
      line = idleLine(n.def, this.rand);
    } catch {
      line = null;
    }
    const text = line ? cleanChat(line) : null;
    if (text) this.host.chat(n.entity, text);
  }

  /**
   * Starts a conversation (fire and forget). Returns false when the NPC is already busy; the
   * line then waits in the NPC's short queue (or is dropped when that is full).
   */
  talk(npc: NpcState, speaker: Speaker, text: string, now: number): boolean {
    // Someone wants a word: a seated NPC gets up (beside the chair, on the speaker's side) first.
    if (isSitting(npc.entity)) {
      const who = this.host.players().find((e) => e.id === speaker.entityId);
      this.getUp(npc, now, who);
    }
    if (!this.gate.begin(npc.id)) {
      this.waiting.offer(npc.id, { speaker, text, at: now });
      return false;
    }
    npc.entity.status = THINKING;
    npc.entity.moving = false;
    npc.target = null;
    if (npc.path) this.abandon(npc, now);
    const done = this.converse(npc, speaker, text, now);
    void withTimeout(done, CONVERSATION_TIMEOUT_MS, undefined).finally(() => {
      if (npc.entity.status === THINKING) this.showEmote(npc);
      this.gate.end(npc.id);
      this.serveNext(npc, speaker.userId);
    });
    return true;
  }

  /** Hands the NPC to whoever waited, preferring someone other than the player just served. */
  private serveNext(npc: NpcState, lastUserId: string): void {
    const now = Date.now();
    for (;;) {
      const next = this.waiting.next(npc.id, lastUserId, now);
      if (!next) return;
      if (!this.host.players().some((e) => e.id === next.speaker.entityId)) continue;
      this.talk(npc, next.speaker, next.text, now);
      return;
    }
  }

  private brainEnv(useAi: boolean): BrainEnv {
    if (!useAi) return { NPC_MODEL: this.env.NPC_MODEL, NPC_AI_MODE: "off" };
    return {
      AI: this.env.AI,
      NPC_MODEL: this.env.NPC_MODEL,
      NPC_AI_MODE: this.env.NPC_AI_MODE,
      TYPESAFE_API_KEY: this.env.TYPESAFE_API_KEY,
    };
  }

  /** All spend checks, cheapest first; the global budget DO is consulted last. */
  private async mayUseAi(npcId: string, userId: string, now: number): Promise<boolean> {
    if (this.env.NPC_AI_MODE === "off" || !this.env.AI) return false;
    if (!this.gate.allowAi(userId, npcId, now)) return false;
    try {
      const units = (this.mind ? AGENT_UNITS : SPEAK_UNITS) + (this.env.TYPESAFE_API_KEY ? JEV_UNITS : 0);
      const stub = this.env.AI_BUDGET.get(this.env.AI_BUDGET.idFromName("global"));
      return (await stub.tryConsume({ userId, units, day: utcDay(now) })) === true;
    } catch {
      return false;
    }
  }

  private context(npc: NpcState, speaker: Speaker, text: string): NpcContext | null {
    if (!npc.def) return null;
    const nearby = [...this.host.players(), ...this.host.others()]
      .filter((e) => e.id !== npc.entity.id)
      .map((e) => ({ id: e.id, name: e.name, kind: e.kind, dist: Math.round(dist(e, npc.entity) * 10) / 10 }))
      .filter((e) => e.dist <= NEARBY_RANGE)
      .slice(0, 8);
    return {
      npc: npc.def,
      pos: { x: npc.entity.x, y: npc.entity.y },
      memory: [...this.pairMemory(npc.id, speaker.userId)],
      speaker: { id: speaker.entityId, name: speaker.name },
      text,
      nearby,
    };
  }

  private async converse(npc: NpcState, speaker: Speaker, text: string, now: number): Promise<void> {
    const ctx = this.context(npc, speaker, text);
    this.faceSpeaker(npc, speaker.entityId, now);
    if (!ctx) return; // no catalog entry: nothing to say

    // Replies are personal (names, gifts), so the cache is per (NPC, player), never shared.
    const pair = this.pairKey(npc.id, speaker.userId);
    const cached = this.gate.cached(pair, text, now);
    const useAi = !cached && (await this.mayUseAi(npc.id, speaker.userId, now));
    const benv = this.brainEnv(useAi);

    const decision = await withTimeout(decide(ctx, benv), 3000, FALLBACK);
    const giftKey = `gift:${npc.id}:${speaker.userId}`;
    const today = utcDay(now);
    const scope: ActionScope = {
      speakerId: speaker.entityId,
      home: { x: npc.spawn.x + 0.5, y: npc.spawn.y + 0.5 },
      leash: this.leash(npc),
      hasShop: !!npc.def?.shop,
      giftAllowed: (await this.storage.get<string>(giftKey)) !== today,
    };
    const actions = sanitizeActions(decision.actions, scope);
    const given = actions.find((a): a is Extract<NpcAction, { kind: "give" }> => a.kind === "give");
    let gifted = this.apply(npc, actions, Date.now());

    let line = cached?.line ?? null;
    let source: ConverseResult["source"] | "cache" | "speak" = cached ? "cache" : "speak";
    if (!line && this.mind && isNpcId(npc.id)) {
      const said = await this.askMind(npc.id, speaker, text, decision, useAi, actions, gifted ? given : undefined);
      if (said) {
        line = said.reply;
        source = said.source;
        // Agent intents go through the same validation as every other NPC action.
        const intents = validateIntents(said.intents, { npcId: npc.id, playerId: speaker.userId });
        const { actions: more, quests } = intentsToActions(intents, {
          speakerEntityId: speaker.entityId,
          place: (id) => placeTarget(this.map, id),
        });
        const extra = sanitizeActions(more, { ...scope, giftAllowed: scope.giftAllowed && !gifted });
        if (this.apply(npc, extra, Date.now())) gifted = true;
        this.pointToQuests(speaker.entityId, quests);
      }
    }
    if (gifted) await this.storage.put(giftKey, today);
    if (!line) {
      const scripted = npc.def?.lines.thinking_fail?.[0] ?? "Hmm?";
      // With a mind, a failed call falls back to scripted lines: the reserved budget was for one turn.
      const env = this.mind ? this.brainEnv(false) : benv;
      line = await withTimeout(speak(ctx, decision, env), MIND_TIMEOUT_MS, scripted);
    }
    const clean = cleanChat(line);
    if (!clean) return;
    if (useAi && (source === "agent" || source === "speak")) this.gate.remember(pair, text, { line: clean, intent: decision.intent, at: now });

    this.rememberLines(npc.id, speaker.userId, [`${speaker.name}: ${text}`, `${ctx.npc.name}: ${clean}`]);

    this.showEmote(npc);
    // Turn back to them when actually replying (they may have moved while the NPC was thinking),
    // unless the decision just sent the NPC walking somewhere.
    if (!npc.target && !npc.follow) this.faceSpeaker(npc, speaker.entityId, Date.now());
    this.host.chat(npc.entity, clean);
  }

  /** The pair's NpcAgent: memory-aware reply, model-written only when `ai` (budget already reserved). */
  private async askMind(
    npcId: NpcId,
    speaker: Speaker,
    text: string,
    decision: Decision,
    ai: boolean,
    actions: NpcAction[],
    gave: Extract<NpcAction, { kind: "give" }> | undefined,
  ): Promise<ConverseResult | null> {
    let world: string[] = [];
    try {
      world = this.host.worldFacts?.() ?? [];
    } catch {
      world = [];
    }
    const req = {
      playerId: speaker.userId,
      playerName: speaker.name,
      text,
      zone: this.map.zone as Exclude<typeof this.map.zone, "home">,
      context: {
        intent: decision.intent,
        interact: text === INTERACT_TEXT,
        world,
        shopOpened: actions.some((a) => a.kind === "open_shop"),
        ...(gave ? { gave: { item: gave.item, qty: gave.qty } } : {}),
        situation: this.situation(npcId, speaker.userId, Date.now()),
      },
      ai,
    };
    const out = await withTimeout(this.mind!.converse(npcId, req).catch(() => null), MIND_TIMEOUT_MS, null);
    if (!out || typeof out.reply !== "string") return null;
    return out;
  }

  /** What the villager knows about "now" for this player (world calendar, UTC hour, hearts). */
  private situation(npcId: NpcId, userId: string, now: number): Situation {
    const date = worldDate(now);
    let hearts = 0;
    try {
      hearts = this.host.hearts?.(userId, npcId) ?? 0;
    } catch {
      hearts = 0;
    }
    return {
      hearts: Math.max(0, Math.min(10, Math.floor(hearts))),
      zone: this.map.zone as SharedZoneId,
      hour: worldHour(now),
      weekday: date.weekday,
      season: date.season,
      day: date.day,
      birthday: isBirthday(NPC_BIRTHDAYS[npcId], date),
    };
  }

  private pointToQuests(entityId: string, quests: GoalId[]): void {
    const where: Record<GoalId, string> = {
      bridge: "Village goal: rebuild the bridge (Town Hall board).",
      fair: "Village goal: bring back the Spring Fair (Town Hall board).",
      lantern: "Village goal: relight the shrine lantern (Town Hall board).",
    };
    const q = quests[0];
    if (q && this.host.notice) this.host.notice(entityId, where[q]);
  }

  /**
   * The player handed `item` to this NPC (ZoneRoom already took it from their bag). The pair's
   * agent records it and answers by the NPC's taste; no model call.
   */
  async receiveGift(npc: NpcState, speaker: Speaker, item: ItemId, now: number): Promise<void> {
    if (!npc.def || !isNpcId(npc.id)) return;
    const key = this.pairKey(npc.id, speaker.userId);
    this.lastGiftIn.set(key, now);
    if (this.lastGiftIn.size > MAX_PAIRS) this.lastGiftIn.delete(this.lastGiftIn.keys().next().value!);
    this.faceSpeaker(npc, speaker.entityId, now);
    const req = { playerId: speaker.userId, playerName: speaker.name, item };
    const local = () => giftReply(npc.id as NpcId, item, speaker.name, this.rand);
    const out = this.mind ? await withTimeout(this.mind.receiveGift(npc.id, req).catch(() => local()), GIFT_TIMEOUT_MS, local()) : local();
    const clean = cleanChat(out.reply);
    if (!clean) return;
    npc.pendingEmote = EMOTE_STATUS[GIFT_EMOTE[out.taste] ?? "happy"] ?? "!";
    this.showEmote(npc);
    this.rememberLines(npc.id, speaker.userId, [`${speaker.name} gave ${npc.def.name} a gift.`, `${npc.def.name}: ${clean}`]);
    this.host.chat(npc.entity, clean);
  }

  /** True when this player gave this NPC something less than `ms` ago (gift spam guard). */
  giftedRecently(npcId: string, userId: string, now: number, ms: number): boolean {
    const at = this.lastGiftIn.get(this.pairKey(npcId, userId));
    return at !== undefined && now - at < ms;
  }

  /** Stop, turn to the speaker and hold still for a moment; wandering resumes after TALK_PAUSE_MS. */
  private faceSpeaker(npc: NpcState, entityId: string, now: number): void {
    const p = this.host.players().find((e) => e.id === entityId);
    if (!p) return;
    npc.target = null;
    npc.entity.moving = false;
    // (A seated NPC was stood up by talk(); never turn someone still in a chair away from the table.)
    if (!isSitting(npc.entity)) npc.entity.facing = facingFor(p.x - npc.entity.x, p.y - npc.entity.y, npc.entity.facing);
    npc.idleUntil = Math.max(npc.idleUntil, now + TALK_PAUSE_MS);
  }

  private showEmote(npc: NpcState): void {
    if (npc.pendingEmote) {
      npc.entity.status = npc.pendingEmote;
      npc.statusUntil = Date.now() + EMOTE_MS;
      npc.pendingEmote = null;
    } else if (npc.entity.status === THINKING) {
      delete npc.entity.status;
    }
  }

  /** Applies sanitized actions. Returns true if a gift was handed over. */
  private apply(npc: NpcState, actions: NpcAction[], now: number): boolean {
    let gifted = false;
    for (const a of actions) {
      switch (a.kind) {
        case "emote":
          npc.pendingEmote = EMOTE_STATUS[a.emote] ?? "!";
          break;
        case "face": {
          const p = this.host.players().find((e) => e.id === a.targetId);
          if (p) npc.entity.facing = facingFor(p.x - npc.entity.x, p.y - npc.entity.y, npc.entity.facing);
          break;
        }
        case "walk_to":
          if (!canStand(this.grid, a.x, a.y)) break;
          if (isSitting(npc.entity)) this.getUp(npc, now);
          if (this.indoor) this.walk(npc, { x: a.x, y: a.y }, { kind: "wander" });
          else npc.target = { x: a.x, y: a.y };
          break;
        case "follow":
          npc.follow = { id: a.targetId, until: now + a.ms };
          break;
        case "open_shop":
          this.host.openShop(a.playerId, npc.id);
          break;
        case "give":
          if (this.host.give(a.playerId, a.item, a.qty)) gifted = true;
          break;
        case "idle":
          break;
      }
    }
    return gifted;
  }
}

/** Spots by the fire, stove or bar where an NPC stands facing it. */
export function interiorPois(map: MapData, grid: CollisionGrid): Poi[] {
  const out: Poi[] = [];
  for (const p of map.props) {
    if (p.type === "fireplace" || p.type === "hearth" || p.type === "stove") {
      for (let x = p.x; x < p.x + p.w; x++) if (canStand(grid, x + 0.5, p.y + p.h + 0.5)) out.push({ x: x + 0.5, y: p.y + p.h + 0.5, face: "up" });
    } else if (p.type === "bar_counter") {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (canStand(grid, x + 0.5, p.y + p.h + 0.5)) out.push({ x: x + 0.5, y: p.y + p.h + 0.5, face: "up" });
      }
      if (canStand(grid, p.x - 0.5, p.y + 0.5)) out.push({ x: p.x - 0.5, y: p.y + 0.5, face: "right" });
      if (canStand(grid, p.x + p.w + 0.5, p.y + 0.5)) out.push({ x: p.x + p.w + 0.5, y: p.y + 0.5, face: "left" });
    }
  }
  return out;
}

/** Open floor tile centres of a room, minus the way out (nobody idles on the doormat). */
export function openTiles(map: MapData, grid: CollisionGrid): Vec2[] {
  const out: Vec2[] = [];
  const exit = map.exits[0];
  for (let y = 3; y < map.height - 1; y++)
    for (let x = 1; x < map.width - 1; x++) {
      if (isBlocked(grid, x, y) || !canStand(grid, x + 0.5, y + 0.5)) continue;
      if (exit && x === exit.x && y >= exit.y - 1) continue;
      out.push({ x: x + 0.5, y: y + 0.5 });
    }
  return out;
}
