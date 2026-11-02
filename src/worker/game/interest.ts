// Interest management: each player gets every change to what is near them on every tick, and
// changes to everything farther away batched to a few times a second. Far entities are off
// screen, so nobody sees the difference, and each message carries only what that player needs.
import type { EntityState, Vec2 } from "../../shared/types";

/** Tiles around a player that update every tick (a 1280 px wide view is 40 tiles across). */
export const NEAR_TILES = 24;
/** Far entities are sent every this many ticks (10 Hz / 5 = twice a second). */
export const FAR_EVERY_TICKS = 5;

const near = (a: Vec2, b: Vec2): boolean => Math.abs(a.x - b.x) <= NEAR_TILES && Math.abs(a.y - b.y) <= NEAR_TILES;

export class PlayerInterest {
  /** Latest unsent snapshot of each far entity that changed. */
  private pending = new Map<string, EntityState>();

  /** `phase` spreads the far flushes of different players over different ticks. */
  constructor(private readonly phase: number) {}

  /**
   * What to send this player this tick, from the zone-wide diff. Removals always go at once;
   * changes near `me` go now, far ones wait for this player's flush tick (newest wins), and a
   * waiting change is sent as soon as its entity comes near.
   */
  filter(upd: readonly EntityState[], del: readonly string[], me: Vec2, tick: number): { upd: EntityState[]; del: string[] } {
    const out: EntityState[] = [];
    for (const id of del) this.pending.delete(id);
    for (const e of upd) {
      if (near(e, me)) {
        this.pending.delete(e.id);
        out.push(e);
      } else {
        this.pending.set(e.id, e);
      }
    }
    const flushAll = (tick + this.phase) % FAR_EVERY_TICKS === 0;
    for (const [id, e] of this.pending) {
      if (flushAll || near(e, me)) {
        out.push(e);
        this.pending.delete(id);
      }
    }
    return { upd: out, del: [...del] };
  }

  /** Changes still waiting (tests). */
  waiting(): number {
    return this.pending.size;
  }
}
