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

### Wrong-tool rebounds

- **When it happens:** a striking tool hits something solid that it can't work:
  - an axe, hoe or sword on a rock;
  - a pickaxe, hoe or sword on a tree or stump;
  - any of them on a decorative boulder (`rock_deco`), which no tool breaks.

  The rules live in `resolveToolUse` in `src/shared/engine/toolRules.ts`, which marks these outcomes `bounce: true`. A pickaxe that is too weak for an ore is the right tool, so it is not a rebound and costs no extra energy.
- **What the player sees, at the swing's impact frame:**
  1. **The spark:** a 4-frame one-shot sprite, `fx/rebound_spark.png` (catalog `props.fx_rebound`), at 80 ms per frame (`REBOUND_FRAME_MS`).
  2. **Grit:** three chips, either wood (tree or stump) or stone (rock or boulder).
  3. **A jolt:** the swinger is pushed 0.18 tiles away from the target and settles back (`reboundRecoil`, using the entity `nudge`).
  4. **Sound and notice:** the `tool_clunk` sound plays, and a notice says which tool is needed.
- **Who sees it:** the swinger shows it from their own swing. Everyone else in the zone gets a `bounce` message with the impact time, so they see it at the same frame.
- **Energy:** each wrong hit in a row costs more energy: 1, then 2, and so on, up to 6. The streak resets after 8 s or after a correct hit. From the third hit, the notice also says it is wearing you out. All of this is in `src/shared/engine/wrongTool.ts`.
- **Where the spark goes:** `toolContactPoint` puts it where the blade meets the target, so the character's own head never hides it:
  - facing up, it sits at the top of the head, under the name tag;
  - facing left or right, it sits at arm's length, at chest height;
  - facing down, it sits in front of the feet.
- **Art rules for the spark:**
  - Each frame is a 32×32 cell, with the impact point in the centre of the cell (anchor `[16, 16]`).
  - Frame 0 is a small hot core, and frame 1 is the biggest flash.
  - Frame 2 flies apart, and frame 3 is the last embers near the cell edge.
  - Nothing may touch the cell edge.
  - Use warm white, yellow and orange, with a dark warm outline (not black) so it reads on grass, stone and dirt.
  - It casts no shadow. It is CC0 and drawn by script, and it is credited in `CREDITS.md`.
- **One sheet per tool:** each striking tool has its own rebound sheet in `fx/`, catalog `props.fx_rebound_<tool>`:

  | Tool | Sheet | Look |
  |---|---|---|
  | Pickaxe | `rebound_pickaxe.png` | Hot orange sparks (also the shared fallback, `props.fx_rebound`) |
  | Axe | `rebound_axe.png` | A cold steel flash with a ringing arc |
  | Sword | `rebound_sword.png` | A bright "ting": a thin cross and a halo ring |
  | Hoe | `rebound_hoe.png` | A dull clang and a puff of dirt with clods |

  `reboundTool` (in `hit-fx-logic.ts`) picks the sheet from the swung item's tool kind, so every tier of a tool (copper or iron pickaxe, any sword) shares its sheet. A tool without a sheet falls back to `fx_rebound`.
- **Any character:** the effect is drawn in the world above the y-sorted sprites. It is never baked into, or layered onto, the character sheets, so it works the same for every body type and look. Its position comes from the swinger's feet point and facing, not from the art.
- **Adding or redrawing a tool's rebound:**
  1. Keep the same 4 × 32 px layout, centre and timing, so every tool lands on the same frame.
  2. Add it to the catalog as `props.fx_rebound_<tool>` and to `REBOUND_TOOLS`.
  3. Credit it.
  4. Check it in the browser on at least two body types, facing all four ways. A screencast (CDP `Page.startScreencast`) shows the frames more reliably than screenshots, because headless screenshots are slower than the effect.

## Poses (`/sleep`, `/meditate` and `/piss`)

Poses are whole-body states a player strikes with a chat command. They hold until the player moves (sleep, meditate) or end on their own (piss). They never need new frames drawn per body, so every body type, outfit and villager sprite gets them for free.

### The poses

| Command (aliases) | Act kind | Body frame used | Props drawn around it | Ends |
|---|---|---|---|---|
| `/sleep` (`/lie`, `/nap`) | `lie` | `idle.up`, rotated −90° so the head points west | `fx_pillow` behind the head, `fx_quilt` over the body, rising `fx_zzz` | moving, a tool, sitting |
| `/meditate` (`/meditation`) | `meditate` | the look's own `meditate` action: generator sit frame 1 (cross-legged), always facing down | `fx_calm_glow` under the body (pulses with the breath), `fx_mote` lights drifting up beside it | moving, a tool, sitting |
| `/piss` (`/pee`) | `pee` | standing idle of the facing | `fx_pee_side` (left/right, mirrored for left) or `fx_pee_front` from the hips, then `fx_puddle` on the ground layer | after `PEE_MS`; the puddle dries after `PUDDLE_MS` |

Facing up while peeing shows no stream: the body hides it.

### How a pose flows through the code

1. **Command:** `src/shared/poses.ts` lists the poses (`POSES`), their act kinds (`POSE_ACT`) and their chat words (`POSE_COMMANDS`). `parseChatInput` in `src/shared/social.ts` turns `/meditate` into a `pose` intent, and `src/client/ui/slash-commands.ts` lists it in the command menu.
2. **Server:** the client sends `{ t: "pose", pose }`. `ZoneRoom.onPose` and `HomeRoom` check `poseRefusal` (not while sitting, moving, or mid-swing), throttle to one pose per `POSE_MIN_INTERVAL_MS`, and set `entity.act`. Moving, using a tool or sitting calls `endPose`, which clears it. Visitors can't pose in someone else's home (`worker/visit/permissions.ts`).
3. **Client:** `entities.ts` asks `poses.draw()` (in `src/client/render/poses.ts`) each frame before the held tool. When it returns `posed: true`, the held tool and tool actions are skipped. If it returns `head`, the name tag moves to that height.
4. **Numbers:** every offset, size and timing lives in `src/client/render/pose-logic.ts`, in source pixels from the feet point (multiplied by `SCALE` when drawn). The pure helpers (`zzzAt`, `breathAt`, `moteAt`, `streamPlacement`, `puddleAt`) are unit tested in `test/fe-poses.test.ts`.

### Reference points on an LPC frame

All humanoid sheets are 64 × 64 with the feet point at (32, 60). Measure offsets from there:

| Point | Source px from the feet | Used by |
|---|---|---|
| Top of the head (standing) | about −50 | default name tag height |
| Mouth | about −34 | nothing should start here |
| Hips / crotch | −17 (`HIP_Y`) | where the pee stream starts |
| Seated head (cross-legged) | about −36 (`MEDITATE.head`) | name tag while meditating |
| Lying body length | about 49 px from head to feet | `LIE.body` offset centres it on the tile |

### Adding a new pose

1. Add the pose to `POSES`, give it an act kind in `POSE_ACT` and its words in `POSE_COMMANDS`. If it holds until the player moves, add its act to `HELD_ACTS`.
2. Add a slash-command entry so it shows in the menu.
3. Pick the body frame:
   - **An existing action frame:** add an action in `custom/custom.json` `actions` pointing at it (for example `"meditate": { "frames": ["sit,1"], "hold": true }`). Composed looks and catalog characters both get it, because every act sheet has the same rows. A catalog character that lacks it lists it in `missing`, and the pose falls back to its idle frame.
   - **A transformed idle frame:** rotate or offset `idle.<facing>`, as sleep does.
4. Draw the props as one small CC0 sheet in `assets/lpc/fx/`. Add each piece to `catalog.json` `props` as `fx_<name>` with a pixel `anchor`, and `frames` for animation. Credit it in `CREDITS.md`.
5. Add the drawing branch in `poses.ts`:
   - Put props **behind** the body with `addChildAt(sprite, indexOf(body))`, and props **in front** with `addChild`.
   - Ground marks that should outlive the pose (like puddles) go in `layers.groundOverlay` at world coordinates.
   - Destroy everything in `clear` and `release`.
6. Keep the geometry and timing in `pose-logic.ts` and test it.
7. Check in the browser:
   - at least two body types (male and female), and a villager if villagers can use it;
   - every facing the pose allows;
   - mid-animation and after it ends;
   - that moving ends it cleanly, with no props left behind.

### Climbing ladders

Cave floors connect by ladders (see [json-maps.md](json-maps.md#the-cave-levels)). Stepping onto a ladder exit plays a short climb before the loading bar. It isn't a chat pose, but it is drawn the same way and works for every look, because it reuses frames every sheet already has.

| Act kind | Body frame used | What happens | Ends |
|---|---|---|---|
| `climb_down` | `walk.up` cycle (back to the camera) | the body steps in place, sinks into the hole and is cut off at the hole's near rim by a mask, then fades over the last 15% | after `CLIMB_MS` (800 ms), then the exit is taken |
| `climb_up` | `walk.up` cycle | the body rises up the ladder on the wall, then fades over the last 30% | after `CLIMB_MS`, then the exit is taken |

How it flows:

1. **Server:** in the tick, a player who steps onto an exit with `climb` set goes to `ZoneRoom.startClimb`. That stands them up, stops their motion and calls `beginClimb` (`src/shared/climb.ts`). `beginClimb` snaps the entity to `climbPoint(exit)` (the hole's centre, or the tile in front of the ladder), faces it up, and sets `entity.act` to `climb_down` or `climb_up`, so every player in the zone sees the climb. While `p.climb` is set, the player ignores every intent except chat, ping and hold. When `until` passes, the tick calls `takeExit`.
2. **Client:** `poses.ts` draws climb acts with the look's `walk.up` frames. `climbAt(kind, age, ms, frames)` in `pose-logic.ts` gives the frame, the vertical offset, the alpha, the rim clip line and the name tag height. The `climb_down` clip is a `Graphics` mask kept in the pose extras, and it is destroyed in `clear` and `release`, like every other pose prop. While your own player has a climb act, `session.ts` pins the predictor to the server's position (as it does for sitting), so you see the climb at the same spot everyone else does.
3. **Numbers:** `CLIMB` in `pose-logic.ts` sets the step time, sink depth, rim line and rise height. `CLIMB_MS` is shared, so the server and the client agree on the length.
4. **Tests:** `test/climb.test.ts` covers `beginClimb`, `climbPoint` and `climbAt` (frames cycle, the body sinks or rises steadily, alpha ends at 0, the tag follows the head).

Check a climb in the browser on two body types, in both directions, and on the frames around the fade.

### Common mistakes

- **Effects starting from the wrong body part:** measure from the feet point using the table above, not by eye from the hands. The stream once started at chest height (−26) and read as coming from the mouth.
- **Particles over the face:** keep motes and sparkles in lanes beside the body (`MOTE_LANES`).
- **Forgetting the name tag:** a lower or rotated body needs a `head` value, or the tag floats over empty space.
- **Shadows:** a lying body hides the standing shadow. Seated and standing poses keep it.

## Monsters

- **Catalog entry:** monsters are listed in `catalog.json` `monsters` with `frameW` and `frameH`, an `anchor`, and `animations.walk` rows per direction. Optional `attack` rows can be added the same way.
- **Flying monsters:** they set `flying: true` and a `hover` height, so the shadow stays on the ground while the body floats above it.
- **Hit flash and knockback:** they're done in code. Don't bake them into the art.

## Looping and state props

- **Looping props:** list the frames as an array in `frames` (for example the campfire, fireplace, forge, candles and wall torches). They loop at a steady rate, with each prop offset by its tile position so neighbours don't flicker in sync.
- **Placed furniture:** a placed piece animates its front view only. Turned views are still pictures. Give it looping `frames` the same size as `rect`, and add `frameMs` (40–2000) when the default 250 ms is wrong: slow for an aquarium, quicker for an arcade screen. Keep the body still between frames and move only small parts (a fish, a light, a screen), so the piece doesn't seem to jump.
- **Lids and doors:** these use named frames, `closed`, `opening` and `open`, for example the shipping bin and the cave chest. The renderer plays closed → opening → open and back again.
- **One-shot effects:** these are short effects that play once, such as the tool-rebound spark (see [Wrong-tool rebounds](#wrong-tool-rebounds)). List their frames the same way as a looping prop. The code plays them once. Draw them centred in the cell, with the anchor in the middle.
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
- [ ] Effects that play once (sparks, puffs) start on the impact frame and stay clear of the character's head and name tag.
