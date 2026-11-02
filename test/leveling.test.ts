import { describe, expect, it } from "vitest";
import {
  addXp,
  cleanLevel,
  cleanSales,
  jailPenalty,
  jailXpText,
  LEVEL_CAP,
  levelLabel,
  mergeSales,
  monsterXp,
  saleXp,
  salesXpTotal,
  SELL_XP_DAY_MAX,
  totalXpFor,
  xpFraction,
  xpToNext,
} from "../src/shared/leveling";
import { grantXp, jailProgress, progressOf, progressSave, withXpLine, xpMsg } from "../src/worker/game/progress";

// A steady hunter takes about 3 kills a minute (spawns.ts refills): first-floor slimes and bats
// pay 7..8 XP, the deeper floors 15..24 for rock crabs.
const EARLY_XP_PER_MIN = 3 * monsterXp("slime", 1);
const LATE_XP_PER_MIN = 3 * monsterXp("rock_crab", 1);
const minutesFor = (level: number, perMin: number) => xpToNext(level) / perMin;

describe("XP curve", () => {
  it("pins the numbers for levels 1..10 and 20", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(xpToNext)).toEqual([25, 76, 145, 230, 328, 440, 562, 696, 841, 995]);
    expect(xpToNext(20)).toBe(3017);
    expect(totalXpFor(1)).toBe(0);
    expect(totalXpFor(2)).toBe(25);
    expect(totalXpFor(10)).toBe(3343);
    expect(totalXpFor(20)).toBe(21717);
  });

  it("every level costs more than the last, and the cap has nothing above it", () => {
    for (let l = 1; l < LEVEL_CAP - 1; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToNext(LEVEL_CAP)).toBe(0);
    expect(xpToNext(0)).toBe(xpToNext(1));
    expect(xpToNext(Number.NaN)).toBe(xpToNext(1));
  });

  it("early levels take minutes of hunting", () => {
    expect(minutesFor(1, EARLY_XP_PER_MIN)).toBeLessThan(2);
    expect(minutesFor(2, EARLY_XP_PER_MIN)).toBeLessThan(5);
    expect(minutesFor(5, EARLY_XP_PER_MIN)).toBeLessThan(20);
    // The first five levels in well under an hour.
    expect(totalXpFor(5) / EARLY_XP_PER_MIN).toBeLessThan(30);
  });

  it("later levels take hours, never days or months", () => {
    expect(minutesFor(20, LATE_XP_PER_MIN)).toBeGreaterThan(45);
    expect(minutesFor(20, LATE_XP_PER_MIN)).toBeLessThan(120);
    expect(minutesFor(30, LATE_XP_PER_MIN)).toBeGreaterThan(90);
    // Even the last level before the cap is an evening or two, not weeks.
    expect(minutesFor(LEVEL_CAP - 1, LATE_XP_PER_MIN)).toBeLessThan(6 * 60);
  });
});

describe("XP awards", () => {
  it("monsters pay by toughness, more on deeper floors", () => {
    expect(monsterXp("slime", 1)).toBe(7);
    expect(monsterXp("bat", 1)).toBe(8);
    expect(monsterXp("rock_crab", 1)).toBe(15);
    expect(monsterXp("rock_crab", 4)).toBeGreaterThan(monsterXp("rock_crab", 1));
    expect(monsterXp("nope" as any, 1)).toBe(0);
  });

  it("adds XP, levels up with the overflow carried, and can gain several levels at once", () => {
    expect(addXp({ level: 1, xp: 0 }, 10)).toEqual({ level: 1, xp: 10, gained: 10, levelsUp: 0 });
    expect(addXp({ level: 1, xp: 20 }, 10)).toEqual({ level: 2, xp: 5, gained: 10, levelsUp: 1 });
    const big = addXp({ level: 1, xp: 0 }, 25 + 76 + 145 + 3);
    expect(big).toMatchObject({ level: 4, xp: 3, levelsUp: 3 });
    expect(addXp({ level: 3, xp: 4 }, -5)).toMatchObject({ level: 3, xp: 4, gained: 0 });
    expect(addXp({ level: 3, xp: 4 }, Number.NaN)).toMatchObject({ gained: 0 });
  });

  it("stops at the cap", () => {
    const r = addXp({ level: LEVEL_CAP - 1, xp: 0 }, 1e9);
    expect(r).toMatchObject({ level: LEVEL_CAP, xp: 0, levelsUp: 1 });
    expect(r.gained).toBe(xpToNext(LEVEL_CAP - 1));
    expect(addXp({ level: LEVEL_CAP, xp: 0 }, 100).gained).toBe(0);
    expect(xpFraction({ level: LEVEL_CAP, xp: 0 })).toBe(1);
  });

  it("grantXp updates progress in place and reports a level-up for the broadcast", () => {
    const p = progressOf({});
    expect(grantXp(p, 0, "kill")).toBeNull();
    const g = grantXp(p, 30, "kill", { x: 10.123, y: 4.5 })!;
    expect(p).toMatchObject({ level: 2, xp: 5 });
    expect(g.levelUp).toBe(2);
    expect(g.msg).toEqual({ t: "xp", level: 2, xp: 5, next: 76, gain: 30, reason: "kill", at: { x: 10.12, y: 4.5 }, up: 1 });
    const h = grantXp(p, 7, "kill")!;
    expect(h.levelUp).toBeNull();
    expect(h.msg.up).toBeUndefined();
  });
});

describe("selling XP", () => {
  it("diminishes with the square root and caps at the day maximum", () => {
    expect(salesXpTotal(0)).toBe(0);
    expect(salesXpTotal(100)).toBe(30);
    expect(salesXpTotal(1000)).toBe(94);
    expect(salesXpTotal(4000)).toBe(189);
    expect(salesXpTotal(1e9)).toBe(SELL_XP_DAY_MAX);
    expect(salesXpTotal(-5)).toBe(0);
    expect(salesXpTotal(Number.NaN)).toBe(0);
  });

  it("many small sales in one day pay the same as one big one, and never past the cap", () => {
    let ledger = null as ReturnType<typeof saleXp>["ledger"] | null;
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const r = saleXp(ledger, 500, 100);
      ledger = r.ledger;
      total += r.xp;
    }
    expect(ledger).toEqual({ day: 500, coins: 10_000 });
    expect(total).toBe(SELL_XP_DAY_MAX);
    expect(saleXp(ledger, 500, 1_000_000).xp).toBe(0);
    // Each extra coin is worth less as the day goes on.
    expect(saleXp({ day: 1, coins: 0 }, 1, 100).xp).toBeGreaterThan(saleXp({ day: 1, coins: 1000 }, 1, 100).xp);
  });

  it("a new world day starts from zero", () => {
    const r = saleXp({ day: 500, coins: 1e6 }, 501, 100);
    expect(r).toEqual({ xp: 30, ledger: { day: 501, coins: 100 } });
  });

  it("cleans and merges saved ledgers so a stale copy can't pay a day twice", () => {
    expect(cleanSales(undefined)).toBeNull();
    expect(cleanSales({ day: -1, coins: 5 })).toBeNull();
    expect(cleanSales({ day: 3, coins: "x" })).toBeNull();
    expect(cleanSales({ day: 3, coins: 5.7 })).toEqual({ day: 3, coins: 5 });
    expect(mergeSales({ day: 3, coins: 50 }, { day: 3, coins: 20 })).toEqual({ day: 3, coins: 50 });
    expect(mergeSales({ day: 3, coins: 50 }, { day: 4, coins: 20 })).toEqual({ day: 4, coins: 20 });
    expect(mergeSales(null, { day: 4, coins: 20 })).toEqual({ day: 4, coins: 20 });
    expect(mergeSales(null, null)).toBeNull();
  });
});

describe("jail penalty", () => {
  it("takes the progress toward the next level but never a level", () => {
    expect(jailPenalty({ level: 7, xp: 300 })).toEqual({ level: 7, xp: 0, lost: 300 });
    expect(jailPenalty({ level: 7, xp: 0 })).toEqual({ level: 7, xp: 0, lost: 0 });
    expect(jailXpText({ level: 7, xp: 0 }, 300)).toBe("You lost your progress toward level 8.");
    expect(jailXpText({ level: 7, xp: 0 }, 0)).toBeNull();
  });

  it("jailProgress resets XP in place, moves the epoch on and words the notice", () => {
    const p = progressOf({ level: 4, xp: 100, levelEpoch: 2 });
    const r = jailProgress(p);
    expect(p).toEqual({ level: 4, xp: 0, epoch: 3 });
    expect(r.msg).toEqual({ t: "xp", level: 4, xp: 0, next: 230, reason: "jail", lost: 100 });
    expect(withXpLine("Jailed.", r.text)).toBe("Jailed. You lost your progress toward level 5.");
    expect(withXpLine("Jailed.", null)).toBe("Jailed.");
    // Nothing to lose: no "lost" and no extra line.
    const again = jailProgress(p);
    expect(again.msg.lost).toBeUndefined();
    expect(again.text).toBeNull();
    expect(p.level).toBe(4);
  });
});

describe("saved level", () => {
  it("old saves without the fields load as level 1, 0 XP, epoch 0", () => {
    expect(progressOf({})).toEqual({ level: 1, xp: 0, epoch: 0 });
    expect(progressOf(null)).toEqual({ level: 1, xp: 0, epoch: 0 });
    expect(xpMsg(progressOf({}))).toEqual({ t: "xp", level: 1, xp: 0, next: 25 });
  });

  it("bad or tampered values are cleaned", () => {
    expect(cleanLevel(-3, 10)).toEqual({ level: 1, xp: 10 });
    expect(cleanLevel(5.9, 1e9)).toEqual({ level: 5, xp: xpToNext(5) - 1 });
    expect(cleanLevel(999, 50)).toEqual({ level: LEVEL_CAP, xp: 0 });
    expect(cleanLevel("7", -1)).toEqual({ level: 1, xp: 0 });
    expect(progressOf({ level: 3, xp: 5, levelEpoch: -1 }).epoch).toBe(0);
    expect(progressSave({ level: 3, xp: 5, epoch: 2 })).toEqual({ level: 3, xp: 5, levelEpoch: 2 });
  });

  it("labels and fractions", () => {
    expect(levelLabel(12)).toBe("Lv 12");
    expect(levelLabel(Number.NaN)).toBe("Lv 1");
    expect(xpFraction({ level: 1, xp: 5 })).toBeCloseTo(0.2);
  });
});
