// Where each villager likes to spend the day out of doors, and the pure choice of where they go
// next. The village map marks the spots (MapData.hangouts: round the fountain, by the pond, at
// their own garden) and the benches (MapData.seats); the zone's NPC runner walks them there.
// Pure: the caller passes `rand`.

import type { Hangout, HangoutKind, Seat } from "./types";

/** "seat" = sit on a free bench; "post" = back to their own spot (the map's NPC spawn). */
export type StopKind = HangoutKind | "seat" | "post";

export type Stop = { kind: "hangout"; hangout: Hangout } | { kind: "seat"; seat: Seat } | { kind: "post" };

/**
 * Relative weights per villager. Odette is missing on purpose: she minds her stall all day.
 * Villagers with no entry keep the old behaviour (a short wander round their spot).
 */
export const NPC_HANGOUTS: Readonly<Record<string, Readonly<Partial<Record<StopKind, number>>>>> = {
  // The mayor does the rounds: the fountain, the notice board, the benches, his flower bed.
  bram: { fountain: 3, notice: 2, seat: 2, pond: 2, yard: 1, market: 1, post: 1 },
  // Pip never stays put.
  pip: { fountain: 3, pond: 3, well: 2, market: 1, yard: 1, post: 1 },
  // Fenwick mostly works the forge yard; now and then a drink from the well or a sit.
  fenwick: { post: 6, well: 1, seat: 1 },
  // Rue greets people on the porch and pops over to the stalls.
  rue: { porch: 4, post: 2, market: 1, fountain: 1 },
  iris: { garden: 5, pond: 3, seat: 1 },
  marlo: { dock: 6, pond: 2, seat: 1 },
  tess: { notice: 4, fountain: 1, market: 1, seat: 1 },
  grumm: { seat: 4, fountain: 2, market: 1 },
};

export function roamsOutdoors(npcId: string): boolean {
  return Object.hasOwn(NPC_HANGOUTS, npcId);
}

/**
 * Next stop for `npcId`: a weighted pick among the kinds it likes that have somewhere free to go
 * (owner-only spots belong to their owner; `busy` hangout ids are taken by someone else), then
 * an even pick within the kind. Null when there is nowhere to go.
 */
export function pickStop(
  npcId: string,
  hangouts: readonly Hangout[],
  freeSeats: readonly Seat[],
  rand: () => number,
  busy: ReadonlySet<string> = new Set(),
): Stop | null {
  const likes = Object.hasOwn(NPC_HANGOUTS, npcId) ? NPC_HANGOUTS[npcId]! : {};
  const open = hangouts.filter((h) => (!h.owner || h.owner === npcId) && !busy.has(h.id));
  const options: { kind: StopKind; weight: number }[] = [];
  for (const [kind, weight] of Object.entries(likes) as [StopKind, number][]) {
    if (weight <= 0) continue;
    const available = kind === "post" ? true : kind === "seat" ? freeSeats.length > 0 : open.some((h) => h.kind === kind);
    if (available) options.push({ kind, weight });
  }
  const total = options.reduce((a, o) => a + o.weight, 0);
  if (total <= 0) return null;
  let roll = rand() * total;
  let kind = options[options.length - 1]!.kind;
  for (const o of options) {
    roll -= o.weight;
    if (roll < 0) {
      kind = o.kind;
      break;
    }
  }
  const one = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;
  if (kind === "post") return { kind: "post" };
  if (kind === "seat") return { kind: "seat", seat: one(freeSeats) };
  return { kind: "hangout", hangout: one(open.filter((h) => h.kind === kind)) };
}
