import { describe, expect, it } from "vitest";
import { ChatGuard, MUTE_MS, REPEAT_LIMIT } from "../src/worker/game/chat";
import { cleanName, spriteForUser, PLAYER_SPRITES } from "../src/worker/game/identity";
import { clampHp, isZoneId, sanitizeFarm, sanitizeInventory, sanitizeObjects } from "../src/worker/game/sanitize";
import { donate, goalsView, remainingNeed, sanitizeProgress, type GoalProgress } from "../src/worker/game/goals";
import { canMine, rockDrops } from "../src/worker/game/rocks";
import { buyFrom, sellTo } from "../src/worker/game/shop";
import { EntityDiffer } from "../src/worker/game/diff";
import { applyDamage, regen, REGEN_DELAY_MS } from "../src/worker/game/vitals";
import { distToRect, inToolReach } from "../src/worker/game/range";
import type { EntityState, Inventory } from "../src/shared/types";

describe("ChatGuard", () => {
  it("rate limits to one message per second", () => {
    const g = new ChatGuard();
    expect(g.check("hi", 0)).toBe("ok");
    expect(g.check("yo", 500)).toBe("tooFast");
    expect(g.check("yo", 1000)).toBe("ok");
  });
  it("mutes after 5 identical messages in a row, for 60 s", () => {
    const g = new ChatGuard();
    let t = 0;
    for (let i = 1; i < REPEAT_LIMIT; i++) expect(g.check("spam", (t += 1000))).toBe("ok");
    expect(g.check("SPAM ", (t += 1000))).toBe("muted");
    expect(g.check("other", t + MUTE_MS - 1)).toBe("muted");
    expect(g.check("other", t + MUTE_MS)).toBe("ok");
  });
  it("varied messages are never muted", () => {
    const g = new ChatGuard();
    let t = 0;
    for (let i = 0; i < 30; i++) expect(g.check(["a", "b", "c"][i % 3], (t += 1000))).toBe("ok");
  });
  it("mutes alternating spam (two lines over the last 5)", () => {
    const g = new ChatGuard();
    let t = 0;
    for (let i = 0; i < REPEAT_LIMIT - 1; i++) expect(g.check(i % 2 ? "buy gold" : "cheap", (t += 1000))).toBe("ok");
    expect(g.check("cheap", (t += 1000))).toBe("muted");
  });
});

describe("identity", () => {
  it("picks a stable player sprite", () => {
    expect(spriteForUser("abc")).toBe(spriteForUser("abc"));
    expect(PLAYER_SPRITES).toContain(spriteForUser("someone"));
    const seen = new Set(Array.from({ length: 50 }, (_, i) => spriteForUser(`u${i}`)));
    expect(seen.size).toBe(4);
  });
  it("cleans names", () => {
    expect(cleanName("  Ann\u0000\n ")).toBe("Ann");
    expect(cleanName("")).toBe("Farmer");
    expect(cleanName(42)).toBe("Farmer");
    expect(cleanName("x".repeat(100)).length).toBe(16);
    expect(cleanName("Old Tom")).toBe("Old_Tom");
    expect(cleanName("Zoë!")).toBe("Zoe");
  });
});

describe("sanitize", () => {
  it("drops unknown items, bad quantities and caps stacks", () => {
    const inv = sanitizeInventory({
      coins: -5,
      slots: [
        { item: "hoe", qty: 1 },
        { item: "nope", qty: 1 },
        { item: "turnip", qty: 0 },
        { item: "turnip", qty: 500 },
        { item: "__proto__", qty: 1 },
        null,
      ],
    });
    expect(inv).toEqual({ coins: 0, slots: [{ item: "hoe", qty: 1 }, { item: "turnip", qty: 99 }] });
    expect(sanitizeInventory(null)).toEqual({ coins: 0, slots: [] });
  });
  it("clamps hp and checks zones", () => {
    expect(clampHp(500, 100)).toBe(100);
    expect(clampHp(-3, 100)).toBe(1);
    expect(clampHp(NaN, 100)).toBe(100);
    expect(isZoneId("caves")).toBe(true);
    expect(isZoneId("moon")).toBe(false);
  });
  it("sanitizes farm tiles and objects", () => {
    const farm = sanitizeFarm([
      { x: 1, y: 1, crop: "turnip", plantedAt: 5, wateredDays: 2, lastWateredDay: 0 },
      { x: 1, y: 1, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null },
      { x: 2, y: 1, crop: "hoe", plantedAt: 5, wateredDays: 2, lastWateredDay: 0 },
      { x: -1, y: 1 },
    ]);
    expect(farm).toHaveLength(2);
    expect(farm[1].crop).toBeNull();
    expect(farm[1].wateredDays).toBe(0);
    const objs = sanitizeObjects([
      { id: "o1", item: "chair_wood", x: 4, y: 6, rotation: 0 },
      { id: "o1", item: "chair_wood", x: 5, y: 6, rotation: 0 },
      { id: "o2", item: "turnip", x: 5, y: 6, rotation: 0 },
      { id: "o3", item: "rug", x: 5, y: 6, rotation: 7 },
    ]);
    expect(objs.map((o) => o.id)).toEqual(["o1"]);
  });
});

describe("goals", () => {
  it("accepts donations up to the need and reports progress", () => {
    const p: GoalProgress = {};
    expect(remainingNeed(p, "lantern", "gem_crystal")).toBe(1);
    expect(donate(p, "lantern", "gem_crystal", 5)).toBe(1);
    expect(donate(p, "lantern", "gem_crystal", 1)).toBe(0);
    expect(donate(p, "lantern", "turnip", 1)).toBe(0);
    expect(donate(p, "constructor", "wood", 1)).toBe(0);
    const lantern = goalsView(p).find((g) => g.id === "lantern")!;
    expect(lantern.needs.find((n) => n.item === "gem_crystal")!.have).toBe(1);
    expect(lantern.done).toBe(false);
  });
  it("marks a goal done when every need is met", () => {
    const p: GoalProgress = {};
    donate(p, "lantern", "gem_crystal", 1);
    donate(p, "lantern", "ore_iron", 8);
    donate(p, "lantern", "slime_gel", 10);
    expect(goalsView(p).find((g) => g.id === "lantern")!.done).toBe(true);
  });
  it("sanitizes stored progress", () => {
    expect(sanitizeProgress({ bridge: { wood: 9999, evil: 3 }, nope: { wood: 1 } })).toEqual({ bridge: { wood: 60 } });
    expect(sanitizeProgress("x")).toEqual({});
  });
});

describe("rocks", () => {
  it("needs enough pickaxe power", () => {
    expect(canMine("copper", 1)).toBe(true);
    expect(canMine("iron", 1)).toBe(false);
    expect(canMine("gem", 2)).toBe(true);
  });
  it("drops the matching ore", () => {
    const drops = rockDrops("copper", () => 0);
    expect(drops.find((d) => d.item === "ore_copper")!.qty).toBe(1);
    expect(rockDrops("gem", () => 0.99).some((d) => d.item === "gem_crystal")).toBe(true);
    expect(rockDrops("stone", () => 0.99)).toEqual([{ item: "stone", qty: 3 }]);
  });
});

describe("shop", () => {
  const shop = { sells: [{ item: "seed_turnip", price: 10 }], buys: ["turnip"] };
  it("buys when affordable and fits", () => {
    const inv: Inventory = { coins: 25, slots: [] };
    expect(buyFrom(inv, shop, "seed_turnip", 2).ok).toBe(true);
    expect(inv).toEqual({ coins: 5, slots: [{ item: "seed_turnip", qty: 2 }] });
    expect(buyFrom(inv, shop, "seed_turnip", 1)).toEqual({ ok: false, reason: "Not enough coins." });
    expect(buyFrom(inv, shop, "hoe", 1).ok).toBe(false);
  });
  it("sells only what the NPC buys, at the item sell price", () => {
    const inv: Inventory = { coins: 0, slots: [{ item: "turnip", qty: 3 }, { item: "stone", qty: 3 }] };
    expect(sellTo(inv, shop, 1, 1).ok).toBe(false);
    expect(sellTo(inv, shop, 0, 4).ok).toBe(false);
    expect(sellTo(inv, shop, 0, 3).ok).toBe(true);
    expect(inv).toEqual({ coins: 75, slots: [{ item: "stone", qty: 3 }] });
    // Shipping bin (no shop) takes anything sellable, but not tools.
    expect(sellTo(inv, null, 0, 3).ok).toBe(true);
    expect(sellTo({ coins: 0, slots: [{ item: "hoe", qty: 1 }] }, null, 0, 1).ok).toBe(false);
  });
});

describe("EntityDiffer", () => {
  const e = (x: number): EntityState => ({ id: "p:1", kind: "player", name: "A", sprite: "player_1", x, y: 1, facing: "down", moving: false });
  it("reports new, changed and removed entities", () => {
    const d = new EntityDiffer();
    expect(d.diff([e(1)]).upd).toHaveLength(1);
    expect(d.diff([e(1)])).toEqual({ upd: [], del: [] });
    expect(d.diff([e(1.00001)]).upd).toHaveLength(0); // float noise is rounded away
    expect(d.diff([e(2)]).upd[0].x).toBe(2);
    expect(d.diff([])).toEqual({ upd: [], del: ["p:1"] });
  });
});

describe("vitals and range", () => {
  it("faints at 0 and refills", () => {
    const p = { hp: 5, maxHp: 100 } as EntityState;
    expect(applyDamage(p, 3)).toBe(false);
    expect(p.hp).toBe(2);
    expect(applyDamage(p, 3)).toBe(true);
    expect(p.hp).toBe(100);
  });
  it("regenerates only out of combat", () => {
    const p = { hp: 50, maxHp: 100 } as EntityState;
    expect(regen(p, 1000, 0, 0)).toBe(false);
    expect(regen(p, REGEN_DELAY_MS + 3000, 0, 0)).toBe(true);
    expect(p.hp).toBe(52);
  });
  it("measures reach", () => {
    expect(inToolReach({ x: 5.5, y: 5.5 }, 6, 5)).toBe(true);
    expect(inToolReach({ x: 5.5, y: 5.5 }, 9, 5)).toBe(false);
    expect(distToRect({ x: 1, y: 1 }, { x: 0, y: 0, w: 2, h: 2 })).toBe(0);
    expect(distToRect({ x: 5, y: 1 }, { x: 0, y: 0, w: 2, h: 2 })).toBe(3);
  });
});
