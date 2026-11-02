// Pure helpers for the right-click player card (no DOM), tested in test/fe-player-card.test.ts.
import type { Friendship, PlayerCard } from "../../shared/players";
import { zoneLabel } from "./friends-logic";

/** A player under the pointer (GameApi.playerAt). */
export interface PlayerHit {
  entityId: string;
  userId: string;
  name: string;
  self: boolean;
  /** Wears the admin halo (admins can't be kicked, so the card offers no Kick). */
  admin?: boolean;
}

/** The card closes once its player is further than this (tiles) from you, or gone. */
export const CARD_LEAVE_TILES = 9;
export const CARD_WATCH_MS = 250;

export function shouldCloseForDistance(distance: number | null): boolean {
  return distance === null || !Number.isFinite(distance) || distance > CARD_LEAVE_TILES;
}

/** Top-left for a w×h card near the cursor, kept 8px inside the viewport. */
export function placeCard(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const pad = 8;
  // Prefer right of and below the cursor; flip when that would leave the screen.
  let left = x + 12;
  let top = y + 12;
  if (left + w > vw - pad) left = x - w - 12;
  if (top + h > vh - pad) top = vh - h - pad;
  return { left: Math.max(pad, Math.min(left, vw - w - pad)), top: Math.max(pad, top) };
}

export type FriendAction = "add" | "accept" | "remove" | null;

/** Label and click action of the friend button for a relation. */
export function friendButton(f: Friendship): { label: string; action: FriendAction; disabled: boolean } {
  switch (f) {
    case "friends":
      return { label: "Friends ✓", action: "remove", disabled: false };
    case "outgoing":
      return { label: "Request sent", action: null, disabled: true };
    case "incoming":
      return { label: "Accept friend", action: "accept", disabled: false };
    case "self":
      return { label: "", action: null, disabled: true };
    default:
      return { label: "Add friend", action: "add", disabled: false };
  }
}

export type CardButton = "friend" | "whisper" | "trade" | "invite" | "mute" | "kick" | "jail";

export interface CardContext {
  viewerGuest: boolean;
  /** You are in your own home (so you can invite). */
  homeOwner: boolean;
  /** You are out in a shared zone, where players can trade. */
  canTrade?: boolean;
  /** You are an admin (the server checks again on every kick). */
  admin?: boolean;
}

/**
 * Which action buttons the card shows. None on your own card; guests get none; a guest target can
 * only be muted. Trade only out in a shared zone (never with villagers: the card is for players).
 */
export function cardButtons(hit: Pick<PlayerHit, "self" | "admin">, card: PlayerCard | null, ctx: CardContext): CardButton[] {
  if (hit.self || card?.self) return [];
  if (ctx.viewerGuest) return [];
  const kick: CardButton[] = ctx.admin && !hit.admin ? ["kick"] : [];
  if (card?.guest) return ["mute", ...kick];
  const out: CardButton[] = ["friend", "whisper"];
  if (ctx.canTrade) out.push("trade");
  if (ctx.homeOwner) out.push("invite");
  out.push("mute");
  // Jail needs a save to hold the sentence, so guests can only be kicked.
  return [...out, ...kick, ...(kick.length ? (["jail"] as CardButton[]) : [])];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-04" -> "Mar 4, 2026". */
export function joinedLabel(day: string | null): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return "—";
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

const FRIENDSHIP_LABELS: Record<Friendship, string> = {
  self: "That's you!",
  friends: "Friends",
  outgoing: "Request sent",
  incoming: "Wants to be friends",
  none: "Not friends yet",
};

/** Status line under the name: "Online · Village" / "Offline". */
export function presenceLine(card: PlayerCard | null): string {
  if (!card) return "…";
  if (card.minimal && !card.self) return card.guest ? "Guest" : "Visitor";
  return zoneLabel(card.online, card.zone);
}

/** Label/value rows of the stats block; empty for minimal cards. */
export function statRows(card: PlayerCard | null): [string, string][] {
  if (!card || card.minimal) return [];
  const n = (v: number | undefined): string => (v === undefined ? "—" : v.toLocaleString("en-US"));
  return [
    ["Joined", joinedLabel(card.joined)],
    ["Home day", card.homeDay === null ? "—" : String(card.homeDay)],
    ["Crops harvested", n(card.stats?.cropsHarvested)],
    ["Monsters defeated", n(card.stats?.monstersDefeated)],
    ["Ores mined", n(card.stats?.oresMined)],
    ["Friendship", FRIENDSHIP_LABELS[card.friendship]],
  ];
}
