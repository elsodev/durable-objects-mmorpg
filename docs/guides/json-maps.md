# JSON maps

Some maps are written as JSON instead of TypeScript: the deeper cave levels today, and interiors from now on. A JSON map names a few rooms, the passages between them and what lives there. The seeded `MapBuilder` paints the walls, carves the floor, places exits and spawns, and scatters rocks and decoration the same way the hand-written maps do. Nobody has to design a full tile grid.

## Where things live

| What | Where |
|---|---|
| Format (typed shapes) | `src/shared/maps/json/spec.ts` |
| Checker (throws on the first bad field, naming it) | `src/shared/maps/json/parse.ts` |
| Builder (spec to `MapData`) | `src/shared/maps/json/build.ts` |
| Cross-map link check | `src/shared/maps/json/links.ts` |
| Cave levels 2 to 4 | `src/shared/maps/cave-levels/*.json`, registered in `cave-levels/index.ts` |
| Tests | `test/json-maps.test.ts`; `test/maps.test.ts` runs its generic checks on every map |

JSON files are imported statically, so they bundle into both the Worker and the client. Nothing reads files at runtime. A bad file throws a `MapSpecError` like `caves_3_top.json: monsters[1].type must be one of slime, bat, rock_crab` the first time the map is built, and the tests build every map.

## The cave levels

`caves` (level 1, `src/shared/maps/caves.ts`) has three ladders down into holes in the floor: on the west side of the miners' hall, the north side of floor 1 and the east side of floor 2. Below it are three wings, `left`, `top` and `right`, on each of levels 2, 3 and 4. The zone ids are `caves_<level>_<wing>`.

```
caves (1)        left hole ──> caves_2_left   top hole ──> caves_2_top   right hole ──> caves_2_right
caves_2_* (2)    left hole ──> caves_3_left   top hole ──> caves_3_top   right hole ──> caves_3_right
caves_3_* (3)    left hole ──> caves_4_left   top hole ──> caves_4_top   right hole ──> caves_4_right
caves_4_* (4)    the bottom: no holes down, a big vault room, two chests, the richest rocks
```

- From any map of a level, the hole on the left side leads to the next level's left wing, the one at the top to its top wing and the one on the right to its right wing. So you can change wings at every level.
- Every deeper map has a ladder on the wall of its landing room that climbs back up. Stepping onto any ladder plays a short climb that everyone sees (`climb_down` or `climb_up`, see [animated-sprites.md](animated-sprites.md#climbing-ladders)), then the loading bar shows as usual. The way up sends you back to the map you came down from: its `back` list names the other maps of the level above, and the server routes you to whichever one you came down from. Each player's save keeps a small cave trail of where they entered every level (`caveTrail`, `src/shared/caveLevels.ts`, routed by `routeExit` in `src/worker/game/spawn.ts`). Without a trail entry, for example after a dev warp, the way up leads to `to`, the same wing one level up.
- Deeper means tougher and richer. Monsters are `level` 2 to 4 (`levelStats` in `src/shared/engine/monsters.ts`: +30% hp and +20% bite per level, +1 armour every other level). Rocks have better odds of coming back as silver, gold or diamond, kill drops are more likely and better, and levels 3 and 4 keep treasure chests.
- Every cave zone is its own `ZoneRoom` Durable Object, exactly like `caves`. The ids are in `CAVE_DEPTH_ZONES` (`src/shared/types.ts`), which makes them shared zones for the WebSocket route, sessions and presence.

To add a level 5, add the ids to `CAVE_DEPTH_ZONES`, add three JSON files and register them in `cave-levels/index.ts`, give the level-4 maps ladders down, and raise `CAVE_MAX_DEPTH`. The tests will tell you which spawn or link is missing.

## The format

A minimal cave:

```json
{
  "id": "caves_2_left",
  "name": "West Hollows · Depth 2",
  "width": 48,
  "height": 44,
  "seed": 852200,
  "depth": 2,
  "rooms": [
    {"id": "landing", "x": 24, "y": 38, "rx": 5, "ry": 3},
    {"id": "hub", "x": 24, "y": 22, "rx": 12, "ry": 8, "noise": 0.35}
  ],
  "tunnels": [{"from": "landing", "to": "hub"}],
  "exits": [
    {"ladder": "up", "room": "landing", "dx": -3, "to": "caves", "label": "↑ Climb back up"},
    {"ladder": "down", "room": "hub", "dx": -8, "to": "caves_3_left", "label": "↓ Depth 3: Dripstone Grotto"}
  ],
  "spawns": {"default": {"room": "landing"}},
  "monsters": [{"room": "hub", "type": "slime", "count": 3, "max": 6, "level": 2}],
  "rocks": [{"room": "hub", "count": 8, "ores": {"copper": 3, "iron": 1}, "odds": {"silver": 0.1, "gold": 0.02, "diamond": 0.004}}],
  "decor": [{"type": "rock_deco", "room": "hub", "count": 3}],
  "chests": 0,
  "drops": {
    "kill": {"chance": 0.2, "table": [{"item": "ore_copper", "weight": 5, "min": 1, "max": 2}]},
    "ground": {"rooms": ["hub"], "base": 2, "max": 5, "refillSec": 300, "table": [{"item": "mushroom", "weight": 1}]}
  }
}
```

### Fields

| Field | Meaning |
|---|---|
| `id` | The zone id. It must be a known zone and must match the slot the file is registered under. |
| `name` | Shown in the HUD and on the loading screen (48 characters at most). |
| `width`, `height` | Map size in tiles (8 to 160). |
| `seed` | Seeds the builder, so the same file always builds the same map on server and client. Change it to reroll the rough edges and the scatter. |
| `ambient` | `cave` (default), `day` or `indoor`. Cave maps also seal any floor pocket you can't walk to. |
| `fill`, `floor` | Ground names: `cave_wall` and `stone` by default. Also `void`, `grass`, `dirt`, `sand`, `water`, `wood`, `tilled`, `wall`. |
| `depth` | Cave level, for labels and tests. |
| `rooms` | Rough ellipses of floor: centre `x`, `y`, radii `rx`, `ry`, and `noise` from 0 (smooth) to 0.6 (ragged), 0.3 by default. |
| `tunnels` | Floor between two rooms' centres, across first and then down. `width` is 1 to 4, 2 by default. |
| `tiles` | Exact ground instead of, or under, the rooms: `{"legend": {"#": "wall", ".": "wood"}, "rows": ["####", "#..#", ...]}`. Use one row per map row and one character per tile. Rooms and tunnels are carved over the painted tiles. |
| `exits` | One of three kinds. `ladder: "down"` plus `room` (or `at: [x, y]`), shifted by `dx`/`dy`, puts a hole with a ladder in the floor there. `ladder: "up"` leans a ladder on the first wall straight north of that point; the wall must be at least two tiles thick. `edge` (`left`, `top`, `right` or `bottom`) plus `room` cuts a 2-wide passage from the room's centre straight off that edge. `rect: [x, y, w, h]` plus `spawnAt: [x, y]` is a fixed doorway. Arrivals at a ladder stand two tiles south of it. `to` is the destination zone. `arrive` is the destination spawn, `from_<this id>` by default. `label` is the door plate shown near the exit, and edge passages also get a sign post with the same text. `back` lists the other maps this exit serves as a shared way up. |
| `spawns` | Named arrival points, each `{"room": id}` or `{"at": [x, y]}`. `default` is required. Each exit also adds `from_<to>` (and `from_<z>` for each `back` zone) just inside it. |
| `monsters` | Spawn groups at a room's centre or `at` a tile: `type` (`slime`, `bat` or `rock_crab`), `count` (the base number alive), `max` (the cap with players around, `count × 2` by default), `perPlayer` (0.5), `radius` (4), `level` (1 to 4) and `respawnSec` (35). |
| `rocks` | Mining rocks scattered inside a room: `count`, base `ores` by weight (`stone`, `copper`, `iron`, `gem`), and the `odds` per spawn that a rock comes back as silver, gold or diamond. |
| `props` | Fixed props: `type` (any key of `PROP_FOOTPRINTS`), `at`, and optionally `id` and `label`. |
| `decor` | Small 1×1 props scattered in a room (`rock_deco` in caves). |
| `chests` | Treasure chests kept on the floor (0 to 8). They use the same loot and respawn rules as the level-1 caves. |
| `drops.kill` | Extra loot on every monster kill in this map: a `chance` from 0 to 1, then one entry of `table` by `weight` with a qty from `min` to `max`. It comes on top of the monster's own drops and scales with `DROP_RATE_MONSTER`. |
| `drops.ground` | Finds that turn up on the floor of the listed `rooms`, which anyone can pick up. The zone tops them up every `refillSec` to `base + perPlayer × players`, at most `max`. |

Unknown fields are ignored. Numbers are range-checked, and every room, zone, item and prop name must exist.

### Rules the builder keeps for you

- Passages, exits, spawns and monster camps are reserved, so rocks and decoration never block them.
- Rocks and scattered props only go where all eight neighbours are open, so they can't cut the floor apart.
- Monsters spawn on open floor near their camp at runtime, and never inside walls.
- All drops roll on the server with the zone's random source. The client only sees what landed.

## Interiors

Interiors use the same format with `"ambient": "indoor"`, painted `tiles`, `rect` exits and `props`. For example:

```json
{
  "id": "int_example",
  "name": "Example Room",
  "width": 10, "height": 10, "seed": 1,
  "ambient": "indoor", "fill": "wall", "floor": "wood",
  "tiles": {"legend": {"#": "wall", ".": "wood"}, "rows": ["##########", "#........#", "...", "####.#####", "##########"]},
  "exits": [{"rect": [4, 8, 1, 1], "spawnAt": [4, 6], "to": "village", "arrive": "from_int_example"}],
  "spawns": {"default": {"at": [4, 5]}},
  "props": [{"type": "table_round", "at": [2, 2]}]
}
```

The existing village interiors are still built by `Room` (`src/shared/maps/interiors/room.ts`), which also places the north-wall pieces and seats. To move a room to JSON, add the zone id, write the file, and register it in `src/shared/maps/index.ts` the way `cave-levels/index.ts` does. Then run the tests.

## Checking a map

- `npx vitest run test/json-maps.test.ts test/maps.test.ts` checks every exit, spawn, monster and rock: each one must stand on floor, be reachable from `default`, and every link must land on a real spawn.
- Print a map as text with `mapToAscii(getMap("caves_3_top"))`. `#` is a wall, `_` floor, `R` a rock, `M` a monster camp, `E` an exit and `S` a spawn.
- With the local server (`npm run dev:local`), `/warp caves_3_top` in chat walks you straight into any shared zone (dev tools only).
