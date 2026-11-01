import { describe, expect, it } from "vitest";
import {
  AMBIENT,
  FLOAT_LIFE,
  FloatTexts,
  FootstepTracker,
  METER_FILL,
  METER_LIFE,
  ParticlePool,
  arcPoint,
  easeOutCubic,
  flicker,
  meterAt,
  rippleRing,
  sanitizeFloat,
  tossScale,
} from "../src/client/render/effects-sim";

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("ParticlePool", () => {
  it("spawns bursts and expires them", () => {
    const pool = new ParticlePool(64);
    const used = pool.burst(100, 100, "hit", seeded());
    expect(used.length).toBeGreaterThanOrEqual(7);
    expect(pool.activeCount()).toBe(used.length);
    for (let i = 0; i < 20; i++) pool.step(0.05);
    expect(pool.activeCount()).toBe(0);
  });

  it("recycles the oldest particles when full", () => {
    const pool = new ParticlePool(8);
    const r = seeded(3);
    pool.burst(0, 0, "sparkle", r);
    pool.step(0.1);
    pool.burst(50, 50, "hit", r);
    expect(pool.activeCount()).toBe(8);
    expect(pool.slots.some((p) => p.x > 30)).toBe(true);
  });

  it("water droplets fall under gravity and fade", () => {
    const pool = new ParticlePool(16);
    const [i] = pool.burst(0, 0, "water", seeded(7));
    const p = pool.slots[i!]!;
    expect(p.vy).toBeLessThan(0);
    for (let k = 0; k < 20 && p.active; k++) pool.step(0.02);
    expect(p.vy).toBeGreaterThan(0);
    expect(p.alpha).toBeLessThanOrEqual(1);
  });
});

describe("FloatTexts", () => {
  it("rises, fades and expires", () => {
    const f = new FloatTexts();
    const { entry } = f.add(0, 0, "+3 ore", "loot");
    f.step(FLOAT_LIFE * 0.5);
    expect(entry.dy).toBeLessThan(0);
    expect(entry.alpha).toBe(1);
    f.step(FLOAT_LIFE * 0.3);
    expect(entry.alpha).toBeLessThan(1);
    const done = f.step(FLOAT_LIFE);
    expect(done).toContain(entry);
    expect(f.entries).toHaveLength(0);
  });

  it("stacks texts spawned at the same spot", () => {
    const f = new FloatTexts();
    const a = f.add(10, 10, "a", "info").entry;
    const b = f.add(10, 10, "b", "info").entry;
    expect(b.y).toBeLessThan(a.y);
  });

  it("evicts the oldest past the cap", () => {
    const f = new FloatTexts(2);
    const a = f.add(0, 0, "a", "info").entry;
    f.add(0, 0, "b", "info");
    const { evicted } = f.add(0, 0, "c", "error");
    expect(evicted).toBe(a);
    expect(f.entries).toHaveLength(2);
  });

  it("caps and flattens untrusted text", () => {
    expect(sanitizeFloat("a\nb")).toBe("a b");
    expect(sanitizeFloat("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe("FootstepTracker", () => {
  it("emits while walking, not when idle or teleporting", () => {
    const t = new FootstepTracker(0.3, 1);
    let puffs = 0;
    let x = 0;
    for (let i = 0; i < 60; i++) {
      x += 0.05; // 3 tiles/s at 60 fps
      if (t.update(1 / 60, { x, y: 0 })) puffs++;
    }
    expect(puffs).toBe(3);
    puffs = 0;
    for (let i = 0; i < 60; i++) if (t.update(1 / 60, { x, y: 0 })) puffs++;
    expect(puffs).toBe(0);
    expect(t.update(1 / 60, { x: x + 10, y: 0 })).toBe(false);
  });
});

describe("ambient", () => {
  it("only the cave has a light hole; day is untinted", () => {
    expect(AMBIENT.day.tint).toBe(0xffffff);
    expect(AMBIENT.cave.light).toBeGreaterThan(0);
    expect(AMBIENT.indoor.light).toBe(0);
    for (let t = 0; t < 10; t += 0.37) expect(Math.abs(flicker(t) - 1)).toBeLessThan(0.05);
  });
});

describe("one-shot curves", () => {
  it("arcPoint starts and ends on its points and peaks halfway", () => {
    const a = { x: 0, y: 100 };
    const b = { x: 40, y: 80 };
    expect(arcPoint(a, b, 0, 30)).toEqual(a);
    expect(arcPoint(a, b, 1, 30)).toEqual(b);
    const mid = arcPoint(a, b, 0.5, 30);
    expect(mid.x).toBe(20);
    expect(mid.y).toBe(90 - 30);
    expect(arcPoint(a, b, 2, 30)).toEqual(b);
  });

  it("tossScale keeps full size, then shrinks into the bin", () => {
    expect(tossScale(0)).toBe(1);
    expect(tossScale(0.5)).toBe(1);
    expect(tossScale(1)).toBeCloseTo(0.3);
    expect(tossScale(0.8)).toBeLessThan(1);
  });

  it("rippleRing grows and fades out", () => {
    const a = rippleRing(0);
    const b = rippleRing(1);
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(a.alpha).toBeGreaterThan(0);
    expect(b.alpha).toBe(0);
  });

  it("meterAt fills from `from` to `to`, then fades by the end of its life", () => {
    expect(meterAt(0, 0.25, 1).level).toBeCloseTo(0.25);
    expect(meterAt(METER_FILL, 0.25, 1).level).toBeCloseTo(1);
    expect(meterAt(0.3, 0.25, 1).alpha).toBe(1);
    expect(meterAt(METER_LIFE, 0.25, 1).alpha).toBe(0);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
});
