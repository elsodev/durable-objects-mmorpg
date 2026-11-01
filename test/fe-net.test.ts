import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionWith, type ConnectionDeps, type WsLike } from "../src/client/net/connection";
import { backoffDelay } from "../src/client/net/backoff";
import { createClockSync, RTT_WINDOW } from "../src/client/net/clock";
import { wsUrl } from "../src/client/net/url";
import type { ConnState } from "../src/client/contracts";
import type { ServerMsg } from "../src/shared/protocol";

class FakeWs implements WsLike {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: WsLike["onopen"] = null;
  onclose: WsLike["onclose"] = null;
  onmessage: WsLike["onmessage"] = null;
  onerror: WsLike["onerror"] = null;
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  recv(msg: ServerMsg | string) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
}

const last = () => FakeWs.all[FakeWs.all.length - 1]!;

function setup(probeStatus: number | null = 426) {
  const states: ConnState[] = [];
  const msgs: ServerMsg[] = [];
  const forbidden: string[] = [];
  const idled: string[] = [];
  const probes: string[] = [];
  const deps: ConnectionDeps = {
    WebSocket: FakeWs,
    location: { protocol: "https:", host: "game.test" },
    now: () => Date.now(),
    rand: () => 0.5,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (t) => clearInterval(t),
    probe: async (url) => {
      probes.push(url);
      return probeStatus;
    },
  };
  const conn = createConnectionWith(
    {
      onMessage: (m) => msgs.push(m),
      onState: (s) => states.push(s),
      onForbidden: (z) => forbidden.push(z),
      onIdle: (z) => idled.push(z),
    },
    deps,
  );
  return { conn, states, msgs, forbidden, idled, probes };
}

beforeEach(() => {
  FakeWs.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("wsUrl", () => {
  it("picks scheme from page protocol and encodes spawn", () => {
    expect(wsUrl({ protocol: "https:", host: "a.b" }, "village", "from home")).toBe("wss://a.b/ws/village?spawn=from%20home");
    expect(wsUrl({ protocol: "http:", host: "localhost:8787" }, "home")).toBe("ws://localhost:8787/ws/home");
  });
});

describe("backoffDelay", () => {
  it("grows exponentially, caps, and jitters", () => {
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(0, () => 0.999999)).toBe(500);
    expect(backoffDelay(3, () => 0.999999)).toBe(4000);
    expect(backoffDelay(50, () => 0.999999)).toBe(10_000);
  });
});

describe("clock sync", () => {
  it("uses the welcome hint until the first pong, then the fastest recent sample", () => {
    const c = createClockSync();
    c.hint(5000, 1000);
    expect(c.offset()).toBe(4000);
    c.pong(1000, 2050, 1100); // rtt 100, offset 2050+50-1100 = 1000
    expect(c.rtt()).toBe(100);
    expect(c.offset()).toBe(1000);
    c.pong(2000, 3100, 2200); // rtt 200 (a slow frame delayed the read), offset 1000
    expect(c.rtt()).toBe(100);
    expect(c.offset()).toBe(1000);
    c.pong(3000, 0, 2000); // negative rtt ignored
    expect(c.rtt()).toBe(100);
  });

  it("forgets a stall once it leaves the window, so a slow first pong doesn't stick", () => {
    const c = createClockSync();
    c.pong(0, 1000, 900); // 900 ms: page was still decoding assets
    expect(c.rtt()).toBe(900);
    c.pong(2000, 3000 + 2, 2004); // 4 ms
    expect(c.rtt()).toBe(4);
    expect(c.offset()).toBe(1000);
    for (let i = 0; i < RTT_WINDOW; i++) c.pong(10_000 + i * 2000, 0, 10_000 + i * 2000 + 30);
    expect(c.rtt()).toBe(30);
    c.reset();
    expect(c.rtt()).toBe(0);
  });
});

describe("connection", () => {
  it("connects, queues while connecting, flushes on open, decodes messages", () => {
    const { conn, states, msgs } = setup();
    conn.connect("village", "home");
    expect(last().url).toBe("wss://game.test/ws/village?spawn=home");
    conn.send({ t: "chat", text: "hi" });
    expect(last().sent).toEqual([]);
    last().open();
    expect(states).toEqual(["connecting", "online"]);
    expect(JSON.parse(last().sent[0]!)).toEqual({ t: "chat", text: "hi" });
    expect(JSON.parse(last().sent[1]!).t).toBe("ping");
    last().recv({ t: "notice", text: "yo", kind: "info" });
    last().recv("not json");
    expect(msgs).toEqual([{ t: "notice", text: "yo", kind: "info" }]);
  });

  it("pings every 2 s and tracks rtt + clock offset", () => {
    const { conn } = setup();
    conn.connect("village");
    const ws = last();
    ws.open();
    const at = JSON.parse(ws.sent[0]!).at as number;
    vi.advanceTimersByTime(80);
    ws.recv({ t: "pong", at, serverTime: Date.now() + 5000 - 40 });
    expect(conn.rtt()).toBe(80);
    expect(conn.clockOffset()).toBe(5000);
    vi.advanceTimersByTime(2000);
    expect(ws.sent.filter((s) => JSON.parse(s).t === "ping").length).toBe(2);
  });

  it("reconnects with backoff after a drop and resets attempts on success", () => {
    const { conn, states } = setup();
    conn.connect("village");
    last().open();
    last().serverClose(1006);
    expect(states.at(-1)).toBe("offline");
    expect(FakeWs.all.length).toBe(1);
    vi.advanceTimersByTime(374); // attempt 0: 500 * 0.75
    expect(FakeWs.all.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeWs.all.length).toBe(2);
    expect(states.at(-1)).toBe("connecting");
    last().open();
    expect(states.at(-1)).toBe("online");
    conn.send({ t: "move", dx: 1, dy: 0 });
    expect(JSON.parse(last().sent.at(-1)!).t).toBe("move");
  });

  it("probes after a failed handshake and retries when not refused", async () => {
    const { conn, probes, forbidden } = setup(426);
    conn.connect("caves");
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toEqual(["https://game.test/ws/caves"]);
    expect(forbidden).toEqual([]);
    await vi.advanceTimersByTimeAsync(375);
    expect(FakeWs.all.length).toBe(2);
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(749); // attempt 1: 1000 * 0.75
    expect(FakeWs.all.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWs.all.length).toBe(3);
  });

  it("calls onForbidden on close 4401 and stops reconnecting", async () => {
    const { conn, forbidden, states } = setup();
    conn.connect("village");
    last().open();
    last().serverClose(4401);
    expect(forbidden).toEqual(["village"]);
    expect(states.at(-1)).toBe("offline");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.all.length).toBe(1);
  });

  it("calls onIdle on close 4408 and does not reconnect by itself", async () => {
    const { conn, idled, forbidden, states, probes } = setup();
    conn.connect("caves");
    last().open();
    last().serverClose(4408);
    expect(idled).toEqual(["caves"]);
    expect(forbidden).toEqual([]);
    expect(states.at(-1)).toBe("offline");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.all.length).toBe(1);
    expect(probes).toEqual([]);
    conn.connect("caves");
    expect(FakeWs.all.length).toBe(2);
  });

  it("calls onForbidden when the HTTP probe says 403", async () => {
    const { conn, forbidden } = setup(403);
    conn.connect("riverside");
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(forbidden).toEqual(["riverside"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.all.length).toBe(1);
  });

  it("zone switch closes the old socket deliberately and ignores its events", async () => {
    const { conn, msgs } = setup();
    conn.connect("home");
    const old = last();
    old.open();
    conn.send({ t: "chat", text: "queued?" });
    conn.connect("village", "gate");
    expect(old.closedWith).toBe(1000);
    old.onclose?.({ code: 1006 }); // handlers were detached; simulate a stray event
    old.recv({ t: "notice", text: "stale", kind: "info" });
    expect(msgs).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.all.length).toBe(2);
    expect(last().url).toBe("wss://game.test/ws/village?spawn=gate");
  });

  it("close() stops everything and drops later sends", async () => {
    const { conn, states } = setup();
    conn.connect("home");
    last().open();
    conn.close();
    expect(last().closedWith).toBe(1000);
    expect(states.at(-1)).toBe("offline");
    conn.send({ t: "chat", text: "x" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.all.length).toBe(1);
  });
});
