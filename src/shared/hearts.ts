// Friendship with villagers: points per (player, NPC), kept in the player's save so every zone
// that loads the player can read and change it. Pure rules only; the server applies them and the
// client just shows the BondView it is sent.
//
// Points come from talking (a daily allowance per NPC, the first chat of the day worth the most,
// with a cooldown between counted chats) and from gifts (by the NPC's taste and the item's quality,
// one a day and two a week, eight times the points on their birthday). Points map to 0..10 hearts
// on a curve seeded per NPC, so some villagers warm up fast and others slowly.
//
// Every daily and weekly rule keys on the world day (shared/calendar.ts), never on a home's own
// day or a date string, so all rooms agree on "today". The day roll (week-end bonus, then decay
// for days nobody talked to the villager) is settled lazily whenever a bond is used, so nothing
// needs an alarm.
import { mulberry32 } from "./maps/rng";
import { getItem } from "./items";
import type { ItemId } from "./types";
import { weekOf, WORLD_DAY_MS, worldDay } from "./calendar";

export const MAX_HEARTS = 10;
/** Hearts at which a villager may hand over a piece of furniture. */
export const GIFT_MILESTONES = [2, 4, 6, 8, 10] as const;

/** First counted chat with a villager each day. */
export const TALK_FIRST_PTS = 25;
/** Each later counted chat that day. */
export const TALK_MORE_PTS = 8;
/** Talk points one villager can give per day (first chat included). */
export const TALK_DAILY_CAP = 50;
/** Chats closer together than this don't count. */
export const TALK_COOLDOWN_MS = 60_000;
/** Gifts a villager accepts from you per world day, and per Sunday-based week. */
export const GIFTS_PER_DAY = 1;
export const GIFTS_PER_WEEK = 2;
export const GIFT_PTS: Readonly<Record<GiftTaste, number>> = { loved: 80, liked: 45, neutral: 20, disliked: -25, hated: -40 };
/** Gift points on the villager's birthday are multiplied by this (good and bad alike). */
export const BIRTHDAY_MULT = 8;
/** Added when a week ends in which you gave this villager both weekly gifts. */
export const WEEKLY_BONUS_PTS = 10;
/** Points lost for each world day that ended without a chat with this villager. */
export const DECAY_PER_DAY = 2;
/** Long absences stop costing more than this many days of decay. */
const MAX_DECAY_DAYS = 120;
/** Undelivered gifts (bag was full) a villager keeps for you. */
export const MAX_PENDING = 5;

export type GiftTaste = "loved" | "liked" | "neutral" | "disliked" | "hated";
export const GIFT_TASTES: readonly GiftTaste[] = ["loved", "liked", "neutral", "disliked", "hated"];

/** Gift points multiplier by item quality: silver x1.1, gold x1.25, iridium (4) x1.5. */
export function qualityMult(quality: number | undefined): number {
  const q = quality ?? 0;
  return q >= 4 ? 1.5 : q >= 2 ? 1.25 : q >= 1 ? 1.1 : 1;
}

/** Points a gift is worth. Quality only raises a good gift; the birthday multiplier scales any. */
export function giftPoints(taste: GiftTaste, quality?: number, birthday = false): number {
  const base = GIFT_PTS[taste];
  const pts = base > 0 ? Math.round(base * qualityMult(quality)) : base;
  return birthday ? pts * BIRTHDAY_MULT : pts;
}

/** One villager's friendship record in a player's save. */
export interface Bond {
  pts: number;
  /** World day index (shared/calendar.ts) the daily counters below belong to; 0 = never rolled. */
  day: number;
  talkPts: number;
  /** Gifts given on `day`. */
  gifts: number;
  /** Talked to them at all on `day` (a chat on cooldown still counts against decay). */
  talked: boolean;
  /** Sunday-based week number `weekGifts` belongs to. */
  week: number;
  weekGifts: number;
  /** Last counted chat (ms epoch). */
  lastTalk: number;
  /** Milestones already rolled for a gift (given or not). */
  milestones: number[];
  /** Furniture this villager has given you (repeats are less likely). */
  given: ItemId[];
  /** Gifts owed while your bag was full (furniture or rare seeds); handed over next time you talk. */
  pending: ItemId[];
  /** Today's points from replies in the conversation window (rules in shared/npcChat.ts). */
  chat?: ChatDay;
}

/** One villager's conversation-window counters for a world day. */
export interface ChatDay {
  /** World day the counters belong to. */
  day: number;
  gain: number;
  loss: number;
  /** When a liked reply last counted (ms epoch). */
  last: number;
}

export type Bonds = Record<string, Bond>;

/** What the client shows for one villager. */
export interface BondView {
  npc: string;
  name: string;
  hearts: number;
  /** Points into the current heart, and the points that heart needs (0 at max hearts). */
  into: number;
  need: number;
  /** Talk points still available today. */
  talkLeft: number;
  pending: number;
  /** You talked to them today (world day). */
  talkedToday?: boolean;
  /** Gifts given today and this week (limits: GIFTS_PER_DAY, GIFTS_PER_WEEK). */
  giftsToday?: number;
  giftsWeek?: number;
  /** "Spring 5", when known. */
  birthday?: string;
  birthdayToday?: boolean;
}

export function newBond(now = 0): Bond {
  const day = now > 0 ? worldDay(now) : 0;
  return {
    pts: 0,
    day,
    talkPts: 0,
    gifts: 0,
    talked: false,
    week: weekOf(day),
    weekGifts: 0,
    lastTalk: 0,
    milestones: [],
    given: [],
    pending: [],
  };
}

/** FNV-1a: a stable 32-bit seed from a string. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface HeartCurve {
  /** Cumulative points needed for each heart: at[h] reaches h hearts (at[0] = 0). */
  at: number[];
  /** Points for the first heart, and how much each heart grows over the last. */
  base: number;
  growth: number;
}

const curveCache = new Map<string, HeartCurve>();

/**
 * Points-per-heart curve of a villager, seeded by their id: the first heart costs 50..150 and
 * each heart costs 4..24% more than the one before, with a little jitter. Same id, same curve.
 */
export function heartCurve(npcId: string): HeartCurve {
  const hit = curveCache.get(npcId);
  if (hit) return hit;
  const rand = mulberry32(seedOf(`hearts:${npcId}`));
  const base = 50 + Math.round(rand() * 100);
  const growth = 1.04 + rand() * 0.2;
  const at = [0];
  let cost = base;
  for (let h = 1; h <= MAX_HEARTS; h++) {
    const step = Math.max(10, Math.round((cost * (0.9 + rand() * 0.2)) / 5) * 5);
    at.push(at[h - 1]! + step);
    cost *= growth;
  }
  const curve = { at, base, growth };
  curveCache.set(npcId, curve);
  return curve;
}

export function maxPoints(npcId: string): number {
  return heartCurve(npcId).at[MAX_HEARTS]!;
}

/** Hearts for a point total, plus progress into the next heart. */
export function heartsFor(npcId: string, pts: number): { hearts: number; into: number; need: number } {
  const at = heartCurve(npcId).at;
  let h = 0;
  while (h < MAX_HEARTS && pts >= at[h + 1]!) h++;
  if (h === MAX_HEARTS) return { hearts: h, into: 0, need: 0 };
  return { hearts: h, into: pts - at[h]!, need: at[h + 1]! - at[h]! };
}

/** Decay never takes a bond below the start of the highest gift milestone it has reached. */
export function decayFloor(npcId: string, pts: number): number {
  const { hearts } = heartsFor(npcId, pts);
  let floor = 0;
  for (const m of GIFT_MILESTONES) if (m <= hearts) floor = m;
  return heartCurve(npcId).at[floor]!;
}

export interface DayRoll {
  /** Weekly bonus added (0 or WEEKLY_BONUS_PTS). */
  bonus: number;
  /** Points lost to decay (>= 0). */
  decay: number;
}

/**
 * Settles every world day that ended since the bond was last used: the week-end bonus, then decay
 * for each ended day without a chat, then fresh daily (and, in a new week, weekly) counters.
 * Pure function of (bond, now); safe to call any number of times. Mutates `b`.
 */
export function rollBond(npcId: string, b: Bond, now: number): DayRoll {
  const today = worldDay(now);
  const out: DayRoll = { bonus: 0, decay: 0 };
  // Same day, or a clock that went backwards: nothing ended.
  if (b.day >= today) return out;
  const week = weekOf(today);
  if (b.day > 0) {
    if (week !== b.week && b.weekGifts >= GIFTS_PER_WEEK) out.bonus = addPts(npcId, b, WEEKLY_BONUS_PTS);
    const missed = Math.min(MAX_DECAY_DAYS, (b.talked ? 0 : 1) + (today - 1 - b.day));
    if (missed > 0) {
      const floor = decayFloor(npcId, b.pts);
      const next = Math.max(Math.min(floor, b.pts), b.pts - missed * DECAY_PER_DAY);
      out.decay = b.pts - next;
      b.pts = next;
    }
  }
  if (week !== b.week) {
    b.week = week;
    b.weekGifts = 0;
  }
  b.day = today;
  b.talkPts = 0;
  b.gifts = 0;
  b.talked = false;
  return out;
}

function addPts(npcId: string, b: Bond, delta: number): number {
  const before = b.pts;
  b.pts = Math.max(0, Math.min(maxPoints(npcId), b.pts + delta));
  return b.pts - before;
}

/**
 * A chat with the villager. Counts once per TALK_COOLDOWN_MS, the first one of the day worth
 * TALK_FIRST_PTS and later ones TALK_MORE_PTS, never more than TALK_DAILY_CAP a day.
 * Returns the points actually gained (0 when capped or too soon). Mutates `b`.
 */
export function talkGain(npcId: string, b: Bond, now: number): number {
  rollBond(npcId, b, now);
  b.talked = true;
  if (now - b.lastTalk < TALK_COOLDOWN_MS) return 0;
  const left = TALK_DAILY_CAP - b.talkPts;
  if (left <= 0) return 0;
  const want = b.talkPts === 0 ? TALK_FIRST_PTS : TALK_MORE_PTS;
  const got = Math.min(want, left);
  b.lastTalk = now;
  b.talkPts += got;
  return addPts(npcId, b, got);
}

export type GiftRefusal = "day" | "week";

/**
 * Why a gift would be refused today, or null when it is welcome. One a day; two a week, except
 * that a birthday gift doesn't count toward (or need room in) the week. Settles the day roll.
 */
export function giftRefusal(npcId: string, b: Bond, now: number, birthday = false): GiftRefusal | null {
  rollBond(npcId, b, now);
  if (b.gifts >= GIFTS_PER_DAY) return "day";
  if (!birthday && b.weekGifts >= GIFTS_PER_WEEK) return "week";
  return null;
}

export interface GiftOpts {
  /** Item quality (0 normal, 1 silver, 2 gold, 4 iridium). */
  quality?: number;
  /** It is the villager's birthday today. */
  birthday?: boolean;
}

/**
 * A gift by the villager's taste, quality and birthday. Returns the points actually gained; 0
 * (and nothing counted) when giftRefusal says no. Mutates `b`.
 */
export function giftGain(npcId: string, b: Bond, taste: GiftTaste, now: number, opts: GiftOpts = {}): number {
  if (giftRefusal(npcId, b, now, opts.birthday)) return 0;
  b.gifts++;
  if (!opts.birthday) b.weekGifts++;
  return addPts(npcId, b, giftPoints(taste, opts.quality, opts.birthday));
}

/** Milestones reached at `hearts` that have not been rolled yet, lowest first. */
export function dueMilestones(b: Bond, hearts: number): number[] {
  return GIFT_MILESTONES.filter((m) => m <= hearts && !b.milestones.includes(m));
}

export function bondView(npcId: string, name: string, b: Bond, now: number, birthday?: { label: string; today: boolean }): BondView {
  const h = heartsFor(npcId, b.pts);
  const day = worldDay(now);
  const isToday = b.day === day;
  const thisWeek = b.week === weekOf(day);
  return {
    npc: npcId,
    name,
    ...h,
    talkLeft: Math.max(0, TALK_DAILY_CAP - (isToday ? b.talkPts : 0)),
    pending: b.pending.length,
    talkedToday: isToday && b.talked,
    giftsToday: isToday ? b.gifts : 0,
    giftsWeek: thisWeek ? b.weekGifts : 0,
    ...(birthday ? { birthday: birthday.label, birthdayToday: birthday.today } : {}),
  };
}

const NPC_KEY = /^[a-z][a-z0-9_]{0,23}$/;
const MAX_BONDS = 64;
/** Old saves keyed the day as a UTC date string. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** World day index from a stored day: a number, an old "YYYY-MM-DD" key, or 0 when unknown. */
function storedDay(v: unknown): number {
  if (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 10_000_000) return v;
  if (typeof v === "string" && DAY_KEY.test(v)) {
    const ms = Date.parse(`${v}T00:00:00Z`);
    if (Number.isFinite(ms)) return Math.floor(ms / WORLD_DAY_MS);
  }
  return 0;
}

const num = (v: unknown, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo;

function chatDayOf(raw: unknown): ChatDay | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const day = num(o.day, 0, 10_000_000);
  if (day <= 0) return undefined;
  return { day, gain: num(o.gain, 0, 1000), loss: num(o.loss, 0, 1000), last: num(o.last, 0, Number.MAX_SAFE_INTEGER) };
}

/** Validates bonds from storage or another Durable Object; anything odd is dropped or clamped. */
export function sanitizeBonds(raw: unknown): Bonds {
  const out: Bonds = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let n = 0;
  for (const [npc, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_BONDS || !NPC_KEY.test(npc) || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const items = (list: unknown, max: number, seeds = false): ItemId[] =>
      Array.isArray(list)
        ? list
            .filter((i): i is string => typeof i === "string" && (getItem(i)?.kind === "furniture" || (seeds && getItem(i)?.kind === "seed" && getItem(i)?.rarity === "rare")))
            .slice(0, max)
        : [];
    const day = storedDay(o.day);
    const talkPts = num(o.talkPts, 0, TALK_DAILY_CAP);
    out[npc] = {
      pts: num(o.pts, 0, maxPoints(npc)),
      day,
      talkPts,
      gifts: num(o.gifts, 0, GIFTS_PER_DAY),
      // Older saves had no flag: any talk points that day mean a chat happened.
      talked: typeof o.talked === "boolean" ? o.talked : talkPts > 0,
      week: typeof o.week === "number" && Number.isInteger(o.week) && o.week >= 0 ? o.week : weekOf(day),
      weekGifts: num(o.weekGifts, 0, GIFTS_PER_WEEK),
      lastTalk: num(o.lastTalk, 0, Number.MAX_SAFE_INTEGER),
      milestones: Array.isArray(o.milestones)
        ? [...new Set(o.milestones.filter((m): m is number => (GIFT_MILESTONES as readonly unknown[]).includes(m)))]
        : [],
      given: items(o.given, 32),
      // Milestone gifts owed: furniture, plus the rare seeds villagers sometimes add.
      pending: items(o.pending, MAX_PENDING, true),
    };
    const chat = chatDayOf(o.chat);
    if (chat) out[npc]!.chat = chat;
    n++;
  }
  return out;
}
