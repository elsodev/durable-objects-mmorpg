// Thin seam to the global SocialRoom Durable Object (src/worker/social/room.ts; binding SOCIAL,
// idFromName(SOCIAL_ROOM)), which owns
// the /ws/social sockets, presence and push notifications. The binding is looked up at runtime so the
// friends API works without it: everyone reads as offline and notifications are dropped.
// Expected SocialRoom RPCs:
//   notify(userId: string, payload: unknown): Promise<unknown>   -> sends { t: "social", payload } to that user's sockets
//   presenceOf(userIds: string[]): Promise<{ userId: string; online: boolean; zone: string | null }[]>

import { SOCIAL_ROOM } from "./social/hooks";

export interface Presence {
  userId: string;
  online: boolean;
  zone: string | null;
}

export interface SocialAdapter {
  /** True when a SOCIAL binding exists (presence is real, not just "offline"). */
  readonly available: boolean;
  notify(userId: string, payload: unknown): Promise<void>;
  /** One entry per requested id, in the same order; offline when unknown or on any failure. */
  presenceOf(userIds: string[]): Promise<Presence[]>;
}

interface SocialStub {
  notify(userId: string, payload: unknown): Promise<unknown>;
  presenceOf(userIds: string[]): Promise<unknown>;
}

interface SocialNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): SocialStub;
}

const MAX_ZONE_LEN = 32;

function socialNamespace(env: object): SocialNamespace | null {
  const ns = (env as { SOCIAL?: unknown }).SOCIAL;
  if (!ns || typeof ns !== "object") return null;
  const n = ns as Partial<SocialNamespace>;
  return typeof n.idFromName === "function" && typeof n.get === "function" ? (ns as SocialNamespace) : null;
}

function offline(userId: string): Presence {
  return { userId, online: false, zone: null };
}

/** Normalises whatever presenceOf returned into one trusted entry per requested id. */
export function normalisePresence(userIds: string[], raw: unknown): Presence[] {
  const byId = new Map<string, Presence>();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const { userId, online, zone } = r as Record<string, unknown>;
      if (typeof userId !== "string") continue;
      const on = online === true;
      const z = on && typeof zone === "string" && zone ? zone.slice(0, MAX_ZONE_LEN) : null;
      byId.set(userId, { userId, online: on, zone: z });
    }
  }
  return userIds.map((id) => byId.get(id) ?? offline(id));
}

export function socialAdapter(env: object): SocialAdapter {
  const ns = socialNamespace(env);
  if (!ns) {
    return {
      available: false,
      notify: async () => {},
      presenceOf: async (ids) => ids.map(offline),
    };
  }
  const stub = (): SocialStub => ns.get(ns.idFromName(SOCIAL_ROOM));
  return {
    available: true,
    async notify(userId, payload) {
      try {
        await stub().notify(userId, payload);
      } catch (err) {
        // A missed push only delays the other side's list until its next poll.
        console.warn("social notify failed", err);
      }
    },
    async presenceOf(userIds) {
      if (userIds.length === 0) return [];
      try {
        return normalisePresence(userIds, await stub().presenceOf(userIds));
      } catch (err) {
        console.warn("social presence failed", err);
        return userIds.map(offline);
      }
    },
  };
}
