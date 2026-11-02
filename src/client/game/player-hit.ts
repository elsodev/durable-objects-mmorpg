// Right-click hit test for players: which player (if any) a pointer lands on, from the entity the
// sprite hit test found (EntityLayer.entityAt). Pure, tested in test/fe-player-card.test.ts.
import type { EntityState, Vec2 } from "../../shared/types";
import { userIdOfEntity } from "../../shared/players";
import type { PlayerHit } from "../ui/player-card-logic";

/** The player behind entity `id` (yourself included, flagged), or null for NPCs, monsters and nothing. */
export function playerHit(id: string | null, state: Pick<EntityState, "kind" | "name" | "admin"> | undefined, youId: string | null): PlayerHit | null {
  if (!id || state?.kind !== "player") return null;
  const userId = userIdOfEntity(id);
  if (!userId) return null;
  return { entityId: id, userId, name: state.name, self: id === youId, ...(state.admin ? { admin: true } : {}) };
}

/** Tiles between two entities' feet. */
export function tileDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
