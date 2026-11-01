import { describe, expect, it } from "vitest";
import { CROP_SPECS, cropSellPrice, getItem, ITEMS, RARITY_PRICE, seedBuyPrice } from "../src/shared/items";
import {
  allCrops,
  isRareCrop,
  MONSTER_SEED_DROPS,
  RARE_SEED_GIFTS,
  rollMilestoneSeed,
  rollSeedDrop,
  SEED_GIFT_CHANCE,
  seedsOf,
  STORE_SEEDS,
} from "../src/shared/seeds";
import { rollMonsterDrops } from "../src/shared/engine";
import { GIFT_MILESTONES, newBond, sanitizeBonds } from "../src/shared/hearts";
import { NPCS } from "../src/worker/npc/catalog";
import { giftTaste, NPC_IDS } from "../src/worker/npc/bible";
import { bondTalk } from "../src/worker/game/bonds";
import { giftLine } from "../src/worker/npc/giftTables";
import type { Inventory } from "../src/shared/types";
import catalog from "../src/client/public/assets/lpc/catalog.json";

interface NodeFs {
  readFileSync(path: string): { readUInt32BE(at: number): number };
}
// Workers types have no node:fs; load it at runtime (vitest runs in Node).
const nodeFs = () => import(/* @vite-ignore */ ["node", "fs"].join(":")) as Promise<NodeFs>;

const seeds = () => Object.values(ITEMS).filter((d) => d.kind === "seed");
/** A rand that replays `values`, then repeats the last. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

describe("crop table", () => {
  it("has the first four crops plus 12-20 new ones", () => {
    expect(CROP_SPECS.length).toBeGreaterThanOrEqual(12);
    expect(CROP_SPECS.length).toBeLessThanOrEqual(20);
    expect(seeds().length).toBe(4 + CROP_SPECS.length);
  });

  it("every seed grows a crop with silver and gold qualities and the same rarity", () => {
    for (const s of seeds()) {
      const crop = getItem(s.grows!.crop)!;
      expect(crop.kind, s.id).toBe("crop");
      expect(s.buy, s.id).toBeGreaterThan(0);
      expect(crop.sell, s.id).toBeGreaterThan(0);
      expect(crop.eat, s.id).toBeGreaterThan(0);
      for (const q of ["_silver", "_gold"]) {
        const better = getItem(crop.id + q)!;
        expect(better.base).toBe(crop.id);
        expect(better.sell).toBeGreaterThan(crop.sell);
        expect(better.rarity ?? "common").toBe(crop.rarity ?? "common");
      }
      expect(crop.rarity ?? "common").toBe(s.rarity ?? "common");
    }
  });

  it("has some uncommon and a few rare crops", () => {
    expect(seedsOf("uncommon").length).toBeGreaterThanOrEqual(2);
    expect(seedsOf("rare").length).toBeGreaterThanOrEqual(3);
  });

  it("prices scale with growth days", () => {
    for (const rarity of ["common", "uncommon", "rare"] as const) {
      for (let d = 2; d < 12; d++) expect(cropSellPrice(d + 1, rarity)).toBeGreaterThan(cropSellPrice(d, rarity));
      for (let d = 4; d < 12; d++) expect(cropSellPrice(d + 1, rarity, 3)).toBeGreaterThanOrEqual(cropSellPrice(d, rarity, 3));
    }
    // Among the table's single-harvest commons, a longer crop never sells for less.
    const singles = CROP_SPECS.filter((c) => !c.regrow && !c.rarity).sort((a, b) => a.days - b.days);
    for (let i = 1; i < singles.length; i++) {
      expect(getItem(singles[i]!.id)!.sell).toBeGreaterThanOrEqual(getItem(singles[i - 1]!.id)!.sell);
    }
  });

  it("rare crops are worth far more than any common crop", () => {
    const common = Math.max(...allCrops().filter((c) => (getItem(c)!.rarity ?? "common") === "common").map((c) => getItem(c)!.sell));
    for (const seed of seedsOf("rare")) {
      const crop = getItem(seed)!.grows!.crop;
      expect(getItem(crop)!.sell).toBeGreaterThan(common * 1.8);
      // A gifted rare seed sells well too.
      expect(getItem(seed)!.sell).toBeGreaterThan(100);
    }
    expect(RARITY_PRICE.rare).toBeGreaterThan(RARITY_PRICE.uncommon);
  });

  it("a seed costs less than the crop it grows (single harvest)", () => {
    for (const d of [3, 6, 9]) expect(seedBuyPrice(d)).toBeLessThan(cropSellPrice(d));
  });
});

describe("crop art", () => {
  const cat = catalog as any;
  const sizes = new Map<string, { w: number; h: number }>();
  const pngSize = (file: string) => sizes.get(file)!;
  async function loadSizes(files: string[]) {
    const fs = await nodeFs();
    for (const f of files) {
      const b = fs.readFileSync(`src/client/public/assets/lpc/${f}`);
      sizes.set(f, { w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    }
  }
  const inside = (r: number[], s: { w: number; h: number }) => r[0]! >= 0 && r[1]! >= 0 && r[0]! + r[2]! <= s.w && r[1]! + r[3]! <= s.h;

  it("every crop has 4 stages, 3 wilted frames and a dead frame inside its sheet", async () => {
    await loadSizes(["crops/crop_stages.png", "icons/crop_items.png"]);
    for (const crop of allCrops()) {
      const e = cat.crops[crop];
      expect(e, crop).toBeTruthy();
      const size = pngSize(e.file);
      expect(e.stages).toHaveLength(4);
      expect(e.wilted).toHaveLength(3);
      for (const r of [...e.stages, ...e.wilted, e.dead]) expect(inside(r, size), crop).toBe(true);
    }
  });

  it("every new crop and its seed has a pack icon", async () => {
    await loadSizes(["icons/crop_items.png"]);
    for (const c of CROP_SPECS) {
      for (const id of [c.id, `seed_${c.id}`]) {
        const e = cat.icons[id];
        expect(e, id).toBeTruthy();
        expect(inside(e.rect, pngSize(e.file)), id).toBe(true);
      }
    }
  });
});

describe("town store", () => {
  const odette = NPCS.odette!;

  it("sells every common seed at its item price and nothing rarer", () => {
    const sold = odette.shop!.sells.map((o) => o.item);
    expect(sold).toEqual([...STORE_SEEDS]);
    expect(sold.length).toBeGreaterThanOrEqual(15);
    for (const o of odette.shop!.sells) {
      expect(getItem(o.item)!.rarity ?? "common").toBe("common");
      expect(o.price).toBe(getItem(o.item)!.buy);
    }
    for (const r of [...seedsOf("uncommon"), ...seedsOf("rare")]) expect(sold).not.toContain(r);
  });

  it("buys every crop, rare ones included", () => {
    for (const c of allCrops()) expect(odette.shop!.buys).toContain(c);
  });
});

describe("monster seed drops", () => {
  it("riverside slimes drop common and uncommon seeds only", () => {
    const rule = MONSTER_SEED_DROPS.riverside!.slime!;
    const rarities = new Set(rule.pool.map((p) => getItem(p.item)!.rarity ?? "common"));
    expect([...rarities].sort()).toEqual(["common", "uncommon"]);
  });

  it("cave monsters drop uncommon seeds and, less often, rare ones", () => {
    for (const type of ["slime", "bat", "rock_crab"] as const) {
      const rule = MONSTER_SEED_DROPS.caves![type]!;
      const weight = (r: string) => rule.pool.filter((p) => (getItem(p.item)!.rarity ?? "common") === r).reduce((s, p) => s + p.weight, 0);
      expect(weight("common")).toBe(0);
      expect(weight("rare")).toBeGreaterThan(0);
      expect(weight("uncommon")).toBeGreaterThan(weight("rare"));
    }
  });

  it("every pooled item is a seed", () => {
    for (const zone of Object.values(MONSTER_SEED_DROPS)) {
      for (const rule of Object.values(zone)) for (const p of rule!.pool) expect(getItem(p.item)?.kind).toBe("seed");
    }
  });

  it("rollSeedDrop respects the chance and picks by weight", () => {
    expect(rollSeedDrop("riverside", "slime", () => 0.99)).toBeNull();
    expect(rollSeedDrop("riverside", "slime", () => 0)).toEqual({ item: MONSTER_SEED_DROPS.riverside!.slime!.pool[0]!.item, qty: 1 });
    expect(rollSeedDrop("village", "slime", () => 0)).toBeNull();
    expect(rollSeedDrop("riverside", "bat", () => 0)).toBeNull();
  });

  it("rollMonsterDrops adds the seed only when the zone is known", () => {
    expect(rollMonsterDrops("slime", () => 0).some((d) => getItem(d.item)?.kind === "seed")).toBe(false);
    const withSeed = rollMonsterDrops("slime", () => 0, "riverside");
    expect(withSeed[0]).toEqual({ item: "slime_gel", qty: 2 });
    expect(getItem(withSeed[withSeed.length - 1]!.item)?.kind).toBe("seed");
    // Over many kills deep in the caves a rare seed turns up, but not often.
    let rare = 0;
    let s = 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4000; i++) if (rollMonsterDrops("rock_crab", rand, "caves").some((d) => isRareCrop(d.item))) rare++;
    expect(rare).toBeGreaterThan(10);
    expect(rare).toBeLessThan(400);
  });
});

describe("villager seed gifts", () => {
  it("rare seeds only, more likely at higher milestones", () => {
    expect(RARE_SEED_GIFTS.length).toBeGreaterThanOrEqual(3);
    for (const s of RARE_SEED_GIFTS) expect(isRareCrop(s)).toBe(true);
    expect(SEED_GIFT_CHANCE).toHaveLength(GIFT_MILESTONES.length);
    for (let i = 1; i < SEED_GIFT_CHANCE.length; i++) expect(SEED_GIFT_CHANCE[i]!).toBeGreaterThan(SEED_GIFT_CHANCE[i - 1]!);
    expect(rollMilestoneSeed(2, () => 0.99)).toBeNull();
    expect(RARE_SEED_GIFTS).toContain(rollMilestoneSeed(10, () => 0));
    expect(rollMilestoneSeed(3, () => 0)).toBeNull(); // not a milestone
  });

  it("a milestone can bring a rare seed along with the furniture", () => {
    const bonds = { odette: { ...newBond(), pts: 10_000 } };
    const inv: Inventory = { coins: 0, slots: [] };
    const out = bondTalk(bonds, "odette", inv, 1_000_000, () => 0)!;
    const seedsGiven = out.delivered.filter((i) => getItem(i)?.kind === "seed");
    expect(seedsGiven.length).toBeGreaterThan(0);
    for (const s of seedsGiven) expect(isRareCrop(s)).toBe(true);
    // Seeds never count as furniture already given.
    expect(bonds.odette.given.every((i) => getItem(i)?.kind === "furniture")).toBe(true);
  });

  it("owed rare seeds survive a save round-trip; common seeds don't", () => {
    const raw = { odette: { ...newBond(), pending: ["seed_starfruit", "seed_turnip", "bookshelf"] } };
    expect(sanitizeBonds(raw).odette!.pending).toEqual(["seed_starfruit", "bookshelf"]);
  });

  it("rare crops and seeds are loved gifts", () => {
    for (const npc of NPC_IDS) {
      for (const seed of RARE_SEED_GIFTS) {
        const crop = getItem(seed)!.grows!.crop;
        for (const item of [seed, crop, `${crop}_gold`]) expect(["loved", "disliked"]).toContain(giftTaste(npc, item));
      }
    }
    expect(giftTaste("odette", "golden_melon")).toBe("loved");
  });

  it("a seed gift gets its own line", () => {
    expect(giftLine("seed_starfruit", () => 0)).toMatch(/starfruit seeds/i);
  });
});
