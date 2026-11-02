import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import { SRC_TILE, TILE, type CharacterArt } from "../src/client/contracts";
import {
  INTERACTABLE_TYPES,
  placeOnSurface,
  propFeet,
  propSortZ,
  frontBodyZ,
  raisedZ,
  surfaceUnder,
  type PxRect,
} from "../src/client/render/props-geom";
import { isSeated, seatedFallback, seatedZ, SIT_DROP_PX } from "../src/client/render/sit-pose";
import { getMap } from "../src/shared/maps";
import { SEAT_FACING, TABLETOP_PROPS } from "../src/shared/maps/interiors/props";
import { facingStep } from "../src/shared/maps/interiors/rules";
import { INTERIOR_ZONES, type MapData, type MapProp } from "../src/shared/types";

type Entry = { rect: number[]; anchor?: number[]; frontOverlay?: number[]; frontAligned?: boolean; surface?: number[] };
const props = (catalog as unknown as { props: Record<string, Entry> }).props;

/** Sort keys exactly as render/props.ts assigns them (body; chair_up's backrest overlay). */
function propZ(p: MapProp): { body: number; front?: number } {
  const fy = propFeet(p).y * TILE;
  const e = props[p.type];
  if (e?.frontOverlay) return { body: (p.y - 1) * TILE + 1, front: fy + 1 };
  return { body: propSortZ(p, fy) };
}
const solidAt = (map: MapData, x: number, y: number) => map.props.find((p) => !p.walkable && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);

describe("seated characters", () => {
  it("knows who sits and lowers them onto the seat", () => {
    expect(isSeated({ act: { k: "sit", at: 1 } } as never)).toBe(true);
    expect(isSeated({} as never)).toBe(false);
    expect(SIT_DROP_PX).toBeGreaterThan(8);
  });

  it("without sit art, shows the whole idle frame (never a clipped one)", () => {
    const idle = Texture.WHITE;
    const c = { idle: { down: idle, up: idle, left: idle, right: idle }, anchor: { x: 0.5, y: 0.9 } };
    expect(seatedFallback(c as unknown as CharacterArt, "left")).toBe(idle);
  });

  it.each(INTERIOR_ZONES)("%s: sitters draw above their seat, behind the table they face unless they sit south of it", (zone) => {
    const map = getMap(zone);
    for (const seat of map.seats ?? []) {
      const chair = map.props.find((p) => p.id === seat.id)!;
      const z = seatedZ(seat.y + 0.5);
      const cz = propZ(chair);
      expect(z, `${seat.id} above its seat`).toBeGreaterThan(cz.body);
      // Only a chair seen from behind (chair_up) puts its backrest in front of the sitter.
      if (cz.front !== undefined) {
        expect(chair.type).toBe("chair_up");
        expect(z).toBeLessThan(cz.front);
      }
      const [dx, dy] = facingStep(seat.facing);
      const table = solidAt(map, seat.x + dx, seat.y + dy)!;
      const tz = propZ(table).body;
      if (seat.facing === "up") expect(z, `${seat.id} in front of ${table.id}`).toBeGreaterThan(tz);
      else expect(z, `${seat.id} behind ${table.id}`).toBeLessThan(tz);
      // A standing character just south of the chair is never covered by it.
      expect((seat.y + 1.3) * TILE).toBeGreaterThan(Math.max(cz.body, cz.front ?? 0));
    }
  });

  it("only chair_up keeps a backrest overlay", () => {
    for (const k of Object.keys(SEAT_FACING)) expect(!!props[k]?.frontOverlay, k).toBe(k === "chair_up");
    expect(props.chair_up!.frontAligned).toBe(true);
  });

  it("chairs and stools are clickable", () => {
    for (const t of Object.keys(SEAT_FACING)) expect(INTERACTABLE_TYPES.has(t)).toBe(true);
  });
});

describe("tabletop things", () => {
  it.each(INTERIOR_ZONES)("%s: each lies wholly on its table's top surface and sorts just above the table", (zone) => {
    const map = getMap(zone);
    for (const p of map.props.filter((q) => TABLETOP_PROPS.has(q.type))) {
      const table = surfaceUnder(p, map.props)!;
      expect(table, p.id).toBeDefined();
      const te = props[table.type]!;
      expect(te.surface, `${table.type} has a surface`).toHaveLength(4);
      const ta = te.anchor!;
      const s: PxRect = { x: te.surface![0]! - ta[0]!, y: te.surface![1]! - ta[1]!, w: te.surface![2]!, h: te.surface![3]! };
      const ie = props[p.type]!;
      const [w, h] = [ie.rect[2]!, ie.rect[3]!];
      const [ax, ay] = ie.anchor ?? [w / 2, h];
      const at = placeOnSurface(p, table, s, { w, h, ax: ax!, ay: ay! });
      const left = at.x - ax!;
      const top = at.y - ay!;
      expect(left, `${p.id} left`).toBeGreaterThanOrEqual(s.x);
      expect(left + w, `${p.id} right`).toBeLessThanOrEqual(s.x + s.w);
      expect(top + h, `${p.id} base on the top`).toBeLessThanOrEqual(s.y + s.h);
      expect(top + h, `${p.id} base on the top`).toBeGreaterThanOrEqual(s.y);
      if (h <= s.h) expect(top, `${p.id} top`).toBeGreaterThanOrEqual(s.y);
      // Above the table, below anyone standing just south of it.
      const z = raisedZ(p, map.props)!;
      expect(z).toBeGreaterThan(propZ(table).body);
      expect(z).toBeLessThan((table.y + table.h + 0.3) * TILE);
    }
  });

  it("the meeting table is one sprite (no stacked halves)", () => {
    const e = props.meeting_table!;
    expect(e.rect[3]).toBeGreaterThan(2 * SRC_TILE);
    expect(e.surface![3]).toBeGreaterThan(SRC_TILE);
  });

  it("wall hangings sort in front of the wall", () => {
    const inn = getMap("int_inn");
    expect(raisedZ(inn.props.find((p) => p.type === "mirror")!, inn.props)).toBeGreaterThan(3 * TILE);
    expect(raisedZ(inn.props.find((p) => p.type === "doormat")!, inn.props)).toBeNull();
  });
});

describe("ladder draw order", () => {
  it("anyone on the ladder's tile is drawn in front of it", () => {
    const ladder = { id: "l", type: "ladder", x: 21, y: 36, w: 1, h: 1 } as never;
    const z = propSortZ(ladder, 37 * TILE);
    expect(z).toBeLessThan(36.1 * TILE);
    expect(z).toBeGreaterThan(35.9 * TILE);
  });
});

describe("market stall layering", () => {
  const stall = getMap("village").props.find((p) => p.type === "market_stall" && p.id === "stall_produce")!;
  it("draws someone standing just north of the stall behind its frame", () => {
    const behindFeet = (stall.y - 0.1) * TILE;
    expect(behindFeet).toBeLessThan(frontBodyZ(stall));
  });
  it("keeps the keeper inside the footprint in front of the frame", () => {
    const keeperFeet = (stall.y + 1) * TILE; // Odette's feet row
    expect(keeperFeet).toBeGreaterThan(frontBodyZ(stall));
  });
});
