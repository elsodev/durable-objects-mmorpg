// Home, inside: the player's house, a walled cottage room built with the interior Room kit. It is
// a second map of the same HomeRoom (map id "home_in", zone "home"): its door leads back out to
// the yard's doorstep. The floor is free for the owner's furniture; only the hearth, the wall
// pieces and the doormat are fixed.
//
// Layout (14x12): north wall rows 0..2, floor x 1..12, y 3..10, door in the south wall at (9, 11).

import { Ground, type MapData } from "../types";
import { Room } from "./interiors/room";

export const HOME_IN_FLOOR = { x: 1, y: 3, w: 12, h: 8 } as const;
/** Where a home with no bed gets one (map tiles, top-left of the 1x2 bed). */
export const HOME_IN_BED = { x: 2, y: 3 } as const;
/**
 * Where a home with no wardrobe gets one (map tiles, top-left of the 2x1 wardrobe): against the
 * back wall under the painting, clear of the bed, the hearth and both windows.
 */
export const HOME_IN_WARDROBE = { x: 9, y: 3 } as const;

export function buildHomeInterior(): MapData {
  const room = new Room({
    zone: "home",
    homeMap: "home_in",
    name: "Your House",
    w: HOME_IN_FLOOR.w,
    h: HOME_IN_FLOOR.h,
    floor: Ground.Wood,
    floorStyle: "floor_wood",
    wall: "timber",
    door: 8,
    seed: 0x4011e,
    wallPattern: "ppwpsppppppwpp",
    exit: { to: "home", spawn: "from_home_in", map: "home" },
    entrySpawn: "from_home",
  });
  // A hearth on the north wall keeps the room warm; a lamp beside the door for evenings.
  room.put("hearth", 5, 0, "hearth");
  room.hang("painting_landscape", 9, "painting");
  room.hang("wall_sconce", 3, "sconce");
  const map = room.build();
  map.floorArea = [{ ...HOME_IN_FLOOR }];
  return map;
}
