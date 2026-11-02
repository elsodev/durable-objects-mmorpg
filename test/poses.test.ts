import { describe, expect, it } from "vitest";
import { newBond } from "../src/shared/hearts";
import { endPose, isPose, PEE_MS, POSE_ACT, poseRefusal, poseShowing, witnesses } from "../src/shared/poses";
import { parseChatInput } from "../src/shared/social";
import type { Inventory } from "../src/shared/types";
import { validateClientMsg } from "../src/shared/validate";
import { bondHearts, bondReset } from "../src/worker/game/bonds";

describe("pose commands", () => {
  it("parses /sleep and /piss and their aliases", () => {
    expect(parseChatInput("/sleep", "all", null)).toEqual({ kind: "pose", pose: "sleep" });
    expect(parseChatInput("/nap", "all", null)).toEqual({ kind: "pose", pose: "sleep" });
    expect(parseChatInput("/piss", "all", null)).toEqual({ kind: "pose", pose: "pee" });
    expect(parseChatInput("/PEE", "all", null)).toEqual({ kind: "pose", pose: "pee" });
    // Other commands still go to the zone.
    expect(parseChatInput("/day", "all", null)).toEqual({ kind: "zone", text: "/day" });
    expect(parseChatInput("/sleep well", "all", null)).toEqual({ kind: "zone", text: "/sleep well" });
  });

  it("validates the pose message", () => {
    expect(validateClientMsg({ t: "pose", pose: "sleep" })).toEqual({ t: "pose", pose: "sleep" });
    expect(validateClientMsg({ t: "pose", pose: "dance" })).toBeNull();
    expect(isPose("pee")).toBe(true);
  });
});

describe("pose rules", () => {
  it("refuses while seated, walking or mid-swing", () => {
    expect(poseRefusal({ moving: false, act: { k: "sit", at: 0 } }, 10_000)).toMatch(/Get up/);
    expect(poseRefusal({ moving: true }, 0)).toMatch(/Stand still/);
    expect(poseRefusal({ moving: false, act: { k: "axe", at: 1000 } }, 1200)).toMatch(/Finish/);
    expect(poseRefusal({ moving: false, act: { k: "axe", at: 1000 } }, 5000)).toBeNull();
    expect(poseRefusal({ moving: false }, 0)).toBeNull();
  });

  it("lying lasts until cleared; peeing lasts PEE_MS", () => {
    expect(poseShowing({ k: POSE_ACT.sleep, at: 0 }, 1e9)).toBe(true);
    expect(poseShowing({ k: POSE_ACT.pee, at: 0 }, PEE_MS - 1)).toBe(true);
    expect(poseShowing({ k: POSE_ACT.pee, at: 0 }, PEE_MS)).toBe(false);
    const e = { act: { k: "lie", at: 0 } } as { act?: { k: string; at: number } };
    endPose(e as never);
    expect(e.act).toBeUndefined();
    const swing = { act: { k: "axe", at: 0 } };
    endPose(swing as never);
    expect(swing.act).toBeDefined();
  });

  it("finds the villagers in range, nearest first", () => {
    const npcs = [
      { id: "far", x: 20, y: 20 },
      { id: "near", x: 11, y: 10 },
      { id: "mid", x: 13, y: 12 },
    ];
    expect(witnesses(npcs, { x: 10, y: 10 })).toEqual(["near", "mid"]);
  });
});

describe("caught peeing", () => {
  it("drops friendship with that villager to zero, and milestones stay rolled", () => {
    const bonds = { odette: { ...newBond(), pts: 900, milestones: [2] } };
    const inv: Inventory = { coins: 0, slots: [] };
    const now = 1_000_000;
    expect(bondHearts(bonds, "odette", now)).toBeGreaterThan(0);
    const out = bondReset(bonds, "odette", inv, now, () => 0)!;
    expect(out.delta).toBeLessThan(0);
    expect(out.heartsAfter).toBe(0);
    expect(bonds.odette.pts).toBe(0);
    expect(bonds.odette.milestones).toEqual([2]);
    expect(bondReset(bonds, "not_a_villager", inv, now, () => 0)).toBeNull();
  });
});
