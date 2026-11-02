import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HALO_CLEARANCE,
  HALO_BOB_AMP,
  HALO_LIFT,
  HALO_RX,
  HALO_RY,
  haloBob,
  haloCentreY,
  haloPulse,
  haloRingCells,
  haloSparkle,
} from "../src/client/render/halo-logic";
import { isNewShout, marqueeTiming, MIN_PASS_MS, showMs, shoutTitle, STATIC_MAX_MS, staticMs } from "../src/client/ui/shout-banner-logic";
import { cardButtons } from "../src/client/ui/player-card-logic";
import { SLASH_COMMANDS, slashSuggestions, type SlashContext } from "../src/client/ui/slash-commands";
import { parseAdminCommand, CLOSE_REMOVED, HTTP_REMOVED } from "../src/shared/admin";
import { createConnectionWith, type ConnectionDeps, type WsLike } from "../src/client/net/connection";
import { createSocialConnectionWith, type SocialDeps } from "../src/client/net/social";
import { friendlyAuthError, isRemovedError } from "../src/client/ui/auth-logic";
import { playerHit } from "../src/client/game/player-hit";

describe("halo geometry", () => {
  const cells = haloRingCells();
  const key = (x: number, y: number) => `${x},${y}`;
  const set = new Set(cells.map((c) => key(c.x, c.y)));

  it("is a closed pixel outline with no duplicates", () => {
    expect(set.size).toBe(cells.length);
    for (const c of cells) {
      let n = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && set.has(key(c.x + dx, c.y + dy))) n++;
      expect(n, `cell ${c.x},${c.y}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("is as wide and tall as the ellipse and symmetric left to right", () => {
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    expect(Math.min(...xs)).toBe(-HALO_RX);
    expect(Math.max(...xs)).toBe(HALO_RX);
    expect(Math.max(...ys)).toBeLessThanOrEqual(Math.ceil(HALO_RY));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-Math.ceil(HALO_RY));
    for (const c of cells) expect(set.has(key(-c.x, c.y)), `mirror of ${c.x},${c.y}`).toBe(true);
  });

  it("is bright in front, deeper behind, with a highlight on the far side", () => {
    expect(cells.filter((c) => c.y > 0).every((c) => c.tone === "front")).toBe(true);
    expect(cells.some((c) => c.tone === "back")).toBe(true);
    expect(cells.filter((c) => c.tone === "shine").every((c) => c.y < 0 && c.x < 0)).toBe(true);
    expect(cells.some((c) => c.tone === "shine")).toBe(true);
  });

  it("bobs within its amplitude and pulses between 0 and 1", () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      expect(Math.abs(haloBob(ms))).toBeLessThanOrEqual(HALO_BOB_AMP + 1e-9);
      const p = haloPulse(ms, 1.3);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(haloBob(0)).toBeCloseTo(0);
    expect(haloBob(500)).toBeLessThan(0); // floats up first
    expect(haloPulse(0, 0)).not.toBeCloseTo(haloPulse(600, 0));
  });

  it("floats above the head top, and the name tag clears it", () => {
    for (const ms of [0, 250, 900, 1700]) {
      const y = haloCentreY(-100, 2, ms);
      expect(y).toBeLessThan(-100 - (HALO_LIFT - HALO_BOB_AMP) * 2 + 1e-9);
      expect(y).toBeGreaterThan(-100 - (HALO_LIFT + HALO_BOB_AMP) * 2 - 1e-9);
      expect(y - HALO_RY * 2).toBeGreaterThan(-100 - HALO_CLEARANCE * 2);
    }
  });

  it("orbits sparkles on the ring, in front only on the near half", () => {
    for (let ms = 0; ms < 3000; ms += 50) {
      for (let i = 0; i < 2; i++) {
        const s = haloSparkle(ms, i, 2);
        expect((s.x / HALO_RX) ** 2 + (s.y / HALO_RY) ** 2).toBeCloseTo(1);
        expect(s.front).toBe(s.y >= 0);
        expect(s.alpha).toBeGreaterThan(0.3);
        expect(s.alpha).toBeLessThanOrEqual(1);
      }
    }
    const a = haloSparkle(0, 0, 2);
    const b = haloSparkle(0, 1, 2);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(HALO_RX); // opposite sides
  });
});

describe("shout banner timing", () => {
  it("enters from the right edge and leaves past the left at a steady speed", () => {
    const t = marqueeTiming(500, 400, 100);
    expect(t).toEqual({ fromPx: 500, toPx: -400, passMs: 9000 });
    expect(showMs(t)).toBe(18_000);
    expect(marqueeTiming(300, 50).passMs).toBe(MIN_PASS_MS);
    expect(marqueeTiming(-5, -5).fromPx).toBe(0);
  });

  it("gives reduced-motion readers time to read, capped", () => {
    expect(staticMs("hi")).toBeGreaterThan(8000);
    expect(staticMs("x".repeat(1000))).toBe(STATIC_MAX_MS);
  });

  it("shows each shout once and names who shouted", () => {
    expect(isNewShout({ id: "a" }, null, null)).toBe(true);
    expect(isNewShout({ id: "a" }, "a", null)).toBe(false);
    expect(isNewShout({ id: "a" }, null, "a")).toBe(false);
    expect(shoutTitle({ name: "ET" })).toBe("Announcement from ET");
    expect(shoutTitle({ name: "" })).toBe("Announcement");
  });
});

describe("admin UI rules", () => {
  const ctx = { viewerGuest: false, homeOwner: false };
  const card = null;

  it("offers Kick on the player card only to admins, never on admins or yourself", () => {
    expect(cardButtons({ self: false }, card, ctx)).not.toContain("kick");
    expect(cardButtons({ self: false }, card, { ...ctx, admin: true })).toEqual(["friend", "whisper", "mute", "kick"]);
    expect(cardButtons({ self: false, admin: true }, card, { ...ctx, admin: true })).not.toContain("kick");
    expect(cardButtons({ self: true }, card, { ...ctx, admin: true })).toEqual([]);
  });

  it("marks admins in player hits from the entity flag", () => {
    expect(playerHit("p:u1", { kind: "player", name: "ET", admin: true }, null)).toMatchObject({ admin: true });
    expect(playerHit("p:u2", { kind: "player", name: "Bob" }, null)!.admin).toBeUndefined();
  });

  it("lists admin commands only for admins, and /kick means the server kick for them", () => {
    const village: SlashContext = { atHome: false, homeOwner: false, guest: false, devTools: false };
    const home: SlashContext = { atHome: true, homeOwner: true, guest: false, devTools: false };
    const labels = (c: SlashContext) => slashSuggestions("/", c).map((s) => s.label);
    expect(labels(village)).not.toContain("/shout");
    expect(labels({ ...village, admin: true })).toEqual(expect.arrayContaining(["/shout", "/kick", "/unban"]));
    expect(labels({ ...village, admin: true, guest: true })).not.toContain("/shout");
    const adminKick = slashSuggestions("/kick", { ...home, admin: true });
    expect(adminKick).toHaveLength(1);
    expect(adminKick[0]!.description).toMatch(/remove a player/i);
    expect(slashSuggestions("/kick", home)[0]!.description).toBe("Send a visitor home");
    for (const c of SLASH_COMMANDS.filter((c) => /^Admin:/.test(c.description))) {
      expect(parseAdminCommand(`/${c.name} Bob hi`)?.cmd, c.name).toBe(c.name === "unban" ? "unban" : c.name === "kick" ? "kick" : "shout");
    }
  });

  it("turns a refused sign-in into the removed message", () => {
    expect(isRemovedError({ status: HTTP_REMOVED })).toBe(true);
    expect(isRemovedError({ code: "REMOVED", status: 403 })).toBe(true);
    expect(isRemovedError({ status: 401 })).toBe(false);
    expect(friendlyAuthError({ status: HTTP_REMOVED }, "signup")).toBe("You've been removed from Mossbrook.");
  });
});

// ------------------------------------------------------------------ sockets stop on removal

class FakeWs implements WsLike {
  static all: FakeWs[] = [];
  readyState = 0;
  onopen: WsLike["onopen"] = null;
  onclose: WsLike["onclose"] = null;
  onmessage: WsLike["onmessage"] = null;
  onerror: WsLike["onerror"] = null;
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const timers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (t: ReturnType<typeof setTimeout>) => clearInterval(t),
};

describe("removed players' sockets", () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeWs.all = [];
  });

  it("the zone connection stops and reports on close 4451", () => {
    vi.useFakeTimers();
    const onRemoved = vi.fn();
    const deps: ConnectionDeps = { WebSocket: FakeWs, location: { protocol: "https:", host: "g" }, now: () => 0, rand: () => 0.5, ...timers, probe: async () => 426 };
    const conn = createConnectionWith({ onMessage() {}, onState() {}, onRemoved }, deps);
    conn.connect("village");
    FakeWs.all.at(-1)!.open();
    FakeWs.all.at(-1)!.serverClose(CLOSE_REMOVED);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1); // no reconnect
  });

  it("the zone connection reads a refused handshake answered with 451 as removed", async () => {
    vi.useFakeTimers();
    const onRemoved = vi.fn();
    const onForbidden = vi.fn();
    const deps: ConnectionDeps = { WebSocket: FakeWs, location: { protocol: "https:", host: "g" }, now: () => 0, rand: () => 0.5, ...timers, probe: async () => HTTP_REMOVED };
    const conn = createConnectionWith({ onMessage() {}, onState() {}, onRemoved, onForbidden }, deps);
    conn.connect("village");
    FakeWs.all.at(-1)!.serverClose(1006);
    await vi.runOnlyPendingTimersAsync();
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(onForbidden).not.toHaveBeenCalled();
  });

  it("the social connection stops on close 4451", () => {
    vi.useFakeTimers();
    const onRemoved = vi.fn();
    const deps: SocialDeps = { WebSocket: FakeWs, location: { protocol: "https:", host: "g" }, rand: () => 0.5, ...timers };
    const social = createSocialConnectionWith({ onMessage() {}, onRemoved }, deps);
    social.start();
    FakeWs.all.at(-1)!.open();
    FakeWs.all.at(-1)!.serverClose(CLOSE_REMOVED);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1);
  });
});
