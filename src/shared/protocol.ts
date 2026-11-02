// WebSocket protocol between the browser and a zone/home Durable Object.
// All messages are JSON text frames. Client sends INTENTS, server is authoritative.

import type { PoseCode } from "./poses";
import type { TravelZone } from "./travel";
import type {
  EntityState,
  Facing,
  FarmTile,
  HomeMapId,
  Inventory,
  Look,
  ItemId,
  PlacedObject,
  RockOre,
  ZoneId,
} from "./types";
import { MAX_FRAME_BYTES, validateClientMsg } from "./validate";
import type { HomeClientMsg, HomeServerMsg } from "./home";
import type { VisitInfo, VisitServerMsg } from "./visits";
import type { EmoteCode } from "./emotes";
import type { BondView } from "./hearts";
import type { ChestView } from "./chests";

// ---------------- Client -> Server ----------------
// Optional `seq` (move/moveTo): client input sequence number, acked in `tick.ack` so the client
// can replay unacked inputs on top of the server position (prediction reconciliation).
// Optional `req` (actions): client-generated tag echoed in `reject.req` so the client can roll
// back exactly the optimistic change that was refused.

export type ClientMsg =
  /** Held-direction movement. dx/dy in {-1,0,1}. Sent on change, and at most every 100 ms. */
  | { t: "move"; dx: number; dy: number; seq?: number }
  /** Click-to-move target in tile coords. */
  | { t: "moveTo"; x: number; y: number; seq?: number }
  | { t: "chat"; text: string }
  /**
   * A reply typed in the conversation window to the villager with entity id `npc`. Said aloud like
   * chat; the server judges it good, neutral or bad and moves your hearts (answered with `bond`).
   */
  | { t: "npcSay"; npc: string; text: string }
  /** Use the item in the given hotbar slot on a tile (hoe, watering can, seed, pickaxe, sword). */
  | { t: "use"; slot: number; x: number; y: number; req?: string }
  /** Talk/interact with an entity (NPC) or prop (shipping bin, shop stall). */
  | { t: "interact"; target: string }
  /** Home only: place furniture from inventory slot. */
  | { t: "place"; slot: number; x: number; y: number; rotation: 0 | 1 | 2 | 3; req?: string }
  /** Home only: move an already placed object. */
  | { t: "moveObject"; id: string; x: number; y: number; rotation: 0 | 1 | 2 | 3; req?: string }
  /** Home only: pick an object back into inventory. */
  | { t: "pickup"; id: string; req?: string }
  /** Shop: buy from an NPC shop. */
  | { t: "buy"; npc: string; item: ItemId; qty: number; req?: string }
  /** Shop: sell from inventory slot to an NPC. */
  | { t: "sell"; npc: string; slot: number; qty: number; req?: string }
  /** Give one item from an inventory slot to an NPC (they remember it). Tools can't be given. */
  | { t: "giftNpc"; npc: string; slot: number; req?: string }
  /** Donate to a village goal (bridge, fair, lantern). */
  | { t: "donate"; goal: string; slot: number; qty: number; req?: string }
  /** Character creator: change your look (ids validated against shared/look.ts; rate-limited). */
  | { t: "setLook"; look: Look }
  | { t: "ping"; at: number }
  /** Emote bubble above your head for everyone in this zone/home (codes in shared/emotes.ts). */
  | { t: "emote"; code: EmoteCode }
  /** Strike a pose: lie down on the ground, or pee on the spot (shared/poses.ts). */
  | { t: "pose"; pose: PoseCode }
  /** Fast travel (Map tab): the room saves you with the destination, then answers with `zone`. */
  | { t: "travel"; to: TravelZone }
  /**
   * Rearrange the bag: move the stack in `from` onto `to`. Empty target: move (or split off `qty`);
   * same item: merge up to the stack limit; otherwise swap. Answered with `inventory` or `reject`.
   */
  | { t: "moveSlot"; from: number; to: number; qty?: number; req?: string }
  /**
   * The hotbar slot you have selected (null: none), sent only when it changes and after each
   * welcome. The server shows the tool in that slot in your hand (EntityState.held).
   */
  | { t: "hold"; slot: number | null }
  | HomeClientMsg;

// ---------------- Server -> Client ----------------

export interface ShopOffer {
  item: ItemId;
  price: number;
}

export interface VillageGoal {
  id: string; // "bridge" | "fair" | "lantern"
  name: string;
  needs: { item: ItemId; qty: number; have: number }[];
  done: boolean;
}

/** An item lying on the ground: your own overflow loot (walk over it) or forage (interact). */
export interface GroundItemView {
  id: string;
  item: ItemId;
  qty: number;
  x: number;
  y: number;
  /** Forage anyone can pick; absent = your own dropped loot. */
  forage?: boolean;
}

/**
 * On farm, rock and tree messages a tool swing caused: who swung (`by`, an entity id) and when the
 * swing's impact frame lands (`impactAt`, server ms). The server has already applied the result;
 * clients hold the visual until then so it shows mid-swing, not before the tool comes down.
 */
export interface ImpactStamp {
  by?: string;
  impactAt?: number;
}

export type ServerMsg =
  /** First message after connect. */
  | {
      t: "welcome";
      zone: ZoneId;
      /** Which copy of a busy zone you joined (shared/zoneCopies.ts); absent for the original. */
      copy?: number;
      you: string; // your entity id
      entities: EntityState[];
      inventory: Inventory;
      /** Home only. */
      farm?: FarmTile[];
      objects?: PlacedObject[];
      /** Rocks already broken in this zone (ids). */
      brokenRocks?: string[];
      /** Rocks holding a different ore than the map places this spawn (cave silver, gold, diamond). */
      rockOres?: Record<string, RockOre>;
      /** Trees chopped down in this zone: a stump, or cleared ("gone"). Others stand. */
      trees?: { id: string; stage: "stump" | "gone" }[];
      goals?: VillageGoal[];
      /** True while the save has no chosen look yet: the client opens the character creator. */
      needsLook?: boolean;
      /** Set when you joined someone else's home as a visitor (see shared/visits.ts). */
      visit?: VisitInfo;
      /** Every villager you have met, with your hearts (shared/hearts.ts). */
      bonds?: BondView[];
      /** Treasure chests here (caves). */
      chests?: ChestView[];
      /**
       * Home only: which of the home's maps you are on ("home" yard, "home_in" inside the
       * house). Walking through the house door sends a new welcome on the same socket.
       */
      homeMap?: HomeMapId;
      /** Items on the ground that you can see (zones). */
      ground?: GroundItemView[];
      /** Local dev servers only: the /day, /time and /hour chat commands work here. */
      devTools?: boolean;
      serverTime: number;
    }
  /** Sent every tick with only what changed. */
  | {
      t: "tick";
      at: number;
      upd: EntityState[]; // new or changed entities (full state)
      del: string[]; // entity ids removed
      /** Last `move`/`moveTo` seq from THIS client that the server has applied. */
      ack?: number;
      /** How long (ms) the server has applied the acked input; the client replays only the rest. */
      ackMs?: number;
    }
  /** `to`: a villager's line that answers this player entity (the conversation window shows it). */
  | { t: "chat"; from: string; name: string; text: string; at: number; to?: string }
  | { t: "inventory"; inventory: Inventory }
  | ({ t: "farm"; tiles: FarmTile[] } & ImpactStamp) // changed farm tiles (home)
  | { t: "objects"; upd: PlacedObject[]; del: string[] } // home
  /**
   * A rock broke (or came back). `hits` > 0 with broken false: it was hit and cracked that far
   * (of `need`). `drops` are what popped out when it broke. `ore`: on a rock coming back, the
   * ore it holds this time.
   */
  | ({ t: "rock"; id: string; broken: boolean; hits?: number; need?: number; drops?: ItemId[]; ore?: RockOre } & ImpactStamp)
  /**
   * A tool rebounded off something it can't work (axe on a rock, pickaxe on a tree, anything on a
   * boulder) at tile x,y. Sent to the others in the zone; the swinger shows it from its own swing.
   */
  | ({ t: "bounce"; x: number; y: number } & ImpactStamp)
  /**
   * A tree was hit (`hits` of `need`, stage unchanged), fell to a stump, was cleared ("gone") or
   * grew back ("tree", hits 0). `drops` are what popped out.
   */
  | ({ t: "tree"; id: string; stage: "tree" | "stump" | "gone"; hits: number; need?: number; drops?: ItemId[] } & ImpactStamp)
  | { t: "shop"; npc: string; name: string; offers: ShopOffer[]; buys: ItemId[] }
  | { t: "goals"; goals: VillageGoal[] }
  /** Floating text / toast, e.g. "+3 copper ore", "Not enough coins". */
  | { t: "notice"; text: string; kind: "info" | "error" | "loot" }
  /** Server says: go to another zone. Client closes socket and connects to /ws/<zone>?spawn=<spawn>. */
  | { t: "zone"; to: ZoneId; spawn: string }
  /** Reject an optimistic action so the client can roll it back. */
  | { t: "reject"; action: ClientMsg["t"]; reason: string; req?: string }
  | { t: "pong"; at: number; serverTime: number }
  /** A guest tried to leave home; the client shows the "create an account" prompt. */
  | { t: "needAccount"; reason: string }
  /** Someone here emoted: `from` is their entity id. */
  | { t: "emote"; from: string; code: EmoteCode }
  /**
   * Friendship with one villager changed or was looked at. `talk`: you just spoke to them (the
   * client opens the talk card); `from`: their entity id here, for the floating hearts.
   */
  | { t: "bond"; view: BondView; delta: number; talk?: boolean; from?: string; gifts?: ItemId[] }
  /** Every villager you have met (sent when the list changes shape, e.g. a new villager met). */
  | { t: "bonds"; list: BondView[] }
  /** All chests here, as you see them (after a respawn). */
  | { t: "chests"; chests: ChestView[] }
  /** You opened a chest: play the lid and show the loot. */
  | { t: "chestOpened"; id: string; loot: string[] }
  /**
   * A player's weapon hit a monster (`id`). `kb`: the knockback slide (tiles, total) the client
   * can play at once. `kill`: it died at `at`. `by`: the attacker's entity id.
   */
  | {
      t: "hit";
      id: string;
      by: string;
      dmg: number;
      crit?: boolean;
      miss?: boolean;
      kb?: { x: number; y: number };
      kill?: boolean;
      at: { x: number; y: number };
    }
  /** A player (`id`) was hurt and is invincible for `ms`; their own client shakes the screen. */
  | { t: "hurt"; id: string; dmg: number; ms: number }
  /** Your share of a kill's loot, popping out of `at` (bag-full extras land as ground items). */
  | { t: "loot"; at: { x: number; y: number }; items: ItemId[] }
  /** Ground items you can see came or went. */
  | { t: "ground"; upd: GroundItemView[]; del: string[] }
  /** Zones: your stamina changed (mining and chopping cost it like at home). */
  | { t: "stamina"; stamina: number; max: number }
  | HomeServerMsg
  | VisitServerMsg;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

/**
 * Parses and VALIDATES a client frame (see validate.ts). Returns null for oversized frames,
 * bad JSON, unknown types or out-of-range fields; the result contains only known fields.
 */
export function decodeClient(raw: string): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_FRAME_BYTES) return null;
  try {
    return validateClientMsg(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const m = JSON.parse(raw);
    return m && typeof m.t === "string" ? (m as ServerMsg) : null;
  } catch {
    return null;
  }
}

export type { Facing };
