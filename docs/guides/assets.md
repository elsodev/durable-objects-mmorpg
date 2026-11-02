# Making and adding game art

This guide covers every image in the game: terrain, buildings, props, furniture, crops, ores, icons and characters. Read it before you add, cut, recolour or draw any sprite. For moving art, also read [animated-sprites.md](animated-sprites.md). For anything that changes look over time, such as crops, trees, rocks or the shipping bin, also read [sprite-lifecycle.md](sprite-lifecycle.md).

## Where art lives

| What | Where |
|---|---|
| PNG sheets | `src/client/public/assets/lpc/<group>/` (`buildings`, `characters`, `crops`, `furniture`, `icons`, `interior`, `monsters`, `ores`, `plants`, `props`, `terrain`) |
| Sprite table (rects, anchors, footprints, frames) | `src/client/public/assets/lpc/catalog.json`, typed in `src/client/art/catalog-types.ts` |
| Character creator layers and action sheets | `src/client/public/assets/lpc/custom/` (`custom.json`, per-body folders, `tools/`) |
| Loader and slicing | `src/client/art/index.ts`, `src/client/art/slice.ts` |
| Drawn fallbacks (used when a catalog entry is missing or fails to load) | `src/client/art/placeholders.ts`, `src/client/art/draw/*.ts` |
| Credits | `src/client/public/assets/**/CREDITS.md` and the README Credits section |
| Map placement (which prop goes where) | `src/shared/maps/*.ts`, footprints in `src/shared/maps/props.ts` |

## Licences

- Use only CC0, CC-BY, CC-BY-SA, OGA-BY or GPL art, preferably from the Liberated Pixel Cup (LPC) family so the style matches. Good sources are the LPC character generator, ElizaWy/LPC, OpenGameArt's LPC collections and bluecarrot16's LPC packs.
- Never use art ripped from commercial games, and never copy another game's look on purpose.
- Credit every new file, or every file derived from one, in the `CREDITS.md` of its folder: file path, authors, licence, source URL, and what we changed (crop, recolour, mirror, composite). Then add the authors to the README Credits section, which lists game assets only.
- Recolours, crops and composites keep the licence of their source. A CC-BY-SA source makes the result CC-BY-SA.
- Art we draw ourselves, by script or by hand, is CC0. Say so in the credits entry.

## Style rules

- **Grid:** source tiles are 32×32 px and character frames are 64×64 px. The game draws everything at 2× (`SCALE` in `src/client/contracts.ts`), so one source pixel is a 2×2 block on screen.
- **Crisp pixels:** textures use nearest-neighbour scaling. Never scale art by a fraction and never smooth it. Resize only by whole multiples, and only in code.
- **Perspective:** LPC top-down 3/4 view, light from the top left, dark outlines tinted by the object's colour rather than pure black.
- **Palette:** use the colours of the sheet you're matching. For a recolour, remap whole ramps (shadow, mid, light, highlight) instead of hue-shifting everything at once, so materials still read correctly. A diamond, for example, was made from the silver crystal sheet with a white-blue ramp.
- **Shadows:**
  - Only things that move cast a drop shadow: players, villagers and monsters.
  - Buildings, props, furniture, crops, rocks and trees sit straight on the ground with no blob shadow.
  - Don't paint a ground shadow into a static sprite either.
  - The shadow sizes in `catalog.json` (`"shadow": "character"` and so on) are for moving things only.
- **Icons:** 16×16 or 32×32 pixel icons, colourful, with a one-pixel outline, readable on the parchment UI. Make every icon in one set the same size.

## Adding a static sprite

1. **Put the PNG in the right group folder.** If you only need part of a big sheet, reference the sheet with a `rect` rather than copying pixels, unless you are changing them.
2. **Find the exact rect.** Measure it from the opaque pixels; don't guess. A quick script that walks the connected opaque pixels from the middle of the object gives the tight bounding box. Check that the rect does **not** take in pixels of the neighbouring sprite on the sheet. A rect that is a few pixels too wide shows stray bits floating beside the object (the woodpile bug).
3. **Add the catalog entry:**
   ```json
   "woodpile": {
     "file": "props/decorations_medieval.png",
     "rect": [354, 657, 30, 32],
     "anchor": [15, 31],
     "footprintTiles": { "w": 1, "h": 1 }
   }
   ```
   - `rect` is `[x, y, w, h]` in pixels of the PNG.
   - `anchor` is the **feet point**, relative to the rect: the middle of where the object touches the ground, usually the bottom row of opaque pixels. Sorting and placement both use it, so a wrong anchor makes the object float or sink.
   - `footprintTiles` is the blocking area in tiles. It is centred on the anchor and extends upwards from it. It must match what the art covers on the ground, not its full height. A tall tree is 1×1, and a house is its wall width by about two tiles.
4. **Add the footprint** to `src/shared/maps/props.ts` if the prop is placed on maps. The server uses it for collision.
5. **Give it a fallback** in `src/client/art/draw/` if it has none, so the game still runs when the pack fails to load.
6. **Place it on a map**, then check it in the browser (see the checklist below).

## Furniture and seats

- **Directions:** chairs and benches need art for each direction they face (`variants`: `left`, `right`, `back`, plus the default front). A chair always faces its table:
  - west of the table: faces right;
  - east of the table: faces left;
  - north of the table: faces down (the front);
  - south of the table: faces up (`back`).
  
  `test/interiors-layout.test.ts` checks every seat.
- **Backrests:** a backrest that must be drawn over a seated character uses `frontOverlay` with `frontAligned: true`.
- **Tables and counters:** these need a `surface` rect, the tabletop that items stand on. Items placed there sort above the table.
- **Wall decor:** paintings, mirrors and windows must stay visible. Tall furniture (potted trees, shelves, barrel stacks, beds) must not cover them.

## Placeable furniture

Furniture players buy and place lives in `src/shared/furnitureItems.ts` (shop and rare pieces) and `src/shared/items.ts` (older and gift pieces). The art is the catalog's `furniture[id]` entry, or `props[id]` when there is none.

- **Size to the footprint:** one tile is 32 px. Draw a 1x1 piece about 26–32 px wide, a 2x1 piece 56–64 px wide, and let tall pieces (fridge, bookcase, arcade cabinet) rise up to two tiles above their row. Solid floor art may lip past its footprint by at most 4 px a side. Rugs and wall pieces are exempt.
- **Feet point:** the anchor is the bottom-centre of the footprint row the piece stands on. No more than 2 px of art may hang below it.
- **Packing a sheet:** leave at least 2 px of clear space around every cell, so a rect can never pick up its neighbour or slice a sprite off.
- **Rugs:** walkable floor pieces lie flat under the room. Other furniture may stand on a rug, but rugs don't stack. A click picks the piece on top.
- **Wall pieces:** they hang on the wall's lowest row or the one above. On the lowest row the renderer raises them 10 source px (`WALL_SKIRT_LIFT`) so they clear the skirting board. Draw wall art with its bottom edge as the hanging point.
- **Turning:** a piece may only list rotations it has art for: `left` for 1 and `back` for 2. Rotation 3 uses `right`, else `left` or the front mirrored.
- **Where it comes from:** shop pieces have a `buy` price and are sold at the village Furniture Stall (`STALL_SHOPS` in `src/worker/game/shop.ts`). Rare pieces (`rarity: "rare"`, no `buy`) are never sold. They drop from cave monsters (`RARE_MONSTER_FURNITURE`) or are a villager's gift at a heart milestone (`RARE_GIFTS`). To add one, add a row there.
- **Storage furniture:** give the item `storage: { slots, accepts }` and its art `closed`/`opening`/`open` frames (see [Sprite lifecycles](sprite-lifecycle.md#bins-chests-and-other-lids)).
- **The audit:** `test/catalog-art.test.ts` checks that:
  - every catalog rect sits inside its image;
  - every placeable piece has art and a footprint;
  - every view stands on its anchor, fits its footprint and isn't cut off at a rect edge;
  - animation frames match the front cell.

  A tightly packed legacy sheet goes on its allowlist only after you've looked at the sheet, with the reason written down.

## Layering

- The world draws in rows by the feet point (the anchor `y`). Anything whose feet are further south is drawn on top.
- A seated character is drawn above its chair but below the table on the same row (`TABLE_SORT_BIAS` in `src/client/render/props-geom.ts`).
- Rugs and mats lie under everything and can't be clicked.
- Roofs and tree canopies hide players who walk behind them. That only works if the anchor sits at the base of the wall or trunk, not at the bottom of the canvas.

## Before you commit art

- [ ] The licence is allowed and the credits are written: the folder's `CREDITS.md` and the README.
- [ ] The rect is tight, with no stray pixels from neighbouring sprites, and nothing is cut off.
- [ ] The anchor sits where the object touches the ground. It doesn't float or sink.
- [ ] The footprint matches the art, and the object doesn't block a door, path or exit.
- [ ] Static art has no drop shadow.
- [ ] Layering: walk behind it and in front of it.
- [ ] Wall art and windows stay visible.
- [ ] Nothing hangs off the map edge.
- [ ] Plants on a soil bed stay inside the soil.
- [ ] Chairs face their tables.
- [ ] You looked at real screenshots at 1280×800 and at phone size (390×844), and read them yourself. Tests don't see pixels.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
