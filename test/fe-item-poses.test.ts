import { describe, expect, it } from "vitest";
import { beatsBetween, bitesAt, EAT_BITES, EAT_MS, HOLD_MS, holdPose, poseAt, poseKindOf } from "../src/client/render/item-pose-logic";
import { actionNameFor, ITEM_POSE_ACTS } from "../src/client/render/tool-actions";

describe("item poses", () => {
  it("only eat and holdUp acts with an item draw one", () => {
    expect(poseKindOf({ k: "eat", item: "turnip" })).toBe("eat");
    expect(poseKindOf({ k: "holdUp", item: "lamp" })).toBe("hold");
    expect(poseKindOf({ k: "eat" })).toBeNull();
    expect(poseKindOf({ k: "hoe", item: "hoe" })).toBeNull();
    expect(poseKindOf(undefined)).toBeNull();
  });

  it("eat and hold-up play body actions, not the item's swing art", () => {
    expect(actionNameFor({ k: "eat", at: 0, item: "turnip" })).toBe("eat");
    expect(actionNameFor({ k: "holdUp", at: 0, item: "lamp" })).toBe("hold_up");
    expect(ITEM_POSE_ACTS.has("eat")).toBe(true);
  });

  it("eating draws nothing over the head (the food is in the hand) and counts its bites", () => {
    expect(poseAt("eat", 400)).toBeNull();
    expect(bitesAt(EAT_BITES[0]! - 1)).toBe(0);
    expect(bitesAt(EAT_MS - 1)).toBe(EAT_BITES.length);
  });

  it("the held item sits above the head and drifts up, fading in and out", () => {
    expect(holdPose(100)).toBeNull();
    const a = holdPose(400)!;
    const b = holdPose(2000)!;
    expect(a.dy).toBeLessThan(0);
    expect(b.dy).toBeLessThan(a.dy);
    expect(b.alpha).toBe(1);
    expect(holdPose(HOLD_MS - 50)!.alpha).toBeLessThan(1);
    expect(holdPose(HOLD_MS)).toBeNull();
  });

  it("beats: bites for crumbs and sound, one fanfare for a hold-up", () => {
    expect(beatsBetween("eat", 0, EAT_MS)).toEqual([...EAT_BITES]);
    expect(beatsBetween("eat", EAT_BITES[0]!, EAT_BITES[0]!)).toEqual([]);
    expect(beatsBetween("hold", 0, 16)).toEqual([]);
    expect(beatsBetween("hold", 290, 310)).toEqual([300]);
  });
});
