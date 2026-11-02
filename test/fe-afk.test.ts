import { describe, expect, it } from "vitest";
import { AFK_HIDDEN_MS, AFK_IDLE_MS, afkTimesFromQuery, createAfkTracker } from "../src/client/game/afk-logic";

describe("AFK tracker", () => {
  it("counts as away after three minutes without input on a visible tab", () => {
    const t = createAfkTracker(0, false);
    expect(AFK_IDLE_MS).toBe(180_000);
    expect(t.away(AFK_IDLE_MS - 1)).toBe(false);
    expect(t.msLeft(AFK_IDLE_MS - 1)).toBe(1);
    expect(t.away(AFK_IDLE_MS)).toBe(true);
    expect(t.msLeft(AFK_IDLE_MS + 5)).toBe(0);
  });

  it("restarts the idle clock on any input", () => {
    const t = createAfkTracker(0, false);
    t.input(100_000);
    expect(t.away(AFK_IDLE_MS)).toBe(false);
    expect(t.msLeft(AFK_IDLE_MS)).toBe(100_000);
    expect(t.away(100_000 + AFK_IDLE_MS)).toBe(true);
  });

  it("ignores input stamped earlier than the last one", () => {
    const t = createAfkTracker(0, false);
    t.input(50_000);
    t.input(10_000);
    expect(t.msLeft(50_000)).toBe(AFK_IDLE_MS);
  });

  it("gives a hidden tab a short grace, so a quick alt-tab stays connected", () => {
    const t = createAfkTracker(0, false);
    t.visibility(true, 1000);
    expect(t.away(1000 + AFK_HIDDEN_MS - 1)).toBe(false);
    t.visibility(false, 1000 + 10_000);
    // Back within the grace: coming back counts as input.
    expect(t.away(1000 + AFK_HIDDEN_MS + 5_000)).toBe(false);
    expect(t.msLeft(11_000)).toBe(AFK_IDLE_MS);
  });

  it("counts a tab hidden past the grace as away", () => {
    const t = createAfkTracker(0, false);
    t.visibility(true, 5000);
    // A second hidden event must not push the deadline back.
    t.visibility(true, 20_000);
    expect(t.away(5000 + AFK_HIDDEN_MS)).toBe(true);
  });

  it("input while hidden does not cancel the hidden grace", () => {
    const t = createAfkTracker(0, false);
    t.visibility(true, 0);
    t.input(20_000);
    expect(t.away(AFK_HIDDEN_MS)).toBe(true);
  });

  it("starts the hidden grace at once for a tab that starts hidden", () => {
    const t = createAfkTracker(1000, true);
    expect(t.msLeft(1000)).toBe(AFK_HIDDEN_MS);
  });

  it("an idle player who hides the tab is away at the earlier deadline", () => {
    const t = createAfkTracker(0, false);
    t.visibility(true, AFK_IDLE_MS - 1000);
    expect(t.msLeft(AFK_IDLE_MS - 1000)).toBe(1000);
  });

  it("reset starts afresh after resuming", () => {
    const t = createAfkTracker(0, false);
    expect(t.away(AFK_IDLE_MS)).toBe(true);
    t.reset(AFK_IDLE_MS, false);
    expect(t.away(AFK_IDLE_MS)).toBe(false);
    t.reset(AFK_IDLE_MS, true);
    expect(t.msLeft(AFK_IDLE_MS)).toBe(AFK_HIDDEN_MS);
  });

  it("takes new times", () => {
    const t = createAfkTracker(0, false);
    t.setTimes({ idleMs: 5000, hiddenMs: 2000 });
    expect(t.away(5000)).toBe(true);
    t.visibility(true, 0);
    expect(t.msLeft(0)).toBe(2000);
  });
});

describe("AFK dev override", () => {
  it("is ignored unless the server runs dev tools", () => {
    expect(afkTimesFromQuery("?afk=5", false)).toBeNull();
  });

  it("reads idle seconds, and optional hidden seconds", () => {
    expect(afkTimesFromQuery("?afk=8", true)).toEqual({ idleMs: 8000, hiddenMs: 8000 });
    expect(afkTimesFromQuery("?afk=60", true)).toEqual({ idleMs: 60_000, hiddenMs: AFK_HIDDEN_MS });
    expect(afkTimesFromQuery("?afk=8,3", true)).toEqual({ idleMs: 8000, hiddenMs: 3000 });
  });

  it("rejects nonsense and clamps tiny values", () => {
    expect(afkTimesFromQuery("", true)).toBeNull();
    expect(afkTimesFromQuery("?afk=abc", true)).toBeNull();
    expect(afkTimesFromQuery("?afk=-3", true)).toBeNull();
    expect(afkTimesFromQuery("?afk=0.01", true)).toEqual({ idleMs: 1000, hiddenMs: 1000 });
  });
});
