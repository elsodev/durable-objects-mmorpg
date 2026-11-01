import { describe, expect, it } from "vitest";
import { ImpactQueue, impactDueMs, MAX_HOLD_MS, type DueContext } from "../src/client/game/impact";
import { impactFrameOf, swingFrame } from "../src/client/render/tool-actions";

const ctx = (over: Partial<DueContext> = {}): DueContext => ({
  youId: "me",
  nowMs: 1000,
  serverNow: 50_000,
  localImpactMs: null,
  remoteLagMs: 0,
  ...over,
});

describe("impact scheduling", () => {
  it("applies unstamped messages at once", () => {
    expect(impactDueMs({}, ctx())).toBe(1000);
  });
  it("holds your own result until your swing lands", () => {
    expect(impactDueMs({ by: "me", impactAt: 50_230 }, ctx({ localImpactMs: 1180 }))).toBe(1180);
    // The swing already landed (a slow answer): show it now.
    expect(impactDueMs({ by: "me", impactAt: 50_230 }, ctx({ localImpactMs: null }))).toBe(1000);
    expect(impactDueMs({ by: "me", impactAt: 50_230 }, ctx({ localImpactMs: 900 }))).toBe(1000);
  });
  it("holds someone else's result until their impact, drawn behind by the lag", () => {
    expect(impactDueMs({ by: "them", impactAt: 50_200 }, ctx())).toBe(1200);
    expect(impactDueMs({ by: "them", impactAt: 50_200 }, ctx({ remoteLagMs: 150 }))).toBe(1350);
    // Late or from a skewed clock: never in the past, never too far ahead.
    expect(impactDueMs({ by: "them", impactAt: 49_000 }, ctx())).toBe(1000);
    expect(impactDueMs({ by: "them", impactAt: 90_000 }, ctx())).toBe(1000 + MAX_HOLD_MS);
  });

  it("releases due items in arrival order, keeping one target's hits in order", () => {
    const q = new ImpactQueue<{ id: string }>();
    q.push(1200, { id: "a" });
    q.push(1100, { id: "b" });
    q.push(1050, { id: "a" });
    const same = (x: { id: string }, y: { id: string }) => x.id === y.id;
    expect(q.take(1000, same)).toEqual([]);
    // The second "a" is due but waits behind the first.
    expect(q.take(1150, same)).toEqual([{ id: "b" }]);
    expect(q.size).toBe(2);
    expect(q.take(1200, same)).toEqual([{ id: "a" }, { id: "a" }]);
    q.push(5000, { id: "c" });
    expect(q.flush()).toEqual([{ id: "c" }]);
    expect(q.size).toBe(0);
  });
});

describe("swing frames", () => {
  const timing = { impactMs: 230, totalMs: 475 };
  it("shows the impact frame exactly at impact time", () => {
    expect(swingFrame(0, 10, 6, timing)).toBe(0);
    expect(swingFrame(229, 10, 6, timing)).toBe(5);
    expect(swingFrame(230, 10, 6, timing)).toBe(6);
    expect(swingFrame(474, 10, 6, timing)).toBe(9);
    expect(swingFrame(475, 10, 6, timing)).toBe(-1);
  });
  it("never goes backwards", () => {
    let last = 0;
    for (let t = 0; t < 475; t += 5) {
      const f = swingFrame(t, 8, 4, { impactMs: 180, totalMs: 475 });
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
  it("finds each tool's impact frame, scaled for sheets of another length", () => {
    expect(impactFrameOf("pickaxe", 10)).toBe(6);
    expect(impactFrameOf("hoe", 8)).toBe(4);
    expect(impactFrameOf("hoe", 4)).toBe(2);
    expect(impactFrameOf("water", 7)).toBe(2);
    expect(impactFrameOf("mystery", 6)).toBe(3);
    expect(impactFrameOf("pickaxe", 1)).toBe(0);
  });
});
