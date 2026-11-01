// Who is online and where, for SocialRoom. Pure (no Workers APIs) so it can be unit tested.
// "Online" means: has a social socket, or a ZoneRoom/HomeRoom reported them in a zone.
// A zone reported by a Durable Object (server) always wins over one the client claims.
import type { ZoneId } from "../../shared/types";
import { nameKey } from "../../shared/names";

export interface ConnInfo {
  userId: string;
  name: string;
  guest: boolean;
}

interface ZoneEntry {
  server: ZoneId | null;
  client: ZoneId | null;
  at: number;
}

/** A server-reported zone with no social socket is forgotten after this long (lost leave RPC). */
export const ZONE_TTL_MS = 12 * 60 * 60_000;

export class Presence {
  private conns = new Map<string, ConnInfo>();
  private byUser = new Map<string, Set<string>>();
  private zones = new Map<string, ZoneEntry>();

  /** Registers a socket. Returns true if this is the user's first one (they just came online). */
  connect(connId: string, info: ConnInfo): boolean {
    const wasOnline = this.isOnline(info.userId);
    this.conns.set(connId, { ...info });
    let set = this.byUser.get(info.userId);
    if (!set) this.byUser.set(info.userId, (set = new Set()));
    set.add(connId);
    return !wasOnline;
  }

  /** Removes a socket. Returns the user and whether they are now offline. */
  disconnect(connId: string): { userId: string; wentOffline: boolean } | null {
    const info = this.conns.get(connId);
    if (!info) return null;
    this.conns.delete(connId);
    const set = this.byUser.get(info.userId);
    set?.delete(connId);
    if (set && set.size === 0) {
      this.byUser.delete(info.userId);
      // A client-claimed zone means nothing without the socket that claimed it.
      const z = this.zones.get(info.userId);
      if (z) {
        z.client = null;
        if (!z.server) this.zones.delete(info.userId);
      }
    }
    return { userId: info.userId, wentOffline: !this.isOnline(info.userId) };
  }

  conn(connId: string): ConnInfo | undefined {
    return this.conns.get(connId);
  }

  connsOf(userId: string): string[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  hasSocket(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  isOnline(userId: string): boolean {
    return this.hasSocket(userId) || !!this.zones.get(userId)?.server;
  }

  /**
   * Zone reported by a ZoneRoom/HomeRoom. `here` false is a leave and only clears the zone if it
   * is still the one being left (a join elsewhere may have arrived first). Returns true if the
   * effective zone changed.
   */
  setServerZone(userId: string, zone: ZoneId, here: boolean, now: number): boolean {
    const before = this.zoneOf(userId);
    let z = this.zones.get(userId);
    if (here) {
      if (!z) this.zones.set(userId, (z = { server: null, client: null, at: now }));
      z.server = zone;
      z.at = now;
    } else if (z && z.server === zone) {
      z.server = null;
      if (z.client === zone) z.client = null;
      if (!z.client) this.zones.delete(userId);
    }
    return before !== this.zoneOf(userId);
  }

  /** Client-claimed zone: only used while no Durable Object has reported one. */
  setClientZone(userId: string, zone: ZoneId, now: number): boolean {
    if (!this.hasSocket(userId)) return false;
    const before = this.zoneOf(userId);
    let z = this.zones.get(userId);
    if (!z) this.zones.set(userId, (z = { server: null, client: null, at: now }));
    z.client = zone;
    return before !== this.zoneOf(userId);
  }

  zoneOf(userId: string): ZoneId | null {
    const z = this.zones.get(userId);
    return z ? (z.server ?? z.client) : null;
  }

  /** The server-reported zone (for persisting into socket attachments). */
  serverZoneOf(userId: string): ZoneId | null {
    return this.zones.get(userId)?.server ?? null;
  }

  /** Case-insensitive lookup among users with a social socket. */
  findByName(name: string): ConnInfo | null {
    const key = nameKey(name);
    let found: ConnInfo | null = null;
    for (const c of this.conns.values()) if (nameKey(c.name) === key) found = c;
    return found;
  }

  counts(): { online: number; zones: Partial<Record<ZoneId, number>> } {
    const users = new Set<string>(this.byUser.keys());
    const zones: Partial<Record<ZoneId, number>> = {};
    for (const [userId, z] of this.zones) {
      if (z.server) users.add(userId);
      const zone = z.server ?? z.client;
      if (zone) zones[zone] = (zones[zone] ?? 0) + 1;
    }
    return { online: users.size, zones };
  }

  /** Forgets stale server-reported zones of users without a socket. */
  prune(now: number): string[] {
    const gone: string[] = [];
    for (const [userId, z] of this.zones) {
      if (!this.hasSocket(userId) && now - z.at > ZONE_TTL_MS) {
        this.zones.delete(userId);
        gone.push(userId);
      }
    }
    return gone;
  }
}
