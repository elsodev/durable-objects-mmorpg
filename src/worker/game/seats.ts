// Who sits where in a zone. Players and NPCs share one book, so nobody sits on anyone's lap.
// A sitter's entity stands at the seat tile's centre (the chair blocks walking, so only the
// sitter is ever there) with act { k: "sit" } and the seat's facing; standing up puts them back
// on a free tile next to the chair.

import { canStand, type CollisionGrid } from "../../shared/engine";
import type { EntityState, Seat, Vec2 } from "../../shared/types";

export const SIT_ACT = "sit";

const AROUND: [number, number][] = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
];

export class SeatBook {
  private readonly byId = new Map<string, Seat>();
  private readonly holder = new Map<string, string>();
  private readonly seatOf = new Map<string, string>();

  constructor(seats: readonly Seat[]) {
    for (const s of seats) this.byId.set(s.id, s);
  }

  get(id: string): Seat | undefined {
    return this.byId.get(id);
  }

  all(): Seat[] {
    return [...this.byId.values()];
  }

  isFree(id: string): boolean {
    return this.byId.has(id) && !this.holder.has(id);
  }

  free(): Seat[] {
    return this.all().filter((s) => !this.holder.has(s.id));
  }

  /** The seat an entity sits on, if any. */
  of(entityId: string): Seat | undefined {
    const id = this.seatOf.get(entityId);
    return id ? this.byId.get(id) : undefined;
  }

  /** Books the seat; false if it's taken or unknown. An entity holds at most one seat. */
  take(id: string, entityId: string): boolean {
    if (!this.isFree(id)) return this.holder.get(id) === entityId;
    this.release(entityId);
    this.holder.set(id, entityId);
    this.seatOf.set(entityId, id);
    return true;
  }

  /** Frees seats held by entities that are gone (left the zone, went home for the night). */
  retain(alive: ReadonlySet<string>): void {
    for (const who of [...this.seatOf.keys()]) if (!alive.has(who)) this.release(who);
  }

  release(entityId: string): void {
    const id = this.seatOf.get(entityId);
    if (!id) return;
    this.seatOf.delete(entityId);
    this.holder.delete(id);
  }
}

/** Where a sitter's entity goes: seat tile centre, facing the table. */
export function seatPose(seat: Seat): { x: number; y: number; facing: Seat["facing"] } {
  return { x: seat.x + 0.5, y: seat.y + 0.5, facing: seat.facing };
}

/**
 * Free tiles beside a seat a sitter can get up onto (centres), nearest to `near` first. Never
 * the tile the seat faces (that's the table).
 */
export function standSpots(grid: CollisionGrid, seat: Seat, near?: Vec2): Vec2[] {
  const spots: Vec2[] = [];
  for (const [dx, dy] of AROUND) {
    const p = { x: seat.x + dx + 0.5, y: seat.y + dy + 0.5 };
    if (canStand(grid, p.x, p.y)) spots.push(p);
  }
  if (near) spots.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
  return spots;
}

/** Puts an entity on the seat (pose + act). */
export function sitDown(e: EntityState, seat: Seat, now: number): void {
  const p = seatPose(seat);
  e.x = p.x;
  e.y = p.y;
  e.facing = p.facing;
  e.moving = false;
  // item names the character action art to play ("sit" holds its last frame until moving).
  e.act = { k: SIT_ACT, at: now, item: SIT_ACT };
}

export function isSitting(e: EntityState): boolean {
  return e.act?.k === SIT_ACT;
}

/** Gets an entity up off its seat onto `to` and clears the sit act. */
export function standUp(e: EntityState, to: Vec2): void {
  e.x = to.x;
  e.y = to.y;
  if (e.act?.k === SIT_ACT) delete e.act;
}
