import { describe, expect, it } from "vitest";
import { classifyTarget, resolveToolUse, type ToolKey, type ToolTarget } from "../src/shared/engine/toolRules";
import {
  boulderAt,
  nextWrongToolStreak,
  WRONG_TOOL_MAX_COST,
  WRONG_TOOL_RESET_MS,
  WRONG_TOOL_WARN_AT,
  wrongToolCost,
  wrongToolNotice,
} from "../src/shared/engine/wrongTool";

const rock: ToolTarget = { kind: "rock", ore: "stone" };
const tree: ToolTarget = { kind: "tree", size: "small" };
const boulder: ToolTarget = { kind: "boulder" };

describe("wrong-tool rebounds", () => {
  it("rebounds an axe off a rock with a notice", () => {
    const out = resolveToolUse("axe", rock, { farm: false });
    expect(out).toMatchObject({ ok: false, swing: true, bounce: true });
    expect(!out.ok && out.reason).toMatch(/axe bounces off the rock.*pickaxe/i);
  });

  it("rebounds a pickaxe, hoe or sword off a tree", () => {
    for (const key of ["pickaxe", "hoe", "sword"] as ToolKey[]) {
      const out = resolveToolUse(key, tree, { farm: true });
      expect(out, key).toMatchObject({ ok: false, bounce: true });
    }
  });

  it("rebounds every striking tool off a boulder", () => {
    for (const key of ["pickaxe", "axe", "hoe", "sword"] as ToolKey[]) {
      const out = resolveToolUse(key, boulder, { farm: true, power: 9 });
      expect(out, key).toMatchObject({ ok: false, bounce: true });
      expect(!out.ok && out.reason).toMatch(/boulder/);
    }
  });

  it("doesn't call the right tool or empty ground a rebound", () => {
    expect(resolveToolUse("pickaxe", rock, { farm: false, power: 1 })).toMatchObject({ ok: true });
    expect(resolveToolUse("axe", tree, { farm: false })).toMatchObject({ ok: true });
    expect(resolveToolUse("axe", { kind: "none" }, { farm: false })).not.toHaveProperty("bounce");
    // Too weak a pickaxe is the right tool, just not strong enough: no wrong-tool penalty.
    expect(resolveToolUse("pickaxe", { kind: "rock", ore: "gold" }, { farm: false, power: 1 })).not.toHaveProperty("bounce");
    expect(resolveToolUse("seed", boulder, { farm: true })).not.toHaveProperty("bounce");
  });

  it("classifies a boulder after rocks and trees", () => {
    expect(classifyTarget({ boulder: true }, 0)).toEqual({ kind: "boulder" });
    expect(classifyTarget({ boulder: true, rock: "copper" }, 0)).toEqual({ kind: "rock", ore: "copper" });
  });

  it("finds boulders by footprint and the tile above it", () => {
    const props = [{ type: "rock_deco", x: 5, y: 5, w: 1, h: 1 }, { type: "bush", x: 8, y: 8, w: 1, h: 1 }];
    expect(boulderAt(props, 5, 5)).toBe(true);
    expect(boulderAt(props, 5, 4)).toBe(true);
    expect(boulderAt(props, 5, 6)).toBe(false);
    expect(boulderAt(props, 6, 5)).toBe(false);
    expect(boulderAt(props, 8, 8)).toBe(false);
  });
});

describe("wrong-tool energy", () => {
  it("costs more for each wrong hit in a row, up to a cap", () => {
    let streak = nextWrongToolStreak(null, 1000);
    const costs = [wrongToolCost(streak.count)];
    for (let i = 1; i < 10; i++) {
      streak = nextWrongToolStreak(streak, 1000 + i * 500);
      costs.push(wrongToolCost(streak.count));
    }
    expect(costs[0]).toBe(1);
    for (let i = 1; i < costs.length; i++) expect(costs[i]!).toBeGreaterThanOrEqual(costs[i - 1]!);
    expect(costs.at(-1)).toBe(WRONG_TOOL_MAX_COST);
  });

  it("starts over after a pause", () => {
    const a = nextWrongToolStreak(nextWrongToolStreak(null, 0), 1000);
    expect(a.count).toBe(2);
    expect(nextWrongToolStreak(a, 1000 + WRONG_TOOL_RESET_MS).count).toBe(1);
    // A clock that went backwards doesn't extend a streak.
    expect(nextWrongToolStreak(a, 500).count).toBe(1);
  });

  it("warns once the streak gets long", () => {
    expect(wrongToolNotice("Clang.", 1)).toBe("Clang.");
    expect(wrongToolNotice("Clang.", WRONG_TOOL_WARN_AT)).toMatch(/^Clang\. .*wearing you out/);
  });
});
