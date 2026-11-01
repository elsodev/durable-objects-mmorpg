// What makes a furnished room physically sensible. The furniture placer only accepts layouts with
// no problems, and the tests run the same checks over every interior (and fuzzed seeds).

import { buildCollision, canStand, isBlocked } from "../../engine";
import type { Facing, MapData, MapProp, Seat } from "../../types";
import { columnsBehindTallFurniture } from "./room";
import {
  ALONG_WALL_PROPS,
  NORTH_WALL_PROPS,
  SEAT_FACING,
  SURFACE_PROPS,
  TABLE_PROPS,
  TABLETOP_PROPS,
  PICTURE_HIDING_PROPS,
  WALL_DECOR_PROPS,
  isBed,
} from "./props";

/** Share of the floor that must stay open (not under furniture; rugs count as open). */
export const MIN_OPEN_FLOOR = 0.4;
/** A floor lamp stands within this many tiles (Chebyshev) of a seat. */
export const LAMP_REACH = 2;

const STEP: Record<Facing, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

export function facingStep(f: Facing): [number, number] {
  return STEP[f];
}

/** The floor rectangle of an interior: inside the side walls, below the 3-row north wall. */
export function floorRect(map: MapData): { x: number; y: number; w: number; h: number } {
  return { x: 1, y: 3, w: map.width - 2, h: map.height - 4 };
}

function propAt(map: MapData, x: number, y: number, solidOnly = true): MapProp | undefined {
  return map.props.find((p) => (!solidOnly || !p.walkable) && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

const isWallPiece = (p: MapProp) => p.type.startsWith("iwall_") || p.type === "stairs_up";

/**
 * Seats of a room, from its seat props: chairs face the way their sprite says; a stool faces the
 * counter next to it (north first).
 */
export function deriveSeats(map: Pick<MapData, "props">): Seat[] {
  const seats: Seat[] = [];
  for (const p of map.props) {
    const f = SEAT_FACING[p.type];
    if (!f) continue;
    let facing: Facing | null = f === "counter" ? null : f;
    if (!facing) {
      for (const cand of ["up", "left", "right", "down"] as const) {
        const [dx, dy] = STEP[cand];
        const t = map.props.find((q) => q.type === "bar_counter" && p.x + dx >= q.x && p.x + dx < q.x + q.w && p.y + dy >= q.y && p.y + dy < q.y + q.h);
        if (t) {
          facing = cand;
          break;
        }
      }
    }
    seats.push({ id: p.id, x: p.x, y: p.y, facing: facing ?? "down" });
  }
  return seats;
}

/** Floor tiles reachable on foot from the arrival spot. */
export function reachable(map: MapData): { grid: ReturnType<typeof buildCollision>; seen: Uint8Array } {
  const grid = buildCollision(map);
  const seen = new Uint8Array(map.width * map.height);
  const s = map.spawns.from_village ?? map.spawns.default!;
  const start = Math.floor(s.y) * map.width + Math.floor(s.x);
  const queue = [start];
  seen[start] = 1;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    const x = c % map.width;
    const y = (c - x) / map.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (isBlocked(grid, nx, ny)) continue;
      const j = ny * map.width + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return { grid, seen };
}

/** Every rule a furnished interior must keep. Empty list = sensible. */
export function layoutProblems(map: MapData): string[] {
  const out: string[] = [];
  const floor = floorRect(map);
  const { grid, seen } = reachable(map);
  const isReach = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && seen[y * map.width + x] === 1;
  const touchesWall = (p: MapProp) =>
    p.x === floor.x || p.y === floor.y || p.x + p.w === floor.x + floor.w || p.y + p.h === floor.y + floor.h;
  const seats = map.seats ?? [];
  const exit = map.exits[0];

  for (const p of map.props) {
    if (isWallPiece(p)) continue;
    if (WALL_DECOR_PROPS.has(p.type)) {
      // Hung on plain wall pieces (not over a window, shelf, picture or the stairs).
      for (let x = p.x; x < p.x + p.w; x++) {
        const piece = map.props.find((q) => isWallPiece(q) && x >= q.x && x < q.x + q.w);
        if (p.y !== 1 || !piece || !piece.type.endsWith("_plain") || x < 1 || x > map.width - 2) out.push(`${p.id}: not on a plain stretch of wall`);
      }
      continue;
    }
    if (TABLETOP_PROPS.has(p.type)) {
      const t = propAt(map, p.x, p.y);
      if (!t || !SURFACE_PROPS.has(t.type)) out.push(`${p.id}: not on a table`);
      continue;
    }
    const inFloor = p.x >= floor.x && p.y >= floor.y && p.x + p.w <= floor.x + floor.w && p.y + p.h <= floor.y + floor.h;
    if (!inFloor) out.push(`${p.id}: outside the floor`);
    if (p.walkable) {
      if (p.type === "doormat") continue;
      // Rugs lie in open floor or under a table set, never under other furniture.
      for (let y = p.y; y < p.y + p.h; y++)
        for (let x = p.x; x < p.x + p.w; x++) {
          const q = propAt(map, x, y);
          if (q && !TABLE_PROPS.has(q.type) && !SEAT_FACING[q.type]) out.push(`${p.id}: under ${q.id}`);
        }
      const covers = (x: number, y: number) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h;
      if (exit && (covers(exit.x, exit.y - 1) || covers(exit.x, exit.y - 2))) out.push(`${p.id}: over the way in`);
      continue;
    }
    if ((isBed(p.type) || NORTH_WALL_PROPS.has(p.type)) && p.y !== floor.y) out.push(`${p.id}: must stand against the north wall`);
    if (ALONG_WALL_PROPS.has(p.type) && !touchesWall(p)) out.push(`${p.id}: must stand against a wall`);
    // Usable side: north-wall pieces are used from the south; anything else from any side.
    const sides: [number, number][] = [];
    if (NORTH_WALL_PROPS.has(p.type) || isBed(p.type)) for (let x = p.x; x < p.x + p.w; x++) sides.push([x, p.y + p.h]);
    else
      for (let y = p.y - 1; y <= p.y + p.h; y++)
        for (let x = p.x - 1; x <= p.x + p.w; x++) {
          const edge = y === p.y - 1 || y === p.y + p.h || x === p.x - 1 || x === p.x + p.w;
          const corner = (y === p.y - 1 || y === p.y + p.h) && (x === p.x - 1 || x === p.x + p.w);
          if (edge && !corner) sides.push([x, y]);
        }
    if (!sides.some(([x, y]) => isReach(x, y))) out.push(`${p.id}: can't be reached`);
    if (p.type === "floor_lamp" && !seats.some((s) => Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y)) <= LAMP_REACH))
      out.push(`${p.id}: lamp far from any seat`);
  }

  for (const s of seats) {
    const [dx, dy] = STEP[s.facing];
    const t = propAt(map, s.x + dx, s.y + dy);
    if (!t || !TABLE_PROPS.has(t.type)) out.push(`${s.id}: faces ${s.facing} but there is no table there`);
    const ways = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => isReach(s.x + ax!, s.y + ay!));
    if (!ways) out.push(`${s.id}: no way to sit down`);
  }

  // No window behind a fireplace, wardrobe, shelf or cabinet.
  for (const x of columnsBehindTallFurniture(map)) {
    if (map.props.some((p) => p.x <= x && x < p.x + p.w && p.y <= 2 && (/^iwall_.*_window$/.test(p.type) || p.type === "window")))
      out.push(`window hidden behind furniture at column ${x}`);
  }

  // A potted tree by the north wall hides no picture, shelf or lamp either.
  for (const p of map.props) {
    if (!PICTURE_HIDING_PROPS.has(p.type) || p.y !== floor.y) continue;
    for (let x = p.x; x < p.x + p.w; x++) {
      const behind = map.props.find(
        (q) => q.x <= x && x < q.x + q.w && q.y <= 2 && (/^iwall_.*_(art|shelf)$/.test(q.type) || WALL_DECOR_PROPS.has(q.type)),
      );
      if (behind) out.push(`${behind.id} hidden behind ${p.id}`);
    }
  }

  if (exit) {
    for (const y of [exit.y - 1, exit.y - 2]) {
      const q = propAt(map, exit.x, y);
      if (q) out.push(`door blocked by ${q.id}`);
    }
  }

  let open = 0;
  for (let y = floor.y; y < floor.y + floor.h; y++)
    for (let x = floor.x; x < floor.x + floor.w; x++) if (!propAt(map, x, y)) open++;
  if (open < MIN_OPEN_FLOOR * floor.w * floor.h) out.push(`only ${open} open floor tiles`);

  for (const n of map.npcs) {
    // NpcRunner places the entity half a tile past the spawn point.
    if (!canStand(grid, n.x + 0.5, n.y + 0.5)) out.push(`${n.npcId}: spot inside furniture`);
    else if (!isReach(Math.floor(n.x + 0.5), Math.floor(n.y + 0.5))) out.push(`${n.npcId}: spot can't be reached`);
  }
  return out;
}
