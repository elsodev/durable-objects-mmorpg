# Animated sprites

This guide covers how moving art is laid out and wired up: characters, tool swings, monsters and looping props. Every rule in [assets.md](assets.md) still applies, especially licences, credits, crisp pixels and "only moving things cast shadows".

## Ground rules for every animation

- **Grid:** every frame of one animation is the same size, and the frames sit on a regular grid in the sheet. Don't pack frames tightly or use different sizes.
- **Feet point:** it stays on the same pixel in every frame. If the feet drift, the sprite slides or bobs on the ground. Check this by stacking the frames.
- **Frame 0:** for walking and idling, frame 0 is the standing pose. Idle is walk frame 0.
- **Direction rows:** they always come in this order: **up, left, down, right**. Right is never a mirrored left unless the art truly has no right row; mirroring flips held tools and lighting.
- **Timing:** it lives in data (`ms` per frame), never in a hard-coded timer. Effects that must line up with a frame, such as soil appearing or a rock chipping, are timed in `src/shared/engine/toolTiming.ts` so the server and every client agree.
- **Remote players:** animations must look right for them too. Never rely on local input to pick a frame.

## Characters (players and villagers)

- **Base sheets:** villagers and fixed characters live in `src/client/public/assets/lpc/characters/<id>.png`. The layout is in `catalog.json` `meta.characterLayout`:
  - walk rows 0–3 (up, left, down, right), 9 frames of 64×64;
  - slash rows 4–7, 6 frames.
- **Action sheets:** `<id>.act.png` holds:
  - thrust rows 0–3 (8 frames);
  - sit rows 4–7 (3 frames);
  - hurt on row 8 (6 frames).
  
  They load only the first time an action is shown.
- **Player looks:** these come from the character creator. Each part (skin, eyes, shoes, bottom, top, hair) is a separate layer PNG under `custom/<body>/`. The client composites them in the order given by `custom.json` `order`, bottom layer first. To add a clothing option:
  1. Add the layer for **every body type** (`male`, `male_slim`, `female`), for both the base sheet and the action sheet.
  2. List it in `custom.json` `options` with a swatch.
  3. Credit every layer.
  
  A layer missing from one body type shows that body naked in that slot.
- **Generating layers:** use the Universal LPC Spritesheet Character Generator's own sheets and palettes so outlines and proportions match. Composite with a script and don't hand-paint over generator output. Credit each layer with its authors from the generator's `CREDITS.csv`.

## Actions and tools

- **Defining actions:** actions (`hoe`, `watering`, `smash`, `sword`, `harvest`, `sit`, `hurt`, `faint`, ...) are defined in `custom.json` `actions`. Each one lists:
  - its frames, taken from the source animations (`"thrust,3"` means the thrust animation, column 3);
  - `ms` per frame;
  - `frameSize`;
  - `hold`, set when the last frame should stay (fainting).
- **Wide swings:** `frameSize` can be bigger than 64, such as 128 for the sword. The 64 px body frame is then centred in the bigger cell, so the weapon arc has room.
- **Held tools:** each tool is drawn as two layers in `custom/tools/`. The tool has to pass behind the arm on some frames and in front of it on others, so a single layer can't work.
  - `<tool>.bg.png` is drawn **behind** the body.
  - `<tool>.fg.png` is drawn **in front** of it.
  - Both sheets have the same layout as the action: 4 rows (up, left, down, right) by the action's frames, in `frameSize` cells.
  - `custom.json` `tools` maps an item to its action and layer files.
- **Adding a tool:**
  1. Draw or cut its bg and fg sheets to match an existing action, or add a new action.
  2. Add it to `custom.json` `tools`.
  3. Add its timing to `TOOL_TIMING` if it lands a hit.
  4. Give it an inventory icon.
  5. Check it in the browser: swing in all four directions and watch the impact frame.
- **The tool must be visible for the whole swing.** If it isn't, either the layer is missing or its rows are in the wrong order.

### Held tools

- **What it is:** while a tool or weapon is the selected hotbar item, the character holds it standing and walking. Two PixiJS sprites sit on the entity container, one behind the body and one in front, and copy the body's anchor, position, scale and alpha every frame (`drawHeld` in `src/client/render/entities.ts`). Nothing is baked into the character sheets.
- **Art:** `custom/tools/<tool>.held.bg.png` (behind) and `.held.fg.png` (in front), laid out exactly like the walk rows: 4 rows (up, left, down, right) by 9 frames of 64×64, same feet point. Frame *i* is drawn on walk frame *i*, so the tool moves with the hand on every step; standing uses frame 0. There is no offset table: the hand position is in the art.
- **Where it comes from:** the generator's walk layers for the same tool, recoloured to the palette of the tool's action sheets so the held and swinging tool match. Tools without a walk layer get one derived by script from a similar tool (the fishing rod is cut from the hoe's).
- **Body types:** `custom.json` `tools.<item>.held` lists `bg` and `fg`; `bodies.<body>` replaces them for a body type the generator draws differently (the axe and pickaxes have `.held.thin.fg.png` for `male_slim` and `female`).
- **When it shows:** players only (`EntityState.held`), and never while an action plays (the swing's own tool layers take over), while seated, or while fading out after death (`heldToShow` in `held-logic.ts`). Seeds, crops, furniture and materials are not held.
- **Multiplayer:** the client sends `{ t: "hold", slot }` when the selected slot changes and after each welcome. The server reads the item from its own copy of the inventory (`heldItemAt` in `src/shared/held.ts`) and refreshes it after every inventory change, so the item can't be faked. Your own character shows it at once from the local inventory.
- **Adding held art for a new tool:**
  1. Take the tool's walk layer from the generator (or derive one by script), recolour it to the tool's action-sheet palette and lay it out as 4 × 9 cells of 64 px.
  2. Split it into `bg` and `fg` the generator's way, and add per-body sheets if the slim builds need them.
  3. Add `held` to the tool's entry in `custom.json` `tools`, and credit the files.
  4. Check it in the browser: all four facings standing and mid-walk, the hand on the handle, nothing cut off, and the layer gone during a swing.

## Monsters

- **Catalog entry:** monsters are listed in `catalog.json` `monsters` with `frameW` and `frameH`, an `anchor`, and `animations.walk` rows per direction. Optional `attack` rows can be added the same way.
- **Flying monsters:** they set `flying: true` and a `hover` height, so the shadow stays on the ground while the body floats above it.
- **Hit flash and knockback:** they're done in code. Don't bake them into the art.

## Looping and state props

- **Looping props:** list the frames as an array in `frames` (for example the campfire, fireplace, forge, candles and wall torches). They loop at a steady rate, with each prop offset by its tile position so neighbours don't flicker in sync.
- **Lids and doors:** these use named frames, `closed`, `opening` and `open`, for example the shipping bin and the cave chest. The renderer plays closed → opening → open and back again.
- **One-shot effects:** short effects that play once, like the tool-rebound spark (`fx/rebound_spark.png`, catalog `props.fx_rebound`), list their frames like a looping prop. The code plays them once (`REBOUND_FRAME_MS` in `src/client/render/hit-fx-logic.ts`) and places them clear of the character's head. Draw them centred in the cell, with the anchor in the middle.
- **Swaying plants:** trees and bushes sway in code (`SWAY_TYPES`). Don't draw sway frames for them.

## Animated terrain (water)

Ponds and rivers are animated by `src/client/render/water.ts`; the pure timing and layout live in `water-anim.ts` (unit-tested in `test/fe-water.test.ts`).

- **Art:** `terrain/water_anim.png`, catalog `terrain.water_anim`:
  - `frames.surface`: 4 frames of open water with Eliza Wyatt's water reflections. Each frame is a seamless 192 px (6-tile) pattern drawn 2x2, so any tile-sized window that starts inside the pattern fits.
  - `banks`: the `terrain.water` bank sheets with the flat open water cut out, so the surface shows through them. The bank pixels themselves never change.
  - `lap`: the colour of the lap line, and the sheet's water colours. The client traces the line from the bank pixels at load time (1–3 px off the bank), so it hugs grass tufts and rocks.
  - `styles`: `ms` per frame and `flow` (drift in source px per second) for each `MapData.waterStyle`: `still` (ponds, lakes, the default) and `river`.
- **One pattern in world space:** each tile shows the window of the pattern at its world position, so the surface runs on across tiles and chunks without seams. The pattern is 6 tiles wide and its glints run out of step, so there is no blinking grid. A river slides the window one whole pixel at a time, keeping the art crisp.
- **Lap phase:** the line's stage is keyed to world pixels and steps every 40 px along the shore, so it travels along a bank instead of pulsing everywhere at once.
- **Layers:** water sits under the cached ground chunks. Land never overlaps a water tile, and banks are drawn inside the water tile. Lily pads, reeds, docks and bridges are props or wood tiles, so they stay on top. Cached chunks skip rows of open water, so nothing paints over the water twice.
- **Cost:** the surface is one sprite per run of water (cut every 6 tiles) sharing a handful of windows into the sheet. The ticker moves those windows only when the frame or the drift pixel changes. Still water is cached per chunk like the ground and redrawn only on a frame step.
- **Adding a water style:** add it to `WaterStyle` in `src/shared/types.ts`, give it defaults in `DEFAULT_WATER_STYLES`, add it to the catalog's `styles`, and set `waterStyle` in the map's `build()` call.
- **Fallback:** if the entry is missing or incomplete, `parseWaterAnim` returns null and water is drawn as still tiles, as before. The minimap and map panel always use still colours.

## Checking an animation

- [ ] Every frame is in its grid cell, and nothing is cut off at the cell edge. Big swings need a bigger `frameSize`.
- [ ] The feet point is steady across frames.
- [ ] All four directions are correct: up, left, down, right.
- [ ] Tool layers go behind and in front of the body at the right moments.
- [ ] The effect lands on the impact frame, for you and for a second player watching.
- [ ] Wide frames don't overlap the name tag or the HUD.
- [ ] The animation goes back to idle, unless it is meant to hold.
- [ ] The moving thing has a shadow; its static props have none.
