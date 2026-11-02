// What happens when a sword swing catches a friendly animal: it isn't hurt, but it is upset with
// whoever swung. Pure rules only; ZoneRoom and HomeRoom apply them (worker/game/animalUpset.ts).
import { MAX_AFFECTION, HEART_PTS, type AnimalBond, type Species } from "./animals";

/** Affection one sword hit costs: one whole heart, so the drop always shows on the card. */
export const HIT_PTS = HEART_PTS;
/**
 * After a hit, the same player can't upset the same animal again for this long: a burst of swings
 * costs one heart, not five, and the animal gets to finish running off.
 */
export const HIT_COOLDOWN_MS = 4000;

export type UpsetEmote = "angry" | "scared";

/** Dogs stand their ground and get cross; cats and hens are frightened. */
export function upsetEmote(species: Species): UpsetEmote {
  return species === "dog" ? "angry" : "scared";
}

export interface HurtResult {
  /** Affection change (0 or negative). */
  delta: number;
  before: number;
  after: number;
}

/** Takes `pts` affection off the bond, never below zero. */
export function hurtBond(b: AnimalBond, pts = HIT_PTS): HurtResult {
  const before = Math.min(MAX_AFFECTION, Math.max(0, b.pts));
  const after = Math.max(0, before - Math.max(0, pts));
  b.pts = after;
  return { delta: after - before, before, after };
}

/** The notice the swinger gets. */
export function upsetLine(name: string, emote: UpsetEmote): string {
  return emote === "angry" ? `${name} is upset with you.` : `${name} is scared of you.`;
}

/**
 * Per player and animal: whether a hit counts now. Keyed by caller (e.g. "user:animal"). Old keys
 * are swept as new hits arrive so the map can't grow without bound.
 */
export class HitCooldown {
  private last = new Map<string, number>();
  constructor(private readonly ms = HIT_COOLDOWN_MS) {}

  allow(key: string, now: number): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.ms) return false;
    if (this.last.size > 256) for (const [k, t] of this.last) if (now - t >= this.ms) this.last.delete(k);
    this.last.set(key, now);
    return true;
  }
}
