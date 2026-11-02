// SocialRoom Durable Object: one global instance (idFromName("global")) behind /ws/social.
// World chat (last 50 lines kept for new joiners), whispers by name, presence (who is online and
// in which zone), server-wide "today" stats, and delivery of payloads from other Durable Objects.
// Guests may connect and read world chat but not send world chat or whispers.
//
// RPC for other Durable Objects: presence(), recordStat(), notify(), presenceOf(), closeSession(),
// and the village notice board (noticeList/Post/Vote/Delete; see noticeDesk.ts for why it lives here).
// Admin tools (adminDesk.ts): /shout, /kick, /unban, /jail, /unjail from admin sockets, and banCheck() for the Worker.
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
import { isNoticeId, isNoticePress, type NoticePress } from "../../shared/notices";
import { NoticeDesk, type BoardAnswer, type DeskHost } from "./noticeDesk";
import { AdminDesk, type AdminActor, type AdminHost, type UserInfo } from "./adminDesk";
import { BanBook, cleanIp, type BanVerdict } from "./bans";
import { CLOSE_REMOVED, type Shout } from "../../shared/admin";
import { isAdminEmail } from "../admin/config";
import { jailInZones, removeFromGame, unjailInZones } from "../admin/disconnect";

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
  /** Notice board open until (ms): live board updates go to this socket. */
  board?: number;
  /** From the Worker's x-dmmo-admin header only. */
  admin?: boolean;
  /** Client IP the Worker forwarded (kept to ban the address if this player is kicked). */
  ip?: string;
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
  private desk!: NoticeDesk;
  private bans!: BanBook;
  private admin!: AdminDesk;

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
      this.desk = await NoticeDesk.load(this.deskHost());
      this.bans = new BanBook(ctx.storage);
      this.admin = new AdminDesk(this.adminHost());
      await this.admin.load();
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
      ...(id.admin ? { admin: true } : {}),
      ...(cleanIp(id.ip) ? { ip: cleanIp(id.ip)! } : {}),
    };
    server.serializeAttachment(att);
    const cameOnline = this.addConn(server, att, now);
    const shout = this.admin.current(now);
    send(server, {
      t: "hello",
      name: att.name,
      guest: att.guest,
      history: this.history,
      ...(att.admin ? { admin: true as const } : {}),
      ...(shout ? { shout } : {}),
    });
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
      case "shout": {
        const r = this.admin.shout(this.actor(c), msg.text, now, crypto.randomUUID());
        if (!r.ok) send(c.ws, { t: "notice", text: r.text, kind: "error" });
        return;
      }
      case "kick":
        return void this.answerAdmin(c, this.admin.kick(this.actor(c), msg.name, msg.reason, now));
      case "unban":
        return void this.answerAdmin(c, this.admin.unban(this.actor(c), msg.name, now));
      case "jail":
        return void this.answerAdmin(c, this.admin.jail(this.actor(c), msg.name, msg.minutes, now));
      case "unjail":
        return void this.answerAdmin(c, this.admin.unjail(this.actor(c), msg.name, now));
    }
  }

  private actor(c: Conn): AdminActor {
    return { userId: c.att.userId, name: c.att.name, admin: c.att.admin === true && !c.att.guest };
  }

  private async answerAdmin(c: Conn, pending: Promise<{ ok: boolean; text: string }>): Promise<void> {
    let r: { ok: boolean; text: string };
    try {
      r = await pending;
    } catch (err) {
      console.error("admin action failed", err);
      r = { ok: false, text: "That didn't work. Try again in a moment." };
    }
    send(c.ws, { t: "notice", text: r.text, kind: r.ok ? "info" : "error" });
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

  // ------------------------------------------------------------------ admin

  private adminHost(): AdminHost {
    const db = () => this.env.DB;
    const toInfo = (r: { id: unknown; name: unknown; email: unknown; isAnonymous: unknown } | null): UserInfo | null =>
      r && typeof r.id === "string"
        ? {
            userId: r.id,
            name: cleanName(r.name),
            email: typeof r.email === "string" ? r.email : null,
            guest: r.isAnonymous === 1 || r.isAnonymous === true,
          }
        : null;
    type Row = { id: unknown; name: unknown; email: unknown; isAnonymous: unknown };
    return {
      bans: this.bans,
      storage: { get: (k) => this.ctx.storage.get(k), put: (k, v) => this.ctx.storage.put(k, v) },
      broadcast: (shout: Shout) => {
        const frame = JSON.stringify({ t: "shout", ...shout } satisfies SocialServerMsg);
        for (const c of this.conns.values()) {
          try {
            c.ws.send(frame);
          } catch {
            // closing
          }
        }
      },
      online: (name) => {
        const hit = this.presenceState.findByName(name);
        return hit ? { userId: hit.userId, name: hit.name } : null;
      },
      // Accounts first, then guests: names are unique among accounts (0006_unique_names.sql).
      userByName: async (name) =>
        toInfo(
          await db()
            .prepare(`SELECT id, name, email, isAnonymous FROM "user" WHERE name = ?1 COLLATE NOCASE ORDER BY COALESCE(isAnonymous, 0), createdAt LIMIT 1`)
            .bind(name)
            .first<Row>(),
        ),
      userById: async (userId) =>
        toInfo(await db().prepare(`SELECT id, name, email, isAnonymous FROM "user" WHERE id = ?`).bind(userId).first<Row>()),
      isAdminEmail: (email) => isAdminEmail(this.env, email),
      socketIps: (userId) =>
        this.presenceState
          .connsOf(userId)
          .map((id) => this.conns.get(id)?.att.ip)
          .filter((ip): ip is string => typeof ip === "string"),
      sessionIps: async (userId) => {
        try {
          const rows = await db()
            .prepare(`SELECT ipAddress FROM "session" WHERE userId = ? AND ipAddress IS NOT NULL ORDER BY updatedAt DESC LIMIT 3`)
            .bind(userId)
            .all<{ ipAddress: unknown }>();
          return (rows.results ?? []).map((r) => r.ipAddress).filter((ip): ip is string => typeof ip === "string");
        } catch {
          return [];
        }
      },
      remove: (userId, text) => {
        for (const connId of this.presenceState.connsOf(userId)) {
          const c = this.conns.get(connId);
          if (!c) continue;
          send(c.ws, { t: "removed", text });
          try {
            c.ws.close(CLOSE_REMOVED, text);
          } catch {
            // already closed
          }
          this.dropConn(c.ws);
        }
        void removeFromGame(this.env, userId, text).catch((err) => console.error("remove from game failed", err));
      },
      log: (line) => console.log(line),
      jail: async (userId, until, text) => {
        const r = await this.env.HOME.get(this.env.HOME.idFromName(userId)).jail(userId, until, text);
        if (r.ok) void jailInZones(this.env, userId, until, text).catch((err) => console.error("jail in zones failed", err));
        return r;
      },
      unjail: async (userId) => {
        const r = await this.env.HOME.get(this.env.HOME.idFromName(userId)).unjail(userId);
        void unjailInZones(this.env, userId).catch((err) => console.error("unjail in zones failed", err));
        return r.ok;
      },
    };
  }

  /** RPC (Worker): is this account, browser cookie's account or address removed? */
  async banCheck(userId: string | null, ip: string | null, cookieUser: string | null): Promise<BanVerdict> {
    const id = validUser(userId) ? userId : null;
    const cookie = validUser(cookieUser) ? cookieUser : null;
    return this.bans.check(id, typeof ip === "string" ? ip : null, cookie, Date.now());
  }

  // ------------------------------------------------------------------ notice board

  private deskHost(): DeskHost {
    return {
      storage: this.ctx.storage,
      mutedBy: (userId) => this.mutedBy(userId),
      watch: (userId, until) => {
        for (const connId of this.presenceState.connsOf(userId)) {
          const c = this.conns.get(connId);
          if (!c) continue;
          c.att.board = until;
          try {
            c.ws.serializeAttachment(c.att);
          } catch {
            // closing
          }
        }
      },
      watchers: (now) => [...new Set([...this.conns.values()].filter((c) => (c.att.board ?? 0) > now).map((c) => c.att.userId))],
      push: (userId, payload) => void this.sendUser(userId, { t: "social", payload }),
      isGuest: (userId) => [...this.presenceState.connsOf(userId)].some((id) => this.conns.get(id)?.att.guest === true),
      chatMuted: (userId, now) => this.guards.get(userId, now).mutedFor(now) > 0,
    };
  }

  /** RPC (ZoneRoom): the board as `userId` sees it; they get live updates for a while. */
  async noticeList(userId: string): Promise<BoardAnswer> {
    if (!validUser(userId)) return { ok: false, posts: [] };
    return this.desk.list(userId, Date.now());
  }

  /** RPC (ZoneRoom, after taking the coins): pin a notice. `req` makes a retry idempotent. */
  async noticePost(userId: string, name: string, text: string, req: string): Promise<BoardAnswer> {
    if (!validUser(userId) || typeof text !== "string" || typeof req !== "string") return { ok: false, posts: [] };
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    return this.desk.post(userId, cleanName(String(name)), text, id, req.slice(0, 64), Date.now());
  }

  /** RPC (ZoneRoom): like or dislike (again: take it back). */
  async noticeVote(userId: string, id: string, press: NoticePress): Promise<BoardAnswer> {
    if (!validUser(userId) || !isNoticeId(id) || !isNoticePress(press)) return { ok: false, posts: [] };
    return this.desk.vote(userId, id, press, Date.now());
  }

  /** RPC (ZoneRoom): the author takes their notice down. */
  async noticeDelete(userId: string, id: string): Promise<BoardAnswer> {
    if (!validUser(userId) || !isNoticeId(id)) return { ok: false, posts: [] };
    return this.desk.remove(userId, id, Date.now());
  }

  /** RPC (sign-out hook): close this session's social sockets. */
  async closeSession(userId: string, sessionId: string): Promise<void> {
    if (!sessionId) return;
    for (const c of [...this.conns.values()]) {
      if (c.att.userId === userId && c.att.sid === sessionId) this.kick(c, CLOSE_SESSION_ENDED, "You signed out.");
    }
  }
}

function validUser(userId: unknown): userId is string {
  return typeof userId === "string" && userId.length > 0 && userId.length <= 128;
}
