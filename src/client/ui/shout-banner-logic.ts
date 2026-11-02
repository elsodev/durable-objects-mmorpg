// Pure helpers for the admin shout banner (ui/shout-banner.ts): marquee timing, how long a
// reduced-motion banner stays, and which shouts are new. No DOM.
import type { Shout } from "../../shared/admin";

/** Marquee speed in CSS px per second: readable at a glance, like a shop-window ticker. */
export const MARQUEE_PX_PER_S = 90;
/** Times the text crosses the banner before it closes by itself. */
export const MARQUEE_PASSES = 2;
/** One pass never runs shorter than this, so short shouts don't zip by. */
export const MIN_PASS_MS = 6_000;
/** Reduced motion (no scrolling): the banner stays this long plus a little per character. */
export const STATIC_BASE_MS = 8_000;
export const STATIC_PER_CHAR_MS = 60;
export const STATIC_MAX_MS = 25_000;
/** Remembers the last shout this browser saw, so a reconnect or reload doesn't replay it. */
export const SEEN_KEY = "dmmo.shout.seen";

export interface MarqueeTiming {
  /** translateX at the start (text just off the right edge) and the end (just off the left). */
  fromPx: number;
  toPx: number;
  /** Duration of one pass. */
  passMs: number;
}

/** The text enters from the right edge of the track and leaves past its left edge. */
export function marqueeTiming(trackW: number, textW: number, pxPerS = MARQUEE_PX_PER_S): MarqueeTiming {
  const track = Math.max(0, trackW);
  const text = Math.max(0, textW);
  const distance = track + text;
  const passMs = Math.max(MIN_PASS_MS, Math.round((distance / Math.max(1, pxPerS)) * 1000));
  return { fromPx: Math.round(track), toPx: -Math.round(text), passMs };
}

/** How long the whole announcement plays before the end chime. */
export function showMs(timing: MarqueeTiming, passes = MARQUEE_PASSES): number {
  return timing.passMs * Math.max(1, passes);
}

/** Reduced motion: time to read it, then close. */
export function staticMs(text: string): number {
  return Math.min(STATIC_MAX_MS, STATIC_BASE_MS + Array.from(text).length * STATIC_PER_CHAR_MS);
}

/** Header line over the text; the admin's name is untrusted and only ever set as textContent. */
export function shoutTitle(s: Pick<Shout, "name">): string {
  return s.name ? `Announcement from ${s.name}` : "Announcement";
}

/** Show this shout unless it is the one already seen (or showing). */
export function isNewShout(s: Pick<Shout, "id">, seenId: string | null, showingId: string | null): boolean {
  return s.id !== seenId && s.id !== showingId;
}
