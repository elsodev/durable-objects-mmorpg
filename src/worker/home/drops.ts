// Things the owner dropped on the ground at home, one pile per home map. Same rules as in the
// zones (game/groundItems.ts): only the owner sees and picks them up, and they're gone after a few
// minutes if left.
import { HOME_MAPS, type HomeMapId } from "../../shared/types";
import { GroundItems } from "../game/groundItems";

export class HomeDrops {
  readonly on: Record<HomeMapId, GroundItems> = { home: new GroundItems(), home_in: new GroundItems() };

  load(stored: unknown, now: number): void {
    const o = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<HomeMapId, unknown>>;
    for (const m of HOME_MAPS) this.on[m].load(o[m], now);
  }

  record(): Record<HomeMapId, unknown> {
    return { home: this.on.home.record(), home_in: this.on.home_in.record() };
  }
}
