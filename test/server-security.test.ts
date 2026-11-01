import { afterEach, describe, expect, it, vi } from "vitest";
import { ABUSE_DROPS, BUCKET_BURST, BUCKET_PER_SEC, SocketLimiter, TokenBucket } from "../src/worker/game/rateLimit";
import { SaveDebouncer, type Timers } from "../src/worker/game/saver";
import { ChatGuards, GUARD_TTL_MS, MUTE_MS } from "../src/worker/game/chat";
import { resolveSpawn, sanitizeTransfer, TRANSFER_TTL_MS } from "../src/worker/game/spawn";
import { recheckDue, sessionRowValid, SESSION_RECHECK_MS } from "../src/worker/game/session";
import { originAllowed } from "../src/worker/http/origin";
import { captchaMode } from "../src/worker/captcha";
import { checkQuota, UPLOAD_MAX_BYTES_TOTAL, UPLOAD_MAX_FILES, UPLOAD_RATE_MAX } from "../src/worker/http/quota";
import { staleGiftKeys, TalkQueue, TALK_QUEUE_MAX, TALK_QUEUE_TTL_MS } from "../src/worker/game/npcGate";
import { objSeqFor } from "../src/worker/game/sanitize";
import { stripControls } from "../src/worker/npc/text";
import { cleanName } from "../src/worker/game/identity";
import { timeout, TimeoutError } from "../src/worker/game/timeout";
import type { PlacedObject } from "../src/shared/types";

describe("TokenBucket / SocketLimiter", () => {
  it("allows a burst, then refills at the sustained rate", () => {
    const b = new TokenBucket(BUCKET_BURST, BUCKET_PER_SEC, 0);
    for (let i = 0; i < BUCKET_BURST; i++) expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(1000 / BUCKET_PER_SEC)).toBe(true);
    expect(b.take(1000 / BUCKET_PER_SEC)).toBe(false);
  });
  it("lets a held key (10/s) plus pings run forever", () => {
    const l = new SocketLimiter(0);
    for (let t = 0; t < 120_000; t += 100) {
      expect(l.check(t)).toBe("ok");
      if (t % 2000 === 0) expect(l.check(t)).toBe("ok");
    }
  });
  it("rejects at most once a second, then closes a sustained flood", () => {
    const l = new SocketLimiter(0);
    const verdicts: string[] = [];
    for (let i = 0; i < BUCKET_BURST + ABUSE_DROPS; i++) verdicts.push(l.check(0));
    expect(verdicts.slice(0, BUCKET_BURST).every((v) => v === "ok")).toBe(true);
    expect(verdicts[BUCKET_BURST]).toBe("reject");
    expect(verdicts[BUCKET_BURST + 1]).toBe("drop");
    expect(verdicts.at(-1)).toBe("close");
  });
});

describe("SaveDebouncer", () => {
  function fakeTimers() {
    const queue: { fn: () => void; at: number; id: number }[] = [];
    let id = 0;
    const timers: Timers = {
      set: (fn, ms) => {
        queue.push({ fn, at: ms, id: ++id });
        return id;
      },
      clear: (h) => {
        const i = queue.findIndex((q) => q.id === h);
        if (i >= 0) queue.splice(i, 1);
      },
    };
    const flush = () => queue.splice(0).forEach((q) => q.fn());
    return { timers, queue, flush };
  }
  it("coalesces a burst into one save", () => {
    const { timers, queue, flush } = fakeTimers();
    let saves = 0;
    const d = new SaveDebouncer(() => saves++, 250, timers);
    d.schedule();
    d.schedule();
    d.schedule();
    expect(queue).toHaveLength(1);
    expect(d.pending).toBe(true);
    flush();
    expect(saves).toBe(1);
    expect(d.pending).toBe(false);
  });
  it("cancel drops the pending save (exit saves directly instead)", () => {
    const { timers, queue, flush } = fakeTimers();
    let saves = 0;
    const d = new SaveDebouncer(() => saves++, 250, timers);
    d.schedule();
    d.cancel();
    expect(queue).toHaveLength(0);
    flush();
    expect(saves).toBe(0);
  });
});

describe("ChatGuards", () => {
  it("keeps a mute across reconnects (same userId) and forgets idle guards", () => {
    const guards = new ChatGuards();
    let t = 0;
    for (let i = 0; i < 5; i++) guards.get("u1", (t += 1000)).check("spam", t);
    // A reconnect gets the same guard back, still muted.
    expect(guards.get("u1", t + 1000).check("hello", t + 1000)).toBe("muted");
    guards.get("u2", t).check("hi", t);
    guards.prune(t + MUTE_MS + GUARD_TTL_MS + 1);
    expect(guards.size).toBe(0);
  });
  it("does not prune a guard that is still muted", () => {
    const guards = new ChatGuards();
    let t = 0;
    for (let i = 0; i < 5; i++) guards.get("u1", (t += 1000)).check("spam", t);
    guards.prune(t + 1);
    expect(guards.size).toBe(1);
  });
});

describe("resolveSpawn", () => {
  const spawns = { default: { x: 10, y: 10 }, from_caves: { x: 3, y: 4 } };
  const transfer = { to: "village" as const, spawn: "from_caves", at: 1000 };
  it("honours a named spawn only when it matches the recorded transfer", () => {
    expect(resolveSpawn(spawns, "village", "from_caves", {}, transfer, 2000)).toEqual({ x: 3, y: 4 });
  });
  it("ignores a crafted spawn with no transfer: saved position, then default", () => {
    expect(resolveSpawn(spawns, "village", "from_caves", { zone: "village", x: 7, y: 8 }, null, 0)).toEqual({ x: 7, y: 8 });
    expect(resolveSpawn(spawns, "village", "from_caves", { zone: "caves", x: 7, y: 8 }, null, 0)).toEqual({ x: 10, y: 10 });
  });
  it("rejects a transfer for another zone, another spawn, or an old one", () => {
    const saved = { zone: "village" as const, x: 1, y: 2 };
    expect(resolveSpawn(spawns, "caves", "from_caves", saved, transfer, 2000)).toEqual(spawns.default);
    expect(resolveSpawn(spawns, "village", "default", saved, transfer, 2000)).toEqual({ x: 1, y: 2 });
    expect(resolveSpawn(spawns, "village", "from_caves", saved, transfer, 1000 + TRANSFER_TTL_MS + 1)).toEqual({ x: 1, y: 2 });
  });
  it("sanitizes stored transfers", () => {
    expect(sanitizeTransfer({ to: "caves", spawn: "x", at: 1 })).toEqual({ to: "caves", spawn: "x", at: 1 });
    expect(sanitizeTransfer({ to: "caves", spawn: 3, at: 1 })).toBeNull();
    expect(sanitizeTransfer(null)).toBeNull();
  });
});

describe("session re-check", () => {
  it("is due every 5 minutes", () => {
    expect(recheckDue(0, SESSION_RECHECK_MS - 1)).toBe(false);
    expect(recheckDue(0, SESSION_RECHECK_MS)).toBe(true);
  });
  it("accepts only a live session of the same user", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    expect(sessionRowValid({ userId: "u", expiresAt: "2026-12-01T00:00:00.000Z" }, "u", now)).toBe(true);
    expect(sessionRowValid({ userId: "u", expiresAt: "2026-10-01T00:00:00.000Z" }, "u", now)).toBe(false);
    expect(sessionRowValid({ userId: "other", expiresAt: "2026-12-01T00:00:00.000Z" }, "u", now)).toBe(false);
    expect(sessionRowValid(null, "u", now)).toBe(false);
  });
});

describe("originAllowed", () => {
  const prod = { BETTER_AUTH_URL: "https://mmo.example.com", DMMO_ENV: undefined };
  const local = { BETTER_AUTH_URL: "http://localhost:8787", DMMO_ENV: "local" };
  it("allows only the app origin in production", () => {
    expect(originAllowed("https://mmo.example.com", prod)).toBe(true);
    expect(originAllowed("https://evil.example.com", prod)).toBe(false);
    expect(originAllowed("http://localhost:8790", prod)).toBe(false);
    expect(originAllowed(null, prod)).toBe(false);
    expect(originAllowed("null", prod)).toBe(false);
  });
  it("allows localhost on any port in the local env", () => {
    expect(originAllowed("http://localhost:8790", local)).toBe(true);
    expect(originAllowed("http://127.0.0.1:5173", local)).toBe(true);
    expect(originAllowed("https://evil.example.com", local)).toBe(false);
  });
});

describe("captchaMode", () => {
  it("fails closed outside local unless explicitly disabled", () => {
    expect(captchaMode({ TURNSTILE_SECRET_KEY: "s" })).toBe("on");
    expect(captchaMode({ TURNSTILE_SECRET_KEY: "" })).toBe("misconfigured");
    expect(captchaMode({ TURNSTILE_SECRET_KEY: "", DMMO_ENV: "local" })).toBe("off");
    expect(captchaMode({ CAPTCHA_DISABLED: "1" })).toBe("off");
    expect(captchaMode({ CAPTCHA_DISABLED: "true" })).toBe("misconfigured");
  });
});

describe("upload quota", () => {
  it("enforces rate, file count and total bytes", () => {
    expect(checkQuota({ count: 0, bytes: 0, recent: 0 }, 1000)).toEqual({ ok: true });
    expect(checkQuota({ count: 0, bytes: 0, recent: UPLOAD_RATE_MAX }, 1)).toMatchObject({ ok: false, status: 429 });
    expect(checkQuota({ count: UPLOAD_MAX_FILES, bytes: 0, recent: 0 }, 1)).toMatchObject({ ok: false, status: 413 });
    expect(checkQuota({ count: 1, bytes: UPLOAD_MAX_BYTES_TOTAL - 10, recent: 0 }, 11)).toMatchObject({ ok: false, status: 413 });
    expect(checkQuota({ count: 1, bytes: UPLOAD_MAX_BYTES_TOTAL - 10, recent: 0 }, 10)).toEqual({ ok: true });
  });
});

describe("TalkQueue", () => {
  const sp = (userId: string) => ({ userId });
  it("keeps at most two waiting players, one entry each", () => {
    const q = new TalkQueue<{ userId: string }>();
    expect(q.offer("n", { speaker: sp("a"), text: "1", at: 0 })).toBe(true);
    expect(q.offer("n", { speaker: sp("a"), text: "2", at: 0 })).toBe(true);
    expect(q.size("n")).toBe(1);
    expect(q.offer("n", { speaker: sp("b"), text: "x", at: 0 })).toBe(true);
    expect(q.offer("n", { speaker: sp("c"), text: "x", at: 0 })).toBe(false);
    expect(q.size("n")).toBe(TALK_QUEUE_MAX);
  });
  it("serves someone other than the player just served first", () => {
    const q = new TalkQueue<{ userId: string }>();
    q.offer("n", { speaker: sp("hog"), text: "again", at: 0 });
    q.offer("n", { speaker: sp("b"), text: "hi", at: 0 });
    expect(q.next("n", "hog", 0)?.speaker.userId).toBe("b");
    expect(q.next("n", "b", 0)?.speaker.userId).toBe("hog");
    expect(q.next("n", "hog", 0)).toBeNull();
  });
  it("drops stale entries", () => {
    const q = new TalkQueue<{ userId: string }>();
    q.offer("n", { speaker: sp("a"), text: "1", at: 0 });
    expect(q.next("n", null, TALK_QUEUE_TTL_MS + 1)).toBeNull();
    expect(q.size("n")).toBe(0);
  });
});

describe("staleGiftKeys", () => {
  it("prunes gift markers older than 2 days", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const keys = staleGiftKeys(
      [
        ["gift:a:u1", "2026-11-10"],
        ["gift:a:u2", "2026-11-08"],
        ["gift:a:u3", "2026-11-07"],
        ["gift:a:u4", 42],
      ],
      now,
    );
    expect(keys).toEqual(["gift:a:u3", "gift:a:u4"]);
  });
});

describe("objSeqFor", () => {
  const obj = (id: string): PlacedObject => ({ id, item: "chair", x: 0, y: 0, rotation: 0 });
  it("never issues an id already in use", () => {
    expect(objSeqFor([obj("o3"), obj("o12"), obj("x")])).toBe(12);
    expect(objSeqFor([obj("o2")], 40)).toBe(40);
    expect(objSeqFor([])).toBe(0);
    expect(objSeqFor([obj("o1")], "bad")).toBe(1);
  });
});

describe("stripControls / cleanName", () => {
  it("removes bidi overrides, zero-width and other format chars", () => {
    expect(stripControls("a‮b​c⁦d﻿e­f")).toBe("abcdef");
    expect(stripControls("x\ny z")).toBe("x y z");
    expect(cleanName("‮Evil‍ Name\u0000")).toBe("Evil_Name");
  });
});

describe("timeout", () => {
  afterEach(() => vi.useRealTimers());
  it("rejects when the promise is too slow", async () => {
    vi.useFakeTimers();
    const p = timeout(new Promise(() => {}), 100);
    vi.advanceTimersByTime(100);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });
  it("passes through a fast result", async () => {
    await expect(timeout(Promise.resolve(5), 100)).resolves.toBe(5);
  });
});
