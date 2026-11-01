// See ../contracts.ts for the contract.
import type { ConnState, Connection, CreateConnection } from "../contracts";
import { decodeServer, encode, type ClientMsg, type ServerMsg } from "../../shared/protocol";
import type { ZoneId } from "../../shared/types";
import { backoffDelay } from "./backoff";
import { createClockSync } from "./clock";
import { probeUrl, wsUrl } from "./url";

/** The slice of the browser WebSocket we use, so tests can pass a fake. */
export interface WsLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type Timer = ReturnType<typeof setTimeout>;

export interface ConnectionDeps {
  WebSocket: new (url: string) => WsLike;
  location: { protocol: string; host: string };
  now(): number;
  rand(): number;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(t: Timer): void;
  setInterval(fn: () => void, ms: number): Timer;
  clearInterval(t: Timer): void;
  /**
   * Browsers hide the HTTP status of a refused handshake (it surfaces as close 1006), so after a
   * socket fails before opening we ask the same path over HTTP. Resolves the status, or null.
   */
  probe(url: string): Promise<number | null>;
}

const OPEN = 1;
const PING_MS = 2000;
const QUEUE_MAX = 100;
export const FORBIDDEN_CLOSE = 4401;
/** Server closed an AFK socket: stay offline until the player asks to come back. */
export const IDLE_CLOSE = 4408;

type Opts = Parameters<CreateConnection>[0];

export function createConnectionWith(opts: Opts, deps: ConnectionDeps): Connection {
  const clock = createClockSync();
  let gen = 0;
  let ws: WsLike | null = null;
  let zone: ZoneId | null = null;
  let spawn: string | undefined;
  /** Owner id while connecting to someone else's home (/ws/visit/<id>). */
  let visit: string | undefined;
  let attempt = 0;
  let stopped = true;
  let queue: string[] = [];
  let pingTimer: Timer | null = null;
  let retryTimer: Timer | null = null;
  let state: ConnState | null = null;

  const setState = (s: ConnState) => {
    if (s === state) return;
    state = s;
    opts.onState(s);
  };

  const stopPing = () => {
    if (pingTimer !== null) deps.clearInterval(pingTimer);
    pingTimer = null;
  };

  const rawSend = (sock: WsLike, data: string): boolean => {
    try {
      sock.send(data);
      return true;
    } catch {
      return false;
    }
  };

  const ping = () => {
    if (ws && ws.readyState === OPEN) rawSend(ws, encode({ t: "ping", at: deps.now() }));
  };

  /** Drops the current socket without triggering reconnect. */
  const teardown = () => {
    gen++;
    stopPing();
    if (retryTimer !== null) deps.clearTimeout(retryTimer);
    retryTimer = null;
    const old = ws;
    ws = null;
    if (old) {
      old.onopen = old.onclose = old.onmessage = old.onerror = null;
      try {
        old.close(1000, "client");
      } catch {
        // already closing
      }
    }
  };

  const forbidden = () => {
    const z = zone;
    stopped = true;
    teardown();
    queue = [];
    setState("offline");
    if (z && opts.onForbidden) opts.onForbidden(z);
  };

  const idle = () => {
    const z = zone;
    stopped = true;
    teardown();
    queue = [];
    setState("offline");
    if (z && opts.onIdle) opts.onIdle(z);
  };

  const scheduleRetry = (my: number) => {
    setState("offline");
    const delay = backoffDelay(attempt++, deps.rand);
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      if (my === gen && !stopped) open();
    }, delay);
  };

  const handle = (msg: ServerMsg) => {
    if (msg.t === "pong") clock.pong(msg.at, msg.serverTime, deps.now());
    else if (msg.t === "welcome") clock.hint(msg.serverTime, deps.now());
    opts.onMessage(msg);
  };

  const open = () => {
    if (!zone) return;
    const my = ++gen;
    const z = zone;
    let opened = false;
    setState("connecting");
    let sock: WsLike;
    try {
      sock = new deps.WebSocket(wsUrl(deps.location, z, spawn, visit));
    } catch {
      scheduleRetry(my);
      return;
    }
    ws = sock;

    sock.onopen = () => {
      if (my !== gen) return;
      opened = true;
      attempt = 0;
      setState("online");
      const pending = queue;
      queue = [];
      for (const data of pending) rawSend(sock, data);
      ping();
      pingTimer = deps.setInterval(ping, PING_MS);
    };

    sock.onmessage = (ev) => {
      if (my !== gen || typeof ev.data !== "string") return;
      const msg = decodeServer(ev.data);
      if (msg) handle(msg);
    };

    sock.onerror = () => {
      // onclose always follows; nothing to do here.
    };

    sock.onclose = (ev) => {
      if (my !== gen) return;
      stopPing();
      ws = null;
      if (ev.code === FORBIDDEN_CLOSE) return forbidden();
      if (ev.code === IDLE_CLOSE) return idle();
      if (opened) return scheduleRetry(my);
      setState("offline");
      deps
        .probe(probeUrl(deps.location, z, visit))
        .catch(() => null)
        .then((status) => {
          if (my !== gen || stopped) return;
          if (status === 401 || status === 403) forbidden();
          else scheduleRetry(my);
        });
    };
  };

  return {
    connect(z, s, v) {
      teardown();
      zone = z;
      spawn = s;
      visit = v;
      attempt = 0;
      queue = [];
      stopped = false;
      open();
    },
    send(msg: ClientMsg) {
      const data = encode(msg);
      if (ws && ws.readyState === OPEN) {
        rawSend(ws, data);
        return;
      }
      if (stopped || msg.t === "ping") return;
      queue.push(data);
      if (queue.length > QUEUE_MAX) queue.shift();
    },
    close() {
      stopped = true;
      teardown();
      queue = [];
      setState("offline");
    },
    rtt: () => clock.rtt(),
    clockOffset: () => clock.offset(),
  };
}

async function httpProbe(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    return res.status;
  } catch {
    return null;
  }
}

export const createConnection: CreateConnection = (opts) =>
  createConnectionWith(opts, {
    WebSocket: globalThis.WebSocket as unknown as ConnectionDeps["WebSocket"],
    location: globalThis.location,
    now: () => Date.now(),
    rand: Math.random,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (t) => globalThis.clearTimeout(t),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (t) => globalThis.clearInterval(t),
    probe: httpProbe,
  });
