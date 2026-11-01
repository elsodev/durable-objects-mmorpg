// Frontend module contracts. Each module below is built separately,
// so these interfaces are the ONLY way modules talk to each other. Add optional members if needed;
// never rename or remove. Every factory returns an object with destroy() where it owns display objects.
import type { Application, Container, Texture } from "pixi.js";
import type { EmoteCode } from "../shared/emotes";
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
  /** Floats above the ground (bats): keep the shadow at the anchor. */
  flying?: boolean;
  /** Flying: draw the sprite this many screen px (already x SCALE) above the anchor/shadow. */
  hover?: number;
}

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

/** Drop shadow sizes the art pack provides. */
export type ShadowSize = "small" | "character" | "medium" | "large" | "tree";

export interface SpriteArt {
  texture: Texture;
  /** Anchor 0..1 at the base/feet point used for y-sorting. */
  anchor: Vec2;
  shadow?: ShadowSize;
  /** Looping animation frames (campfire); texture is frames[0]. Same anchor. */
  frames?: Texture[];
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
  crop(crop: ItemId, stage: 0 | 1 | 2 | 3): SpriteArt;
  rock(ore: "stone" | "copper" | "iron" | "gem"): SpriteArt;
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
  crop(crop: ItemId, stage: 0 | 1 | 2 | 3): SpriteArt;
  rock(ore: "stone" | "copper" | "iron" | "gem"): SpriteArt;
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
  goals: VillageGoal[];
  /** Apply any ServerMsg that changes world state (welcome, tick, inventory, farm, objects, rock, goals, chat). */
  apply(msg: ServerMsg, recvTime: number): void;
  /** Latest authoritative state of an entity. */
  latest(id: string): EntityState | undefined;
  /** Remote entities interpolated at renderTime (recv-clock ms); excludes you. ~100 ms behind. */
  sample(renderTime: number): EntityState[];
  on(ev: StoreEvent, cb: (payload?: unknown) => void): () => void;
  reset(): void;
}
/** state/store.ts (uses state/interp.ts) */
export type CreateStore = () => WorldStore;
/** state/interp.ts: lerp position, keep b's discrete fields. */
export type Interpolate = (a: EntityState, b: EntityState, t: number) => EntityState;

// ---------------------------------------------------------------- prediction (src/client/game/prediction.ts)
export interface Predictor {
  /** Local input each frame; returns the seq to send with a move msg when direction changed or every 100 ms. */
  step(dx: number, dy: number, dtMs: number): { send: ClientMsg | null };
  /** Server state for you + last acked seq: replay unacked inputs; snap if error > 1.5 tiles else ease. */
  reconcile(server: EntityState, ack: number | undefined): void;
  /** Click-to-move: client also walks the path locally. */
  moveTo(target: Vec2): ClientMsg;
  state(): { x: number; y: number; facing: Facing; moving: boolean };
  reset(at: Vec2, facing: Facing): void;
}
export type CreatePredictor = (getMap: () => MapData | null, getBlockedExtras: () => { objects: PlacedObject[]; rocks: Vec2[] }) => Predictor;

// ---------------------------------------------------------------- input (src/client/game/input.ts)
export type InputAction = "use" | "interact" | "gift" | "build" | "rotate" | "cancel" | "inventory" | "goals" | "chat";
export interface PointerInfo {
  screen: Vec2;
  tile: Vec2; // float tile coords under the pointer
  button: 0 | 2;
}
export interface Input {
  /** Held movement direction from WASD/arrows, in {-1,0,1}. Zero while typing. */
  dir(): { dx: number; dy: number };
  setTyping(typing: boolean): void;
  onAction(cb: (a: InputAction) => void): () => void;
  onSlot(cb: (slot: number) => void): () => void; // keys 1-8, mouse wheel
  /** Tell input the slot chosen elsewhere (HUD click), so the wheel steps from it. */
  setSlot?(slot: number): void;
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
  screenToTile(sx: number, sy: number): Vec2;
  tileToScreen(x: number, y: number): Vec2;
  /** Visible tile rect for culling. */
  view(): { x: number; y: number; w: number; h: number };
}
export type CreateCamera = (layers: Layers, viewport: { w: number; h: number }) => Camera;

// ---------------------------------------------------------------- renderers (src/client/render/)
/** render/ground.ts: terrain in chunks (cacheAsTexture), simple autotile edges for water/sand/cave walls. */
export interface GroundLayer {
  destroy(): void;
}
export type CreateGroundLayer = (art: Art, map: MapData, layers: Layers) => GroundLayer;

/** render/props.ts: map props as y-sorted sprites with soft shadows (into layers.sorted / groundOverlay). */
export interface PropsLayer {
  /** Prop id under a tile, for interact clicks (shipping_bin, stalls...). */
  propAt(tile: Vec2): string | null;
  destroy(): void;
}
export type CreatePropsLayer = (art: Art, map: MapData, layers: Layers) => PropsLayer;

/** render/entities.ts: players/NPCs/monsters with animation by facing+moving, y-sorted, shadows, hit flash. */
export interface EntityLayer {
  sync(states: EntityState[], dtMs: number): void; // full set to show this frame (remote sampled + you)
  entityAt(tile: Vec2): string | null; // for click-to-interact
  /** Screen-space (camera) head position for overlays. */
  headOf(id: string): Vec2 | null;
  flash(id: string): void;
  destroy(): void;
}
export type CreateEntityLayer = (art: Art, layers: Layers) => EntityLayer;

/** render/overlays.ts: name tags, speech bubbles (5 s, wrap 28 chars), status ("..."), hp bars. Plain Text only, never HTML. */
export interface Overlays {
  sync(states: EntityState[], headOf: (id: string) => Vec2 | null, youId: string | null): void;
  say(entityId: string, text: string): void;
  /** Icon bubble above the head for EMOTE_MS (shared/emotes.ts). Optional for older overlay builds. */
  emote?(entityId: string, code: EmoteCode): void;
  destroy(): void;
}
export type CreateOverlays = (layers: Layers) => Overlays;

/** render/farm.ts: tilled/watered soil, crop stages (engine cropView), mining rocks (hidden when broken), placed furniture. */
export interface FarmLayer {
  setFarm(tiles: Iterable<FarmTile>, now: number): void;
  setRocks(map: MapData, broken: Set<string>): void;
  setObjects(objects: Iterable<PlacedObject>): void;
  objectAt(tile: Vec2): string | null;
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
  rotate(): void;
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
  floatText(at: Vec2, text: string, kind: "info" | "error" | "loot"): void;
  burst(at: Vec2, kind: "dust" | "hit" | "water" | "sparkle"): void;
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
