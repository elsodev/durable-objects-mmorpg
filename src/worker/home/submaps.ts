// The two maps of one HomeRoom: the yard ("home") and the inside of the house ("home_in").
// Both share the home's save, clock and visitors; everyone at home stands on exactly one of them.
// This module keeps what is per map (collision grid, entity differ, placed furniture) and the
// rules for moving between them, so HomeRoom only asks "which map is this person on".
import { getMap } from "../../shared/maps";
import { HOME_MAPS, isHomeMapId, type EntityState, type HomeMapId, type MapData, type MapExit, type PlacedObject, type Vec2 } from "../../shared/types";
import { buildCollision, canStand, type CollisionGrid } from "../../shared/engine";
import type { ServerMsg } from "../../shared/protocol";
import { EntityDiffer } from "../game/diff";
import { send } from "../game/net";
import { resolveSpawn, type PendingTransfer, type SavedPlace } from "../game/spawn";

export const HOME_OUT: MapData = getMap("home");
export const HOME_IN: MapData = getMap("home_in");

export function homeMap(id: HomeMapId): MapData {
  return id === "home_in" ? HOME_IN : HOME_OUT;
}

/** Placed furniture of each home map (ids are unique across both). */
export type HomeObjects = Record<HomeMapId, PlacedObject[]>;

export function emptyObjects(): HomeObjects {
  return { home: [], home_in: [] };
}

export function allObjects(o: HomeObjects): PlacedObject[] {
  return [...o.home, ...o.home_in];
}

/** Anyone standing at home: the owner or a visitor. */
export interface Present {
  ws: WebSocket;
  map: HomeMapId;
  entity: EntityState;
}

/** Per-map collision grids and entity differs. */
export class SubMaps {
  readonly grids: Record<HomeMapId, CollisionGrid>;
  private differs: Record<HomeMapId, EntityDiffer> = { home: new EntityDiffer(), home_in: new EntityDiffer() };

  constructor(objects: HomeObjects, rocks?: { x: number; y: number }[]) {
    this.grids = { home: buildCollision(HOME_OUT), home_in: buildCollision(HOME_IN) };
    this.rebuild(objects, rocks);
  }

  /** Rocks (unbroken) and choppable trees only exist in the yard. */
  rebuild(objects: HomeObjects, rocks?: { x: number; y: number }[], trees?: { applyTo(grid: CollisionGrid): void }): void {
    this.grids.home = buildCollision(HOME_OUT, { objects: objects.home, ...(rocks ? { rocks } : {}) });
    trees?.applyTo(this.grids.home);
    this.grids.home_in = buildCollision(HOME_IN, { objects: objects.home_in });
  }

  /**
   * What changed on one map since its last tick (everyone on that map gets the same diff).
   * `others`: entities that aren't people (the yard's animals).
   */
  diff(id: HomeMapId, people: readonly Present[], others: readonly EntityState[] = []): { upd: EntityState[]; del: string[] } {
    return this.differs[id].diff([...onMap(people, id).map((p) => p.entity), ...others]);
  }
}

export function onMap<T extends Present>(people: readonly T[], id: HomeMapId): T[] {
  return people.filter((p) => p.map === id);
}

export function entitiesOn(people: readonly Present[], id: HomeMapId): EntityState[] {
  return onMap(people, id).map((p) => p.entity);
}

/** Sends to everyone on one home map. */
export function toMap(people: readonly Present[], id: HomeMapId, msg: ServerMsg): void {
  for (const p of onMap(people, id)) send(p.ws, msg);
}

/** The home map a door exit leads to, or null for a real exit (to the village). */
export function doorTarget(exit: MapExit): HomeMapId | null {
  return exit.to === "home" && isHomeMapId(exit.map) ? exit.map : null;
}

/**
 * Where you appear on `to` after walking through a door: its named spawn, nudged to the map's
 * default when furniture or a body can't stand there.
 */
export function doorArrival(to: HomeMapId, spawn: string, grid: CollisionGrid): Vec2 {
  const map = homeMap(to);
  const at = Object.hasOwn(map.spawns, spawn) ? map.spawns[spawn]! : map.spawns.default!;
  return canStand(grid, at.x, at.y) ? { ...at } : { ...map.spawns.default! };
}

/** The saved position, with the home map it was on (saves from before the house read as the yard). */
export interface HomePlace extends SavedPlace {
  homeMap?: HomeMapId;
}

/**
 * Where the owner appears on connect: a matching named spawn (always in the yard: that is where
 * the road from the village arrives), else the saved position on its saved map, else the yard's
 * default (the doorstep).
 */
export function resolveHomeArrival(
  requested: string,
  saved: HomePlace,
  transfer: PendingTransfer | null | undefined,
  now: number,
): { map: HomeMapId; at: Vec2 } {
  const at = resolveSpawn(HOME_OUT.spawns, "home", requested, saved, transfer, now);
  const named = requested !== "default" && at === HOME_OUT.spawns[requested];
  const resumed = !named && saved.zone === "home" && at.x === saved.x && at.y === saved.y;
  return { map: resumed && isHomeMapId(saved.homeMap) ? saved.homeMap : "home", at: { ...at } };
}

/** Picks a standable position on `map`, falling back to its default spawn. */
export function standOn(grid: CollisionGrid, id: HomeMapId, at: Vec2 | null): Vec2 {
  if (at && canStand(grid, at.x, at.y)) return at;
  return { ...homeMap(id).spawns.default! };
}

export { HOME_MAPS };
