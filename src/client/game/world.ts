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
import { createChestLayer, type ChestLayer } from "../render/chests";
import { createDoorHint, type DoorHintLayer } from "../render/door-hint";
import { createEffects } from "../render/effects";
import { createDaylight, type Daylight } from "../render/daylight";
import { createEntityLayer, type CharacterResolver } from "../render/entities";
import { createFarmLayer } from "../render/farm";
import { createGroundLayer } from "../render/ground";
import { createMailboxFlag, type MailboxFlag } from "../render/mailbox-flag";
import { createOverlays } from "../render/overlays";
import { createItemPoses, type ItemPoseOpts, type ItemPoses } from "../render/item-poses";
import { createPropsLayer } from "../render/props";
import { createHitFx, type HitFx } from "../render/hit-fx";
import { createGroundItems, type GroundItemsLayer } from "../render/ground-items";
import { createTreeView, type TreeView } from "../render/tree-fx";
import type { MapData } from "../../shared/types";

export interface World {
  map: MapData;
  ground: GroundLayer;
  props: PropsLayer;
  farm: FarmLayer;
  entities: EntityLayer;
  overlays: Overlays;
  /** The item in eat and hold-up acts, with crumbs. */
  itemPoses: ItemPoses;
  build: BuildMode;
  /** Cave treasure chests (empty elsewhere). */
  chests: ChestLayer;
  effects: Effects;
  /** Home only: day/night tint and lamp glows driven by the home clock. */
  daylight: Daylight | null;
  doorHint: DoorHintLayer;
  /** Home yard only: the mailbox's red flag (up while there is unread mail). */
  mailboxFlag: MailboxFlag | null;
  /** Rock and tree hit effects. */
  hitFx: HitFx;
  /** Choppable trees: stumps, cleared tiles, chop and fall effects. */
  trees: TreeView;
  /** Loot on the ground and forage. */
  groundItems: GroundItemsLayer;
  destroy(): void;
}

export function createWorld(
  game: GameApp,
  art: Art,
  map: MapData,
  buildDeps: Parameters<typeof createBuildMode>[2],
  characterFor?: CharacterResolver,
  itemPoseOpts?: ItemPoseOpts,
): World {
  const { layers } = game;
  const created: { destroy(): void }[] = [];
  const track = <T extends { destroy(): void }>(x: T): T => {
    created.push(x);
    return x;
  };
  try {
    const ground = track(createGroundLayer(art, map, layers));
    const props = track(createPropsLayer(art, map, layers));
    const world: World = {
      map,
      ground,
      props,
      farm: track(createFarmLayer(art, layers)),
      entities: track(createEntityLayer(art, layers, { characterFor })),
      overlays: track(createOverlays(layers)),
      itemPoses: track(createItemPoses(art, layers, itemPoseOpts)),
      build: track(createBuildMode(art, layers, buildDeps)),
      chests: track(createChestLayer(art, layers)),
      effects: track(createEffects(layers, () => ({ w: game.width(), h: game.height() }))),
      daylight: map.zone === "home" ? track(createDaylight(layers, { indoor: map.ambient === "indoor" })) : null,
      mailboxFlag: map.props.some((p) => p.id === "mailbox") ? track(createMailboxFlag(layers, map)) : null,
      doorHint: track(createDoorHint(layers)),
      hitFx: track(createHitFx(art, layers)),
      groundItems: track(createGroundItems(art, layers)),
      trees: null as unknown as TreeView,
      destroy() {
        destroyAll(created);
        game.clearWorld();
      },
    };
    world.trees = createTreeView(art, map, props, world.hitFx);
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
