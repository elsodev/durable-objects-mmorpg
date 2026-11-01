// Where a bible place id is on a zone map, for walk_to intents. Buildings resolve to the tile just
// south of their door; places with no prop on this map resolve to null (the intent is dropped).
import type { MapData, Vec2 } from "../../shared/types";
import type { PlaceId } from "../npc/bible";

/** Map prop id (or prop type) that stands for each place. Interiors may add more later. */
export const PLACE_PROPS: Partial<Record<PlaceId, string>> = {
  townhall: "town_hall",
  inn: "inn",
  smithy: "blacksmith",
  market: "stall_produce",
  dock: "dock",
  shrine: "shrine",
  smithy_yard: "blacksmith",
  inn_porch: "inn",
  fountain: "fountain",
  notice_board: "notice_board",
  well: "well",
  square: "fountain",
  mine_camp: "mine_cart",
};

export function placeTarget(map: MapData, placeId: PlaceId): Vec2 | null {
  const key = PLACE_PROPS[placeId];
  if (!key) return null;
  const prop = map.props.find((p) => p.id === key) ?? map.props.find((p) => p.type === key);
  if (!prop) return null;
  return { x: prop.x + prop.w / 2, y: prop.y + prop.h + 0.5 };
}
