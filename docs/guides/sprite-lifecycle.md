# Sprite lifecycles

Some things change look as the game runs: crops grow, wilt and die; trees are felled to stumps; rocks break; soil gets wet; bins and chests open. Each state needs its own art, and every state must line up with the others so the swap doesn't make the object jump. The rules in [assets.md](assets.md) apply to every frame.

**The core rule:** all states of one object share **one cell size and one anchor**. Draw every state in the same size cell, with the ground point on the same pixel. Swapping state then changes only the art, never the position.

## Crops

Growth rules are in `src/shared/engine/farming.ts`. The art comes from the `crops` section of `catalog.json`, and `cropRect` in `src/client/art/slice.ts` picks the frame.

| State | When | Art key |
|---|---|---|
| Seedling (stage 0) | Planted, no watered days yet | `stages[0]` |
| Small (stage 1) | About a third of the way grown | `stages[1]` |
| Medium (stage 2) | About two thirds of the way grown | `stages[2]` |
| Ready / fruiting (stage 3) | All watered days done, harvestable | `stages[3]` |
| Wilted | Missed a day's water and not watered yet today (stages 0–2 only; ripe crops don't wilt) | `wilted[0..2]`, one per growing stage |
| Dead | Dry for `CROP_DEATH_DAYS` (3) days in a row | `dead` |

How growth works:
- A crop grows one step per **completed watered day**. Today's watering counts when the day rolls over.
- `growthStage(grown, days)` spreads the four stages evenly over the crop's `days`.
- The look comes from timestamps (`plantedAt`, watered days) and never from a running timer.
- A dead crop stays until it's cleared with the hoe or by hand, and the cleared tile goes back to empty tilled soil.

Example entry:

```json
"cabbage": {
  "file": "crops/crop_stages.png",
  "stages": [[0, 832, 32, 64], [32, 832, 32, 64], [64, 832, 32, 64], [96, 832, 32, 64]],
  "wilted": [[128, 832, 32, 64], [160, 832, 32, 64], [192, 832, 32, 64]],
  "dead": [224, 832, 32, 64],
  "anchor": [16, 60]
}
```

Rules for crop art:
- **Cell:** every state is a 32×64 cell with the same anchor, the base of the stem. Tall crops grow upwards inside the cell; they never move their base.
- **Wilted art:** each growing stage gets its own wilted frame, drooping and desaturated, so a wilted medium plant still reads as medium. Making wilted frames from the normal ones by script is fine; credit them as derived.
- **Dead art:** a dry brown plant at about the small stage's size.
- **Ripe art:** the ready stage has to read as harvestable at a glance, with visible fruit or a full head. In code, ripe crops sway gently and sparkle; don't draw that into the art.
- **Stay on the soil:** a crop must fit within its tile's soil. The soil autotile draws its outer rim inset, so wide, leafy art spills onto the grass. Give wide crops a soil mound in the art, or keep them off a bed's edge row. Village garden beds (`src/shared/maps/yards.ts`) follow the same rule.
- **Quality variants:** silver and gold crops reuse the crop's icon with a quality badge. They have no separate plant art.
- **Item icons:** every crop also needs an item icon (`icons` in the catalog) and a seed icon.
- **Adding a crop:**
  1. Add its seed and crop item.
  2. Add the catalog entry with all four stages, three wilted frames and the dead frame.
  3. Add the icons.
  4. Run a few days in game with `/day`. Leave one tile dry so you can see it wilt and die.

## Soil

- **Tilled soil:** `terrain.tilled` is drawn as a blob autotile:
  - `outer3x3` for edges and corners;
  - `inner2x2` for inside corners;
  - `wetOverlay3x3` darkens soil that was watered today.
- **The wet look:** it is an overlay on top of the dry soil, not a second tileset. That way edges line up between wet and dry tiles.
- **Hoed grass:** it becomes soil straight away, using client prediction, so the tile never flashes grass, and the edges blend into the grass around it.

## Trees

The rules are in `src/shared/engine/toolRules.ts` (`TREE_RULES`, `STUMP_HITS`, `TREE_REGROW_MS`), and the art is swapped in `src/client/render/tree-fx.ts`.

| State | Art | Notes |
|---|---|---|
| Tree | The tree sprite (it sways in code) | Takes N axe hits depending on size, and shakes on each hit |
| Stump | `tree_stump` prop | Same anchor as the tree trunk base, so the stump appears exactly where the trunk stood |
| Gone | Nothing (grass) | At home the stump can be cleared with more hits. Felled trees regrow after `TREE_REGROW_MS` |

The stump's anchor must sit on the trunk base of the tree art. Check by drawing one over the other.

## Rocks and ores

- **Catalog entries:** each ore type (`rock_stone`, `rock_copper`, ..., `rock_gold`, `rock_diamond`) is a 32×32 entry in `ores`, with `variants` so neighbouring rocks don't look identical.
- **Hits per tier:** these are set in `toolRules.ts`, from stone at 2 hits up to diamond at 8.
- **Breaking a rock:** it shows chips on each hit, then the rock is removed and its drops pop out. There's no broken-rock sprite; the tile is just cleared.
- **Variants:** all variants of one ore share the same anchor and footprint.

## Bins, chests and other lids

- **Frames:** they use named frames, `closed`, `opening` and `open`, in the same cell with the same anchor.
- **Shipping bin:** the lid opens when you drop an item in and closes after.
- **Cave chests:** a chest stays open once looted.

## Checking a lifecycle

- [ ] Every state has art, including wilted and dead for crops and the stump for trees.
- [ ] The object doesn't jump when it changes state: same cell, same anchor.
- [ ] Each state reads clearly at 2× zoom. Seedling, small, medium and ready are easy to tell apart.
- [ ] Crops stay inside the soil, and nothing spills onto the grass or a path.
- [ ] No static state casts a drop shadow.
- [ ] You watched the whole cycle in the browser:
  - `/day` to advance days;
  - `/hour` to see the lighting;
  - skip watering to see wilting and death;
  - fell a tree and wait for it to regrow;
  - break each ore.
