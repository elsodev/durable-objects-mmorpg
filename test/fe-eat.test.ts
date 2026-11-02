// The eat animation (render/eat-logic.ts): body frames that match custom.json for every body
// type, the food held at the hand and lifted to the mouth in each facing, bites, drinks tipping
// toward the face, and the bite mask cut from the icon.
import { describe, expect, it } from "vitest";
import { biteMask, bitesAt, bitesBetween, EAT_BITES, EAT_FRAME_MS, EAT_FRAMES, EAT_MS, eatStep, foodPose, mouthSide } from "../src/client/render/eat-logic";
import { isBiteable, isDrink, tipOf } from "../src/client/render/food-in-hand";
import { actionNameFor } from "../src/client/render/tool-actions";
import { beatsBetween, poseLength } from "../src/client/render/item-pose-logic";
import customJson from "../src/client/public/assets/lpc/custom/custom.json";

const custom = customJson as unknown as {
  actions: Record<string, { frames: string[]; ms: number; hold?: boolean }>;
  anims: Record<string, unknown>;
  actionFiles: Record<string, Record<string, Record<string, string>>>;
};

describe("eat body frames", () => {
  it("custom.json's eat action is the same timeline the food follows", () => {
    const eat = custom.actions.eat;
    expect(eat.frames).toEqual(EAT_FRAMES.map((f) => `thrust,${f}`));
    expect(eat.ms).toBe(EAT_FRAME_MS);
    expect(eat.hold).toBeUndefined(); // it ends and goes back to idle
    expect(actionNameFor({ k: "eat", at: 0, item: "inn_stew" })).toBe("eat");
  });

  it("every body type has the thrust rows the eat action uses", () => {
    expect(custom.anims.thrust).toMatchObject({ sheet: "act", rows: 4 });
    for (const body of ["male", "male_slim", "female"]) {
      const files = custom.actionFiles[body];
      for (const part of ["skin", "top", "bottom", "shoes", "hair", "eyes"]) expect(Object.keys(files[part] ?? {}).length, `${body} ${part}`).toBeGreaterThan(0);
    }
  });

  it("lasts 1.3 s with three bites, each in a stretch with the hand at the mouth", () => {
    expect(EAT_MS).toBe(1300);
    expect(EAT_BITES).toHaveLength(3);
    for (const b of EAT_BITES) {
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThan(EAT_MS);
      expect(EAT_FRAMES[eatStep(b)]).toBe(3);
    }
    expect(EAT_FRAMES[0]).toBe(2); // reaching up
    expect(EAT_FRAMES.at(-1)).toBe(2); // lowering
    expect(eatStep(-1)).toBe(-1);
    expect(eatStep(EAT_MS)).toBe(-1);
    expect(bitesAt(0)).toBe(0);
    expect(bitesAt(EAT_MS - 1)).toBe(3);
    expect(bitesBetween(0, EAT_MS)).toEqual([...EAT_BITES]);
    expect(beatsBetween("eat", 0, EAT_MS)).toEqual([...EAT_BITES]);
    expect(poseLength("eat")).toBe(EAT_MS);
  });
});

describe("food in the hand", () => {
  it("sits at the fist when reaching and at the chin while biting, for down, left and right", () => {
    for (const facing of ["down", "left", "right"] as const) {
      const reach = foodPose(facing, 0, "none")!;
      const mouth = foodPose(facing, 150, "none")!;
      expect(reach.visible && mouth.visible).toBe(true);
      expect(reach.frame).toBe(2);
      expect(mouth.frame).toBe(3);
      // From the feet point (32, 60): the chin is 26 px up, the fist about 18.
      expect(mouth.dy).toBe(-23);
      expect(reach.dy).toBeGreaterThan(mouth.dy);
      expect(Math.abs(mouth.dx)).toBeLessThanOrEqual(8);
    }
    // Held out in front of the face when side on, just left of the chin facing down.
    expect(foodPose("left", 150, "none")!.dx).toBeLessThan(0);
    expect(foodPose("right", 150, "none")!.dx).toBeGreaterThan(0);
    expect(foodPose("down", 150, "none")!.dx).toBeLessThan(0);
    // Left and right mirror each other about the body's centre line.
    expect(foodPose("left", 150, "none")!.dx + foodPose("right", 150, "none")!.dx).toBeLessThanOrEqual(1);
  });

  it("is pushed into the mouth on each bite and counts it", () => {
    const before = foodPose("down", EAT_BITES[0]! - 1, "none")!;
    const bite = foodPose("down", EAT_BITES[0]!, "none")!;
    const after = foodPose("down", EAT_BITES[0]! + EAT_FRAME_MS, "none")!;
    expect(bite.dy).toBe(before.dy - 1);
    expect(after.dy).toBe(before.dy);
    expect([before.bites, bite.bites]).toEqual([0, 1]);
    expect(foodPose("down", EAT_MS - 1, "none")!.bites).toBe(3);
  });

  it("is hidden behind the head facing up, and gone after the act", () => {
    expect(foodPose("up", 150, "none")).toMatchObject({ visible: false, frame: 3 });
    expect(foodPose("down", EAT_MS, "none")).toBeNull();
    expect(foodPose("down", -5, "none")).toBeNull();
  });

  it("drinks tip toward the mouth instead of losing bites", () => {
    expect(foodPose("down", 150, "none")!.tilt).toBe(0);
    expect(foodPose("down", 150, "cup")!.tilt).toBeGreaterThan(0);
    expect(foodPose("left", 150, "cup")!.tilt).toBeGreaterThan(0);
    expect(foodPose("right", 150, "cup")!.tilt).toBeLessThan(0);
    expect(Math.abs(foodPose("down", EAT_BITES[0]!, "cup")!.tilt)).toBeGreaterThan(foodPose("down", 150, "cup")!.tilt);
    expect(foodPose("down", 0, "cup")!.tilt).toBe(0); // level while reaching
    expect([mouthSide("down"), mouthSide("left"), mouthSide("right")]).toEqual([1, 1, -1]);
    expect(isDrink("coffee")).toBe(true);
    expect(isDrink("inn_stew")).toBe(false);
    expect(isDrink("turnip")).toBe(false);
    expect(isDrink(undefined)).toBe(false);
    expect([tipOf("coffee"), tipOf("inn_stew"), tipOf("bread_roll"), tipOf("turnip")]).toEqual(["cup", "dish", "none", "none"]);
    const dish = foodPose("down", EAT_BITES[0]!, "dish")!.tilt;
    expect(dish).toBeGreaterThan(0);
    expect(dish).toBeLessThan(foodPose("down", EAT_BITES[0]!, "cup")!.tilt);
  });

  it("only hand-held food loses bites; bowls, plates and cups stay whole", () => {
    for (const id of ["bread_roll", "apple_pie", "oat_cookie", "turnip", "egg"]) expect(isBiteable(id), id).toBe(true);
    for (const id of ["inn_stew", "roast_dinner", "coffee", "milk", "hoe", undefined]) expect(isBiteable(id), String(id)).toBe(false);
  });
});

describe("bite mask", () => {
  const box = { x0: 4, y0: 6, x1: 27, y1: 26 };
  const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

  it("takes nothing before the first bite and more with every bite", () => {
    expect(count(biteMask(32, 32, box, 0))).toBe(0);
    const sizes = [1, 2, 3].map((b) => count(biteMask(32, 32, box, b)));
    expect(sizes[0]).toBeGreaterThan(0);
    expect(sizes[1]).toBeGreaterThan(sizes[0]!);
    expect(sizes[2]).toBeGreaterThan(sizes[1]!);
    // Never more than half of the food's box, so it still reads as the same food.
    expect(sizes[2]!).toBeLessThan(((box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)) / 2);
  });

  it("bites from the top, starting on the side toward the mouth", () => {
    const m = biteMask(32, 32, box, 1, 1);
    const at = (x: number, y: number) => m[y * 32 + x];
    let right = 0;
    let left = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (at(x, y)) (x >= 16 ? right++ : left++);
    expect(right).toBeGreaterThan(left);
    for (let y = 20; y < 32; y++) for (let x = 0; x < 32; x++) expect(at(x, y)).toBe(0);
    const mirrored = biteMask(32, 32, box, 1, -1);
    let mr = 0;
    for (let y = 0; y < 32; y++) for (let x = 16; x < 32; x++) mr += mirrored[y * 32 + x]!;
    expect(mr).toBeLessThan(right);
  });
});
