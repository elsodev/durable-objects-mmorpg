// Friend request lifecycle: request (auto-accepts a crossed request), respond, remove, list.
// Callers pass an already-validated account user; every outcome is a status + JSON body.
import {
  MAX_FRIENDS,
  MAX_PENDING_OUT,
  sortFriends,
  type FriendNotice,
  type FriendRequestResult,
  type FriendsList,
} from "../../shared/friends";
import type { SocialAdapter } from "../social-adapter";
import * as store from "./store";

export interface Me {
  id: string;
  name: string;
}

export type Outcome = { status: number; body: unknown };

const ok = (body: unknown, status = 200): Outcome => ({ status, body });
const fail = (status: number, error: string): Outcome => ({ status, body: { error } });

async function push(social: SocialAdapter, userId: string, payload: FriendNotice): Promise<void> {
  await social.notify(userId, payload);
}

export async function listFor(db: D1Database, social: SocialAdapter, me: Me): Promise<FriendsList> {
  const [friends, incoming, outgoing] = await Promise.all([
    store.listFriends(db, me.id),
    store.listIncoming(db, me.id),
    store.listOutgoing(db, me.id),
  ]);
  // Presence (and so zone) is only ever asked for accepted friends.
  const presence = await social.presenceOf(friends.map((f) => f.id));
  return {
    friends: sortFriends(
      friends.map((f, i) => ({
        userId: f.id,
        name: f.name,
        online: presence[i]?.online ?? false,
        zone: presence[i]?.online ? (presence[i]?.zone ?? null) : null,
        since: Number(f.since),
      })),
    ),
    incoming: incoming.map((r) => ({ userId: r.id, name: r.name, at: Number(r.at) })),
    outgoing: outgoing.map((r) => ({ userId: r.id, name: r.name, at: Number(r.at) })),
    limits: { maxFriends: MAX_FRIENDS, maxPendingOut: MAX_PENDING_OUT },
  };
}

async function accept(db: D1Database, social: SocialAdapter, me: Me, from: store.UserRow, now: number): Promise<Outcome> {
  if (await store.acceptRequest(db, from.id, me.id, now)) {
    await push(social, from.id, { t: "friendAccepted", userId: me.id, name: me.name });
    const result: FriendRequestResult = { status: "accepted", user: { userId: from.id, name: from.name } };
    return ok(result);
  }
  if (await store.areFriends(db, me.id, from.id)) {
    return ok({ status: "accepted", user: { userId: from.id, name: from.name } } satisfies FriendRequestResult);
  }
  if (!(await store.hasRequest(db, from.id, me.id))) return fail(404, "That friend request is gone.");
  if ((await store.friendCount(db, me.id)) >= MAX_FRIENDS) {
    return fail(409, `Your friends list is full (${MAX_FRIENDS}).`);
  }
  return fail(409, `${from.name}'s friends list is full.`);
}

export async function request(db: D1Database, social: SocialAdapter, me: Me, name: string, now: number): Promise<Outcome> {
  // Rate limit before the lookup, so it also bounds probing which names exist.
  if (!(await store.takeRequestQuota(db, me.id, now))) {
    return fail(429, "You've sent a lot of friend requests. Try again in a while.");
  }
  const found = await store.findUsersByName(db, name);
  if (found.length === 0) return fail(404, `No player named ${name}.`);
  if (found.length > 1) return fail(409, `Several players are called ${name}; ask them for their exact name.`);
  const other = found[0]!;
  if (other.id === me.id) return fail(400, "You can't add yourself as a friend.");
  if (await store.areFriends(db, me.id, other.id)) return fail(409, `${other.name} is already your friend.`);

  // They already asked you: asking back means yes.
  if (await store.hasRequest(db, other.id, me.id)) return accept(db, social, me, other, now);

  if (await store.hasRequest(db, me.id, other.id)) return fail(409, `You already asked ${other.name}.`);
  if ((await store.friendCount(db, me.id)) >= MAX_FRIENDS) {
    return fail(409, `Your friends list is full (${MAX_FRIENDS}).`);
  }
  if (!(await store.insertRequest(db, me.id, other.id, now))) {
    if (await store.hasRequest(db, me.id, other.id)) return fail(409, `You already asked ${other.name}.`);
    return fail(409, `You have ${MAX_PENDING_OUT} requests waiting; cancel one first.`);
  }
  await push(social, other.id, { t: "friendRequest", fromId: me.id, fromName: me.name });
  const result: FriendRequestResult = { status: "requested", user: { userId: other.id, name: other.name } };
  return ok(result, 201);
}

export async function respond(
  db: D1Database,
  social: SocialAdapter,
  me: Me,
  fromId: string,
  yes: boolean,
  now: number,
): Promise<Outcome> {
  if (!yes) {
    // Declines are silent: the sender just sees the request disappear.
    return (await store.deleteRequest(db, fromId, me.id)) ? ok({ status: "declined" }) : fail(404, "That friend request is gone.");
  }
  const rows = await db.prepare(`SELECT id, name FROM "user" WHERE id = ?`).bind(fromId).all<store.UserRow>();
  const from = rows.results?.[0];
  if (!from) return fail(404, "That friend request is gone.");
  return accept(db, social, me, from, now);
}

export async function remove(db: D1Database, social: SocialAdapter, me: Me, otherId: string): Promise<Outcome> {
  if (otherId === me.id) return fail(400, "That's you.");
  const wereFriends = await store.areFriends(db, me.id, otherId);
  if (!(await store.removeFriend(db, me.id, otherId))) return fail(404, "Not on your friends list.");
  if (wereFriends) await push(social, otherId, { t: "friendRemoved", userId: me.id });
  return ok({ status: "removed" });
}
