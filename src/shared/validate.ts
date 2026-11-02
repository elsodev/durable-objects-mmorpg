// Runtime validation of client frames. Every WebSocket frame from a browser is untrusted:
// decodeClient() runs this before any Durable Object handler sees the message, so handlers
// can rely on the ClientMsg types actually holding (finite integers, bounded strings, ...).
import { isPose } from "./poses";
import { isTravelZone } from "./travel";
import type { ClientMsg } from "./protocol";
import { validateLook } from "./look";
import { validateHomeClientMsg } from "./home";
import { isEmote } from "./emotes";
import { HOTBAR_SIZE } from "./held";
import { cleanNoticeText, isNoticeId, isNoticePress } from "./notices";
import { MAX_ARRANGE, type ArrangeMove } from "./engine/arrange";

/** Frames larger than this are dropped without parsing. */
export const MAX_FRAME_BYTES = 2048;
export const MAX_CHAT_LEN = 200;
export const MAX_ID_LEN = 64;
export const MAX_QTY = 999;
/** Inventory slots are 0..MAX_SLOT_INDEX (matches MAX_SLOTS in items.ts). */
export const MAX_SLOT_INDEX = 23;
/** Tile coordinates are bounded well above the largest map so a bad value can't blow up math. */
const MAX_COORD = 1024;

type Obj = Record<string, unknown>;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isCoord = (v: unknown): v is number => isInt(v, -MAX_COORD, MAX_COORD);
const isFiniteCoord = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
const isSlot = (v: unknown): v is number => isInt(v, 0, MAX_SLOT_INDEX);
const isQty = (v: unknown): v is number => isInt(v, 1, MAX_QTY);
const isDir = (v: unknown): v is number => v === -1 || v === 0 || v === 1;
const isRot = (v: unknown): v is 0 | 1 | 2 | 3 => v === 0 || v === 1 || v === 2 || v === 3;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN;

/** Optional client request tag (seq/req) used for prediction acks and reject matching. */
function optSeq(m: Obj): { seq?: number } | null {
  if (m.seq === undefined) return {};
  return isInt(m.seq, 0, Number.MAX_SAFE_INTEGER) ? { seq: m.seq } : null;
}
function optReq(m: Obj): { req?: string } | null {
  if (m.req === undefined) return {};
  return isId(m.req) ? { req: m.req } : null;
}

/** 1..MAX_ARRANGE distinct ids. */
function idList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ARRANGE) return null;
  if (!v.every(isId) || new Set(v).size !== v.length) return null;
  return [...v];
}

/** 1..MAX_ARRANGE moves, each a distinct id with a whole tile and a rotation; only known fields kept. */
function arrangeMoves(v: unknown): ArrangeMove[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ARRANGE) return null;
  const out: ArrangeMove[] = [];
  for (const m of v) {
    if (!m || typeof m !== "object") return null;
    const e = m as Obj;
    if (!isId(e.id) || !isCoord(e.x) || !isCoord(e.y) || !isRot(e.rotation)) return null;
    out.push({ id: e.id, x: e.x, y: e.y, rotation: e.rotation });
  }
  return new Set(out.map((m) => m.id)).size === out.length ? out : null;
}

/** Trims, strips control characters and caps chat text. Returns null if nothing is left. */
export function cleanChat(text: unknown): string | null {
  if (typeof text !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, MAX_CHAT_LEN);
  return t.length > 0 ? t : null;
}

/**
 * Builds a clean ClientMsg from parsed JSON (copying only known fields), or null if invalid.
 * Unknown message types are rejected.
 */
export function validateClientMsg(m: unknown): ClientMsg | null {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Obj;
  const req = optReq(o);
  if (!req) return null;
  switch (o.t) {
    case "move": {
      const seq = optSeq(o);
      if (!seq || !isDir(o.dx) || !isDir(o.dy) || (o.dash !== undefined && typeof o.dash !== "boolean")) return null;
      // Only a held direction can dash; the server still decides whether it may (worn out, visiting).
      const dash = o.dash === true && (o.dx !== 0 || o.dy !== 0);
      return { t: "move", dx: o.dx, dy: o.dy, ...seq, ...(dash ? { dash: true } : {}) };
    }
    case "moveTo": {
      const seq = optSeq(o);
      return seq && isFiniteCoord(o.x) && isFiniteCoord(o.y) ? { t: "moveTo", x: o.x, y: o.y, ...seq } : null;
    }
    case "chat": {
      const text = cleanChat(o.text);
      return text ? { t: "chat", text } : null;
    }
    case "npcSay": {
      const text = cleanChat(o.text);
      return text && isId(o.npc) ? { t: "npcSay", npc: o.npc, text } : null;
    }
    case "use":
      return isSlot(o.slot) && isCoord(o.x) && isCoord(o.y) ? { t: "use", slot: o.slot, x: o.x, y: o.y, ...req } : null;
    case "interact":
      return isId(o.target) ? { t: "interact", target: o.target } : null;
    case "place":
      return isSlot(o.slot) && isCoord(o.x) && isCoord(o.y) && isRot(o.rotation)
        ? { t: "place", slot: o.slot, x: o.x, y: o.y, rotation: o.rotation, ...req }
        : null;
    case "moveObject":
      return isId(o.id) && isCoord(o.x) && isCoord(o.y) && isRot(o.rotation)
        ? { t: "moveObject", id: o.id, x: o.x, y: o.y, rotation: o.rotation, ...req }
        : null;
    case "pickup":
      return isId(o.id) ? { t: "pickup", id: o.id, ...req } : null;
    case "moveObjects": {
      const moves = arrangeMoves(o.moves);
      return moves ? { t: "moveObjects", moves, ...req } : null;
    }
    case "pickupObjects": {
      const ids = idList(o.ids);
      return ids ? { t: "pickupObjects", ids, ...req } : null;
    }
    case "buy":
      return isId(o.npc) && isId(o.item) && isQty(o.qty) ? { t: "buy", npc: o.npc, item: o.item, qty: o.qty, ...req } : null;
    case "sell":
      return isId(o.npc) && isSlot(o.slot) && isQty(o.qty) ? { t: "sell", npc: o.npc, slot: o.slot, qty: o.qty, ...req } : null;
    case "giftNpc":
      return isId(o.npc) && isSlot(o.slot) ? { t: "giftNpc", npc: o.npc, slot: o.slot, ...req } : null;
    case "donate":
      return isId(o.goal) && isSlot(o.slot) && isQty(o.qty)
        ? { t: "donate", goal: o.goal, slot: o.slot, qty: o.qty, ...req }
        : null;
    case "moveSlot":
      if (!isSlot(o.from) || !isSlot(o.to) || o.from === o.to) return null;
      if (o.qty !== undefined && !isQty(o.qty)) return null;
      return { t: "moveSlot", from: o.from, to: o.to, ...(o.qty !== undefined ? { qty: o.qty as number } : {}), ...req };
    case "sortBag":
      return { t: "sortBag", ...req };
    case "dropItem":
      if (!isSlot(o.slot) || (o.qty !== undefined && !isQty(o.qty))) return null;
      return { t: "dropItem", slot: o.slot, ...(o.qty !== undefined ? { qty: o.qty as number } : {}), ...req };
    case "setLook": {
      const look = validateLook(o.look);
      return look ? { t: "setLook", look } : null;
    }
    case "hold":
      return o.slot === null || isInt(o.slot, 0, HOTBAR_SIZE - 1) ? { t: "hold", slot: o.slot as number | null } : null;
    case "ping":
      return typeof o.at === "number" && Number.isFinite(o.at) ? { t: "ping", at: o.at } : null;
    case "emote":
      return isEmote(o.code) ? { t: "emote", code: o.code } : null;
    case "pose":
      return isPose(o.pose) ? { t: "pose", pose: o.pose } : null;
    case "travel":
      return isTravelZone(o.to) ? { t: "travel", to: o.to } : null;
    case "petAnimal":
      return isId(o.animal) ? { t: "petAnimal", animal: o.animal } : null;
    case "feedAnimal":
      return isId(o.animal) && isSlot(o.slot) ? { t: "feedAnimal", animal: o.animal, slot: o.slot, ...req } : null;
    case "adoptAnimal":
      return isId(o.animal) ? { t: "adoptAnimal", animal: o.animal, ...req } : null;
    case "noticePost": {
      const text = cleanNoticeText(o.text);
      return text ? { t: "noticePost", text, ...req } : null;
    }
    case "noticeVote":
      return isNoticeId(o.id) && isNoticePress(o.press) ? { t: "noticeVote", id: o.id, press: o.press } : null;
    case "noticeDelete":
      return isNoticeId(o.id) ? { t: "noticeDelete", id: o.id } : null;
    default:
      return validateHomeClientMsg(o);
  }
}

/**
 * Safe lookup in a record keyed by a client-supplied string: only own keys count, so
 * "constructor" / "__proto__" never resolve to Object.prototype members.
 */
export function ownGet<T>(rec: Record<string, T>, key: unknown): T | undefined {
  return typeof key === "string" && Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** Valid spawn name for `spawns`, else "default". Use for any spawn name that came from a client. */
export function safeSpawnName(spawns: Record<string, unknown>, name: unknown): string {
  return typeof name === "string" && /^[a-z0-9_]{1,32}$/.test(name) && Object.hasOwn(spawns, name) ? name : "default";
}
