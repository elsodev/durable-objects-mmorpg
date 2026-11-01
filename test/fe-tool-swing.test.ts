import { describe, expect, it } from "vitest";
import {
  clearedTreeTiles,
  effectiveAct,
  pendingImpactMs,
  predictUse,
  startSwing,
  swingLocked,
  swingPlaying,
  takeImpact,
  targetAtTile,
  type TileWorld,
} from "../src/client/game/tool-swing";
import { crackLines, fallAngle, particleBurst, shakeOffset } from "../src/client/render/hit-fx-logic";
import { getMap } from "../src/shared/maps";
import { SWING_TOTAL_MS } from "../src/shared/engine/toolTiming";

describe("local tool swing", () => {
  const me = { x: 5.5, y: 5.5, facing: "down" as const };

  it("swings tools at once, facing the target, and locks input for the whole swing", () => {
    const s = startSwing("hoe", me, { x: 6, y: 5 }, 1000, 50_000)!;
    expect(s.act).toEqual({ k: "hoe", at: 50_000, item: "hoe" });
    expect(s.facing).toBe("right");
    expect(swingLocked(s, 1000 + SWING_TOTAL_MS - 1)).toBe(true);
    expect(swingLocked(s, 1000 + SWING_TOTAL_MS)).toBe(false);
    expect(swingPlaying(s, 1400)).toBe(true);
    expect(startSwing("watering_can", me, { x: 5, y: 4 }, 0, 1)!.act.k).toBe("water");
    expect(startSwing("axe", me, { x: 5, y: 4 }, 0, 1)!.facing).toBe("up");
    expect(startSwing("sword_copper", me, { x: 4, y: 5 }, 0, 1)!.act).toMatchObject({ k: "sword", item: "sword_copper" });
  });

  it("lands at the impact frame for the tool and facing", () => {
    expect(startSwing("hoe", me, { x: 5, y: 6 }, 1000, 1)!.impactMs).toBe(1230); // down
    expect(startSwing("hoe", me, { x: 6, y: 5 }, 1000, 1)!.impactMs).toBe(1180); // sideways
    expect(startSwing("pickaxe", me, { x: 5, y: 4 }, 1000, 1)!.impactMs).toBe(1180); // up
    expect(startSwing("watering_can", me, { x: 5, y: 6 }, 1000, 1)!.impactMs).toBe(1175);
  });

  it("plays the impact once, not on press", () => {
    const s = startSwing("pickaxe", me, { x: 5, y: 6 }, 0, 1)!;
    expect(pendingImpactMs(s)).toBe(230);
    expect(takeImpact(s, 0)).toBe(false);
    expect(takeImpact(s, 229)).toBe(false);
    expect(takeImpact(s, 231)).toBe(true);
    expect(takeImpact(s, 300)).toBe(false);
    expect(pendingImpactMs(s)).toBeNull();
    expect(takeImpact(null, 300)).toBe(false);
  });

  it("doesn't swing seeds or crops", () => {
    expect(startSwing("seed_turnip", me, { x: 5, y: 6 }, 0, 1)).toBeNull();
    expect(startSwing("turnip", me, { x: 5, y: 6 }, 0, 1)).toBeNull();
    expect(startSwing(null, me, { x: 5, y: 6 }, 0, 1)).toBeNull();
    expect(swingLocked(null, 0)).toBe(false);
  });

  it("plays your local swing over the server's echo, but newer non-tool acts win", () => {
    const local = { k: "hoe", at: 100, item: "hoe" };
    expect(effectiveAct({ k: "hoe", at: 120, item: "hoe" }, local)).toBe(local);
    expect(effectiveAct({ k: "harvest", at: 130 }, local)).toEqual({ k: "harvest", at: 130 });
    // An older harvest must not replay after the swing.
    expect(effectiveAct({ k: "harvest", at: 50 }, local)).toBe(local);
    expect(effectiveAct({ k: "sit", at: 10 }, null)).toEqual({ k: "sit", at: 10 });
    expect(effectiveAct({ k: "pickaxe", at: 10, item: "pickaxe" }, null)).toBeUndefined();
  });
});

describe("client tile targets", () => {
  const home = getMap("home");
  const world = (over: Partial<TileWorld> = {}): TileWorld => ({
    map: home,
    farm: true,
    farmTiles: new Map(),
    objects: [],
    brokenRocks: new Set(),
    trees: new Map(),
    monsters: [],
    ...over,
  });
  const tree = home.props.find((p) => p.type === "tree")!;
  const rock = home.rocks![0]!;

  it("classifies trees, stumps, rocks and farm ground like the server", () => {
    expect(targetAtTile(world(), tree, 0).kind).toBe("tree");
    expect(targetAtTile(world({ trees: new Map([[tree.id, "stump"]]) }), tree, 0)).toEqual({ kind: "stump" });
    expect(targetAtTile(world({ trees: new Map([[tree.id, "gone"]]) }), tree, 0).kind).not.toMatch(/tree|stump/);
    expect(targetAtTile(world(), rock, 0)).toEqual({ kind: "rock", ore: rock.ore });
    expect(targetAtTile(world({ brokenRocks: new Set([rock.id]) }), rock, 0).kind).not.toBe("rock");
    expect(targetAtTile(world(), { x: 24, y: 6 }, 0)).toEqual({ kind: "grass" });
    expect(targetAtTile(world({ farm: false }), { x: 24, y: 6 }, 0)).toEqual({ kind: "none" });
    expect(targetAtTile(world({ monsters: [{ x: 24.4, y: 6.6 }] }), { x: 24, y: 6 }, 0)).toEqual({ kind: "monster" });
  });

  it("predicts the rules' verdict for the selected item", () => {
    expect(predictUse("axe", { kind: "tree", size: "small" }, true)).toEqual({ ok: true, effect: "hitTree" });
    expect(predictUse("hoe", { kind: "grass" }, true)).toEqual({ ok: true, effect: "till" });
    expect(predictUse("pickaxe", { kind: "tree", size: "small" }, true).ok).toBe(false);
  });

  it("lists cleared tree tiles for client collision", () => {
    expect(clearedTreeTiles(home, new Map([[tree.id, "gone"]]))).toEqual([{ x: tree.x, y: tree.y }]);
    expect(clearedTreeTiles(home, new Map([[tree.id, "stump"]]))).toEqual([]);
  });
});

describe("hit effect maths", () => {
  it("shakes ease out to rest", () => {
    expect(shakeOffset(0, 260, 3)).toBe(0);
    expect(shakeOffset(260, 260, 3)).toBe(0);
    expect(Math.abs(shakeOffset(20, 260, 3))).toBeLessThanOrEqual(3);
  });
  it("trees lean further as they fall", () => {
    expect(fallAngle(0, 700)).toBe(0);
    expect(fallAngle(350, 700)).toBeLessThan(fallAngle(700, 700));
    expect(fallAngle(900, 700)).toBe(fallAngle(700, 700));
  });
  it("bursts the requested number of particles around the tile", () => {
    let n = 0;
    const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const ps = particleBurst({ x: 3, y: 4 }, 9, "chip", rand);
    expect(ps).toHaveLength(9);
    for (const p of ps) {
      expect(Math.abs(p.x - 3.5)).toBeLessThan(0.5);
      expect(p.vy).toBeLessThan(0.001); // upward or nearly so
    }
  });
  it("cracks grow with each hit and are fixed per rock", () => {
    expect(crackLines("r1", 1, 4).length).toBeLessThan(crackLines("r1", 3, 4).length);
    expect(crackLines("r1", 2, 4)).toEqual(crackLines("r1", 2, 4));
  });
});
