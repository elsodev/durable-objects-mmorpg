// Per-zone render layers. Rebuilt from scratch on every welcome so nothing from the old map leaks.
import type {
  Art,
  BuildMode,
  Effects,
  EntityLayer,
  FarmLayer,
  GameApp,
  GroundLayer,
  Overlays,
  PropsLayer,
} from "../contracts";
import { createBuildMode } from "../render/buildmode";
import { createDoorHint, type DoorHintLayer } from "../render/door-hint";
import { createEffects } from "../render/effects";
import { createDaylight, type Daylight } from "../render/daylight";
import { createEntityLayer, type CharacterResolver } from "../render/entities";
import { createFarmLayer } from "../render/farm";
import { createGroundLayer } from "../render/ground";
import { createOverlays } from "../render/overlays";
import { createPropsLayer } from "../render/props";
import type { MapData } from "../../shared/types";

export interface World {
  map: MapData;
  ground: GroundLayer;
  props: PropsLayer;
  farm: FarmLayer;
  entities: EntityLayer;
  overlays: Overlays;
  build: BuildMode;
  effects: Effects;
  /** Home only: day/night tint and lamp glows driven by the home clock. */
  daylight: Daylight | null;
  doorHint: DoorHintLayer;
  destroy(): void;
}

export function createWorld(
  game: GameApp,
  art: Art,
  map: MapData,
  buildDeps: Parameters<typeof createBuildMode>[2],
  characterFor?: CharacterResolver,
): World {
  const { layers } = game;
  const created: { destroy(): void }[] = [];
  const track = <T extends { destroy(): void }>(x: T): T => {
    created.push(x);
    return x;
  };
  try {
    const world: World = {
      map,
      ground: track(createGroundLayer(art, map, layers)),
      props: track(createPropsLayer(art, map, layers)),
      farm: track(createFarmLayer(art, layers)),
      entities: track(createEntityLayer(art, layers, { characterFor })),
      overlays: track(createOverlays(layers)),
      build: track(createBuildMode(art, layers, buildDeps)),
      effects: track(createEffects(layers, () => ({ w: game.width(), h: game.height() }))),
      daylight: map.zone === "home" ? track(createDaylight(layers)) : null,
      doorHint: track(createDoorHint(layers)),
      destroy() {
        destroyAll(created);
        game.clearWorld();
      },
    };
    world.effects.setAmbient(map.ambient);
    return world;
  } catch (err) {
    destroyAll(created);
    game.clearWorld();
    throw err;
  }
}

function destroyAll(items: { destroy(): void }[]): void {
  for (const x of items.reverse()) {
    try {
      x.destroy();
    } catch (err) {
      console.warn("layer destroy failed", err);
    }
  }
  items.length = 0;
}
