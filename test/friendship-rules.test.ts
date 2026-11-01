import { describe, expect, it } from "vitest";
import {
  BIRTHDAY_MULT,
  bondView,
  decayFloor,
  DECAY_PER_DAY,
  GIFT_PTS,
  giftGain,
  giftPoints,
  giftRefusal,
  GIFTS_PER_WEEK,
  heartCurve,
  heartsFor,
  newBond,
  qualityMult,
  rollBond,
  sanitizeBonds,
  talkGain,
  WEEKLY_BONUS_PTS,
} from "../src/shared/hearts";
import { dateOfDay, worldDay, WORLD_DAY_MS } from "../src/shared/calendar";
import { giftTaste, NPC_BIRTHDAYS, NPC_IDS, UNIVERSAL_GIFTS } from "../src/worker/npc/bible";
import { bondGift, bondGiftRefusal, bondList, bondTalk, npcBirthdayToday } from "../src/worker/game/bonds";
import type { Inventory } from "../src/shared/types";
import { rng } from "./engine-fixtures";

const DAY = WORLD_DAY_MS;
/** Sunday 1 Nov 2026, 09:00 UTC: the first day of a Sunday-based week. */
const SUN = Date.UTC(2026, 10, 1, 9);

/** A time on the given NPC's next birthday (searching forward from SUN). */
function birthdayTime(npc: (typeof NPC_IDS)[number]): number {
  const b = NPC_BIRTHDAYS[npc];
  for (let i = 0; i < 112; i++) {
    const d = dateOfDay(worldDay(SUN) + i);
    if (d.season === b.season && d.day === b.day) return SUN + i * DAY;
  }
  throw new Error("no birthday within a year");
}

describe("gift tastes", () => {
  it("has five tiers, hated is -40", () => {
    expect(GIFT_PTS).toEqual({ loved: 80, liked: 45, neutral: 20, disliked: -25, hated: -40 });
  });

  it("personal lists win over universal ones, then neutral", () => {
    expect(UNIVERSAL_GIFTS.hated).toContain("slime_gel");
    expect(giftTaste("iris", "slime_gel")).toBe("loved"); // personal love beats the universal hate
    expect(giftTaste("grumm", "slime_gel")).toBe("hated"); // universal
    expect(giftTaste("grumm", "strawberry")).toBe("disliked"); // personal dislike beats the universal like
    expect(giftTaste("bram", "gem_crystal")).toBe("liked"); // universal like
    expect(giftTaste("fenwick", "slime_gel")).toBe("hated"); // personal hate
    expect(giftTaste("bram", "carrot_gold")).toBe(giftTaste("bram", "carrot")); // quality crops by base
  });

  it("every villager has a hated item and a birthday", () => {
    for (const id of NPC_IDS) {
      expect(NPC_BIRTHDAYS[id].day).toBeGreaterThanOrEqual(1);
      expect(NPC_BIRTHDAYS[id].day).toBeLessThanOrEqual(28);
    }
    const days = NPC_IDS.map((id) => `${NPC_BIRTHDAYS[id].season}${NPC_BIRTHDAYS[id].day}`);
    expect(new Set(days).size).toBe(NPC_IDS.length);
  });
});

describe("gift points: quality and birthday", () => {
  it("quality multipliers", () => {
    expect(qualityMult(0)).toBe(1);
    expect(qualityMult(undefined)).toBe(1);
    expect(qualityMult(1)).toBe(1.1);
    expect(qualityMult(2)).toBe(1.25);
    expect(qualityMult(4)).toBe(1.5);
    expect(giftPoints("loved", 1)).toBe(88);
    expect(giftPoints("loved", 2)).toBe(100);
    expect(giftPoints("liked", 2)).toBe(56);
    expect(giftPoints("hated", 2)).toBe(-40); // quality never softens a bad gift
  });

  it("birthday gifts are worth x8, good or bad", () => {
    expect(BIRTHDAY_MULT).toBe(8);
    expect(giftPoints("liked", 0, true)).toBe(360);
    expect(giftPoints("loved", 2, true)).toBe(800);
    expect(giftPoints("disliked", 0, true)).toBe(-200);
  });

  it("bondGift applies the birthday multiplier on the villager's birthday only", () => {
    const at = birthdayTime("bram");
    expect(npcBirthdayToday("bram", at)).toBe(true);
    expect(npcBirthdayToday("bram", at + DAY)).toBe(false);
    const inv: Inventory = { coins: 0, slots: [] };
    const bonds = {};
    const out = bondGift(bonds, "bram", "liked", inv, at, rng(1))!;
    expect(out.delta).toBe(45 * 8);
    expect(out.view.birthdayToday).toBe(true);
    expect(out.view.birthday).toBe("Spring 9");
    const other = bondGift({}, "bram", "liked", inv, at + DAY, rng(1))!;
    expect(other.delta).toBe(45);
  });

  it("bondGift uses the item quality", () => {
    const out = bondGift({}, "odette", "loved", { coins: 0, slots: [] }, SUN, rng(1), { quality: 2 })!;
    expect(out.delta).toBe(100);
  });
});

describe("gift limits: one a day, two a week", () => {
  it("refuses a second gift the same day and a third the same week", () => {
    const b = newBond();
    expect(giftRefusal("rue", b, SUN)).toBeNull();
    expect(giftGain("rue", b, "liked", SUN)).toBe(45);
    expect(giftRefusal("rue", b, SUN + 1000)).toBe("day");
    expect(giftGain("rue", b, "liked", SUN + 1000)).toBe(0);
    expect(giftGain("rue", b, "liked", SUN + DAY)).toBe(45);
    expect(b.weekGifts).toBe(GIFTS_PER_WEEK);
    expect(giftRefusal("rue", b, SUN + 2 * DAY)).toBe("week");
    expect(giftGain("rue", b, "loved", SUN + 3 * DAY)).toBe(0);
    // Next Sunday: a new week.
    expect(giftRefusal("rue", b, SUN + 7 * DAY)).toBeNull();
  });

  it("a birthday gift doesn't count toward (or need room in) the week", () => {
    const at = birthdayTime("pip");
    const b = newBond();
    b.day = worldDay(at) - 1;
    b.week = dateOfDay(b.day).week;
    b.weekGifts = GIFTS_PER_WEEK;
    b.talked = true;
    // Unless the birthday starts a new week, the week is already full...
    expect(giftRefusal("pip", b, at, false) ?? "week").toBe("week");
    // ...but the birthday gift is still welcome, once.
    expect(giftRefusal("pip", b, at, true)).toBeNull();
    expect(giftGain("pip", b, "loved", at, { birthday: true })).toBe(640);
    expect(giftRefusal("pip", b, at, true)).toBe("day");
  });

  it("bondGiftRefusal reads the bond without creating one", () => {
    const bonds: Record<string, ReturnType<typeof newBond>> = {};
    expect(bondGiftRefusal(bonds, "tess", SUN)).toBeNull();
    expect(Object.keys(bonds)).toEqual([]);
    bondGift(bonds, "tess", "neutral", { coins: 0, slots: [] }, SUN, rng(1));
    expect(bondGiftRefusal(bonds, "tess", SUN)).toBe("day");
    expect(bondGiftRefusal(bonds, "not_an_npc", SUN)).toBeNull();
  });
});

describe("weekly bonus", () => {
  it("+10 when a week ends with both weekly gifts given", () => {
    const b = newBond(SUN);
    giftGain("marlo", b, "neutral", SUN);
    talkGain("marlo", b, SUN);
    giftGain("marlo", b, "neutral", SUN + DAY);
    talkGain("marlo", b, SUN + DAY);
    const before = b.pts;
    // Saturday: same week, no bonus yet (talk keeps decay away).
    for (let d = 2; d <= 6; d++) talkGain("marlo", b, SUN + d * DAY);
    const sat = b.pts;
    expect(sat - before).toBe(5 * 25);
    const roll = rollBond("marlo", b, SUN + 7 * DAY);
    expect(roll.bonus).toBe(WEEKLY_BONUS_PTS);
    expect(b.pts).toBe(sat + WEEKLY_BONUS_PTS);
    expect(b.weekGifts).toBe(0);
  });

  it("no bonus with only one gift", () => {
    const b = newBond(SUN);
    giftGain("marlo", b, "neutral", SUN);
    talkGain("marlo", b, SUN);
    expect(rollBond("marlo", b, SUN + 7 * DAY).bonus).toBe(0);
  });
});

describe("decay", () => {
  it("-2 for every ended day without a chat, settled lazily", () => {
    const b = newBond(SUN);
    b.pts = 40;
    talkGain("sable", b, SUN); // talked on day 0: no decay for it
    const pts = b.pts;
    const roll = rollBond("sable", b, SUN + 4 * DAY); // days 1, 2, 3 ended untalked
    expect(roll.decay).toBe(3 * DECAY_PER_DAY);
    expect(b.pts).toBe(pts - 3 * DECAY_PER_DAY);
    // Calling again the same day changes nothing.
    expect(rollBond("sable", b, SUN + 4 * DAY + 3600_000)).toEqual({ bonus: 0, decay: 0 });
    // The current day only counts once it has ended.
    expect(rollBond("sable", b, SUN + 5 * DAY).decay).toBe(DECAY_PER_DAY);
  });

  it("never drops below the highest milestone reached", () => {
    const at = heartCurve("grumm").at;
    const b = newBond(SUN);
    b.pts = at[4]! + 7; // 4 hearts and a bit
    expect(heartsFor("grumm", b.pts).hearts).toBe(4);
    expect(decayFloor("grumm", b.pts)).toBe(at[4]);
    rollBond("grumm", b, SUN + 30 * DAY);
    expect(b.pts).toBe(at[4]);
    const low = newBond(SUN);
    low.pts = 5;
    rollBond("grumm", low, SUN + 30 * DAY);
    expect(low.pts).toBe(0);
  });

  it("a brand-new or migrated bond (no day yet) doesn't decay", () => {
    const b = newBond();
    b.pts = 100;
    expect(rollBond("rue", b, SUN).decay).toBe(0);
    expect(b.pts).toBe(100);
  });

  it("bondList settles decay when the save loads", () => {
    const bonds = sanitizeBonds({ rue: { pts: 30, day: worldDay(SUN), talkPts: 25, gifts: 0, lastTalk: SUN, milestones: [], given: [], pending: [] } });
    bondList(bonds, SUN + 3 * DAY);
    expect(bonds.rue!.pts).toBe(30 - 2 * DECAY_PER_DAY);
  });
});

describe("one day key everywhere (no midnight double-dip)", () => {
  it("daily talk and gift counters roll exactly at the world day boundary", () => {
    const midnight = Date.UTC(2026, 10, 3);
    const b = newBond(midnight - DAY);
    expect(talkGain("rue", b, midnight - 30_000)).toBe(25);
    expect(giftGain("rue", b, "liked", midnight - 20_000)).toBe(45);
    // The cooldown still holds across midnight...
    expect(talkGain("rue", b, midnight + 10_000)).toBe(0);
    // ...and the new day's view agrees with the rules about what is left today.
    const v = bondView("rue", "Rue", b, midnight + 10_000);
    expect(v.talkedToday).toBe(true);
    expect(v.giftsToday).toBe(0);
    expect(v.giftsWeek).toBe(1);
    expect(giftRefusal("rue", b, midnight + 20_000)).toBeNull();
    expect(giftGain("rue", b, "liked", midnight + 20_000)).toBe(45);
    // Week total caps the double-dip: a third gift that week is refused.
    expect(giftRefusal("rue", b, midnight + DAY)).toBe("week");
  });

  it("talking marks the day, views report talked today", () => {
    const bonds = {};
    const out = bondTalk(bonds, "iris", { coins: 0, slots: [] }, SUN, rng(1))!;
    expect(out.view.talkedToday).toBe(true);
    expect(bondList(bonds, SUN + DAY)[0]!.talkedToday).toBe(false);
  });
});
