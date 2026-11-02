// Client world store: applies server messages and serves interpolated remote entities.
import type { ChatEntry, CreateStore, StoreEvent, WorldStore } from "../contracts";
import type { ServerMsg } from "../../shared/protocol";
import type { EntityState, FarmTile, Inventory, PlacedObject } from "../../shared/types";
import { getMap } from "../../shared/maps";
import { applyYard } from "../../shared/yard";
import { HISTORY_MS, INTERP_DELAY_MS, sampleBuffer, type Snapshot } from "./interp";

export const MAX_CHAT = 100;

const tileKey = (t: { x: number; y: number }) => `${t.x},${t.y}`;
const emptyInventory = (): Inventory => ({ coins: 0, slots: [] });

/**
 * Events: "you" -> { state: EntityState; ack?: number }, "removed" -> entity id,
 * "objects" -> objects msg (or full list on welcome), "rocks" -> rock msg (or the set on welcome).
 * sample(now) applies INTERP_DELAY_MS itself: pass the current recv-clock time.
 */
export const createStore: CreateStore = () => {
  const buffers = new Map<string, Snapshot[]>();
  const listeners = new Map<StoreEvent, Set<(payload?: unknown) => void>>();
  const chatLog: ChatEntry[] = [];

  const emit = (ev: StoreEvent, payload?: unknown) => {
    const set = listeners.get(ev);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`store listener for "${ev}" failed`, err);
      }
    }
  };

  const push = (s: EntityState, at: number) => {
    let buf = buffers.get(s.id);
    if (!buf) buffers.set(s.id, (buf = []));
    // Out-of-order or same-time receipt: keep the buffer monotonic, newest state wins.
    const last = buf[buf.length - 1];
    if (last && at <= last.at) last.s = s;
    else buf.push({ at, s });
    // Keep ~1 s, but never drop below two snapshots so we can still interpolate/extrapolate.
    const cutoff = at - HISTORY_MS;
    let drop = 0;
    while (buf.length - drop > 2 && buf[drop]!.at < cutoff) drop++;
    if (drop) buf.splice(0, drop);
  };

  const store: WorldStore & { chat: ChatEntry[] } = {
    zone: null,
    map: null,
    youId: null,
    inventory: emptyInventory(),
    farm: new Map<string, FarmTile>(),
    objects: new Map<string, PlacedObject>(),
    brokenRocks: new Set<string>(),
    rockOres: new Map(),
    trees: new Map<string, "stump" | "gone">(),
    goals: [],
    chat: chatLog,

    apply(msg: ServerMsg, recvTime: number) {
      switch (msg.t) {
        case "welcome": {
          store.reset();
          store.zone = msg.zone;
          // A home yard is drawn as its owner laid it out (the house may have moved).
          store.map = msg.yard ? applyYard(getMap(msg.homeMap ?? msg.zone), msg.yard) : getMap(msg.homeMap ?? msg.zone);
          store.youId = msg.you;
          store.inventory = msg.inventory;
          for (const e of msg.entities) push(e, recvTime);
          for (const f of msg.farm ?? []) store.farm.set(tileKey(f), f);
          for (const o of msg.objects ?? []) store.objects.set(o.id, o);
          for (const r of msg.brokenRocks ?? []) store.brokenRocks.add(r);
          for (const [id, ore] of Object.entries(msg.rockOres ?? {})) store.rockOres.set(id, ore);
          for (const t of msg.trees ?? []) store.trees.set(t.id, t.stage);
          store.goals = msg.goals ?? [];
          emit("zone", msg.zone);
          emit("inventory", store.inventory);
          emit("farm", [...store.farm.values()]);
          emit("objects", [...store.objects.values()]);
          emit("rocks", store.brokenRocks);
          emit("goals", store.goals);
          const you = store.latest(msg.you);
          if (you) emit("you", { state: you, ack: undefined });
          break;
        }
        case "tick": {
          for (const e of msg.upd) {
            push(e, recvTime);
            if (e.id === store.youId) emit("you", { state: e, ack: msg.ack });
          }
          for (const id of msg.del) {
            if (buffers.delete(id)) emit("removed", id);
          }
          // A tick with only an ack still matters to prediction.
          if (msg.ack !== undefined && store.youId && !msg.upd.some((e) => e.id === store.youId)) {
            const you = store.latest(store.youId);
            if (you) emit("you", { state: you, ack: msg.ack });
          }
          break;
        }
        case "inventory":
          store.inventory = msg.inventory;
          emit("inventory", msg.inventory);
          break;
        case "farm":
          for (const f of msg.tiles) store.farm.set(tileKey(f), f);
          emit("farm", msg.tiles);
          break;
        case "objects":
          for (const o of msg.upd) store.objects.set(o.id, o);
          for (const id of msg.del) store.objects.delete(id);
          emit("objects", msg);
          break;
        case "rock":
          if (msg.broken) store.brokenRocks.add(msg.id);
          else store.brokenRocks.delete(msg.id);
          if (msg.ore) {
            // Only differences from the map are kept, like the welcome's rockOres.
            const base = store.map?.rocks?.find((r) => r.id === msg.id)?.ore;
            if (msg.ore === base) store.rockOres.delete(msg.id);
            else store.rockOres.set(msg.id, msg.ore);
          }
          emit("rocks", msg);
          break;
        case "tree":
          if (msg.stage === "tree") store.trees.delete(msg.id);
          else store.trees.set(msg.id, msg.stage);
          break;
        case "goals":
          store.goals = msg.goals;
          emit("goals", msg.goals);
          break;
        case "chat": {
          const entry: ChatEntry = { from: msg.from, name: msg.name, text: msg.text, at: msg.at };
          chatLog.push(entry);
          if (chatLog.length > MAX_CHAT) chatLog.splice(0, chatLog.length - MAX_CHAT);
          emit("chat", entry);
          break;
        }
        default:
          break;
      }
    },

    latest(id) {
      const buf = buffers.get(id);
      return buf && buf.length ? buf[buf.length - 1]!.s : undefined;
    },

    sample(renderTime) {
      const at = renderTime - INTERP_DELAY_MS;
      const out: EntityState[] = [];
      for (const [id, buf] of buffers) {
        if (id === store.youId || !buf.length) continue;
        out.push(sampleBuffer(buf, at));
      }
      return out;
    },

    on(ev, cb) {
      let set = listeners.get(ev);
      if (!set) listeners.set(ev, (set = new Set()));
      set.add(cb);
      return () => {
        set!.delete(cb);
      };
    },

    reset() {
      buffers.clear();
      store.zone = null;
      store.map = null;
      store.youId = null;
      store.inventory = emptyInventory();
      store.farm.clear();
      store.objects.clear();
      store.brokenRocks.clear();
      store.rockOres.clear();
      store.trees.clear();
      store.goals = [];
      chatLog.length = 0;
    },
  };
  return store;
};
