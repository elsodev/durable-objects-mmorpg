// Applies friendship changes to a loaded player (ZoneRoom calls these synchronously, next to the
// inventory, so no await sits between reading and writing either). Rules live in shared/hearts.ts;
// gift tables in npc/giftTables.ts.
import { addItem, canAdd } from "../../shared/engine";
import {
  bondView,
  dueMilestones,
  giftGain,
  giftRefusal,
  heartsFor,
  MAX_PENDING,
  newBond,
  rollBond,
  talkGain,
  type Bond,
  type BondView,
  type Bonds,
  type GiftOpts,
  type GiftRefusal,
  type GiftTaste,
} from "../../shared/hearts";
import { formatBirthday, isBirthday, worldDate } from "../../shared/calendar";
import type { Inventory, ItemId } from "../../shared/types";
import { isNpcId, NPC_BIRTHDAYS, type NpcId } from "../npc/bible";
import { NPCS } from "../npc/catalog";
import { rollMilestoneGift } from "../npc/giftTables";
import { rollMilestoneSeed } from "../../shared/seeds";
import { DEFAULT_DROP_RATES, type DropRates } from "../../shared/engine/dropRate";

export interface BondOutcome {
  npc: NpcId;
  /** Points gained (negative for a disliked gift). */
  delta: number;
  heartsBefore: number;
  heartsAfter: number;
  /** Furniture and rare seeds put in the bag just now (milestone gifts and gifts owed from before). */
  delivered: ItemId[];
  /** New gifts that didn't fit and wait with the villager. */
  owed: ItemId[];
  view: BondView;
}

export function npcName(npcId: string): string {
  return (Object.hasOwn(NPCS, npcId) ? NPCS[npcId]?.name : undefined) ?? npcId;
}

/** The bond with a villager, created on first contact; ended days are settled (bonus, decay) here. */
function bondOf(bonds: Bonds, npc: NpcId, now: number): Bond {
  const b = (bonds[npc] ??= newBond(now));
  rollBond(npc, b, now);
  return b;
}

export function npcBirthdayToday(npc: string, now: number): boolean {
  return isNpcId(npc) && isBirthday(NPC_BIRTHDAYS[npc], worldDate(now));
}

function viewOf(npc: NpcId, b: Bond, now: number): BondView {
  return bondView(npc, npcName(npc), b, now, { label: formatBirthday(NPC_BIRTHDAYS[npc]), today: npcBirthdayToday(npc, now) });
}

/** Hearts with a villager (0 when never met). Settles ended days first. */
export function bondHearts(bonds: Bonds, npcId: string, now: number): number {
  if (!isNpcId(npcId) || !Object.hasOwn(bonds, npcId)) return 0;
  return heartsFor(npcId, bondOf(bonds, npcId, now).pts).hearts;
}

/** Why this villager won't take a gift right now (null = they will). Doesn't create a bond. */
export function bondGiftRefusal(bonds: Bonds, npcId: string, now: number): GiftRefusal | null {
  if (!isNpcId(npcId) || !Object.hasOwn(bonds, npcId)) return null;
  return giftRefusal(npcId, bonds[npcId]!, now, npcBirthdayToday(npcId, now));
}

/** Settles every bond's ended days (call when a save is loaded, so decay shows at once). */
export function rollBonds(bonds: Bonds, now: number): void {
  for (const [npc, b] of Object.entries(bonds)) if (isNpcId(npc)) rollBond(npc, b, now);
}

/** Rolls milestone gifts, then hands over everything owed that fits in the bag. */
function settle(
  npc: NpcId,
  b: Bond,
  inv: Inventory,
  heartsBefore: number,
  delta: number,
  now: number,
  rand: () => number,
  rates: Readonly<DropRates>,
): BondOutcome {
  const heartsAfter = heartsFor(npc, b.pts).hearts;
  let fresh = 0;
  for (const m of dueMilestones(b, heartsAfter)) {
    b.milestones.push(m);
    const item = rollMilestoneGift(npc, m, b, rand, rates);
    if (item) {
      b.given.push(item);
      if (b.pending.length < MAX_PENDING) {
        b.pending.push(item);
        fresh++;
      }
    }
    // A rare seed may come along too (it doesn't count towards `given`: that steers furniture).
    const seed = rollMilestoneSeed(m, rand, rates);
    if (seed && b.pending.length < MAX_PENDING) {
      b.pending.push(seed);
      fresh++;
    }
  }
  const delivered: ItemId[] = [];
  while (b.pending.length > 0 && canAdd(inv, b.pending[0]!, 1)) {
    const item = b.pending.shift()!;
    addItem(inv, item, 1);
    delivered.push(item);
  }
  // Owed items queue oldest first, so the new ones still waiting are at the end.
  const stillOwed = Math.min(fresh, b.pending.length);
  return {
    npc,
    delta,
    heartsBefore,
    heartsAfter,
    delivered,
    owed: stillOwed > 0 ? b.pending.slice(-stillOwed) : [],
    view: viewOf(npc, b, now),
  };
}

/**
 * Something the villager can't forgive (they watched you pee in public): friendship drops to zero.
 * Milestones already reached stay rolled, so winning them back doesn't pay out the gifts again.
 */
export function bondReset(
  bonds: Bonds,
  npcId: string,
  inv: Inventory,
  now: number,
  rand: () => number,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
): BondOutcome | null {
  if (!isNpcId(npcId)) return null;
  const b = bondOf(bonds, npcId, now);
  const before = heartsFor(npcId, b.pts).hearts;
  const delta = -b.pts;
  b.pts = 0;
  return settle(npcId, b, inv, before, delta, now, rand, rates);
}

/** A chat with a villager (interact or a line typed next to them). Null for non-villagers. */
export function bondTalk(
  bonds: Bonds,
  npcId: string,
  inv: Inventory,
  now: number,
  rand: () => number,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
): BondOutcome | null {
  if (!isNpcId(npcId)) return null;
  const b = bondOf(bonds, npcId, now);
  const before = heartsFor(npcId, b.pts).hearts;
  const delta = talkGain(npcId, b, now);
  return settle(npcId, b, inv, before, delta, now, rand, rates);
}

/**
 * A gift given to a villager, by their taste and the item's quality (x8 on their birthday). Null
 * for non-villagers. Callers check bondGiftRefusal first so a refused gift stays in the bag.
 */
export function bondGift(
  bonds: Bonds,
  npcId: string,
  taste: GiftTaste,
  inv: Inventory,
  now: number,
  rand: () => number,
  opts: Pick<GiftOpts, "quality"> & { rates?: Readonly<DropRates> } = {},
): BondOutcome | null {
  if (!isNpcId(npcId)) return null;
  const b = bondOf(bonds, npcId, now);
  const before = heartsFor(npcId, b.pts).hearts;
  const delta = giftGain(npcId, b, taste, now, { quality: opts.quality, birthday: npcBirthdayToday(npcId, now) });
  return settle(npcId, b, inv, before, delta, now, rand, opts.rates ?? DEFAULT_DROP_RATES);
}

/** Every villager the player has met, warmest first. */
export function bondList(bonds: Bonds, now: number): BondView[] {
  return Object.entries(bonds)
    .filter((e): e is [NpcId, Bond] => isNpcId(e[0]))
    .map(([npc, b]) => {
      rollBond(npc, b, now);
      return viewOf(npc, b, now);
    })
    .sort((a, b) => b.hearts - a.hearts || b.into - a.into || a.name.localeCompare(b.name));
}
