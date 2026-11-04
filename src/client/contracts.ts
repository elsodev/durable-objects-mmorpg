// Frontend module contracts. Each module below is built separately,
// so these interfaces are the ONLY way modules talk to each other. Add optional members if needed;
// never rename or remove. Every factory returns an object with destroy() where it owns display objects.
import type { Application, Container, Sprite, Texture } from "pixi.js";
import type { BubbleCode } from "../shared/emotes";
import type { CropLook } from "../shared/engine";
import type { ClientMsg, ServerMsg, VillageGoal } from "../shared/protocol";
import type {
  EntityState,
  Facing,
  FarmTile,
  Ground,
  Inventory,
  ItemId,
  MapData,
  PlacedObject,
  RockOre,
  Vec2,
  ZoneId,
} from "../shared/types";

// ---------------------------------------------------------------- scale
/** LPC source art: 32 px tiles, 64x64 character frames. */
export const SRC_TILE = 32;
/** Screen pixels per source pixel. */
export const SCALE = 2;
/** Screen pixels per tile. All world containers use tile * TILE for x/y. */
export const TILE = SRC_TILE * SCALE;

// ---------------------------------------------------------------- art   (src/client/art/)
// art/index.ts: loadArt() reads /assets/lpc/catalog.json (if present) and the PNGs it lists,
// and falls back to art/placeholders.ts for every key that is missing, so the game always renders.

export interface CharacterArt {
  walk: Record<Facing, Texture[]>; // looping walk cycle
  idle: Record<Facing, Texture>;
  attack?: Record<Facing, Texture[]>;
  /**
   * Seated pose per facing (same anchor as idle: the feet point). Optional: without it a seated
   * character is drawn as its idle frame, legs cut off and lowered onto the seat.
   */
  sit?: Record<Facing, Texture>;
  /** Anchor in texture space 0..1 where the FEET are (sprite.anchor). */
  anchor: Vec2;
  /** Drop shadow to draw under the feet (Art.shadow(size)). */
  shadow?: ShadowSize;
  /**
   * Action animation by name ("hoe", "watering", "smash", "sword", "fishing", "harvest", "sit"
   * (on a chair), "sit_ground", "hurt", "faint") or by tool item id ("pickaxe_iron" -> smash with an iron pickaxe). Null when this
   * character has none, or while its frames are still loading (they load on the first ask).
   */
  action?(nameOrItem: string): ActionArt | null;
  /**
   * The tool `item` held in the hand while standing and walking: layers whose frame i of a facing
   * lines up with walk[facing][i] (same size and anchor). Null when the item has no held art, or
   * while it loads (it loads on the first ask).
   */
  held?(item: string): HeldArt | null;
  /** Animals: looping poses by act name (AnimalPose), same frame size and anchor as walk. */
  poses?: Partial<Record<AnimalPose, Record<Facing, Texture[]>>>;
  /** Floats above the ground (bats): keep the shadow at the anchor. */
  flying?: boolean;
  /** Flying: draw the sprite this many screen px (already x SCALE) above the anchor/shadow. */
  hover?: number;
}

/** Animal poses an entity's act key can name (shared/engine/animals.ts ANIMAL_ACTS). */
export type AnimalPose = "rest" | "nap" | "love" | "scratch" | "play" | "sniff";

/** One action animation (CharacterArt.action). Frames can be larger than walk frames (tools swing wide). */
export interface ActionArt {
  frames: Record<Facing, Texture[]>;
  /** Milliseconds per frame. */
  ms: number;
  /** Stay on the last frame when done (faint) instead of returning to idle. */
  hold: boolean;
  /** Feet position in texture space 0..1 for these frames. */
  anchor: Vec2;
}

/** A held tool (CharacterArt.held): "bg" frames go behind the body, "fg" frames in front. */
export interface HeldArt {
  bg: Record<Facing, Texture[]> | null;
  fg: Record<Facing, Texture[]> | null;
}

/** Drop shadow sizes the art pack provides. */
export type ShadowSize = "small" | "character" | "medium" | "large" | "tree";

export interface SpriteArt {
  texture: Texture;
  /** Anchor 0..1 at the base/feet point used for y-sorting. */
  anchor: Vec2;
  shadow?: ShadowSize;
  /** Looping animation frames (campfire); texture is frames[0]. Same anchor. */
  frames?: Texture[];
  /** Milliseconds per looping frame, when the catalog sets one (placed furniture). */
  frameMs?: number;
  /** Lid frames from closed to open (shipping bin); texture is open[0]. Same anchor. */
  open?: Texture[];
  /** Drawn above an NPC standing at `keeper` (market stall counter). Place at the same position as the sprite. */
  front?: SpriteArt;
  /** Where a shopkeeper's feet go: screen px (already x SCALE) relative to the sprite's anchor point. */
  keeper?: Vec2;
  /** Where a MapProp.label plate is centred (signposts): screen px (already x SCALE) relative to the anchor. */
  label?: Vec2;
  /** Tables: top surface where tabletop things stand, source px relative to the anchor. */
  surface?: { x: number; y: number; w: number; h: number };
}

export interface Art {
  /** Deterministic variant by tile position. */
  ground(kind: Ground, x: number, y: number): Texture;
  /** Map prop types (see src/shared/maps/props.ts PROP_FOOTPRINTS keys). */
  prop(type: string): SpriteArt;
  /** Interior floor tile (catalog `interior` floor key), deterministic variant; null without art. */
  floor?(style: string, x: number, y: number): Texture | null;
  /** Interior side/south wall top piece (corner_sw, wall_w, wall_s_cap...) for a wall style. */
  wallBorder?(style: string, piece: string): Texture | null;
  /** Players (player_1..player_4), NPC sprite keys (see npc catalog), monsters (slime, bat, rock_crab). */
  character(key: string): CharacterArt;
  /** Growth stage art; `look` swaps in the wilted or dead plant (engine cropLook). */
  crop(crop: ItemId, stage: 0 | 1 | 2 | 3, look?: CropLook): SpriteArt;
  rock(ore: RockOre): SpriteArt;
  furniture(item: ItemId, rotation: 0 | 1 | 2 | 3): SpriteArt;
  icon(item: ItemId): Texture;
  /** Same icon as a data URL for DOM UI (cached). */
  iconUrl(item: ItemId): string;
  /** Soft drop shadow texture, drawn centred on an anchor (feet point). */
  shadow?(size: ShadowSize): Texture;
  /** Watered tilled soil (no Ground value for it). */
  tilledWet?(x: number, y: number): Texture;
  /** Autotiled fence piece for a neighbour mask (render/fence.ts); null if the fence sheet is missing. */
  fence?(mask: number): SpriteArt | null;
}

/** art/index.ts */
export type LoadArt = (app: Application) => Promise<Art>;

/** art/placeholders.ts: procedural pixel-art textures for any key (cozy palette, outlines, 32 px grid). */
export interface Placeholders {
  ground(kind: Ground, variant: number): Texture;
  prop(type: string): SpriteArt;
  character(key: string): CharacterArt;
  crop(crop: ItemId, stage: 0 | 1 | 2 | 3, look?: CropLook): SpriteArt;
  rock(ore: RockOre): SpriteArt;
  furniture(item: ItemId, rotation: 0 | 1 | 2 | 3): SpriteArt;
  icon(item: ItemId): Texture;
}
export type MakePlaceholders = (app: Application) => Placeholders;

// ---------------------------------------------------------------- app shell (src/client/game/app.ts)
export interface Layers {
  /** Moved by the camera. Children positioned in screen px = tile * TILE. */
  world: Container;
  ground: Container; // terrain, never sorted
  groundOverlay: Container; // tilled soil, water, shadows (under sorted things)
  sorted: Container; // sortableChildren = true; zIndex = feet y in px. Props, entities, crops, rocks, furniture
  overlay: Container; // name tags, bubbles, hp bars, float text, build ghost (camera-space, drawn above `screen` so ambient darkness doesn't dim it)
  /** Screen-space container NOT moved by the camera (ambient tint, vignette). */
  screen: Container;
}
export interface GameApp {
  app: Application;
  layers: Layers;
  renderer: "webgpu" | "webgl";
  width(): number;
  height(): number;
  /** Clears world layers (on zone change). */
  clearWorld(): void;
  destroy(): void;
}
/** game/app.ts: PixiJS v8 Application.init({ preference: 'webgpu', ... }) with WebGL fallback, nearest scale mode. */
export type CreateGameApp = (mount: HTMLElement) => Promise<GameApp>;

// ---------------------------------------------------------------- network (src/client/net/)
export type ConnState = "connecting" | "online" | "offline";
export interface Connection {
  /**
   * Opens /ws/<zone>?spawn=<spawn> (or /ws/visit/<visit> to visit that owner's home, where `zone` is
   * "home"); closes any previous socket first. Reconnects with backoff on drop.
   */
  connect(zone: ZoneId, spawn?: string, visit?: string): void;
  send(msg: ClientMsg): void;
  close(): void;
  /** Smoothed round-trip ms (from ping/pong every 2 s). */
  rtt(): number;
  /** Estimated serverTime - Date.now(). */
  clockOffset(): number;
}
export type CreateConnection = (opts: {
  onMessage(msg: ServerMsg): void;
  onState(state: ConnState): void;
  /** Called when the server closes with code 4401 (not allowed: e.g. guest entering a shared zone). */
  onForbidden?(zone: ZoneId): void;
  /** Called when the server closes with code 4408 (idle too long). The connection does not retry. */
  onIdle?(zone: ZoneId): void;
  /** An admin removed this player (close 4451, or the Worker answers 451). The connection does not retry. */
  onRemoved?(): void;
}) => Connection;

// ---------------------------------------------------------------- world store (src/client/state/)
export type StoreEvent =
  | "zone"
  | "inventory"
  | "farm"
  | "objects"
  | "rocks"
  | "goals"
  | "chat"
  | "removed"
  | "you";
export interface ChatEntry {
  from: string;
  name: string;
  text: string;
  at: number;
}
export interface WorldStore {
  zone: ZoneId | null;
  map: MapData | null;
  youId: string | null;
  inventory: Inventory;
  farm: Map<string, FarmTile>; // key `${x},${y}`
  objects: Map<string, PlacedObject>;
  brokenRocks: Set<string>;
  /** Rocks holding another ore than the map places this spawn (cave silver, gold, diamond). */
  rockOres: Map<string, RockOre>;
  /** Chopped trees: tree id -> "stump" or "gone" (standing trees are not listed). */
  trees: Map<string, "stump" | "gone">;
  goals: VillageGoal[];
  /** Apply any ServerMsg that changes world state (welcome, tick, inventory, farm, objects, rock, goals, chat). */
  apply(msg: ServerMsg, recvTime: number): void;
  /** Latest authoritative state of an entity. */
  latest(id: string): EntityState | undefined;
  /** Remote entities interpolated at renderTime (recv-clock ms); excludes you. ~100 ms behind. */
  sample(renderTime: number): EntityState[];
  /** How far (ms) behind the fastest packets others are drawn: tick interval plus measured jitter. */
  renderDelay?(): number;
  on(ev: StoreEvent, cb: (payload?: unknown) => void): () => void;
  reset(): void;
}
/** state/store.ts (uses state/interp.ts) */
export type CreateStore = () => WorldStore;
/** state/interp.ts: lerp position, keep b's discrete fields. */
export type Interpolate = (a: EntityState, b: EntityState, t: number) => EntityState;

// ---------------------------------------------------------------- prediction (src/client/game/prediction.ts)
export interface Predictor {
  /**
   * Local input each frame; returns a move msg to send when direction changed or every 100 ms.
   * `now` (performance.now() clock) lets it integrate exactly up to the frame; without it, dtMs.
   */
  step(dx: number, dy: number, dtMs: number, now?: number, dash?: boolean): { send: ClientMsg | null };
  /** Direction (or dash) changed at clock time `at` (key event timeStamp): returns the move msg to send now, or null if unchanged. */
  setDir(dx: number, dy: number, at: number, dash?: boolean): ClientMsg | null;
  /**
   * What the server allows (shared/engine/pace.ts): worn out walks at half speed and can't dash;
   * visitors can't dash. Prediction must use the same speed as the server.
   */
  setLimits?(limits: { tired: boolean; canDash: boolean }): void;
  /**
   * Server state for you + last acked seq (+ how long the server has applied it): replay the
   * inputs the server has not simulated yet; snap if error > 1.5 tiles else ease. `now`
   * (performance.now() clock) integrates the held input up to the moment the tick arrived.
   */
  reconcile(server: EntityState, ack: number | undefined, ackMs?: number, now?: number): void;
  /** Click-to-move: client also walks the path locally. */
  moveTo(target: Vec2): ClientMsg;
  state(): { x: number; y: number; facing: Facing; moving: boolean; pace?: "dash" | "tired" };
  reset(at: Vec2, facing: Facing): void;
  /** Turn on the spot (a tool swing faces its tile); ignored while walking. */
  face?(facing: Facing): void;
  /** Corrections so far (debug hook and network tests). */
  stats?(): PredictorStats;
}
/** How often reconcile moved you: all corrections, the visible ones, the hard snaps, the largest (tiles). */
export interface PredictorStats {
  corrections: number;
  visible: number;
  snaps: number;
  maxErr: number;
}
export type CreatePredictor = (getMap: () => MapData | null, getBlockedExtras: () => { objects: PlacedObject[]; rocks: Vec2[]; cleared?: Vec2[] }) => Predictor;

// ---------------------------------------------------------------- input (src/client/game/input.ts)
export type InputAction = "use" | "interact" | "gift" | "build" | "rotate" | "rotateBack" | "cancel" | "inventory" | "goals" | "chat";
export interface PointerInfo {
  screen: Vec2;
  tile: Vec2; // float tile coords under the pointer
  button: 0 | 2;
}
export interface Input {
  /**
   * Held movement direction from WASD/arrows, in {-1,0,1}. Zero while typing. `dash`: Shift is
   * held together with a direction.
   */
  dir(): { dx: number; dy: number; dash?: boolean };
  /** Fires as soon as the held direction (or dash) changes, with the event's timeStamp (performance.now() clock). */
  onDir(cb: (dir: { dx: number; dy: number; dash?: boolean }, at: number) => void): () => void;
  setTyping(typing: boolean): void;
  onAction(cb: (a: InputAction) => void): () => void;
  onSlot(cb: (slot: number) => void): () => void; // keys 1-8, mouse wheel
  /** Tell input the slot chosen elsewhere (HUD click), so the wheel steps from it. */
  setSlot?(slot: number): void;
  /** While true the mouse wheel rotates (emits rotate / rotateBack) instead of stepping slots. */
  setWheelRotates?(on: boolean): void;
  onClick(cb: (p: PointerInfo) => void): () => void;
  onPointerMove(cb: (p: PointerInfo) => void): () => void;
  destroy(): void;
}
export type CreateInput = (canvas: HTMLCanvasElement, screenToTile: (sx: number, sy: number) => Vec2) => Input;

// ---------------------------------------------------------------- camera (src/client/render/camera.ts)
export interface Camera {
  setBounds(mapW: number, mapH: number): void; // tiles
  /** Smoothly follow a tile position (snap=true on zone change). */
  follow(x: number, y: number, snap?: boolean): void;
  update(dtMs: number): void; // moves layers.world
  resize(w: number, h: number): void;
  /** Draw the world at this scale (below 1 zooms out); dpr keeps the offset on device pixels. */
  setZoom?(zoom: number, devicePixelRatio: number): void;
  /** The current world scale (1 unless zoomed). */
  zoom?(): number;
  screenToTile(sx: number, sy: number): Vec2;
  tileToScreen(x: number, y: number): Vec2;
  /** Visible tile rect for culling. */
  view(): { x: number; y: number; w: number; h: number };
  /** Shakes the view for `ms` by up to `amp` screen px. */
  shake?(ms: number, amp: number): void;
}
export type CreateCamera = (layers: Layers, viewport: { w: number; h: number }) => Camera;

// ---------------------------------------------------------------- renderers (src/client/render/)
/** render/ground.ts: terrain in chunks (cacheAsTexture), simple autotile edges for water/sand/cave walls. */
export interface GroundLayer {
  destroy(): void;
}
export type CreateGroundLayer = (art: Art, map: MapData, layers: Layers) => GroundLayer;

/** render/props.ts: map props as y-sorted sprites with soft shadows (into layers.sorted / groundOverlay). */
/** A night glow centre in tile coords, with its radius in tiles (render/light-points.ts). */
export interface LightSpot extends Vec2 {
  radius: number;
}

/** A building's lit-window overlay placed in the world (render/light-points.ts LIT_WINDOWS). */
export interface LitWindowsView {
  /** Prop art name of the overlay: same size and anchor as the building, only the panes opaque. */
  art: string;
  /** Building anchor (feet), world px. */
  x: number;
  y: number;
  /** The building's sort key: anything sorted after it stands in front of its windows. */
  z: number;
  /** Each window's panes, world px. */
  windows: { x: number; y: number; w: number; h: number }[];
}

export interface PropsLayer {
  /** Prop id under a tile, for interact clicks (shipping_bin, stalls...). */
  propAt(tile: Vec2): string | null;
  /** Body and ground shadow of a prop that changes at runtime (choppable trees). */
  spriteOf?(id: string): { body: Sprite; shadow: Sprite | null } | null;
  /** Opens or closes a prop's lid (shipping bin); no-op for props without one. */
  setOpen?(id: string, open: boolean): void;
  /** Squashes a lidded prop as something lands in it. */
  bump?(id: string): void;
  /** Night glows of the map's lamps, lanterns and fires, centred on their lit part (tile coords). */
  lights?(): readonly LightSpot[];
  /** Buildings whose windows light up at night, placed in the world. */
  litWindows?(): readonly LitWindowsView[];
  destroy(): void;
}
export type CreatePropsLayer = (art: Art, map: MapData, layers: Layers) => PropsLayer;

/** render/entities.ts: players/NPCs/monsters with animation by facing+moving, y-sorted, shadows, hit flash. */
export interface EntityLayer {
  sync(states: EntityState[], dtMs: number): void; // full set to show this frame (remote sampled + you)
  entityAt(tile: Vec2): string | null; // for click-to-interact
  /** Screen-space (camera) head position for overlays. */
  headOf(id: string): Vec2 | null;
  /** Where the food in the hand is while eating (world px), else null. For crumbs. */
  foodOf?(id: string): Vec2 | null;
  /** True once per foot landing in this entity's walk cycle (then cleared). */
  footstepOf?(id: string): boolean;
  flash(id: string): void;
  /** Plays a knockback slide (tiles, total) at once, ahead of the server's next positions. */
  nudge?(id: string, slide: Vec2): void;
  /** Blinks the entity for `ms` (hurt invincibility). */
  blink?(id: string, ms: number): void;
  /** Death: squash flat and fade now; the entity is removed a moment later. */
  die?(id: string): void;
  destroy(): void;
}
export type CreateEntityLayer = (art: Art, layers: Layers) => EntityLayer;

/** render/overlays.ts: name tags, speech bubbles (5 s, wrap 28 chars), status ("..."), hp bars. Plain Text only, never HTML. */
export interface Overlays {
  sync(states: EntityState[], headOf: (id: string) => Vec2 | null, youId: string | null): void;
  say(entityId: string, text: string): void;
  /** Icon bubble above the head for EMOTE_MS (shared/emotes.ts). Optional for older overlay builds. */
  emote?(entityId: string, code: BubbleCode): void;
  destroy(): void;
}
export type CreateOverlays = (layers: Layers) => Overlays;

/** render/farm.ts: tilled/watered soil, crop stages (engine cropView), mining rocks (hidden when broken), placed furniture. */
export interface FarmLayer {
  setFarm(tiles: Iterable<FarmTile>, now: number): void;
  /** `ores`: this spawn's ore where it differs from the map's. */
  setRocks(map: MapData, broken: Set<string>, ores?: ReadonlyMap<string, RockOre>): void;
  /** `map`: the map they stand on (wall pieces sort in front of their wall); kept until the next one. */
  setObjects(objects: Iterable<PlacedObject>, map?: MapData | null): void;
  objectAt(tile: Vec2): string | null;
  /** Opens or shuts a placed storage piece's door (fridge lid frames); no-op without lid art. */
  setLid?(id: string, open: boolean): void;
  /** Edit mode: draw these placed pieces faded (they are being dragged); the rest at full alpha. */
  setDimmed?(ids: ReadonlySet<string>): void;
  /** The sprite drawing a rock, for hit effects. */
  rockSprite?(id: string): Sprite | null;
  /** Night glows of placed lamps, candles and fireplaces, centred on their lit part (tile coords). */
  lights?(): readonly LightSpot[];
  destroy(): void;
}
export type CreateFarmLayer = (art: Art, layers: Layers) => FarmLayer;

/** render/buildmode.ts: home furniture ghost snapped to tiles, green/red via engine canPlace, R rotates, click places/moves. */
export interface BuildMode {
  active(): boolean;
  /** Start placing furniture from an inventory slot. */
  enter(slot: number): void;
  /** Start moving an existing placed object. */
  pick(objectId: string): void;
  exit(): void;
  /** Next allowed rotation of the piece (ItemDef.rotations); dir -1 turns the other way. */
  rotate(dir?: 1 | -1): void;
  pointer(tile: Vec2): void;
  /** Returns the message to send (place or moveObject) when valid, else null (and shows why). */
  click(tile: Vec2): ClientMsg | null;
  destroy(): void;
}
export type CreateBuildMode = (
  art: Art,
  layers: Layers,
  deps: {
    map(): MapData | null;
    objects(): PlacedObject[];
    farm(): FarmTile[];
    inventory(): Inventory;
    occupied(): Vec2[];
    notice(text: string): void;
  },
) => BuildMode;

/** render/effects.ts: ambient tint (cave dark with light around you, indoor warm), float text (+3 ore), dust/hit particles. */
export interface Effects {
  setAmbient(ambient: MapData["ambient"]): void;
  /** A flashlight in the bag: caves are drawn fully lit instead of dark around you. */
  setFlashlight?(on: boolean): void;
  floatText(at: Vec2, text: string, kind: "info" | "error" | "loot" | "love" | "damage" | "crit" | "miss" | "hurt" | "xp"): void;
  burst(at: Vec2, kind: "dust" | "hit" | "water" | "sparkle" | "levelup"): void;
  /**
   * The level-up burst over a character: rings, a column of light and "LEVEL UP! / Lv N" rising
   * off the head. `follow` gives its feet each frame (null once it is gone). `reduced`: no motion.
   */
  levelUp?(follow: () => Vec2 | null, level: number, reduced: boolean): void;
  /**
   * Rings spreading on water (watering-can refill). With `sortY` (tiles) they y-sort like a
   * prop standing there (in a well, in front of it but behind you), else they draw above all.
   */
  ripple?(at: Vec2, sortY?: number): void;
  /** Watering-can meter over your head, filling from `from` to `to` (0..1), then fading. */
  meter?(from: number, to: number): void;
  /** Throws `texture` in an arc from `from` to `to` (tiles), shrinking at the end; `onLand` when it lands. */
  toss?(from: Vec2, to: Vec2, texture: Texture, onLand?: () => void): void;
  update(dtMs: number, you: Vec2 | null): void;
  destroy(): void;
}
export type CreateEffects = (layers: Layers, viewport: () => { w: number; h: number }) => Effects;

// ---------------------------------------------------------------- session orchestrator (src/client/game/session.ts, main.ts)
// Wires everything: auth -> GameApp -> art -> store -> connection -> renderers -> HUD; runs the frame loop,
// zone switching (rebuild layers), sends input, handles needAccount by hud.showAccountPrompt().
// Exposes window.__dmmo = { renderer, zone, you(), entities(), inventory(), send(msg), teleportTo?(x,y) (moveTo) } for tests.
export interface GameSession {
  destroy(): void;
}
