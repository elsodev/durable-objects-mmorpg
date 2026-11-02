// Second WebSocket to the global SocialRoom (/ws/social): world chat, whispers, presence, stats.
// Independent of the zone socket: it stays open across zone changes and reconnects with backoff.
import { decodeSocialServer, type SocialClientMsg, type SocialServerMsg } from "../../shared/social";
import { backoffDelay } from "./backoff";
import { CLOSE_REMOVED } from "../../shared/admin";
import type { WsLike } from "./connection";

type Timer = ReturnType<typeof setTimeout>;

export interface SocialDeps {
  WebSocket: new (url: string) => WsLike;
  location: { protocol: string; host: string };
  rand(): number;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(t: Timer): void;
  setInterval(fn: () => void, ms: number): Timer;
  clearInterval(t: Timer): void;
}

export interface SocialConnection {
  start(): void;
  /** Dropped while offline (chat is not queued: a stale world line is worse than none). */
  send(msg: SocialClientMsg): boolean;
  online(): boolean;
  close(): void;
}

const OPEN = 1;
/** SocialRoom answers this exact frame without waking (setWebSocketAutoResponse). */
export const KEEPALIVE = '{"t":"ping"}';
const KEEPALIVE_MS = 30_000;
/** Session ended / signed out: stop instead of retrying. */
const SESSION_CLOSE = 4401;

export function socialUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws/social`;
}

export function createSocialConnectionWith(
  opts: { onMessage(msg: SocialServerMsg): void; onState?(online: boolean): void; onRemoved?(): void },
  deps: SocialDeps,
): SocialConnection {
  let ws: WsLike | null = null;
  let stopped = true;
  let attempt = 0;
  let retry: Timer | null = null;
  let keepalive: Timer | null = null;
  let isOpen = false;

  const setOpen = (v: boolean) => {
    if (v === isOpen) return;
    isOpen = v;
    opts.onState?.(v);
  };

  const clearTimers = () => {
    if (retry !== null) deps.clearTimeout(retry);
    if (keepalive !== null) deps.clearInterval(keepalive);
    retry = keepalive = null;
  };

  const open = () => {
    if (stopped) return;
    let sock: WsLike;
    try {
      sock = new deps.WebSocket(socialUrl(deps.location));
    } catch {
      return schedule();
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      attempt = 0;
      setOpen(true);
      keepalive = deps.setInterval(() => {
        if (sock.readyState === OPEN) sock.send(KEEPALIVE);
      }, KEEPALIVE_MS);
    };
    sock.onmessage = (ev) => {
      if (ws !== sock || typeof ev.data !== "string") return;
      const msg = decodeSocialServer(ev.data);
      if (msg) opts.onMessage(msg);
    };
    sock.onerror = () => {};
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      if (keepalive !== null) deps.clearInterval(keepalive);
      keepalive = null;
      setOpen(false);
      if (ev.code === SESSION_CLOSE) {
        stopped = true;
        return;
      }
      if (ev.code === CLOSE_REMOVED) {
        stopped = true;
        opts.onRemoved?.();
        return;
      }
      schedule();
    };
  };

  const schedule = () => {
    if (stopped) return;
    retry = deps.setTimeout(() => {
      retry = null;
      open();
    }, backoffDelay(attempt++, deps.rand, { baseMs: 1000, maxMs: 15_000 }));
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      open();
    },
    send(msg) {
      if (!ws || ws.readyState !== OPEN) return false;
      try {
        ws.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    },
    online: () => isOpen,
    close() {
      stopped = true;
      clearTimers();
      const old = ws;
      ws = null;
      setOpen(false);
      if (old) {
        old.onopen = old.onclose = old.onmessage = old.onerror = null;
        try {
          old.close(1000, "client");
        } catch {
          // closing
        }
      }
    },
  };
}

export function createSocialConnection(opts: Parameters<typeof createSocialConnectionWith>[0]): SocialConnection {
  return createSocialConnectionWith(opts, {
    WebSocket: globalThis.WebSocket as unknown as SocialDeps["WebSocket"],
    location: globalThis.location,
    rand: Math.random,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (t) => globalThis.clearTimeout(t),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (t) => globalThis.clearInterval(t),
  });
}
