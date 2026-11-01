// The visitors standing in one HomeRoom. Visitors never touch their own save while here (their own
// HomeRoom keeps its lease and data); they only exist as an entity plus a socket, and when the
// visit ends they are told to reconnect to the zone they came from.
import type { EntityState, HomeMapId, Look, Vec2, ZoneId } from "../../shared/types";
import { MAX_VISITORS, type VisitorEntry } from "../../shared/visits";
import { SLEEP_COUNTDOWN_MS } from "../game/homeTiming";
import { entityIdFor, PLAYER_MAX_HP, type SocketAttachment } from "../game/identity";
import { Motion } from "../game/motion";
import { closeQuietly, send } from "../game/net";
import { SocketLimiter } from "../game/rateLimit";
import { shownLook } from "../game/look";

/** Stored in SocketAttachment.visit so a woken HomeRoom can rebuild its visitors. */
export interface VisitAttachment {
  returnTo: ZoneId;
  sprite: string;
  look?: Look;
}

export interface Visitor {
  ws: WebSocket;
  userId: string;
  name: string;
  /** Which of the host's home maps the visitor stands on. */
  map: HomeMapId;
  entity: EntityState;
  motion: Motion;
  lastAck: number | undefined;
  lastUse: number;
  lastEmote: number;
  limiter: SocketLimiter;
  sid: string | null;
  authCheckedAt: number;
  returnTo: ZoneId;
}

/** How long the owner's "going to sleep" countdown runs: only when someone else is here to see it. */
export function sleepCountdownFor(visitorCount: number): number {
  return visitorCount > 0 ? SLEEP_COUNTDOWN_MS : 0;
}

export class VisitorSet {
  private byWs = new Map<WebSocket, Visitor>();

  get size(): number {
    return this.byWs.size;
  }

  get full(): boolean {
    return this.byWs.size >= MAX_VISITORS;
  }

  get(ws: WebSocket): Visitor | undefined {
    return this.byWs.get(ws);
  }

  byUser(userId: string): Visitor | undefined {
    for (const v of this.byWs.values()) if (v.userId === userId) return v;
    return undefined;
  }

  byName(name: string): Visitor | undefined {
    const n = name.trim().toLowerCase();
    for (const v of this.byWs.values()) if (v.name.toLowerCase() === n) return v;
    return undefined;
  }

  all(): Visitor[] {
    return [...this.byWs.values()];
  }

  entities(): EntityState[] {
    return this.all().map((v) => v.entity);
  }

  list(): VisitorEntry[] {
    return this.all().map((v) => ({ userId: v.userId, name: v.name }));
  }

  add(ws: WebSocket, att: SocketAttachment & { visit: VisitAttachment }, at: Vec2, authCheckedAt: number, now: number): Visitor {
    const v: Visitor = {
      ws,
      userId: att.userId,
      name: att.name,
      map: "home",
      entity: {
        id: entityIdFor(att.userId),
        kind: "player",
        name: att.name,
        sprite: att.visit.sprite,
        x: at.x,
        y: at.y,
        facing: "down",
        moving: false,
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        look: shownLook(att.visit.look),
      },
      motion: new Motion(),
      lastAck: undefined,
      lastUse: 0,
      lastEmote: 0,
      limiter: new SocketLimiter(now),
      sid: att.sid ?? null,
      authCheckedAt,
      returnTo: att.visit.returnTo,
    };
    this.byWs.set(ws, v);
    return v;
  }

  /** Forgets the visitor without telling them anything (socket already closed). */
  remove(v: Visitor): boolean {
    return this.byWs.delete(v.ws);
  }

  /** Ends the visit: notice, then "go back where you came from", then close. */
  sendHome(v: Visitor, reason: string): void {
    this.byWs.delete(v.ws);
    send(v.ws, { t: "notice", text: reason, kind: "info" });
    send(v.ws, { t: "zone", to: v.returnTo, spawn: "default" });
    closeQuietly(v.ws, 1000, "visit over");
  }
}
