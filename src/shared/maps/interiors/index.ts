// Building interiors: one shared, public room per building (the village's, and the police station) (Durable Object per zone id
// "int_<building>"). Ids used by NPC routines and the NPC bible are BUILDING_IDS.
import type { InteriorZoneId, MapData } from "../../types";
import { HOUSE_OWNERS, type HouseOwner } from "./doors";
import { buildHouse } from "./houses";
import { buildInn } from "./inn";
import { buildPolice } from "./police";
import { buildSmithy } from "./smithy";
import { buildTownHall } from "./townhall";

export {
  BUILDING_DOORS,
  BUILDING_IDS,
  HOUSE_OWNERS,
  doorFor,
  doorsIn,
  outsideOf,
  villageSpawnFor,
  type BuildingDoor,
  type BuildingId,
  type HouseOwner,
  type InteriorBuildingId,
} from "./doors";
export { INTERIOR_PROP_FOOTPRINTS, WALKABLE_PROPS, type InteriorPropType } from "./props";

const house = (owner: HouseOwner) => () => buildHouse(owner);

export const INTERIOR_BUILDERS: Record<InteriorZoneId, () => MapData> = {
  int_townhall: buildTownHall,
  int_inn: buildInn,
  int_smithy: buildSmithy,
  int_police: buildPolice,
  ...(Object.fromEntries(HOUSE_OWNERS.map((o) => [`int_house_${o}`, house(o)])) as Record<`int_house_${HouseOwner}`, () => MapData>),
};
