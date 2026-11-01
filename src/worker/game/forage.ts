// Forage that grows in a zone (riverside herbs and mushrooms): every refill period the zone tops
// the forage on the ground back up to a cap that grows with the number of players.
import { Ground, type MapData, type SharedZoneId, type Vec2 } from "../../shared/types";
import { canStand, farFromPlayers, forageCap, planForage, weightedItem, type CollisionGrid } from "../../shared/engine";
import { FORAGE_RULES, type ForageRule } from "../../shared/spawns";
import type { GroundItem, GroundItems } from "./groundItems";
import { DEFAULT_DROP_RATES, dropCount, type DropRates } from "../../shared/engine/dropRate";

export class ForageGrower {
  private nextAt = 0;

  constructor(
    readonly rule: ForageRule,
    /** Tile centres forage may grow on. */
    readonly spots: readonly Vec2[],
  ) {}

  static forZone(zone: SharedZoneId, map: MapData, grid: CollisionGrid): ForageGrower | null {
    const rule = FORAGE_RULES[zone];
    if (!rule) return null;
    const spots = forageSpots(map, grid, rule);
    return spots.length > 0 ? new ForageGrower(rule, spots) : null;
  }

  /**
   * Tops up when the refill is due; returns the items that grew. The cap scales with
   * DROP_RATE_FORAGE (never past the spots there are).
   */
  refill(ground: GroundItems, players: readonly Vec2[], now: number, rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): GroundItem[] {
    if (now < this.nextAt) return [];
    this.nextAt = now + this.rule.refillMs;
    const cap = Math.min(this.spots.length, dropCount(forageCap(this.rule, players.length), "forage", rates));
    const want = planForage(ground.forageCount(), cap);
    const out: GroundItem[] = [];
    for (let n = 0; n < want; n++) {
      const spot = this.pickSpot(ground, players, rand);
      const pick = spot ? weightedItem(this.rule.table, rand) : null;
      const g = spot && pick ? ground.forage(pick.item, spot) : null;
      if (g) out.push(g);
    }
    return out;
  }

  private pickSpot(ground: GroundItems, players: readonly Vec2[], rand: () => number): Vec2 | null {
    for (let i = 0; i < 11; i++) {
      const s = this.spots[Math.floor(rand() * this.spots.length)];
      if (s && farFromPlayers(s, players, this.rule.minPlayerDist) && !ground.occupied(s)) return s;
    }
    return null;
  }
}

/** Open grass tiles within `nearRadius` of a prop of the rule's type. */
export function forageSpots(map: MapData, grid: CollisionGrid, rule: Pick<ForageRule, "near" | "nearRadius">): Vec2[] {
  const seen = new Set<number>();
  const out: Vec2[] = [];
  const r = rule.nearRadius;
  for (const p of map.props) {
    if (p.type !== rule.near) continue;
    for (let y = p.y - r; y < p.y + p.h + r; y++) {
      for (let x = p.x - r; x < p.x + p.w + r; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        const k = y * map.width + x;
        if (seen.has(k) || map.ground[k] !== Ground.Grass) continue;
        seen.add(k);
        if (canStand(grid, x + 0.5, y + 0.5)) out.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  return out;
}
