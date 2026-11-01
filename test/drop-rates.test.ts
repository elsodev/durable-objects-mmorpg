// Global drop-rate control: env parsing, the shared helper, and proof that every random drop roll
// in the game goes through it (table coverage at rates 0 and 10, plus a source scan).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DROP_RATES,
  dropChance,
  dropCount,
  dropMultiplier,
  isRareDrop,
  MAX_DROP_RATE,
  parseDropRates,
  parseRate,
  type DropRates,
} from "../src/shared/engine/dropRate";
import { rollMonsterDrops, MONSTER_STATS } from "../src/shared/engine/monsters";
import { ROCK_RULES, rollDrops, type Ore } from "../src/shared/engine/toolRules";
import { rockDrops } from "../src/worker/game/rocks";
import { rollRockOre, CAVE_ROCK_ODDS } from "../src/shared/engine/rockOres";
import { MONSTER_SEED_DROPS, rollMilestoneSeed, rollSeedDrop } from "../src/shared/seeds";
import { CHEST_BONUS, CHEST_TABLE, rollChestLoot } from "../src/worker/game/chestField";
import { rollMilestoneGift } from "../src/worker/npc/giftTables";
import { rollCount, rollHarvest } from "../src/shared/engine/harvest";
import { GIFT_MILESTONES, MAX_HEARTS } from "../src/shared/hearts";
import { ForageGrower } from "../src/worker/game/forage";
import { GroundItems } from "../src/worker/game/groundItems";
import { buildCollision } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import { rng } from "./engine-fixtures";

// No @types/node in this repo: load Node built-ins untyped and describe only what is used.
const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const { readdirSync, readFileSync, statSync } = proc.getBuiltinModule("node:fs") as {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: "utf8"): string;
  statSync(p: string): { isDirectory(): boolean };
};
const join = (dir: string, f: string): string => `${dir}/${f}`;

const OFF: DropRates = { global: 0 };
const MAX: DropRates = { global: MAX_DROP_RATE };

describe("parseDropRates", () => {
  it("defaults to 1 with no overrides", () => {
    expect(parseDropRates({})).toEqual({ global: 1 });
    expect(parseDropRates(undefined)).toEqual({ global: 1 });
    expect(parseDropRates({ DROP_RATE: "1" })).toEqual(DEFAULT_DROP_RATES);
  });

  it("reads the global rate and every override", () => {
    expect(
      parseDropRates({
        DROP_RATE: "2",
        DROP_RATE_MONSTER: "0.5",
        DROP_RATE_ROCK: "3",
        DROP_RATE_RARE: "0",
        DROP_RATE_CHEST: "1.25",
        DROP_RATE_FORAGE: " 4 ",
        DROP_RATE_GIFT: "1e0",
        DROP_RATE_HARVEST: "0.1",
      }),
    ).toEqual({ global: 2, monster: 0.5, rock: 3, rare: 0, chest: 1.25, forage: 4, gift: 1, harvest: 0.1 });
  });

  it("clamps to 0..10 and ignores anything that isn't a plain number", () => {
    expect(parseRate("25")).toBe(10);
    expect(parseRate("-3")).toBe(0);
    expect(parseRate(1e9)).toBe(10);
    for (const bad of ["", "  ", "abc", "1x", "0x10", "NaN", "Infinity", "1,5", null, undefined, {}, [], true, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseRate(bad), String(bad)).toBeUndefined();
    }
    expect(parseDropRates({ DROP_RATE: "lots", DROP_RATE_RARE: "", DROP_RATE_ROCK: "99" })).toEqual({ global: 1, rock: 10 });
  });
});

describe("dropChance", () => {
  it("multiplies a chance and caps it at 1", () => {
    expect(dropChance(0.1, "monster", { global: 2 })).toBeCloseTo(0.2);
    expect(dropChance(0.4, "monster", { global: 5 })).toBe(1);
    expect(dropChance(0.4, "monster", OFF)).toBe(0);
    expect(dropChance(0, "monster", MAX)).toBe(0);
    expect(dropChance(-1, "monster", MAX)).toBe(0);
  });

  it("never scales guaranteed drops", () => {
    expect(dropChance(1, "rock", OFF)).toBe(1);
    expect(dropChance(1, "gift", { global: 1, gift: 0, rare: 0 }, true)).toBe(1);
  });

  it("uses the category override, then DROP_RATE; rare items prefer DROP_RATE_RARE", () => {
    const rates: DropRates = { global: 2, monster: 0.5, rare: 3 };
    expect(dropMultiplier("monster", rates)).toBe(0.5);
    expect(dropMultiplier("chest", rates)).toBe(2);
    expect(dropMultiplier("monster", rates, true)).toBe(3);
    expect(dropMultiplier("monster", { global: 2, monster: 0.5 }, true)).toBe(0.5);
    expect(dropCount(7, "forage", { global: 1, forage: 2 })).toBe(14);
    expect(dropCount(7, "forage", OFF)).toBe(0);
  });

  it("knows which items are rare", () => {
    for (const id of ["gem_diamond", "gem_crystal", "ore_gold", "seed_starfruit", "clock"]) expect(isRareDrop(id), id).toBe(true);
    for (const id of ["stone", "ore_copper", "ore_iron", "ore_silver", "slime_gel", "seed_turnip", "nope"]) expect(isRareDrop(id), id).toBe(false);
  });
});

/** Rolls `fn` many times and counts the items it gave. */
function tally(n: number, seed: number, fn: (r: () => number) => { item: string; qty: number }[]): Map<string, number> {
  const r = rng(seed);
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) for (const d of fn(r)) out.set(d.item, (out.get(d.item) ?? 0) + d.qty);
  return out;
}

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("every drop source honours the rates (table coverage)", () => {
  it("monsters: nothing at 0, more at 10", () => {
    for (const type of Object.keys(MONSTER_STATS) as (keyof typeof MONSTER_STATS)[]) {
      for (const zone of [undefined, "riverside", "caves"]) {
        expect(total(tally(300, 1, (r) => rollMonsterDrops(type, r, zone, OFF))), `${type} ${zone}`).toBe(0);
        const base = total(tally(2000, 2, (r) => rollMonsterDrops(type, r, zone)));
        const up = total(tally(2000, 2, (r) => rollMonsterDrops(type, r, zone, MAX)));
        expect(up, `${type} ${zone}`).toBeGreaterThan(base);
      }
    }
  });

  it("monster seed drops: none at 0; rare seeds follow DROP_RATE_RARE", () => {
    for (const [zone, rules] of Object.entries(MONSTER_SEED_DROPS)) {
      for (const type of Object.keys(rules) as (keyof typeof MONSTER_STATS)[]) {
        const r = rng(9);
        for (let i = 0; i < 500; i++) expect(rollSeedDrop(zone, type, r, OFF)).toBeNull();
      }
    }
    const rare = (rates: DropRates) => {
      const r = rng(4);
      let n = 0;
      for (let i = 0; i < 20000; i++) {
        const s = rollSeedDrop("caves", "rock_crab", r, rates);
        if (s && isRareDrop(s.item)) n++;
      }
      return n;
    };
    expect(rare({ global: 1, rare: 0 })).toBe(0);
    expect(rare({ global: 1, rare: 5 })).toBeGreaterThan(rare({ global: 1 }) * 2);
  });

  it("rocks: the base ore always drops; bonus drops scale", () => {
    for (const ore of Object.keys(ROCK_RULES) as Ore[]) {
      const main = ROCK_RULES[ore].drops[0]!;
      expect(main.chance, ore).toBeUndefined();
      const off = tally(500, 3, (r) => rockDrops(ore, r, OFF));
      expect(off.get(main.item) ?? 0, ore).toBeGreaterThanOrEqual(500 * main.min);
      const bonus = ROCK_RULES[ore].drops.filter((d) => d.chance !== undefined);
      for (const d of bonus) {
        const base = tally(5000, 5, (r) => rollDrops([d], r)).get(d.item) ?? 0;
        expect(tally(500, 5, (r) => rollDrops([d], r, OFF)).size, `${ore} ${d.item}`).toBe(0);
        expect(tally(5000, 5, (r) => rollDrops([d], r, MAX)).get(d.item) ?? 0, `${ore} ${d.item}`).toBeGreaterThan(base);
      }
    }
  });

  it("cave rock upgrades: none at 0, more at 10", () => {
    const count = (rates: DropRates) => {
      const r = rng(6);
      let n = 0;
      for (let i = 0; i < 5000; i++) for (const odds of Object.values(CAVE_ROCK_ODDS)) if (rollRockOre("iron", odds, r, rates) !== "iron") n++;
      return n;
    };
    expect(count(OFF)).toBe(0);
    expect(count(MAX)).toBeGreaterThan(count(DEFAULT_DROP_RATES) * 3);
  });

  it("chests: one main roll and no bonus finds at 0; bonus finds grow at 10", () => {
    const main = new Set(CHEST_TABLE.map((e) => e.value.item));
    const r = rng(8);
    for (let i = 0; i < 500; i++) {
      const loot = rollChestLoot(r, OFF);
      expect(loot.items).toHaveLength(1);
      expect(main.has(loot.items[0]!.item)).toBe(true);
    }
    const bonusItems = (rates: DropRates) => {
      const t = tally(3000, 10, (rr) => rollChestLoot(rr, rates).items);
      return [...t].filter(([item]) => !main.has(item)).reduce((n, [, q]) => n + q, 0);
    };
    expect(CHEST_BONUS.length).toBeGreaterThan(0);
    expect(bonusItems(MAX)).toBeGreaterThan(bonusItems(DEFAULT_DROP_RATES) * 3);
  });

  it("villager gifts: nothing at 0 except the sure gift at full hearts", () => {
    const r = rng(12);
    for (const m of GIFT_MILESTONES) {
      for (let i = 0; i < 200; i++) {
        const gift = rollMilestoneGift("rue", m, { given: [] }, r, OFF);
        if (m === MAX_HEARTS) expect(gift).not.toBeNull();
        else expect(gift).toBeNull();
        expect(rollMilestoneSeed(m, r, OFF)).toBeNull();
      }
    }
    const seeds = (rates: DropRates) => {
      const rr = rng(13);
      let n = 0;
      for (let i = 0; i < 2000; i++) if (rollMilestoneSeed(GIFT_MILESTONES[0]!, rr, rates)) n++;
      return n;
    };
    expect(seeds({ global: 1, gift: 5 })).toBeGreaterThan(seeds(DEFAULT_DROP_RATES) * 2);
  });

  it("harvest: no extra crops at 0, more at 10", () => {
    const y = { min: 1, max: 1, extra: 0.1 };
    const r = rng(14);
    for (let i = 0; i < 500; i++) expect(rollCount(y, r, OFF)).toBe(1);
    const sum = (rates: DropRates) => {
      const rr = rng(15);
      let n = 0;
      for (let i = 0; i < 2000; i++) n += rollHarvest("turnip", 0, rr, 0, rates).count;
      return n;
    };
    expect(sum(MAX)).toBeGreaterThan(sum(DEFAULT_DROP_RATES));
  });

  it("forage: the cap scales (0 grows nothing)", () => {
    const map = getMap("riverside");
    const grid = buildCollision(map);
    const grow = (rates: DropRates) => ForageGrower.forZone("riverside", map, grid)!.refill(new GroundItems(), [], 0, rng(3), rates).length;
    expect(grow(OFF)).toBe(0);
    expect(grow({ global: 1, forage: 2 })).toBe(2 * grow(DEFAULT_DROP_RATES));
  });
});

// ---- source scan: no drop roll may compare rand() to a chance on its own ----

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/**
 * rand() comparisons that are NOT item drops (combat, AI, crops wilting, NPC chatter), or that
 * compare against a chance the helper already produced. Anything else must call dropChance /
 * rollDrop from shared/engine/dropRate.ts.
 */
const NOT_DROPS: Record<string, string[]> = {
  "src/shared/engine/dropRate.ts": ["rand() < dropChance("],
  "src/shared/engine/monsters.ts": ["rand() < p)", "rand() < dtMs / MONSTER_AI.wanderIdleMs"],
  "src/shared/engine/homeday.ts": ["rand() >= CROW_CHANCE", "rand() < REVERT_CHANCE_DAY2"],
  "src/shared/engine/combat.ts": ["rand() < missChance", "rand() < w.critChance"],
  // Crop quality, not a drop; `extra` comes from dropChance a few lines up.
  "src/shared/engine/harvest.ts": ["rand() < gold", "rand() < silver", "rand() < extra"],
  "src/worker/npc/brain.ts": ["rand() >= IDLE_CHANCE"],
  "src/worker/npc/think/scripted.ts": ['rand() < 0.5'],
};

describe("every drop roll goes through the drop-rate helper (source scan)", () => {
  const files = [...sources("src/shared"), ...sources("src/worker")].map((p) => p.replaceAll("\\", "/"));
  const roll = /(?:rand|random)\(\)\s*(?:<|>=|>|<=)/;

  it("finds no unlisted rand() comparison", () => {
    const found: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!roll.test(line)) return;
          const ok = (NOT_DROPS[f] ?? []).some((snip) => line.includes(snip));
          if (!ok) found.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("each drop module calls the helper", () => {
    const helper = /\b(rollDrop|dropChance|dropCount)\(/;
    for (const f of [
      "src/shared/engine/toolRules.ts",
      "src/shared/engine/monsters.ts",
      "src/shared/engine/rockOres.ts",
      "src/shared/engine/harvest.ts",
      "src/shared/seeds.ts",
      "src/worker/game/chestField.ts",
      "src/worker/game/forage.ts",
      "src/worker/npc/giftTables.ts",
    ]) {
      expect(helper.test(readFileSync(f, "utf8")), f).toBe(true);
    }
  });

  it("the Durable Objects read the rates from env and pass them on", () => {
    for (const f of ["src/worker/zone.ts", "src/worker/home.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("parseDropRates(env");
      expect(src.match(/this\.rates/g)?.length ?? 0, f).toBeGreaterThanOrEqual(3);
    }
    const zone = readFileSync("src/worker/zone.ts", "utf8");
    for (const call of ["rollMonsterDrops(", "rollChestLoot(", "rockDrops(", "forage.refill(", "bondTalk(", "bondGift("]) {
      const lines = zone.split("\n").filter((l) => l.includes(call) && !l.trim().startsWith("import"));
      expect(lines.length, call).toBeGreaterThan(0);
      for (const l of lines) expect(l, call).toContain("rates");
    }
  });
});
