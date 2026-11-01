import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelTag, lineVisible, placeholderFor, unreadTabs } from "../src/client/ui/chat-format";
import { statRows, statsVisible } from "../src/client/ui/stats-logic";
import { emotePixelProblems, EMOTE_PIXELS } from "../src/client/art/emote-pixels";
import { bubbleLines, emoteScale, EMOTE_POP_MS } from "../src/client/render/overlays";
import { createSocialConnectionWith, KEEPALIVE, socialUrl, type SocialDeps } from "../src/client/net/social";
import type { WsLike } from "../src/client/net/connection";
import { EMOTES } from "../src/shared/emotes";
import type { SocialServerMsg, SocialStats } from "../src/shared/social";

describe("chat tabs", () => {
  it("filters lines per tab; system lines show everywhere", () => {
    expect(lineVisible("all", "world")).toBe(true);
    expect(lineVisible("world", "world")).toBe(true);
    expect(lineVisible("world", "zone")).toBe(false);
    expect(lineVisible("pm", "system")).toBe(true);
    expect(lineVisible("zone", "pm")).toBe(false);
  });

  it("lights unread dots only on tabs that would show the line", () => {
    expect(unreadTabs("all", "pm")).toEqual([]);
    expect(unreadTabs("world", "pm")).toEqual(["all", "pm"]);
    expect(unreadTabs("pm", "pm")).toEqual([]);
    expect(unreadTabs("zone", "system")).toEqual([]);
    expect(unreadTabs("zone", "world")).toEqual(["all", "world"]);
  });

  it("tags and placeholders", () => {
    expect(channelTag("world")).toBe("[W]");
    expect(channelTag("pm", "in")).toBe("[PM]");
    expect(channelTag("pm", "out")).toBe("[PM to]");
    expect(channelTag("zone")).toBe("");
    expect(placeholderFor("world", true)).toMatch(/Create an account/);
    expect(placeholderFor("world", false)).toMatch(/world/i);
  });
});

describe("stats panel", () => {
  const s: SocialStats = { online: 12, zones: { village: 3, home: 4 }, today: { crops_shipped: 1234 }, day: "2026-11-01" };
  it("shows only in shared zones", () => {
    expect(statsVisible("village", s)).toBe(true);
    expect(statsVisible("caves", s)).toBe(true);
    expect(statsVisible("home", s)).toBe(false);
    expect(statsVisible(null, s)).toBe(false);
    expect(statsVisible("village", null)).toBe(false);
  });
  it("formats rows", () => {
    expect(statRows(s, "village")).toEqual([
      { key: "online", label: "online", value: "12" },
      { key: "zone", label: "in the village", value: "3" },
      { key: "today", label: "crops shipped today", value: "1,234" },
    ]);
    expect(statRows(s, "caves")[1]!.value).toBe("0");
    const harvested = { ...s, today: { crops_harvested: 5 } };
    expect(statRows(harvested, "village")[2]).toEqual({ key: "today", label: "crops harvested today", value: "5" });
  });
});

describe("emote art", () => {
  it("has a well-formed 12x12 pixel map per emote", () => {
    expect(emotePixelProblems()).toEqual([]);
    for (const e of EMOTES) expect(EMOTE_PIXELS[e].join("").replace(/\./g, "").length).toBeGreaterThan(10);
  });
});

describe("bubbles", () => {
  it("truncate to 5 words", () => {
    expect(bubbleLines("one two three four five six seven").join(" ")).toBe("one two three four five…");
    expect(bubbleLines("hi")).toEqual(["hi"]);
    expect(bubbleLines("   ")).toEqual([]);
  });
  it("pop in emotes", () => {
    expect(emoteScale(0)).toBeCloseTo(0.6);
    expect(emoteScale(EMOTE_POP_MS)).toBe(1);
    expect(emoteScale(EMOTE_POP_MS / 2)).toBeGreaterThan(0.6);
  });
});

class FakeWs implements WsLike {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: WsLike["onopen"] = null;
  onclose: WsLike["onclose"] = null;
  onmessage: WsLike["onmessage"] = null;
  onerror: WsLike["onerror"] = null;
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
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

describe("social connection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWs.all = [];
  });
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const msgs: SocialServerMsg[] = [];
    const deps: SocialDeps = {
      WebSocket: FakeWs,
      location: { protocol: "https:", host: "game.test" },
      rand: () => 0.5,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (t) => clearInterval(t),
    };
    return { c: createSocialConnectionWith({ onMessage: (m) => msgs.push(m) }, deps), msgs };
  };

  it("connects to /ws/social, sends only while open, and keeps alive", () => {
    expect(socialUrl({ protocol: "http:", host: "h:1" })).toBe("ws://h:1/ws/social");
    const { c, msgs } = make();
    c.start();
    const ws = FakeWs.all[0]!;
    expect(ws.url).toBe("wss://game.test/ws/social");
    expect(c.send({ t: "stats" })).toBe(false);
    ws.open();
    expect(c.send({ t: "world", text: "hi" })).toBe(true);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ t: "world", text: "hi" });
    ws.onmessage?.({ data: JSON.stringify({ t: "pong", at: 1 }) });
    ws.onmessage?.({ data: "garbage" });
    expect(msgs).toEqual([{ t: "pong", at: 1 }]);
    vi.advanceTimersByTime(30_000);
    expect(ws.sent).toContain(KEEPALIVE);
  });

  it("reconnects with backoff, but not after the session ended", () => {
    const { c } = make();
    c.start();
    FakeWs.all[0]!.open();
    FakeWs.all[0]!.serverClose(1006);
    vi.advanceTimersByTime(20_000);
    expect(FakeWs.all).toHaveLength(2);
    FakeWs.all[1]!.open();
    FakeWs.all[1]!.serverClose(4401);
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(2);
    c.close();
  });
});
