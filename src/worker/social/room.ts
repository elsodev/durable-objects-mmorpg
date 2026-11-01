// SocialRoom Durable Object: one global instance (idFromName("global")) behind /ws/social.
// World chat (last 50 lines kept for new joiners), whispers by name, presence (who is online and
// in which zone), server-wide "today" stats, and delivery of payloads from other Durable Objects.
// Guests may connect and read world chat but not send world chat or whispers.
//
// RPC for other Durable Objects: presence(), recordStat(), notify(), presenceOf(), closeSession().
// Subclass hook: onPresenceChange() fires when a user comes online, goes offline or changes zone.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import type { ZoneId } from "../../shared/types";
import {
  decodeSocialClient,
  type PresenceView,
  type SocialClientMsg,
  type SocialServerMsg,
  type SocialStats,
  type WorldLine,
} from "../../shared/social";
import { cleanChat } from "../../shared/validate";
import { cleanName, readIdentity } from "../game/identity";
import { ChatGuards } from "../game/chat";
import { CLOSE_ABUSE, SocketLimiter } from "../game/rateLimit";
import { CLOSE_SESSION_ENDED, recheckDue, sessionStillValid } from "../game/session";
import { isZoneId } from "../game/sanitize";
import { stripControls } from "../npc/text";
import { Presence } from "./presence";
import { DailyStats } from "./stats";
import { friendIds } from "../friends/store";
import { mutedIds } from "../mutes/store";
import { MUTES_NOTICE } from "../../shared/players";

/** Friend lists are cached briefly so a burst of zone changes costs one D1 query. */
const FRIEND_CACHE_MS = 60_000;

export const HISTORY_MAX = 50;
export const MAX_NOTIFY_BYTES = 2048;
const MAX_PRESENCE_QUERY = 200;
const GUEST_TEXT = "Create an account to chat with everyone.";

interface SocialAttachment {
  connId: string;
  userId: string;
  name: string;
  guest: boolean;
  sid: string | null;
  /** Zone a ZoneRoom/HomeRoom reported, so presence survives hibernation. */
  zone: ZoneId | null;
  /** Zone the client claimed (fallback only). */
  czone: ZoneId | null;
}

interface Conn {
  ws: WebSocket;
  att: SocialAttachment;
  limiter: SocketLimiter;
  authCheckedAt: number;
}

function send(ws: WebSocket, msg: SocialServerMsg): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // closing
  }
}

function readAtt(ws: WebSocket): SocialAttachment | null {
  try {
    const a = ws.deserializeAttachment() as SocialAttachment | null;
    return a && typeof a.userId === "string" && typeof a.connId === "string" ? a : null;
  } catch {
    return null;
  }
}

export class SocialRoom extends DurableObject<Env> {
  private presenceState = new Presence();
  private conns = new Map<string, Conn>();
  private byWs = new Map<WebSocket, string>();
  private guards = new ChatGuards();
  private history: WorldLine[] = [];
  private stats = DailyStats.from(null, Date.now());
  private friendCache = new Map<string, { at: number; ids: string[] }>();
  /** Who each recipient muted, cached like friend lists; a { t: "mutes" } notify drops the entry. */
  private muteCache = new Map<string, { at: number; ids: Set<string> }>();
  /** Name of each online user, kept until their offline push has gone out. */
  private lastNames = new Map<string, string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Client keepalives are answered without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong","at":0}'));
    ctx.blockConcurrencyWhile(async () => {
      const [history, stats, mutes] = await Promise.all([
        ctx.storage.get<WorldLine[]>("history"),
        ctx.storage.get("stats"),
        ctx.storage.list<number>({ prefix: "mute:" }),
      ]);
      this.history = Array.isArray(history) ? history.slice(-HISTORY_MAX) : [];
      this.stats = DailyStats.from(stats, Date.now());
      const now = Date.now();
      for (const [k, until] of mutes) {
        if (typeof until === "number" && until > now) this.guards.get(k.slice(5), now).muteUntil(until);
        else void ctx.storage.delete(k);
      }
      // Woken from hibernation: rebuild presence from the sockets that survived.
      for (const ws of ctx.getWebSockets()) {
        const att = readAtt(ws);
        if (!att) {
          ws.close(1011, "reconnect");
          continue;
        }
        this.addConn(ws, att, 0);
        if (att.zone) this.presenceState.setServerZone(att.userId, att.zone, true, now);
        if (att.czone) this.presenceState.setClientZone(att.userId, att.czone, now);
      }
    });
  }

  /**
   * Called after a user's online state or zone changes. Tells their online friends
   * ({ t: "social", payload: { t: "presence", name, online, zone } }) so open Friends panels refresh.
   * Non-friends never get this. Async on purpose: the D1 lookup must not hold up the socket event.
   */
  protected onPresenceChange(userId: string, online: boolean, zone: ZoneId | null): void {
    const name = this.lastNames.get(userId) ?? null;
    if (!online) this.lastNames.delete(userId);
    void this.friendsOf(userId)
      .then((ids) => {
        for (const id of ids) {
          if (!this.presenceState.hasSocket(id)) continue;
          this.sendUser(id, { t: "social", payload: { t: "presence", name, online, zone: online ? zone : null } });
        }
      })
      .catch((err) => console.warn("presence push failed", err));
  }

  private async friendsOf(userId: string): Promise<string[]> {
    const now = Date.now();
    const hit = this.friendCache.get(userId);
    if (hit && now - hit.at < FRIEND_CACHE_MS) return hit.ids;
    if (this.friendCache.size > 2000) this.friendCache.clear();
    const ids = await friendIds(this.env.DB, userId);
    this.friendCache.set(userId, { at: now, ids });
    return ids;
  }

  /** Ids `userId` muted. On a D1 failure nobody reads as muted (a whisper is better than a lost one). */
  protected async mutedBy(userId: string): Promise<Set<string>> {
    const now = Date.now();
    const hit = this.muteCache.get(userId);
    if (hit && now - hit.at < FRIEND_CACHE_MS) return hit.ids;
    if (this.muteCache.size > 2000) this.muteCache.clear();
    let ids: Set<string>;
    try {
      ids = new Set(await mutedIds(this.env.DB, userId));
    } catch (err) {
      console.warn("mute lookup failed", err);
      return new Set();
    }
    this.muteCache.set(userId, { at: now, ids });
    return ids;
  }

  // ------------------------------------------------------------------ connect

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const id = readIdentity(request);
    if (!id) return new Response("Unauthorized", { status: 401 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    const att: SocialAttachment = {
      connId: crypto.randomUUID(),
      userId: id.userId,
      name: cleanName(id.name),
      guest: id.guest,
      sid: id.sessionId,
      zone: this.presenceState.serverZoneOf(id.userId),
      czone: null,
    };
    server.serializeAttachment(att);
    const cameOnline = this.addConn(server, att, now);
    send(server, { t: "hello", name: att.name, guest: att.guest, history: this.history });
    send(server, { t: "stats", ...this.statsView(now) });
    if (cameOnline) this.changed(att.userId);
    return new Response(null, { status: 101, webSocket: client });
  }

  private addConn(ws: WebSocket, att: SocialAttachment, authCheckedAt: number): boolean {
    this.conns.set(att.connId, { ws, att, limiter: new SocketLimiter(Date.now()), authCheckedAt });
    this.byWs.set(ws, att.connId);
    this.lastNames.set(att.userId, att.name);
    return this.presenceState.connect(att.connId, { userId: att.userId, name: att.name, guest: att.guest });
  }

  private dropConn(ws: WebSocket): void {
    const connId = this.byWs.get(ws);
    if (!connId) return;
    this.byWs.delete(ws);
    this.conns.delete(connId);
    const r = this.presenceState.disconnect(connId);
    if (r?.wentOffline) this.changed(r.userId);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.dropConn(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropConn(ws);
  }

  private kick(c: Conn, code: number, reason: string): void {
    send(c.ws, { t: "notice", text: reason, kind: "error" });
    try {
      c.ws.close(code, reason);
    } catch {
      // already closed
    }
    this.dropConn(c.ws);
  }

  // ------------------------------------------------------------------ messages

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const connId = this.byWs.get(ws);
    const c = connId ? this.conns.get(connId) : undefined;
    if (!c || typeof message !== "string") return;
    const now = Date.now();
    const verdict = c.limiter.check(now);
    if (verdict === "close") return this.kick(c, CLOSE_ABUSE, "Too many messages.");
    if (verdict !== "ok") return;
    const msg = decodeSocialClient(message);
    if (!msg) return;
    this.maybeRecheckSession(c, now);
    this.handle(c, msg, now);
  }

  private maybeRecheckSession(c: Conn, now: number): void {
    if (!c.att.sid || !recheckDue(c.authCheckedAt, now)) return;
    c.authCheckedAt = now;
    void sessionStillValid(this.env, c.att.sid, c.att.userId, now).then((ok) => {
      if (!ok && this.conns.get(c.att.connId) === c) this.kick(c, CLOSE_SESSION_ENDED, "Your session ended. Please sign in again.");
    });
  }

  private handle(c: Conn, msg: SocialClientMsg, now: number): void {
    switch (msg.t) {
      case "world":
        return this.onWorld(c, msg.text, now);
      case "pm":
        return this.onPm(c, msg.to, msg.text, now);
      case "here":
        if (this.presenceState.setClientZone(c.att.userId, msg.zone, now)) {
          this.saveZones(c.att.userId);
          this.changed(c.att.userId);
        } else this.saveZones(c.att.userId);
        return;
      case "stats":
        return send(c.ws, { t: "stats", ...this.statsView(now) });
      case "ping":
        return send(c.ws, { t: "pong", at: msg.at });
    }
  }

  /** Shared rate limit + mute for world chat and whispers. Returns the clean text or null. */
  private guardText(c: Conn, raw: string, now: number): string | null {
    if (c.att.guest) {
      send(c.ws, { t: "notice", text: GUEST_TEXT, kind: "error" });
      return null;
    }
    const text = cleanChat(stripControls(raw));
    if (!text) return null;
    const guard = this.guards.get(c.att.userId, now);
    const verdict = guard.check(text, now);
    if (verdict === "tooFast") {
      send(c.ws, { t: "notice", text: "Slow down a little.", kind: "error" });
      return null;
    }
    if (verdict === "muted") {
      const ms = guard.mutedFor(now);
      void this.ctx.storage.put(`mute:${c.att.userId}`, now + ms);
      send(c.ws, { t: "notice", text: `You are muted for ${Math.ceil(ms / 1000)}s (repeating yourself).`, kind: "error" });
      return null;
    }
    return text;
  }

  private onWorld(c: Conn, raw: string, now: number): void {
    const text = this.guardText(c, raw, now);
    if (!text) return;
    const line: WorldLine = { name: c.att.name, text, at: now };
    this.history.push(line);
    if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    void this.ctx.storage.put("history", this.history);
    const frame = JSON.stringify({ t: "world", ...line } satisfies SocialServerMsg);
    for (const other of this.conns.values()) {
      try {
        other.ws.send(frame);
      } catch {
        // closing
      }
    }
  }

  private onPm(c: Conn, to: string, raw: string, now: number): void {
    if (c.att.guest) return send(c.ws, { t: "notice", text: GUEST_TEXT, kind: "error" });
    const target = this.presenceState.findByName(to);
    if (!target) return send(c.ws, { t: "notice", text: `${to} isn't online.`, kind: "error" });
    if (target.userId === c.att.userId) return send(c.ws, { t: "notice", text: "You can't whisper to yourself.", kind: "error" });
    if (target.guest) return send(c.ws, { t: "notice", text: `${target.name} is a guest and can't receive whispers.`, kind: "error" });
    const text = this.guardText(c, raw, now);
    if (!text) return;
    // Mute is silent: the sender always sees their line go out; a muted sender's never arrives.
    this.sendUser(c.att.userId, { t: "pm", dir: "out", name: target.name, text, at: now });
    const from = c.att.userId;
    return void this.mutedBy(target.userId).then((muted) => {
      if (!muted.has(from)) this.sendUser(target.userId, { t: "pm", dir: "in", name: c.att.name, text, at: now });
    });
  }

  private sendUser(userId: string, msg: SocialServerMsg): number {
    let n = 0;
    for (const connId of this.presenceState.connsOf(userId)) {
      const c = this.conns.get(connId);
      if (!c) continue;
      send(c.ws, msg);
      n++;
    }
    return n;
  }

  /** Writes the user's zones into their sockets' attachments so a hibernation wake keeps them. */
  private saveZones(userId: string): void {
    const zone = this.presenceState.serverZoneOf(userId);
    for (const connId of this.presenceState.connsOf(userId)) {
      const c = this.conns.get(connId);
      if (!c) continue;
      c.att.zone = zone;
      if (!zone) c.att.czone = this.presenceState.zoneOf(userId);
      try {
        c.ws.serializeAttachment(c.att);
      } catch {
        // closing
      }
    }
  }

  private changed(userId: string): void {
    try {
      this.onPresenceChange(userId, this.presenceState.isOnline(userId), this.presenceState.zoneOf(userId));
    } catch (err) {
      console.error("onPresenceChange failed", err);
    }
  }

  private statsView(now: number): SocialStats {
    this.presenceState.prune(now);
    const { online, zones } = this.presenceState.counts();
    const snap = this.stats.snapshot(now);
    return { online, zones, today: snap.counts, day: snap.day };
  }

  // ------------------------------------------------------------------ RPC

  /** RPC (ZoneRoom/HomeRoom): `userId` joined (here) or left `zone`. */
  async presence(userId: string, zone: ZoneId, here: boolean): Promise<void> {
    if (typeof userId !== "string" || !userId || userId.length > 128 || !isZoneId(zone)) return;
    const changed = this.presenceState.setServerZone(userId, zone, here === true, Date.now());
    this.saveZones(userId);
    if (changed) this.changed(userId);
  }

  /** RPC: add `n` to today's server-wide counter `key` ([a-z][a-z0-9_]*, n 1..10000). */
  async recordStat(key: string, n: number): Promise<boolean> {
    const ok = this.stats.record(key, n, Date.now());
    if (ok) void this.ctx.storage.put("stats", this.stats.toJSON());
    return ok;
  }

  /**
   * RPC: deliver `payload` ({ t: string, ... }, JSON <= 2 KB) to the user's social sockets as
   * { t: "social", payload }. Returns how many sockets got it (0 = offline).
   */
  async notify(userId: string, payload: unknown): Promise<number> {
    if (typeof userId !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
    const p = payload as { t?: unknown };
    if (typeof p.t !== "string" || p.t.length === 0 || p.t.length > 32) return 0;
    let json: string;
    try {
      json = JSON.stringify(payload);
    } catch {
      return 0;
    }
    if (json.length > MAX_NOTIFY_BYTES) return 0;
    // A friendship was made or removed: cached friend lists for presence pushes are stale.
    if (p.t === "friendAccepted" || p.t === "friendRemoved") this.friendCache.clear();
    // The user changed their mute list (only ever sent to the muter).
    if (p.t === MUTES_NOTICE) this.muteCache.delete(userId);
    return this.sendUser(userId, { t: "social", payload: JSON.parse(json) });
  }

  /** RPC: online state and zone name (never a position) for up to 200 users. */
  async presenceOf(userIds: string[]): Promise<PresenceView[]> {
    if (!Array.isArray(userIds)) return [];
    return userIds
      .filter((id): id is string => typeof id === "string")
      .slice(0, MAX_PRESENCE_QUERY)
      .map((userId) => {
        const online = this.presenceState.isOnline(userId);
        return { userId, online, zone: online ? this.presenceState.zoneOf(userId) : null };
      });
  }

  /** RPC (sign-out hook): close this session's social sockets. */
  async closeSession(userId: string, sessionId: string): Promise<void> {
    if (!sessionId) return;
    for (const c of [...this.conns.values()]) {
      if (c.att.userId === userId && c.att.sid === sessionId) this.kick(c, CLOSE_SESSION_ENDED, "You signed out.");
    }
  }
}
