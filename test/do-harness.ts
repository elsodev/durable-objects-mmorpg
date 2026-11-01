// Runs real HomeRoom Durable Objects in Node: fake storage, fake hibernatable sockets, a fake
// WebSocketPair and a HOME namespace that hands out one room per name. Use with vi.useFakeTimers()
// so Date.now and the tick interval are under the test's control.
import { HomeRoom } from "../src/worker/home";
import { H_GUEST, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME, H_ZONE } from "../src/worker/env";

export class FakeWs {
  sent: any[] = [];
  closed: { code: number; reason: string } | null = null;
  private att: unknown = null;
  send(data: string): void {
    if (this.closed) throw new Error("closed");
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = ""): void {
    this.closed ??= { code, reason };
  }
  accept(): void {}
  serializeAttachment(a: unknown): void {
    this.att = structuredClone(a);
  }
  deserializeAttachment(): unknown {
    return this.att;
  }
  /** Messages of one type sent to this socket's client. */
  of(t: string): any[] {
    return this.sent.filter((m) => m.t === t);
  }
  last(t: string): any {
    return this.of(t).at(-1);
  }
}

class FakeStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get(keys: string | string[]): Promise<any> {
    if (Array.isArray(keys)) {
      const out = new Map<string, unknown>();
      for (const k of keys) if (this.data.has(k)) out.set(k, structuredClone(this.data.get(k)));
      return out;
    }
    return structuredClone(this.data.get(keys));
  }
  async put(k: string | Record<string, unknown>, v?: unknown): Promise<void> {
    if (typeof k === "string") this.data.set(k, structuredClone(v));
    else for (const [key, val] of Object.entries(k)) this.data.set(key, structuredClone(val));
  }
  async delete(k: string): Promise<boolean> {
    return this.data.delete(k);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
  async setAlarm(t: number): Promise<void> {
    this.alarm = t;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

export class FakeCtx {
  storage = new FakeStorage();
  sockets: FakeWs[] = [];
  ready: Promise<unknown> = Promise.resolve();
  blockConcurrencyWhile(fn: () => Promise<unknown>): Promise<unknown> {
    this.ready = fn();
    return this.ready;
  }
  acceptWebSocket(ws: FakeWs): void {
    this.sockets.push(ws);
  }
  getWebSockets(): FakeWs[] {
    return this.sockets.filter((w) => !w.closed);
  }
}

let installed = false;
/** WebSocketPair and a Response that accepts status 101, as the Workers runtime has. */
export function installWorkersGlobals(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as any;
  g.WebSocketPair = class {
    0 = new FakeWs();
    1 = new FakeWs();
  };
  const Base: typeof Response = g.Response;
  g.Response = class extends Base {
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
      if (init?.status === 101) {
        super(null, { status: 200 });
        Object.defineProperty(this, "status", { value: 101 });
        Object.defineProperty(this, "webSocket", { value: init.webSocket });
      } else {
        super(body, init);
      }
    }
  };
}

export interface Rooms {
  env: any;
  ns: { idFromName(n: string): any; get(id: any): HomeRoom };
  /** The room behind a proxy that waits for its constructor and records method calls. */
  room(userId: string): HomeRoom;
  ctx(userId: string): FakeCtx;
  /** Calls between rooms that the test wants to see (method names), in order. */
  calls: { room: string; method: string }[];
}

/** One HomeRoom per userId, created on first use; every RPC call is recorded in `calls`. */
export function createRooms(extraEnv: Record<string, unknown> = {}): Rooms {
  installWorkersGlobals();
  const rooms = new Map<string, { room: HomeRoom; ctx: FakeCtx; proxy: HomeRoom }>();
  const calls: Rooms["calls"] = [];
  const env: any = { DMMO_ENV: "local", BETTER_AUTH_URL: "http://localhost:8787", ...extraEnv };
  const make = (name: string) => {
    let r = rooms.get(name);
    if (!r) {
      const ctx = new FakeCtx();
      const room = new HomeRoom(ctx as any, env);
      const proxy = new Proxy(room, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (typeof v !== "function") return v;
          // Like the runtime, nothing reaches the object before its constructor's blockConcurrencyWhile is done.
          return (...args: unknown[]) => {
            calls.push({ room: name, method: String(prop) });
            return ctx.ready.then(() => v.apply(target, args));
          };
        },
      });
      r = { room, ctx, proxy };
      rooms.set(name, r);
    }
    return r;
  };
  const ns = { idFromName: (n: string) => ({ name: n }), get: (id: { name: string }) => make(id.name).proxy };
  env.HOME = ns;
  return { env, ns, room: (u) => make(u).proxy, ctx: (u) => make(u).ctx, calls };
}

export function wsRequest(url: string, headers: Record<string, string>): Request {
  return new Request(url, { headers: { upgrade: "websocket", ...headers } });
}

/** Connects the owner to their own home (as the Worker's /ws/home route would) and returns the server socket. */
export async function connectOwner(r: Rooms, userId: string, name: string, opts: { guest?: boolean } = {}): Promise<FakeWs> {
  const room = r.room(userId);
  const res = await room.fetch(
    wsRequest("http://localhost:8787/ws/home", {
      [H_USER_ID]: userId,
      [H_USER_NAME]: name,
      [H_ZONE]: "home",
      [H_SPAWN]: "default",
      [H_GUEST]: opts.guest ? "1" : "0",
      [H_SESSION]: `s-${userId}`,
    }),
  );
  if (res.status !== 101) throw new Error(`owner connect failed: ${res.status}`);
  return r.ctx(userId).sockets.at(-1)!;
}

/** Sends a client frame on a server-side socket. */
export async function sendMsg(r: Rooms, owner: string, ws: FakeWs, msg: unknown): Promise<void> {
  await r.room(owner).webSocketMessage(ws as any, JSON.stringify(msg));
}
