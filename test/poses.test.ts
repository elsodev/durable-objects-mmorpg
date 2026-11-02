import { describe, expect, it } from "vitest";
import { newBond } from "../src/shared/hearts";
import { CHEER_MS, endPose, isPose, PEE_MS, POSE_ACT, POSE_ACTS, POSE_COMMANDS, POSES, poseRefusal, poseShowing, visitorMayPose, WAVE_MS, witnesses } from "../src/shared/poses";
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

  it("parses the cozy poses and their aliases", () => {
    const cases: [string, string][] = [
      ["/sit", "sit"],
      ["/wave", "wave"],
      ["/hi", "wave"],
      ["/cheer", "cheer"],
      ["/yay", "cheer"],
      ["/dance", "dance"],
      ["/Think", "think"],
      ["/hmm", "think"],
    ];
    for (const [line, pose] of cases) expect(parseChatInput(line, "all", null), line).toEqual({ kind: "pose", pose });
    // An argument makes it chat, not a pose.
    expect(parseChatInput("/sit down", "all", null)).toEqual({ kind: "zone", text: "/sit down" });
    // "/emote wave" is still the emote bubble.
    expect(parseChatInput("/emote wave", "all", null)).toEqual({ kind: "emote", code: "wave" });
  });

  it("validates the pose message against the allowed list only", () => {
    expect(validateClientMsg({ t: "pose", pose: "sleep" })).toEqual({ t: "pose", pose: "sleep" });
    for (const pose of POSES) expect(validateClientMsg({ t: "pose", pose })).toEqual({ t: "pose", pose });
    for (const bad of ["moonwalk", "SIT", "", 3, null, "toString", "__proto__"]) expect(validateClientMsg({ t: "pose", pose: bad })).toBeNull();
    expect(validateClientMsg({ t: "pose" })).toBeNull();
    expect(isPose("pee")).toBe(true);
    expect(isPose("lie")).toBe(false);
  });

  it("maps every command word to a pose and every pose to its own act", () => {
    for (const pose of Object.values(POSE_COMMANDS)) expect(isPose(pose)).toBe(true);
    for (const pose of POSES) expect(Object.values(POSE_COMMANDS)).toContain(pose);
    // Distinct acts, and ground sitting never looks like holding a chair seat.
    expect(new Set(POSES.map((p) => POSE_ACT[p])).size).toBe(POSES.length);
    expect(POSE_ACT.sit).toBe("sit_ground");
    expect(POSE_ACTS.has("sit")).toBe(false);
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

  it("a sitter's own seat act still blocks a new pose, and so does a pose's walk", () => {
    expect(poseRefusal({ moving: false, act: { k: POSE_ACT.sit, at: 0 } }, 10)).toBeNull();
    expect(poseRefusal({ moving: true, act: { k: POSE_ACT.dance, at: 0 } }, 10)).toMatch(/Stand still/);
  });

  it("sitting, dancing and thinking hold; waving and cheering play once", () => {
    for (const p of ["sit", "dance", "think"] as const) expect(poseShowing({ k: POSE_ACT[p], at: 0 }, 1e9), p).toBe(true);
    expect(poseShowing({ k: POSE_ACT.wave, at: 0 }, WAVE_MS - 1)).toBe(true);
    expect(poseShowing({ k: POSE_ACT.wave, at: 0 }, WAVE_MS)).toBe(false);
    expect(poseShowing({ k: POSE_ACT.cheer, at: 0 }, CHEER_MS)).toBe(false);
    expect(poseShowing({ k: "axe", at: 0 }, 0)).toBe(false);
    expect(poseShowing(undefined, 0)).toBe(false);
  });

  it("moving clears every pose act", () => {
    for (const p of POSES) {
      const e = { act: { k: POSE_ACT[p], at: 0 } } as { act?: { k: string; at: number } };
      endPose(e as never);
      expect(e.act, p).toBeUndefined();
    }
  });

  it("lets visitors strike every pose except peeing", () => {
    for (const p of POSES) expect(visitorMayPose(p), p).toBe(p !== "pee");
  });

  it("lying lasts until cleared; peeing lasts PEE_MS", () => {
    expect(poseShowing({ k: POSE_ACT.sleep, at: 0 }, 1e9)).toBe(true);
    expect(poseShowing({ k: POSE_ACT.pee, at: 0 }, PEE_MS - 1)).toBe(true);
    expect(poseShowing({ k: POSE_ACT.pee, at: 0 }, PEE_MS)).toBe(false);
    expect(poseShowing({ k: POSE_ACT.meditate, at: 0 }, 1e9)).toBe(true);
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
