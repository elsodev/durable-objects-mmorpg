// WebSocket protocol between the browser and a zone/home Durable Object.
// All messages are JSON text frames. Client sends INTENTS, server is authoritative.

import type {
  EntityState,
  Facing,
  FarmTile,
  Inventory,
  Look,
  ItemId,
  PlacedObject,
  ZoneId,
} from "./types";
import { MAX_FRAME_BYTES, validateClientMsg } from "./validate";
import type { HomeClientMsg, HomeServerMsg } from "./home";
import type { VisitInfo, VisitServerMsg } from "./visits";
import type { EmoteCode } from "./emotes";

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

export type ServerMsg =
  /** First message after connect. */
  | {
      t: "welcome";
      zone: ZoneId;
      you: string; // your entity id
      entities: EntityState[];
      inventory: Inventory;
      /** Home only. */
      farm?: FarmTile[];
      objects?: PlacedObject[];
      /** Rocks already broken in this zone (ids). */
      brokenRocks?: string[];
      goals?: VillageGoal[];
      /** True while the save has no chosen look yet: the client opens the character creator. */
      needsLook?: boolean;
      /** Set when you joined someone else's home as a visitor (see shared/visits.ts). */
      visit?: VisitInfo;
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
    }
  | { t: "chat"; from: string; name: string; text: string; at: number }
  | { t: "inventory"; inventory: Inventory }
  | { t: "farm"; tiles: FarmTile[] } // changed farm tiles (home)
  | { t: "objects"; upd: PlacedObject[]; del: string[] } // home
  | { t: "rock"; id: string; broken: boolean }
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
