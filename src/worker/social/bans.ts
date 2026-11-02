// Removed players, kept in SocialRoom's storage (one global list next to presence, which every
// client's social socket already goes through). D1 stays Better Auth's alone.
//   ban:<userId>  -> BanRecord          (until an admin runs /unban)
//   banip:<ip>    -> { userId, until }  (IP bans expire: addresses get reused)
// The Worker asks check() on every socket, /api/me and sign-in; the signed browser cookie
// (admin/cookie.ts) only names an account, so whether it still bans is decided here.

export interface BanRecord {
  userId: string;
  name: string;
  /** Admin who removed them. */
  by: string;
  byName: string;
  reason: string;
  at: number;
  /** Addresses banned with them (removed again on /unban). */
  ips: string[];
}

interface IpBan {
  userId: string;
  until: number;
}

export type BanVerdict = { banned: false } | { banned: true; userId: string; via: "user" | "cookie" | "ip" };

/** The slice of DurableObjectStorage the list needs (tests pass a Map-backed fake). */
export interface BanStorage {
  get(keys: string[]): Promise<Map<string, unknown>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list(opts: { prefix: string; limit?: number }): Promise<Map<string, unknown>>;
}

/** A shared address (home, school, cafe) may cover other players: its ban lifts after this. */
export const IP_BAN_MS = 30 * 24 * 60 * 60_000;
/** At most this many addresses per ban. */
export const MAX_BAN_IPS = 8;
const MAX_LISTED_BANS = 1000;

const banKey = (userId: string) => `ban:${userId}`;
const ipKey = (ip: string) => `banip:${ip}`;

/** A plausible IPv4/IPv6 address string, or null (it becomes a storage key). */
export function cleanIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const ip = raw.trim().toLowerCase();
  return ip.length >= 2 && ip.length <= 45 && /^[0-9a-f.:]+$/.test(ip) ? ip : null;
}

function isRecord(v: unknown): v is BanRecord {
  return !!v && typeof v === "object" && typeof (v as BanRecord).userId === "string";
}

function isIpBan(v: unknown): v is IpBan {
  return !!v && typeof v === "object" && typeof (v as IpBan).userId === "string" && typeof (v as IpBan).until === "number";
}

export class BanBook {
  constructor(private readonly storage: BanStorage) {}

  async check(userId: string | null, ip: string | null, cookieUser: string | null, now: number): Promise<BanVerdict> {
    const addr = cleanIp(ip);
    const keys = [...new Set([userId && banKey(userId), cookieUser && banKey(cookieUser), addr && ipKey(addr)].filter((k): k is string => !!k))];
    if (keys.length === 0) return { banned: false };
    const got = await this.storage.get(keys);
    if (userId && isRecord(got.get(banKey(userId)))) return { banned: true, userId, via: "user" };
    if (cookieUser && isRecord(got.get(banKey(cookieUser)))) return { banned: true, userId: cookieUser, via: "cookie" };
    const byIp = addr ? got.get(ipKey(addr)) : undefined;
    if (addr && isIpBan(byIp)) {
      if (byIp.until > now) return { banned: true, userId: byIp.userId, via: "ip" };
      await this.storage.delete([ipKey(addr)]);
    }
    return { banned: false };
  }

  async get(userId: string): Promise<BanRecord | null> {
    const v = (await this.storage.get([banKey(userId)])).get(banKey(userId));
    return isRecord(v) ? v : null;
  }

  /** Records (or refreshes) a ban and its addresses. */
  async ban(rec: BanRecord, now: number): Promise<BanRecord> {
    const old = await this.get(rec.userId);
    const ips = [...new Set([...(old?.ips ?? []), ...rec.ips].map(cleanIp).filter((ip): ip is string => !!ip))].slice(-MAX_BAN_IPS);
    const next: BanRecord = { ...rec, ips };
    const entries: Record<string, unknown> = { [banKey(rec.userId)]: next };
    for (const ip of ips) entries[ipKey(ip)] = { userId: rec.userId, until: now + IP_BAN_MS } satisfies IpBan;
    await this.storage.put(entries);
    return next;
  }

  /** Lifts a ban and its address bans. Returns the record that was removed, or null. */
  async unban(userId: string): Promise<BanRecord | null> {
    const rec = await this.get(userId);
    if (!rec) return null;
    const ipKeys = rec.ips.map(ipKey);
    // Only drop address bans that still point at this player (another ban may have taken one over).
    const current = ipKeys.length > 0 ? await this.storage.get(ipKeys) : new Map<string, unknown>();
    const mine = ipKeys.filter((k) => {
      const v = current.get(k);
      return isIpBan(v) && v.userId === userId;
    });
    await this.storage.delete([banKey(userId), ...mine]);
    return rec;
  }

  /** A ban by the removed player's name (case-insensitive), for /unban of an account that is gone. */
  async findByName(name: string): Promise<BanRecord | null> {
    const key = name.toLowerCase();
    const all = await this.storage.list({ prefix: "ban:", limit: MAX_LISTED_BANS });
    for (const v of all.values()) if (isRecord(v) && v.name.toLowerCase() === key) return v;
    return null;
  }
}
