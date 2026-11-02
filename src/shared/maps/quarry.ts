// Quarry (40x30): the open-air approach to the caves, east of the village. A cliff runs along
// the whole north side with the cave mouth in it; walking into the mouth enters the caves, and
// the caves' way out brings you back here. Daylight, no monsters.
//   west          - road from the village
//   north (cliff) - the cave mouth, lanterns either side, the old mine cart
//   south         - a lane down through the woods to the town jail

import { Ground, type MapData } from "../types";
import { MapBuilder } from "./builder";

export const QUARRY_SIZE = { width: 40, height: 30 } as const;

/** First row of the cliff pieces (the grass lip); the face ends at CLIFF_Y + 3. */
export const CLIFF_Y = 2;
/** The cave mouth's footprint (its bottom row holds the exit into the caves). */
export const MOUTH = { x: 25, y: CLIFF_Y, w: 3, h: 4 } as const;

/**
 * Lines the cliff from x0 up to (not including) x1 with 2- and 3-wide pieces, mostly plain rock
 * with vines now and then, never leaving a 1-tile gap.
 */
function cliffRun(b: MapBuilder, x0: number, x1: number): void {
  let x = x0;
  for (let i = 0; x < x1; i++) {
    const left = x1 - x;
    const vines = left === 3 || (i % 3 === 1 && left >= 5);
    b.prop(vines ? "cliff_vines" : "cliff_face", x, CLIFF_Y);
    x += vines ? 3 : 2;
  }
}

/** The lane south to the town jail leaves through the woods here (bottom edge, east side). */
export const JAIL_EXIT = { x: 31, y: QUARRY_SIZE.height - 1, w: 2, h: 1 } as const;

export function buildQuarry(): MapData {
  const W = QUARRY_SIZE.width;
  const H = QUARRY_SIZE.height;
  const b = new MapBuilder(W, QUARRY_SIZE.height, Ground.Grass, 0x9a7713);
  const foot = MOUTH.y + MOUTH.h; // first open row under the cliff

  // ---- cliff with the cave mouth ----
  cliffRun(b, 0, MOUTH.x);
  b.prop("cave_mouth", MOUTH.x, MOUTH.y, { id: "cave_mouth" });
  cliffRun(b, MOUTH.x + MOUTH.w, W);
  // Woods on the clifftop (out of reach): a row of trunks along the lip, shrubs behind.
  for (let x = 0; x < W; x++) if (x % 7 !== 3) b.prop("tree", x, CLIFF_Y - 1);
  for (let x = 1; x < W; x += 3) b.prop("bush", x, 0);

  // ---- exits & spawns ----
  b.exit({ x: MOUTH.x, y: foot - 1, w: MOUTH.w, h: 1 }, "caves", "from_quarry");
  b.spawn("from_caves", MOUTH.x + 1, foot + 1);
  b.exit({ x: 0, y: 14, w: 1, h: 4 }, "village", "from_quarry");
  b.spawn("from_village", 2, 16); // a row below the "← Village" sign so its label clears your name tag
  b.spawn("default", 18, 16);
  b.prop("sign_post", 3, 14, { id: "sign_village", label: "← Village" });
  b.exit(JAIL_EXIT, "jail", "from_quarry");
  b.spawn("from_jail", JAIL_EXIT.x, H - 3);
  b.prop("sign_post", JAIL_EXIT.x + 2, H - 4, { id: "sign_jail", label: "↓ Town Jail" });

  // ---- road from the village up to the mouth ----
  b.path([{ x: 0, y: 15 }, { x: MOUTH.x, y: 15 }], 2);
  b.path([{ x: MOUTH.x, y: foot }, { x: MOUTH.x, y: 14 }], MOUTH.w); // as wide as the mouth
  b.reserve({ x: MOUTH.x - 1, y: foot, w: MOUTH.w + 2, h: 3 });
  b.path([{ x: JAIL_EXIT.x, y: 15 }, { x: JAIL_EXIT.x, y: H - 1 }], JAIL_EXIT.w); // lane to the jail

  // ---- by the mouth ----
  b.prop("lantern_post", MOUTH.x - 1, foot);
  b.prop("lantern_post", MOUTH.x + MOUTH.w, foot);
  b.prop("sign_post", MOUTH.x - 2, foot + 1, { id: "sign_caves", label: "↑ Caves" });
  b.prop("mine_cart", MOUTH.x + 5, foot + 1, { id: "mine_cart" });
  b.prop("woodpile", 21, foot);

  // ---- decoration: loose stone under the cliff, woods to the south and east ----
  b.scatter("rock_deco", 10, { x: 2, y: foot, w: W - 4, h: 6 });
  b.borderTrees(2, 0.4);
  b.scatter("tree", 26, { x: 2, y: 19, w: W - 4, h: 9 });
  b.scatter("tree", 6, { x: 31, y: foot + 3, w: 6, h: 14 });
  b.scatter("bush", 14, { x: 2, y: foot + 2, w: W - 4, h: 22 });
  b.scatter("tall_grass", 10, { x: 2, y: foot + 2, w: W - 4, h: 22 });

  return b.build({ zone: "quarry", name: "Mossbrook Quarry", ambient: "day" });
}
