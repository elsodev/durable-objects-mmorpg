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
import { applyYard, withoutTrees, type YardLayout } from "../../shared/yard";

export const HOME_OUT: MapData = getMap("home");
export const HOME_IN: MapData = getMap("home_in");

/** The base map of each home map (the yard before its owner rearranged it). */
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

/** Per-map collision grids and entity differs, and this home's yard as its owner laid it out. */
export class SubMaps {
  readonly grids: Record<HomeMapId, CollisionGrid>;
  private differs: Record<HomeMapId, EntityDiffer> = { home: new EntityDiffer(), home_in: new EntityDiffer() };
  /** The yard with the owner's layout (shared/yard.ts) laid over the base map. */
  yard: MapData = HOME_OUT;

  constructor(objects: HomeObjects, rocks?: { x: number; y: number }[]) {
    this.grids = { home: buildCollision(HOME_OUT), home_in: buildCollision(HOME_IN) };
    this.rebuild(objects, rocks);
  }

  /** This home's map `id`: its own yard, or the house inside (the same for everyone). */
  map(id: HomeMapId): MapData {
    return id === "home_in" ? HOME_IN : this.yard;
  }

  /**
   * Lays the owner's layout over the base yard, without the trees cleared away (`gone`): their
   * tiles are open ground until they grow back. Call rebuild() after, so collision follows.
   */
  setYard(layout: YardLayout, gone: ReadonlySet<string> = new Set()): void {
    this.yard = withoutTrees(applyYard(HOME_OUT, layout), gone);
  }

  /** Rocks (unbroken) and choppable trees only exist in the yard. */
  rebuild(objects: HomeObjects, rocks?: { x: number; y: number }[], trees?: { applyTo(grid: CollisionGrid): void }): void {
    this.grids.home = buildCollision(this.yard, { objects: objects.home, ...(rocks ? { rocks } : {}) });
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
export function doorArrival(to: HomeMapId, spawn: string, grid: CollisionGrid, map: MapData = homeMap(to)): Vec2 {
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
  yard: MapData = HOME_OUT,
): { map: HomeMapId; at: Vec2 } {
  const at = resolveSpawn(yard.spawns, "home", requested, saved, transfer, now);
  const named = requested !== "default" && at === yard.spawns[requested];
  const resumed = !named && saved.zone === "home" && at.x === saved.x && at.y === saved.y;
  return { map: resumed && isHomeMapId(saved.homeMap) ? saved.homeMap : "home", at: { ...at } };
}

/** Picks a standable position on `map`, falling back to its default spawn. */
export function standOn(grid: CollisionGrid, id: HomeMapId, at: Vec2 | null, map: MapData = homeMap(id)): Vec2 {
  if (at && canStand(grid, at.x, at.y)) return at;
  return { ...map.spawns.default! };
}

export { HOME_MAPS };
