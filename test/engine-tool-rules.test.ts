import { describe, expect, it } from "vitest";
import {
  classifyTarget,
  facingToward,
  HIT_RESET_MS,
  HitTracker,
  hitsNeeded,
  isSwingTool,
  resolveToolUse,
  rollDrops,
  ROCK_RULES,
  STUMP_RULE,
  toolDamage,
  toolKeyOf,
  treeSize,
  TREE_RULES,
  type ToolKey,
  type ToolTarget,
} from "../src/shared/engine/toolRules";
import { dayIndex } from "../src/shared/engine";
import type { FarmTile } from "../src/shared/types";

const TARGETS: Record<string, ToolTarget> = {
  monster: { kind: "monster" },
  stone: { kind: "rock", ore: "stone" },
  iron: { kind: "rock", ore: "iron" },
  tree: { kind: "tree", size: "small" },
  stump: { kind: "stump" },
  water: { kind: "water" },
  soilEmpty: { kind: "soil", crop: "none" },
  soilGrowing: { kind: "soil", crop: "growing" },
  soilReady: { kind: "soil", crop: "ready" },
  grass: { kind: "grass" },
  bin: { kind: "bin" },
  none: { kind: "none" },
};
const KEYS: ToolKey[] = ["hoe", "water", "pickaxe", "axe", "sword", "seed", "other"];

/** Expected effect (or "-" for nothing) on the home farm, with a basic (power 1) pickaxe. */
const HOME: Record<ToolKey, Record<keyof typeof TARGETS, string>> = {
  hoe: { monster: "hitMonster", stone: "-", iron: "-", tree: "-", stump: "-", water: "-", soilEmpty: "-", soilGrowing: "-", soilReady: "harvest", grass: "till", bin: "-", none: "-" },
  water: { monster: "hitMonster", stone: "-", iron: "-", tree: "-", stump: "-", water: "refill", soilEmpty: "water", soilGrowing: "water", soilReady: "harvest", grass: "-", bin: "-", none: "-" },
  pickaxe: { monster: "hitMonster", stone: "hitRock", iron: "-", tree: "-", stump: "-", water: "-", soilEmpty: "-", soilGrowing: "-", soilReady: "harvest", grass: "-", bin: "-", none: "-" },
  axe: { monster: "hitMonster", stone: "-", iron: "-", tree: "hitTree", stump: "hitStump", water: "-", soilEmpty: "-", soilGrowing: "-", soilReady: "harvest", grass: "-", bin: "-", none: "-" },
  sword: { monster: "hitMonster", stone: "-", iron: "-", tree: "-", stump: "-", water: "-", soilEmpty: "-", soilGrowing: "-", soilReady: "harvest", grass: "-", bin: "-", none: "-" },
  seed: { monster: "-", stone: "-", iron: "-", tree: "-", stump: "-", water: "-", soilEmpty: "plant", soilGrowing: "-", soilReady: "harvest", grass: "-", bin: "ship", none: "-" },
  other: { monster: "-", stone: "-", iron: "-", tree: "-", stump: "-", water: "-", soilEmpty: "-", soilGrowing: "-", soilReady: "harvest", grass: "-", bin: "ship", none: "-" },
};

describe("tool rules matrix", () => {
  it("covers every tool against every target on the home farm", () => {
    for (const key of KEYS)
      for (const [name, target] of Object.entries(TARGETS)) {
        const out = resolveToolUse(key, target, { farm: true, power: 1 });
        expect(out.ok ? out.effect : "-", `${key} on ${name}`).toBe(HOME[key][name]);
        // Tools always swing; seeds and other items never do.
        if (!out.ok) expect(out.swing, `${key} on ${name} swings`).toBe(isSwingTool(key));
      }
  });

  it("in shared zones only monsters, rocks and trees respond; farm tools say so", () => {
    for (const key of KEYS)
      for (const [name, target] of Object.entries(TARGETS)) {
        const out = resolveToolUse(key, target, { farm: false, power: 2 });
        const want = HOME[key][name] === "harvest" ? "-" : HOME[key][name];
        const zoneWant =
          key === "hoe" || key === "water" || key === "seed"
            ? want === "hitMonster"
              ? "hitMonster"
              : "-"
            : name === "iron" && key === "pickaxe"
              ? "hitRock"
              : name === "stump"
                ? "-"
                : want;
        expect(out.ok ? out.effect : "-", `${key} on ${name}`).toBe(zoneWant === "ship" || zoneWant === "plant" ? "-" : zoneWant);
      }
    expect(resolveToolUse("axe", TARGETS.stump, { farm: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/grow back/) });
    expect(resolveToolUse("hoe", TARGETS.grass, { farm: false })).toEqual({ ok: false, swing: true, reason: "That's for your farm at home." });
  });

  it("gives gentle wrong-tool notices and stays quiet when swinging at nothing", () => {
    const reason = (k: ToolKey, t: ToolTarget) => {
      const o = resolveToolUse(k, t, { farm: true, power: 1 });
      return o.ok ? null : o.reason;
    };
    expect(reason("pickaxe", TARGETS.tree)).toMatch(/pickaxe bounces off the tree.*axe/);
    expect(reason("axe", TARGETS.stone)).toMatch(/axe bounces off the rock.*pickaxe/);
    expect(reason("sword", TARGETS.stump)).toMatch(/You need an axe/);
    expect(reason("hoe", TARGETS.stone)).toMatch(/hoe bounces off the rock/);
    expect(reason("pickaxe", TARGETS.iron)).toBe("You need a stronger pickaxe.");
    expect(reason("hoe", TARGETS.soilEmpty)).toBe("Already tilled.");
    expect(reason("hoe", TARGETS.none)).toBe("You can't till here.");
    expect(reason("seed", TARGETS.grass)).toMatch(/Till the soil/);
    expect(reason("pickaxe", TARGETS.none)).toBe("");
    expect(reason("axe", TARGETS.grass)).toBe("");
    expect(reason("sword", TARGETS.none)).toBe("");
    expect(resolveToolUse("pickaxe", TARGETS.iron, { farm: true, power: 2 })).toEqual({ ok: true, effect: "hitRock" });
  });
});

describe("tool rules tables", () => {
  it("rock and tree hit counts", () => {
    expect([ROCK_RULES.stone.hits, ROCK_RULES.copper.hits, ROCK_RULES.iron.hits, ROCK_RULES.gem.hits]).toEqual([2, 3, 4, 5]);
    expect([ROCK_RULES.iron.power, ROCK_RULES.gem.power]).toEqual([2, 2]);
    expect([TREE_RULES.small.hits, TREE_RULES.large.hits, STUMP_RULE.hits]).toEqual([3, 5, 2]);
    expect(hitsNeeded(TARGETS.stone)).toBe(2);
    expect(hitsNeeded({ kind: "tree", size: "large" })).toBe(5);
    expect(hitsNeeded(TARGETS.stump)).toBe(2);
    expect(hitsNeeded(TARGETS.grass)).toBe(0);
  });

  it("large trees give more wood than small ones", () => {
    const wood = (size: "small" | "large", r: number) => rollDrops(TREE_RULES[size].drops, () => r)[0]!.qty;
    expect(wood("large", 0)).toBeGreaterThan(wood("small", 0.99));
  });

  it("tree size is fixed per id and both sizes occur", () => {
    const sizes = Array.from({ length: 30 }, (_, i) => treeSize(`tree_${i}`));
    expect(sizes).toContain("small");
    expect(sizes).toContain("large");
    expect(treeSize("tree_7")).toBe(treeSize("tree_7"));
  });

  it("every tool hurts monsters and the sword hurts most", () => {
    expect(toolDamage("sword_wood")).toBe(5);
    expect(toolDamage("sword_copper")).toBe(10);
    expect([toolDamage("pickaxe"), toolDamage("axe"), toolDamage("hoe"), toolDamage("watering_can")]).toEqual([3, 3, 2, 1]);
    for (const t of ["pickaxe", "pickaxe_iron", "axe", "hoe", "watering_can"]) expect(toolDamage("sword_wood")).toBeGreaterThan(toolDamage(t));
    expect(toolDamage("turnip")).toBe(0);
  });

  it("maps items to tool keys", () => {
    expect(["hoe", "watering_can", "pickaxe_iron", "axe", "sword_copper", "seed_turnip", "turnip", "nope"].map(toolKeyOf)).toEqual([
      "hoe",
      "water",
      "pickaxe",
      "axe",
      "sword",
      "seed",
      "other",
      "other",
    ]);
  });
});

describe("classifyTarget", () => {
  const now = 5 * 86_400_000;
  const tile = (crop: string | null, wateredDays = 0): FarmTile => ({ x: 1, y: 1, crop, plantedAt: crop ? 0 : null, wateredDays, lastWateredDay: crop ? dayIndex(now) - 1 : null });
  it("puts monsters, rocks and trees first, then soil, water, the bin and bare ground", () => {
    expect(classifyTarget({ monster: true, rock: "stone" }, now)).toEqual({ kind: "monster" });
    expect(classifyTarget({ rock: "copper", farmable: true }, now)).toEqual({ kind: "rock", ore: "copper" });
    expect(classifyTarget({ tree: { stage: "stump", size: "large" } }, now)).toEqual({ kind: "stump" });
    expect(classifyTarget({ tree: { stage: "tree", size: "large" } }, now)).toEqual({ kind: "tree", size: "large" });
    expect(classifyTarget({ soil: tile(null) }, now)).toEqual({ kind: "soil", crop: "none" });
    expect(classifyTarget({ soil: tile("turnip", 1) }, now)).toEqual({ kind: "soil", crop: "growing" });
    expect(classifyTarget({ soil: tile("turnip", 30) }, now)).toEqual({ kind: "soil", crop: "ready" });
    expect(classifyTarget({ water: true }, now)).toEqual({ kind: "water" });
    expect(classifyTarget({ bin: true }, now)).toEqual({ kind: "bin" });
    expect(classifyTarget({ farmable: true }, now)).toEqual({ kind: "grass" });
    expect(classifyTarget({}, now)).toEqual({ kind: "none" });
  });
});

describe("HitTracker", () => {
  it("counts hits to done and resets progress left untouched", () => {
    const h = new HitTracker();
    expect(h.hit("r", 3, 0)).toEqual({ hits: 1, done: false });
    expect(h.hit("r", 3, 1000)).toEqual({ hits: 2, done: false });
    expect(h.progress("r", 1000)).toBe(2);
    expect(h.hit("r", 3, 2000)).toEqual({ hits: 3, done: true });
    expect(h.progress("r", 2000)).toBe(0);
    h.hit("r", 3, 10_000);
    expect(h.progress("r", 10_000 + HIT_RESET_MS)).toBe(0);
    expect(h.hit("r", 3, 10_000 + HIT_RESET_MS)).toEqual({ hits: 1, done: false });
    expect(h.expire(10_000 + 3 * HIT_RESET_MS)).toEqual(["r"]);
  });
});

describe("facingToward", () => {
  it("faces the target tile along the dominant axis", () => {
    const me = { x: 5.5, y: 5.5 };
    expect(facingToward(me, { x: 6, y: 5 }, "down")).toBe("right");
    expect(facingToward(me, { x: 4, y: 5 }, "down")).toBe("left");
    expect(facingToward(me, { x: 5, y: 4 }, "down")).toBe("up");
    expect(facingToward(me, { x: 5, y: 6 }, "up")).toBe("down");
    expect(facingToward(me, { x: 5, y: 5 }, "left")).toBe("left");
  });
});
