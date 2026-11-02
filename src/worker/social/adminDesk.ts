// Admin actions handled by SocialRoom: /shout (a banner for everyone online), /kick (disconnect
// and ban), /unban, and /jail and /unjail (the police station's cell, shared/jail.ts). Every action re-checks `actor.admin`, which comes only from the
// x-dmmo-admin header the Worker set on that socket. The room supplies sockets, D1 lookups and
// the "close everywhere" call through AdminHost, so this logic is testable without a Durable Object.
import { REMOVED_TEXT, SHOUT_MIN_INTERVAL_MS, cleanReason, cleanShout, shoutIsFresh, type Shout } from "../../shared/admin";
import { BanBook, cleanIp, type BanRecord } from "./bans";
import { jailedText, jailEndsAt, minutesLabel, parseJailMinutes } from "../../shared/jail";

export interface AdminActor {
  userId: string;
  name: string;
  admin: boolean;
}

export interface UserInfo {
  userId: string;
  name: string;
  email: string | null;
  guest: boolean;
}

export interface AdminHost {
  bans: BanBook;
  /** Durable storage for the latest shout and the kick log. */
  storage: { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> };
  /** Sends a shout to every social socket. */
  broadcast(shout: Shout): void;
  /** Someone online with this name (case-insensitive). */
  online(name: string): { userId: string; name: string } | null;
  /** Account (or guest) by name; throws when D1 can't answer. */
  userByName(name: string): Promise<UserInfo | null>;
  /** Account by id; throws when D1 can't answer. */
  userById(userId: string): Promise<UserInfo | null>;
  isAdminEmail(email: string | null): boolean;
  /** Addresses their open social sockets came from. */
  socketIps(userId: string): string[];
  /** Addresses their recent sessions signed in from (empty on a D1 error). */
  sessionIps(userId: string): Promise<string[]>;
  /** Tells them and closes every socket they have, here and in every zone and home. */
  remove(userId: string, text: string): void;
  log(line: string): void;
  /**
   * Saves the sentence in their HomeRoom (which walks them to the cell if they are home or
   * visiting) and tells every zone to lock them up if they are there. Throws when the home fails.
   */
  jail(userId: string, until: number, text: string): Promise<{ ok: boolean; noSave?: boolean }>;
  /** Ends the sentence in their HomeRoom and lets them out wherever they are. True if they were in. */
  unjail(userId: string): Promise<boolean>;
}

export type AdminAnswer = { ok: boolean; text: string };

const NOT_ADMIN = "Only admins can do that.";
const KICK_LOG_MAX = 100;

export interface KickLogEntry {
  at: number;
  action: "kick" | "unban" | "jail" | "unjail";
  by: string;
  byName: string;
  userId: string;
  name: string;
  reason?: string;
}

export class AdminDesk {
  private lastShoutBy = new Map<string, number>();
  private latest: Shout | null = null;

  constructor(private readonly host: AdminHost) {}

  /** Restores the latest shout after the room wakes (late joiners may still see it). */
  async load(): Promise<void> {
    const s = await this.host.storage.get("shout");
    if (s && typeof s === "object" && typeof (s as Shout).id === "string") this.latest = s as Shout;
  }

  /** The shout a player coming online now should still see, if any. */
  current(now: number): Shout | null {
    return shoutIsFresh(this.latest, now) ? this.latest : null;
  }

  shout(actor: AdminActor, raw: unknown, now: number, id: string): AdminAnswer {
    if (!actor.admin) return { ok: false, text: NOT_ADMIN };
    const text = cleanShout(raw);
    if (!text) return { ok: false, text: "Usage: /shout message" };
    const last = this.lastShoutBy.get(actor.userId) ?? -Infinity;
    if (now - last < SHOUT_MIN_INTERVAL_MS) {
      return { ok: false, text: `One shout at a time: wait ${Math.ceil((SHOUT_MIN_INTERVAL_MS - (now - last)) / 1000)}s.` };
    }
    this.lastShoutBy.set(actor.userId, now);
    const shout: Shout = { id, name: actor.name, text, at: now };
    this.latest = shout;
    void this.host.storage.put("shout", shout);
    this.host.broadcast(shout);
    this.host.log(`admin shout by ${actor.userId} (${actor.name}): ${JSON.stringify(text)}`);
    return { ok: true, text: "Shouted to everyone online." };
  }

  async kick(actor: AdminActor, name: string, rawReason: unknown, now: number): Promise<AdminAnswer> {
    if (!actor.admin) return { ok: false, text: NOT_ADMIN };
    const reason = cleanReason(rawReason);
    let target: UserInfo | null;
    try {
      const here = this.host.online(name);
      target = here ? ((await this.host.userById(here.userId)) ?? { ...here, email: null, guest: false }) : await this.host.userByName(name);
    } catch (err) {
      // Fail closed: without the account we can't tell whether they are an admin.
      this.host.log(`admin kick lookup failed: ${String(err)}`);
      return { ok: false, text: "Couldn't look that player up. Try again in a moment." };
    }
    if (!target) return { ok: false, text: `There's no player called ${name}.` };
    if (target.userId === actor.userId) return { ok: false, text: "You can't kick yourself." };
    if (!target.guest && this.host.isAdminEmail(target.email)) return { ok: false, text: `${target.name} is an admin and can't be kicked.` };

    const ips = [...this.host.socketIps(target.userId), ...(await this.host.sessionIps(target.userId))]
      .map(cleanIp)
      .filter((ip): ip is string => !!ip);
    const rec: BanRecord = { userId: target.userId, name: target.name, by: actor.userId, byName: actor.name, reason, at: now, ips };
    await this.host.bans.ban(rec, now);
    this.host.remove(target.userId, REMOVED_TEXT);
    await this.record({ at: now, action: "kick", by: actor.userId, byName: actor.name, userId: target.userId, name: target.name, ...(reason ? { reason } : {}) });
    return { ok: true, text: `${target.name} was removed from Mossbrook. /unban ${target.name} lets them back.` };
  }

  async unban(actor: AdminActor, name: string, now: number): Promise<AdminAnswer> {
    if (!actor.admin) return { ok: false, text: NOT_ADMIN };
    let rec: BanRecord | null = null;
    try {
      const user = await this.host.userByName(name);
      if (user) rec = await this.host.bans.get(user.userId);
    } catch (err) {
      this.host.log(`admin unban lookup failed: ${String(err)}`);
    }
    rec ??= await this.host.bans.findByName(name);
    if (!rec) return { ok: false, text: `${name} isn't removed.` };
    await this.host.bans.unban(rec.userId);
    await this.record({ at: now, action: "unban", by: actor.userId, byName: actor.name, userId: rec.userId, name: rec.name });
    return { ok: true, text: `${rec.name} can play in Mossbrook again.` };
  }

  /** Looks a player up by name (online first), for kick and jail. Throws when D1 can't answer. */
  private async target(name: string): Promise<UserInfo | null> {
    const here = this.host.online(name);
    return here ? ((await this.host.userById(here.userId)) ?? { ...here, email: null, guest: false }) : await this.host.userByName(name);
  }

  /**
   * /jail name [minutes] or the player card's Send to Jail: `minutes` defaults to 5 and must be
   * 1..1440. Admins and guests can't be jailed, nor can you jail yourself.
   */
  async jail(actor: AdminActor, name: string, rawMinutes: unknown, now: number): Promise<AdminAnswer> {
    if (!actor.admin) return { ok: false, text: NOT_ADMIN };
    const minutes = parseJailMinutes(rawMinutes);
    if (minutes === null) return { ok: false, text: "Jail time is whole minutes from 1 to 1440." };
    let target: UserInfo | null;
    try {
      target = await this.target(name);
    } catch (err) {
      this.host.log(`admin jail lookup failed: ${String(err)}`);
      return { ok: false, text: "Couldn't look that player up. Try again in a moment." };
    }
    if (!target) return { ok: false, text: `There's no player called ${name}.` };
    if (target.userId === actor.userId) return { ok: false, text: "You can't jail yourself." };
    if (target.guest) return { ok: false, text: `${target.name} is a guest and can only be at home.` };
    if (this.host.isAdminEmail(target.email)) return { ok: false, text: `${target.name} is an admin and can't be jailed.` };
    let r: { ok: boolean; noSave?: boolean };
    try {
      r = await this.host.jail(target.userId, jailEndsAt(now, minutes), jailedText(minutes, false));
    } catch (err) {
      this.host.log(`admin jail failed: ${String(err)}`);
      r = { ok: false };
    }
    if (!r.ok) return { ok: false, text: r.noSave ? `${target.name} hasn't played yet.` : "That didn't work. Try again in a moment." };
    await this.record({ at: now, action: "jail", by: actor.userId, byName: actor.name, userId: target.userId, name: target.name, reason: `${minutes} min` });
    return { ok: true, text: `${target.name} is in jail for ${minutesLabel(minutes)}. /unjail ${target.name} lets them out.` };
  }

  async unjail(actor: AdminActor, name: string, now: number): Promise<AdminAnswer> {
    if (!actor.admin) return { ok: false, text: NOT_ADMIN };
    let target: UserInfo | null;
    try {
      target = await this.target(name);
    } catch (err) {
      this.host.log(`admin unjail lookup failed: ${String(err)}`);
      return { ok: false, text: "Couldn't look that player up. Try again in a moment." };
    }
    if (!target) return { ok: false, text: `There's no player called ${name}.` };
    let was: boolean;
    try {
      was = await this.host.unjail(target.userId);
    } catch (err) {
      this.host.log(`admin unjail failed: ${String(err)}`);
      return { ok: false, text: "That didn't work. Try again in a moment." };
    }
    if (!was) return { ok: false, text: `${target.name} isn't in jail.` };
    await this.record({ at: now, action: "unjail", by: actor.userId, byName: actor.name, userId: target.userId, name: target.name });
    return { ok: true, text: `${target.name} is out of jail.` };
  }

  /** Every kick, unban, jail and unjail goes to the Worker log and a short list kept in storage. */
  private async record(e: KickLogEntry): Promise<void> {
    this.host.log(`admin ${e.action}: ${JSON.stringify(e)}`);
    const prev = await this.host.storage.get("kicklog");
    const list = Array.isArray(prev) ? (prev as KickLogEntry[]) : [];
    list.push(e);
    await this.host.storage.put("kicklog", list.slice(-KICK_LOG_MAX));
  }
}
