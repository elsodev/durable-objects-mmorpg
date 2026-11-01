// Ore economy: shipping stone, ore and other goods, shop prices, the rarer rock tiers and how
// rare they are in the caves.
import { describe, expect, it } from "vitest";
import { getItem, isShippable, ITEMS, ORE_VALUES, SHOP_ORE_SHARE, shopSellPrice } from "../src/shared/items";
import type { Inventory } from "../src/shared/types";
import { binPayout, sanitizeBin, shipSlot, type BinEntry } from "../src/worker/game/shipping";
import { sellTo } from "../src/worker/game/shop";
import { NPCS } from "../src/worker/npc/catalog";
import { ROCK_RULES, resolveToolUse, type Ore } from "../src/shared/engine/toolRules";
import { CAVE_ROCK_ODDS, rockOdds, rockOreAt } from "../src/shared/engine/rockOres";
import { RockField } from "../src/worker/game/rockField";
import { getMap } from "../src/shared/maps";
import { buildCollision } from "../src/shared/engine";

const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const { readFileSync } = proc.getBuiltinModule("node:fs") as { readFileSync(p: string, enc: "utf8"): string };

const inv = (...slots: ({ item: string; qty: number } | null)[]): Inventory => ({ coins: 0, slots: [...slots, ...Array(24 - slots.length).fill(null)] });

describe("shipping bin", () => {
  it("takes stone, ores, gems, forage, materials and fish, paying each item's full value", () => {
    const goods = ["stone", "ore_copper", "ore_iron", "ore_silver", "ore_gold", "gem_crystal", "gem_diamond", "herb_mint", "wood", "slime_gel", "fish_trout", "turnip"];
    const bag = inv(...goods.map((item) => ({ item, qty: 3 })));
    const bin: BinEntry[] = [];
    goods.forEach((_, slot) => expect(shipSlot(bag, bin, slot).ok, goods[slot]).toBe(true));
    const { lines, total } = binPayout(bin);
    for (const l of lines) expect(l.coins, l.item).toBe(3 * getItem(l.item)!.sell);
    expect(lines.find((l) => l.item === "ore_gold")!.coins).toBe(3 * ORE_VALUES.ore_gold);
    expect(total).toBe(goods.reduce((n, id) => n + 3 * getItem(id)!.sell, 0));
  });

  it("refuses anything with no sell value, and tools", () => {
    for (const def of Object.values(ITEMS)) {
      const bin: BinEntry[] = [];
      const r = shipSlot(inv({ item: def.id, qty: 1 }), bin, 0);
      expect(r.ok, def.id).toBe(def.sell > 0 && def.kind !== "tool");
      expect(isShippable(def.id), def.id).toBe(r.ok);
    }
    // A stored bin can't smuggle in something unsellable either.
    expect(sanitizeBin([{ item: "hoe", qty: 1 }, { item: "ore_gold", qty: 2 }])).toEqual([{ item: "ore_gold", qty: 2 }]);
    expect(binPayout([{ item: "pickaxe", qty: 5 }]).total).toBe(0);
  });
});

describe("ore values", () => {
  it("climb with rarity, diamond far above the rest", () => {
    const v = ORE_VALUES;
    expect(v.stone).toBeLessThan(v.ore_copper);
    expect(v.ore_copper).toBeLessThan(v.ore_iron);
    expect(v.ore_iron).toBeLessThan(v.ore_silver);
    expect(v.ore_silver).toBeLessThan(v.ore_gold);
    expect(v.gem_diamond).toBeGreaterThanOrEqual(300);
    for (const [id, sell] of Object.entries(v)) expect(getItem(id)?.sell, id).toBe(sell);
  });

  it("the smith buys every ore and gem, for less than the bin pays", () => {
    const buys = NPCS.fenwick!.shop!.buys;
    for (const id of Object.keys(ORE_VALUES)) {
      expect(buys, id).toContain(id);
      const price = shopSellPrice(id);
      expect(price, id).toBe(Math.max(1, Math.floor(getItem(id)!.sell * SHOP_ORE_SHARE)));
      expect(price, id).toBeLessThan(getItem(id)!.sell);
    }
    const bag = inv({ item: "ore_gold", qty: 2 });
    expect(sellTo(bag, NPCS.fenwick!.shop!, 0, 2).ok).toBe(true);
    expect(bag.coins).toBe(2 * shopSellPrice("ore_gold"));
    // Crops still sell at full price to the market.
    expect(shopSellPrice("turnip")).toBe(getItem("turnip")!.sell);
  });
});

describe("rock tiers", () => {
  it("gold and diamond need the iron pickaxe and many hits", () => {
    expect(ROCK_RULES.gold).toMatchObject({ hits: 6, power: 2 });
    expect(ROCK_RULES.diamond).toMatchObject({ hits: 8, power: 2 });
    expect(ROCK_RULES.silver.power).toBe(2);
    const hits = (["stone", "copper", "iron", "silver", "gold", "diamond"] as Ore[]).map((o) => ROCK_RULES[o].hits);
    expect([...hits].sort((a, b) => a - b)).toEqual(hits);
    for (const ore of ["silver", "gold", "diamond"] as Ore[]) {
      expect(resolveToolUse("pickaxe", { kind: "rock", ore }, { farm: false, power: 1 }).ok, ore).toBe(false);
      expect(resolveToolUse("pickaxe", { kind: "rock", ore }, { farm: false, power: 2 }).ok, ore).toBe(true);
    }
    expect(ROCK_RULES.gold.drops[0]).toMatchObject({ item: "ore_gold" });
    expect(ROCK_RULES.diamond.drops[0]).toMatchObject({ item: "gem_diamond" });
    // Diamonds are a rare bonus in iron, silver and gold rocks.
    for (const ore of ["iron", "silver", "gold"] as Ore[]) {
      const d = ROCK_RULES[ore].drops.find((x) => x.item === "gem_diamond");
      expect(d?.chance, ore).toBeGreaterThan(0);
      expect(d!.chance!, ore).toBeLessThanOrEqual(0.02);
    }
  });

  it("only cave rocks change, and deeper floors weigh in higher", () => {
    for (const r of getMap("home").rocks ?? []) expect(rockOdds(r.id), r.id).toBeNull();
    const caves = getMap("caves").rocks ?? [];
    expect(caves.length).toBeGreaterThan(30);
    for (const r of caves) expect(rockOdds(r.id), r.id).not.toBeNull();
    const { f1, f2, f3 } = CAVE_ROCK_ODDS;
    expect(f1!.gold).toBeLessThan(f2!.gold);
    expect(f2!.gold).toBeLessThan(f3!.gold);
    expect(f1!.diamond).toBeLessThan(f2!.diamond);
    expect(f2!.diamond).toBeLessThan(f3!.diamond);
  });

  it("gold is about 2-4% of cave rocks and diamond 0.5-1%", () => {
    const caves = getMap("caves").rocks ?? [];
    const count: Record<string, number> = {};
    let n = 0;
    for (let spawn = 0; spawn < 1000; spawn++) {
      for (const r of caves) {
        const ore = rockOreAt(r, "caves", spawn);
        count[ore] = (count[ore] ?? 0) + 1;
        n++;
      }
    }
    expect((count.gold ?? 0) / n).toBeGreaterThan(0.02);
    expect((count.gold ?? 0) / n).toBeLessThan(0.04);
    expect((count.diamond ?? 0) / n).toBeGreaterThan(0.004);
    expect((count.diamond ?? 0) / n).toBeLessThan(0.01);
    // Home rocks stay stone.
    for (const r of getMap("home").rocks ?? []) expect(rockOreAt(r, "owner", 3)).toBe("stone");
  });

  it("a rock's ore is fixed per spawn and reported to clients", () => {
    const map = getMap("caves");
    const field = new RockField(map, "caves");
    field.load(undefined);
    const grid = buildCollision(map);
    // Find a rock that changes ore within a few spawns.
    let rock = map.rocks![0]!;
    for (const r of map.rocks!) {
      let changed = false;
      for (let s = 0; s < 40 && !changed; s++) changed = rockOreAt(r, "caves", s) !== r.ore;
      if (changed) {
        rock = r;
        break;
      }
    }
    for (let s = 0; s < 40; s++) {
      const now = field.oreOf(rock);
      expect(field.at(rock.x, rock.y)?.ore).toBe(now);
      expect(field.oreOf(rock)).toBe(now); // stable while it stands
      expect(field.oreOverrides()[rock.id]).toBe(now === rock.ore ? undefined : now);
      field.breakRock(rock, grid, 0);
      field.respawnDue(grid, Number.MAX_SAFE_INTEGER, []);
    }
  });
});

describe("art", () => {
  it("every rock tier and new ore has LPC art in the catalog", () => {
    const cat = JSON.parse(readFileSync("src/client/public/assets/lpc/catalog.json", "utf8"));
    for (const ore of Object.keys(ROCK_RULES)) expect(cat.ores[`rock_${ore}`], ore).toBeTruthy();
    for (const id of ["ore_silver", "ore_gold", "gem_diamond"]) expect(cat.icons[id], id).toBeTruthy();
    const credits = readFileSync("src/client/public/assets/lpc/CREDITS.md", "utf8");
    for (const f of ["ores/ore_gold.png", "ores/ore_diamond.png"]) expect(credits).toContain(f);
  });
});
