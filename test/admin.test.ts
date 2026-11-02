import { describe, expect, it, vi } from "vitest";
import { adminEmails, isAdminEmail, isAdminUser, parseAdminEmails } from "../src/worker/admin/config";
import { BAN_COOKIE, banCookieHeader, readCookie, signBanCookie, verifyBanCookie } from "../src/worker/admin/cookie";
import { banGate, bodyEmail, clientIp, SIGN_IN_ENDPOINTS } from "../src/worker/admin/gate";
import { BanBook, cleanIp, IP_BAN_MS, type BanStorage } from "../src/worker/social/bans";
import { AdminDesk, type AdminHost, type UserInfo } from "../src/worker/social/adminDesk";
import { setAdminAndIp, stripIdentityHeaders } from "../src/worker/http/util";
import { forwardSocialWs } from "../src/worker/http/social-route";
import { forwardWs } from "../src/worker/http/ws";
import { H_ADMIN, H_IP } from "../src/worker/env";
import { readIdentity } from "../src/worker/game/identity";
import { snapshotEntity } from "../src/worker/game/diff";
import {
  CLOSE_REMOVED,
  HTTP_REMOVED,
  REMOVED_TEXT,
  SHOUT_LATE_JOIN_MS,
  SHOUT_MAX_LEN,
  SHOUT_MIN_INTERVAL_MS,
  cleanShout,
  parseAdminCommand,
  readShout,
  shoutIsFresh,
  type Shout,
} from "../src/shared/admin";
import { decodeSocialClient } from "../src/shared/social";
import type { AuthUser } from "../src/worker/auth";

const SECRET = "x".repeat(40);
const T0 = Date.UTC(2026, 10, 2, 12);

// ------------------------------------------------------------------ config

describe("admin emails", () => {
  it("parses comma-separated lists case-insensitively and drops junk", () => {
    expect([...parseAdminEmails(" ET@Example.com, b@x.io ,, not-an-email ;c@y.dev")]).toEqual(["et@example.com", "b@x.io", "c@y.dev"]);
    expect(parseAdminEmails(undefined, null, "").size).toBe(0);
  });

  it("reads ADMIN_EMAILS and the singular ADMIN_EMAIL", () => {
    const env = { ADMIN_EMAILS: "a@x.com", ADMIN_EMAIL: "B@x.com" };
    expect([...adminEmails(env)].sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(isAdminEmail(env, "A@X.COM")).toBe(true);
    expect(isAdminEmail(env, " b@x.com ")).toBe(true);
    expect(isAdminEmail(env, "c@x.com")).toBe(false);
    expect(isAdminEmail({}, "a@x.com")).toBe(false);
    expect(isAdminEmail(env, null)).toBe(false);
  });

  it("never makes a guest an admin", () => {
    const env = { ADMIN_EMAILS: "a@x.com" };
    expect(isAdminUser(env, { email: "a@x.com", isGuest: false })).toBe(true);
    expect(isAdminUser(env, { email: "a@x.com", isGuest: true })).toBe(false);
    expect(isAdminUser(env, null)).toBe(false);
  });
});

// ------------------------------------------------------------------ headers

const user = (over: Partial<AuthUser> = {}): AuthUser => ({ id: "u1", name: "Ann", email: "a@x.com", isGuest: false, sessionId: "s1", ...over });

function socialEnv() {
  const seen: Request[] = [];
  const stub = { fetch: async (r: Request) => (seen.push(r), new Response("ok")) };
  const env: any = { SOCIAL: { idFromName: () => "id", get: () => stub }, DMMO_ENV: "local", BETTER_AUTH_URL: "http://localhost:8787" };
  return { env, seen };
}

describe("admin and IP headers", () => {
  it("strips client-sent x-dmmo-admin and x-dmmo-ip", () => {
    const h = stripIdentityHeaders(new Headers({ [H_ADMIN]: "1", [H_IP]: "6.6.6.6", "X-DMMO-ADMIN": "1", cookie: "a=b" }));
    expect(h.get(H_ADMIN)).toBeNull();
    expect(h.get(H_IP)).toBeNull();
    expect(h.get("cookie")).toBe("a=b");
  });

  it("sets admin only from the Worker's verdict, and the IP from Cloudflare", () => {
    const req = new Request("http://x/ws/social", { headers: { "cf-connecting-ip": "203.0.113.9" } });
    const h = new Headers();
    setAdminAndIp(h, req, { admin: true, isGuest: false });
    expect(h.get(H_ADMIN)).toBe("1");
    expect(h.get(H_IP)).toBe("203.0.113.9");
    setAdminAndIp(h, req, { admin: true, isGuest: true });
    expect(h.get(H_ADMIN)).toBe("0");
    setAdminAndIp(h, req, { isGuest: false });
    expect(h.get(H_ADMIN)).toBe("0");
  });

  it("a forged x-dmmo-admin on /ws/social never reaches SocialRoom", async () => {
    const { env, seen } = socialEnv();
    const req = new Request("http://localhost:8787/ws/social", { headers: { upgrade: "websocket", [H_ADMIN]: "1", [H_IP]: "1.1.1.1", "cf-connecting-ip": "198.51.100.4" } });
    await forwardSocialWs(req, env, user());
    expect(seen[0]!.headers.get(H_ADMIN)).toBe("0");
    expect(seen[0]!.headers.get(H_IP)).toBe("198.51.100.4");
    await forwardSocialWs(req, env, user({ admin: true }));
    expect(seen[1]!.headers.get(H_ADMIN)).toBe("1");
  });

  it("a forged x-dmmo-admin on /ws/:zone never reaches the room", async () => {
    const seen: Request[] = [];
    const stub = { fetch: async (r: Request) => (seen.push(r), new Response("ok")) };
    const env: any = { HOME: { idFromName: () => "id", get: () => stub }, DMMO_ENV: "local" };
    const req = new Request("http://localhost:8787/ws/home", { headers: { upgrade: "websocket", [H_ADMIN]: "1" } });
    await forwardWs(req, env, "home", user());
    expect(seen[0]!.headers.get(H_ADMIN)).toBe("0");
  });

  it("Durable Objects read admin only from the header, never for guests", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: { "x-dmmo-user-id": "u1", "x-dmmo-user-name": "Ann", ...h } });
    expect(readIdentity(req({ [H_ADMIN]: "1" }))!.admin).toBe(true);
    expect(readIdentity(req({ [H_ADMIN]: "1", "x-dmmo-guest": "1" }))!.admin).toBe(false);
    expect(readIdentity(req({}))!.admin).toBe(false);
    expect(readIdentity(req({ [H_ADMIN]: "true" }))!.admin).toBe(false);
  });

  it("entity snapshots carry the admin flag only when set", () => {
    const base = { id: "p:u1", kind: "player" as const, name: "Ann", sprite: "player_1", x: 1, y: 2, facing: "down" as const, moving: false };
    expect(snapshotEntity({ ...base, admin: true }).admin).toBe(true);
    expect("admin" in snapshotEntity(base)).toBe(false);
    expect("admin" in snapshotEntity({ ...base, admin: false })).toBe(false);
  });
});

// ------------------------------------------------------------------ shout text and commands

describe("shout text and admin commands", () => {
  it("caps shouts, flattens lines and drops control and bidi characters", () => {
    const ctl = String.fromCharCode(7) + String.fromCharCode(0x202e);
    expect(cleanShout(`  Market ${ctl}day\n\ntomorrow!  `)).toBe("Market day tomorrow!");
    expect(cleanShout("a".repeat(500))!.length).toBe(SHOUT_MAX_LEN);
    expect(cleanShout("   ")).toBeNull();
    expect(cleanShout(42)).toBeNull();
    expect(cleanShout("<b>hi</b>")).toBe("<b>hi</b>"); // kept as text; the client only uses textContent
  });

  it("parses /shout, /kick and /unban", () => {
    expect(parseAdminCommand("/shout Fair at noon")).toEqual({ cmd: "shout", text: "Fair at noon" });
    expect(parseAdminCommand("/announce hi")).toEqual({ cmd: "shout", text: "hi" });
    expect(parseAdminCommand("/shout")).toEqual({ cmd: "error", message: "Usage: /shout message" });
    expect(parseAdminCommand("/kick Bob spamming the well")).toEqual({ cmd: "kick", name: "Bob", reason: "spamming the well" });
    expect(parseAdminCommand("/kick Bob")).toEqual({ cmd: "kick", name: "Bob", reason: "" });
    expect(parseAdminCommand("/kick")?.cmd).toBe("error");
    expect(parseAdminCommand("/kick b<o>b")?.cmd).toBe("error");
    expect(parseAdminCommand("/unban Bob")).toEqual({ cmd: "unban", name: "Bob" });
    expect(parseAdminCommand("/world hi")).toBeNull();
    expect(parseAdminCommand("/shouty")).toBeNull();
  });

  it("decodes admin frames on the social socket, copying only known fields", () => {
    expect(decodeSocialClient(JSON.stringify({ t: "shout", text: " hi ", admin: true }))).toEqual({ t: "shout", text: "hi" });
    expect(decodeSocialClient(JSON.stringify({ t: "shout", text: "" }))).toBeNull();
    expect(decodeSocialClient(JSON.stringify({ t: "kick", name: "Bob", reason: "x" }))).toEqual({ t: "kick", name: "Bob", reason: "x" });
    expect(decodeSocialClient(JSON.stringify({ t: "kick", name: "Bob" }))).toEqual({ t: "kick", name: "Bob" });
    expect(decodeSocialClient(JSON.stringify({ t: "kick", name: "no way" }))).toBeNull();
    expect(decodeSocialClient(JSON.stringify({ t: "unban", name: "Bob" }))).toEqual({ t: "unban", name: "Bob" });
  });

  it("checks shout frames from the server and their freshness", () => {
    expect(readShout({ id: "s1", name: "ET", text: "hello", at: 5 })).toEqual({ id: "s1", name: "ET", text: "hello", at: 5 });
    expect(readShout({ id: "", text: "x", at: 1 })).toBeNull();
    expect(readShout({ id: "s", text: "  ", at: 1 })).toBeNull();
    expect(shoutIsFresh({ at: T0 }, T0 + SHOUT_LATE_JOIN_MS - 1)).toBe(true);
    expect(shoutIsFresh({ at: T0 }, T0 + SHOUT_LATE_JOIN_MS)).toBe(false);
    expect(shoutIsFresh(null, T0)).toBe(false);
  });
});

// ------------------------------------------------------------------ ban list

class MemStorage implements BanStorage {
  data = new Map<string, unknown>();
  failGet = false;
  async get(keys: string[]): Promise<Map<string, unknown>> {
    if (this.failGet) throw new Error("storage down");
    const m = new Map<string, unknown>();
    for (const k of keys) if (this.data.has(k)) m.set(k, structuredClone(this.data.get(k)));
    return m;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }
  async delete(keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.data.delete(k)) n++;
    return n;
  }
  async list(opts: { prefix: string }): Promise<Map<string, unknown>> {
    return new Map([...this.data].filter(([k]) => k.startsWith(opts.prefix)));
  }
}

const rec = (over = {}) => ({ userId: "bob1", name: "Bob", by: "et1", byName: "ET", reason: "", at: T0, ips: ["203.0.113.7"], ...over });

describe("ban list", () => {
  it("bans by user id, browser cookie and address", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec(), T0);
    expect(await book.check("bob1", null, null, T0)).toEqual({ banned: true, userId: "bob1", via: "user" });
    expect(await book.check("new1", null, "bob1", T0)).toEqual({ banned: true, userId: "bob1", via: "cookie" });
    expect(await book.check(null, "203.0.113.7", null, T0)).toEqual({ banned: true, userId: "bob1", via: "ip" });
    expect(await book.check("ann1", "198.51.100.1", null, T0)).toEqual({ banned: false });
    expect(await book.check(null, null, null, T0)).toEqual({ banned: false });
  });

  it("lets address bans lapse but keeps the account ban", async () => {
    const s = new MemStorage();
    const book = new BanBook(s);
    await book.ban(rec(), T0);
    expect((await book.check(null, "203.0.113.7", null, T0 + IP_BAN_MS + 1)).banned).toBe(false);
    expect(s.data.has("banip:203.0.113.7")).toBe(false);
    expect((await book.check("bob1", "203.0.113.7", null, T0 + IP_BAN_MS + 1)).banned).toBe(true);
  });

  it("unban lifts the account, its addresses and makes old cookies harmless", async () => {
    const s = new MemStorage();
    const book = new BanBook(s);
    await book.ban(rec({ ips: ["203.0.113.7", "2001:db8::1"] }), T0);
    expect((await book.unban("bob1"))?.name).toBe("Bob");
    expect(await book.check("bob1", "203.0.113.7", "bob1", T0)).toEqual({ banned: false });
    expect(await book.check(null, "2001:db8::1", null, T0)).toEqual({ banned: false });
    expect(await book.unban("bob1")).toBeNull();
  });

  it("an address taken over by a later ban stays banned when the first is lifted", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec(), T0);
    await book.ban(rec({ userId: "cid1", name: "Cid" }), T0 + 1);
    await book.unban("bob1");
    expect(await book.check(null, "203.0.113.7", null, T0 + 2)).toEqual({ banned: true, userId: "cid1", via: "ip" });
  });

  it("finds bans by name and keeps only sane addresses", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec({ ips: ["203.0.113.7", "evil key", "203.0.113.7"] }), T0);
    expect((await book.findByName("BOB"))?.ips).toEqual(["203.0.113.7"]);
    expect(await book.findByName("nobody")).toBeNull();
    expect(cleanIp(" 2001:DB8::1 ")).toBe("2001:db8::1");
    expect(cleanIp("ban:x")).toBeNull();
    expect(cleanIp(undefined)).toBeNull();
  });
});

// ------------------------------------------------------------------ cookie

describe("ban cookie", () => {
  it("round-trips a signed user id", async () => {
    const v = await signBanCookie(SECRET, "bob1", T0);
    expect(await verifyBanCookie(SECRET, v)).toBe("bob1");
  });

  it("rejects tampered, foreign and malformed cookies", async () => {
    const v = await signBanCookie(SECRET, "bob1", T0);
    expect(await verifyBanCookie(SECRET, v.replace("bob1", "ann1"))).toBeNull();
    expect(await verifyBanCookie("y".repeat(40), v)).toBeNull();
    expect(await verifyBanCookie(SECRET, `${v}x`)).toBeNull();
    expect(await verifyBanCookie(SECRET, "v1.bob1.1")).toBeNull();
    expect(await verifyBanCookie(SECRET, "")).toBeNull();
    expect(await verifyBanCookie(SECRET, null)).toBeNull();
    expect(await verifyBanCookie(SECRET, "a".repeat(2000))).toBeNull();
  });

  it("reads one cookie and builds an httpOnly, long-lived Set-Cookie", () => {
    expect(readCookie(`a=1; ${BAN_COOKIE}=v1.x.1.sig; b=2`, BAN_COOKIE)).toBe("v1.x.1.sig");
    expect(readCookie("a=1", BAN_COOKIE)).toBeNull();
    expect(readCookie(null, BAN_COOKIE)).toBeNull();
    const h = banCookieHeader("v", true);
    expect(h).toContain("HttpOnly");
    expect(h).toContain("Max-Age=34560000");
    expect(h).toContain("Secure");
    expect(banCookieHeader("v", false)).not.toContain("Secure");
  });
});

// ------------------------------------------------------------------ Worker gate

function gateEnv(book: BanBook, opts: { fail?: boolean } = {}) {
  const social = {
    banCheck: vi.fn(async (u: string | null, ip: string | null, c: string | null) => {
      if (opts.fail) throw new Error("down");
      return book.check(u, ip, c, T0);
    }),
  };
  return { env: { SOCIAL: { idFromName: () => "id", get: () => social }, BETTER_AUTH_SECRET: SECRET, ADMIN_EMAILS: "et@x.com" } as any, social };
}

const reqFrom = (ip: string, cookie?: string) =>
  new Request("https://game.example/ws/village", { headers: { "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) } });

describe("ban gate", () => {
  it("refuses a removed account with 451 and sets the signed cookie", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec(), T0);
    const { env } = gateEnv(book);
    const res = await banGate(env, reqFrom("198.51.100.2"), user({ id: "bob1", email: "bob@x.com" }), { now: T0 });
    expect(res?.status).toBe(HTTP_REMOVED);
    expect(((await res!.json()) as any).error).toBe(REMOVED_TEXT);
    const cookie = res!.headers.get("set-cookie")!;
    const value = /dmmo_ban=([^;]+)/.exec(cookie)![1]!;
    expect(await verifyBanCookie(SECRET, value)).toBe("bob1");
  });

  it("refuses a new account in a removed browser, and a forged cookie does nothing", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec({ ips: [] }), T0);
    const { env } = gateEnv(book);
    const good = await signBanCookie(SECRET, "bob1", T0);
    expect((await banGate(env, reqFrom("198.51.100.2", `${BAN_COOKIE}=${good}`), null))?.status).toBe(HTTP_REMOVED);
    expect((await banGate(env, reqFrom("198.51.100.2", `${BAN_COOKIE}=${good}`), null, { signIn: true, email: "bob2@x.com" }))?.status).toBe(HTTP_REMOVED);
    const forged = good.slice(0, -2) + "AA";
    expect(await banGate(env, reqFrom("198.51.100.2", `${BAN_COOKIE}=${forged}`), null)).toBeNull();
  });

  it("refuses a banned address without marking that browser", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec(), T0);
    const { env } = gateEnv(book);
    const res = await banGate(env, reqFrom("203.0.113.7"), user({ id: "ann1", email: "ann@x.com" }));
    expect(res?.status).toBe(HTTP_REMOVED);
    expect(res!.headers.get("set-cookie")).toBeNull();
    expect((await banGate(env, reqFrom("203.0.113.7"), null, { signIn: true, email: "new@x.com" }))?.status).toBe(HTTP_REMOVED);
  });

  it("lets a signed-out visitor on a banned address reach the sign-in form (an admin may be on it)", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec(), T0);
    const { env, social } = gateEnv(book);
    expect(await banGate(env, reqFrom("203.0.113.7"), null)).toBeNull();
    expect(social.banCheck).not.toHaveBeenCalled();
  });

  it("never refuses an admin (signed in, or signing in by email) and fails open on errors", async () => {
    const book = new BanBook(new MemStorage());
    await book.ban(rec(), T0);
    const { env, social } = gateEnv(book);
    expect(await banGate(env, reqFrom("203.0.113.7"), user({ id: "et1", email: "ET@x.com" }))).toBeNull();
    expect(await banGate(env, reqFrom("203.0.113.7"), null, { signIn: true, email: "et@x.com" })).toBeNull();
    expect(social.banCheck).not.toHaveBeenCalled();
    const down = gateEnv(book, { fail: true });
    expect(await banGate(down.env, reqFrom("203.0.113.7"), null, { signIn: true })).toBeNull();
  });

  it("reads the sign-in email without consuming the body", async () => {
    const r = new Request("http://x/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: "et@x.com", password: "p" }) });
    expect(await bodyEmail(r)).toBe("et@x.com");
    expect(((await r.json()) as any).password).toBe("p");
    expect(await bodyEmail(new Request("http://x", { method: "POST", body: "nope" }))).toBeNull();
    expect(clientIp(reqFrom("1.2.3.4"))).toBe("1.2.3.4");
    expect(SIGN_IN_ENDPOINTS).toEqual(expect.arrayContaining(["/sign-up/email", "/sign-in/email", "/sign-in/anonymous"]));
  });
});

// ------------------------------------------------------------------ AdminDesk: shout, kick, unban

interface Users {
  [name: string]: UserInfo;
}

function desk(opts: { users?: Users; online?: string[]; failLookup?: boolean; noSave?: string[]; failJail?: boolean } = {}) {
  const users: Users = opts.users ?? {
    et: { userId: "et1", name: "ET", email: "et@x.com", guest: false },
    bob: { userId: "bob1", name: "Bob", email: "bob@x.com", guest: false },
    amy: { userId: "amy1", name: "Amy", email: "amy@x.com", guest: false },
    guest_ab12cd: { userId: "gus1", name: "Guest_ab12cd", email: "temp@anon", guest: true },
  };
  const storage = new MemStorage();
  const kv = new Map<string, unknown>();
  const shouts: Shout[] = [];
  const removed: { userId: string; text: string }[] = [];
  const jailed = new Map<string, { until: number; text: string }>();
  const logs: string[] = [];
  const bans = new BanBook(storage);
  const byId = (id: string) => Object.values(users).find((u) => u.userId === id) ?? null;
  const host: AdminHost = {
    bans,
    storage: { get: async (k) => kv.get(k), put: async (k, v) => void kv.set(k, structuredClone(v)) },
    broadcast: (s) => void shouts.push(s),
    online: (name) => {
      const u = users[name.toLowerCase()];
      return u && (opts.online ?? []).includes(u.userId) ? { userId: u.userId, name: u.name } : null;
    },
    userByName: async (name) => {
      if (opts.failLookup) throw new Error("d1 down");
      return users[name.toLowerCase()] ?? null;
    },
    userById: async (id) => {
      if (opts.failLookup) throw new Error("d1 down");
      return byId(id);
    },
    isAdminEmail: (email) => isAdminEmail({ ADMIN_EMAILS: "et@x.com, amy@x.com" }, email),
    socketIps: (id) => (id === "bob1" ? ["203.0.113.7"] : []),
    sessionIps: async (id) => (id === "bob1" ? ["198.51.100.20", "203.0.113.7"] : []),
    remove: (userId, text) => void removed.push({ userId, text }),
    log: (l) => void logs.push(l),
    jail: async (userId, until, text) => {
      if (opts.failJail) throw new Error("home down");
      if ((opts.noSave ?? []).includes(userId)) return { ok: false, noSave: true };
      jailed.set(userId, { until, text });
      return { ok: true };
    },
    unjail: async (userId) => jailed.delete(userId),
  };
  return { d: new AdminDesk(host), shouts, removed, logs, bans, kv, jailed };
}

const et = { userId: "et1", name: "ET", admin: true };
const bobActor = { userId: "bob1", name: "Bob", admin: false };

describe("shout", () => {
  it("refuses non-admins and never broadcasts for them", () => {
    const { d, shouts } = desk();
    expect(d.shout(bobActor, "hi all", T0, "s1")).toEqual({ ok: false, text: "Only admins can do that." });
    expect(shouts).toEqual([]);
  });

  it("fans one clean shout out to everyone, rate-limited per admin", () => {
    const { d, shouts, kv } = desk();
    expect(d.shout(et, "  Harvest fair\nat noon ", T0, "s1").ok).toBe(true);
    expect(shouts).toEqual([{ id: "s1", name: "ET", text: "Harvest fair at noon", at: T0 }]);
    expect(kv.get("shout")).toEqual(shouts[0]);
    const again = d.shout(et, "again", T0 + 1000, "s2");
    expect(again.ok).toBe(false);
    expect(again.text).toMatch(/wait 9s/);
    expect(d.shout(et, "again", T0 + SHOUT_MIN_INTERVAL_MS, "s3").ok).toBe(true);
    expect(shouts).toHaveLength(2);
    expect(d.shout(et, "   ", T0 + 2 * SHOUT_MIN_INTERVAL_MS, "s4").ok).toBe(false);
  });

  it("shows the latest shout to late joiners for a few minutes, also after a restart", async () => {
    const { d, kv } = desk();
    d.shout(et, "Welcome!", T0, "s1");
    expect(d.current(T0 + 60_000)?.id).toBe("s1");
    expect(d.current(T0 + SHOUT_LATE_JOIN_MS + 1)).toBeNull();
    const fresh = desk();
    fresh.kv.set("shout", kv.get("shout"));
    await fresh.d.load();
    expect(fresh.d.current(T0 + 1000)?.text).toBe("Welcome!");
  });
});

describe("kick and unban", () => {
  it("refuses non-admins", async () => {
    const { d, removed, bans } = desk();
    expect(await d.kick(bobActor, "Amy", "", T0)).toEqual({ ok: false, text: "Only admins can do that." });
    expect(await d.unban(bobActor, "Amy", T0)).toEqual({ ok: false, text: "Only admins can do that." });
    expect(removed).toEqual([]);
    expect(await bans.get("amy1")).toBeNull();
  });

  it("can't kick yourself, another admin or nobody", async () => {
    const { d, removed } = desk();
    expect((await d.kick(et, "et", "", T0)).text).toBe("You can't kick yourself.");
    expect((await d.kick(et, "Amy", "", T0)).text).toBe("Amy is an admin and can't be kicked.");
    expect((await d.kick(et, "Zed", "", T0)).text).toBe("There's no player called Zed.");
    expect(removed).toEqual([]);
  });

  it("fails closed when the account can't be looked up", async () => {
    const { d, removed } = desk({ failLookup: true });
    expect((await d.kick(et, "Bob", "", T0)).ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("bans the account and its addresses, closes their sockets and logs it", async () => {
    const { d, removed, bans, logs, kv } = desk({ online: ["bob1"] });
    const r = await d.kick(et, "bob", "griefing the  farm", T0);
    expect(r.ok).toBe(true);
    expect(removed).toEqual([{ userId: "bob1", text: REMOVED_TEXT }]);
    const b = await bans.get("bob1");
    expect(b).toMatchObject({ name: "Bob", by: "et1", reason: "griefing the farm" });
    expect(b!.ips.sort()).toEqual(["198.51.100.20", "203.0.113.7"]);
    expect((await bans.check(null, "198.51.100.20", null, T0)).banned).toBe(true);
    expect(logs.some((l) => l.includes("admin kick"))).toBe(true);
    expect((kv.get("kicklog") as any[])[0]).toMatchObject({ action: "kick", userId: "bob1", by: "et1" });
  });

  it("kicks guests too", async () => {
    const { d, removed } = desk();
    expect((await d.kick(et, "Guest_ab12cd", "", T0)).ok).toBe(true);
    expect(removed[0]!.userId).toBe("gus1");
  });

  it("/unban lets them back in", async () => {
    const { d, bans } = desk();
    await d.kick(et, "Bob", "", T0);
    expect((await d.unban(et, "BOB", T0 + 1)).text).toBe("Bob can play in Mossbrook again.");
    expect(await bans.check("bob1", "203.0.113.7", "bob1", T0 + 2)).toEqual({ banned: false });
    expect((await d.unban(et, "Bob", T0 + 3)).ok).toBe(false);
  });

  it("finds a ban by name when the account is gone", async () => {
    const users: Users = { bob: { userId: "bob1", name: "Bob", email: "bob@x.com", guest: false } };
    const { d, bans } = desk({ users });
    await d.kick(et, "Bob", "", T0);
    delete users.bob;
    expect((await d.unban(et, "Bob", T0)).ok).toBe(true);
    expect(await bans.get("bob1")).toBeNull();
  });
});

describe("removed signals", () => {
  it("uses one close code and one HTTP status", () => {
    expect(CLOSE_REMOVED).toBeGreaterThanOrEqual(4000);
    expect(CLOSE_REMOVED).toBeLessThan(5000);
    expect(HTTP_REMOVED).toBe(451);
  });
});

describe("jail and unjail", () => {
  it("refuses non-admins and never touches anyone's save", async () => {
    const { d, jailed } = desk();
    expect(await d.jail(bobActor, "Amy", 5, T0)).toEqual({ ok: false, text: "Only admins can do that." });
    expect(await d.unjail(bobActor, "Amy", T0)).toEqual({ ok: false, text: "Only admins can do that." });
    expect(jailed.size).toBe(0);
  });

  it("jails for 5 minutes by default, or the minutes given, and logs it", async () => {
    const { d, jailed, kv } = desk();
    const r = await d.jail(et, "bob", undefined, T0);
    expect(r).toEqual({ ok: true, text: "Bob is in jail for 5 minutes. /unjail Bob lets them out." });
    expect(jailed.get("bob1")).toEqual({ until: T0 + 5 * 60_000, text: "You've been sent to jail for 5 minutes." });
    await d.jail(et, "Bob", 90, T0);
    expect(jailed.get("bob1")!.until).toBe(T0 + 90 * 60_000);
    const log = kv.get("kicklog") as { action: string; reason?: string }[];
    expect(log.map((e) => e.action)).toEqual(["jail", "jail"]);
    expect(log[1]!.reason).toBe("90 min");
  });

  it("refuses bad minutes, yourself, admins, guests, unknown names and players with no save", async () => {
    const { d, jailed } = desk({ noSave: ["bob1"] });
    for (const m of [0, -3, 1.5, 1441, "ten", 1e9]) expect((await d.jail(et, "Bob", m, T0)).text).toMatch(/whole minutes from 1 to 1440/);
    expect((await d.jail(et, "ET", 5, T0)).text).toBe("You can't jail yourself.");
    expect((await d.jail(et, "Amy", 5, T0)).text).toBe("Amy is an admin and can't be jailed.");
    expect((await d.jail(et, "Guest_ab12cd", 5, T0)).ok).toBe(false);
    expect((await d.jail(et, "Nobody", 5, T0)).text).toBe("There's no player called Nobody.");
    expect((await d.jail(et, "Bob", 5, T0)).text).toBe("Bob hasn't played yet.");
    expect(jailed.size).toBe(0);
  });

  it("answers kindly when the home or the lookup is down", async () => {
    expect((await desk({ failJail: true }).d.jail(et, "Bob", 5, T0)).ok).toBe(false);
    expect((await desk({ failLookup: true }).d.jail(et, "Bob", 5, T0)).text).toMatch(/Couldn't look that player up/);
  });

  it("/unjail lets them out once", async () => {
    const { d, jailed } = desk();
    await d.jail(et, "Bob", 5, T0);
    expect(await d.unjail(et, "Bob", T0 + 1)).toEqual({ ok: true, text: "Bob is out of jail." });
    expect(jailed.size).toBe(0);
    expect(await d.unjail(et, "Bob", T0 + 2)).toEqual({ ok: false, text: "Bob isn't in jail." });
  });

  it("parses /jail and /unjail, and the social socket only carries valid ones", () => {
    expect(parseAdminCommand("/jail Bob")).toEqual({ cmd: "jail", name: "Bob", minutes: 5 });
    expect(parseAdminCommand("/jail Bob 30")).toEqual({ cmd: "jail", name: "Bob", minutes: 30 });
    expect(parseAdminCommand("/jail Bob 0")?.cmd).toBe("error");
    expect(parseAdminCommand("/jail Bob 2000")?.cmd).toBe("error");
    expect(parseAdminCommand("/jail Bob 5 extra")?.cmd).toBe("error");
    expect(parseAdminCommand("/jail")?.cmd).toBe("error");
    expect(parseAdminCommand("/unjail Bob")).toEqual({ cmd: "unjail", name: "Bob" });
    expect(parseAdminCommand("/release Bob")).toEqual({ cmd: "unjail", name: "Bob" });
    expect(parseAdminCommand("/jailbreak")).toBeNull();
    expect(decodeSocialClient(JSON.stringify({ t: "jail", name: "Bob", minutes: 10 }))).toEqual({ t: "jail", name: "Bob", minutes: 10 });
    expect(decodeSocialClient(JSON.stringify({ t: "jail", name: "Bob" }))).toEqual({ t: "jail", name: "Bob" });
    expect(decodeSocialClient(JSON.stringify({ t: "jail", name: "Bob", minutes: 0 }))).toBeNull();
    expect(decodeSocialClient(JSON.stringify({ t: "jail", name: "Bob", minutes: "5" }))).toBeNull();
    expect(decodeSocialClient(JSON.stringify({ t: "jail", name: "<b>" }))).toBeNull();
    expect(decodeSocialClient(JSON.stringify({ t: "unjail", name: "Bob" }))).toEqual({ t: "unjail", name: "Bob" });
  });
});
