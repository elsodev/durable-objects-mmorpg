// Client world store: applies server messages and serves interpolated remote entities.
import type { ChatEntry, CreateStore, StoreEvent, WorldStore } from "../contracts";
import type { ServerMsg } from "../../shared/protocol";
import type { EntityState, FarmTile, Inventory, PlacedObject } from "../../shared/types";
import { getMap } from "../../shared/maps";
import { applyYard } from "../../shared/yard";
import { TICK_MS } from "../../shared/types";
import { HISTORY_MS, SNAP_DIST, sampleBuffer, type Snapshot } from "./interp";
import { createPlayback } from "./playback";

export const MAX_CHAT = 100;

const tileKey = (t: { x: number; y: number }) => `${t.x},${t.y}`;
const emptyInventory = (): Inventory => ({ coins: 0, slots: [] });

/**
 * How fast an entity's own extra delay may change, as a share of real time: it slows to half
 * speed when its snapshots stop coming (instead of halting and then jumping), and catches up at
 * 1.25x once they come often again.
 */
const LAG_GROW = 0.5;
const LAG_SHRINK = 0.25;
/** Weight of the newest gap in an entity's average gap between moving snapshots. */
const GAP_WEIGHT = 0.3;
/**
 * Another player's server path can jump when their turn reached the server late (it walked on
 * the old way, then settled back: see Motion.settle). Drawn players move at most this fast
 * (tiles/s, about twice a dash), so such a jump becomes a quick slide; teleports (over
 * SNAP_DIST) still jump.
 */
const CATCH_UP_SPEED = 14;
/** Gaps longer than this are pauses, not a send rate (the far batch is 500 ms). */
const MAX_GAP_MS = 600;

/**
 * Snapshots of one entity, stamped with server time. `gap`: average ms between its snapshots
 * while it moves (100 near you; 500 for far ones the server batches to 2 Hz). `lag`: how much
 * further behind than everyone else it is drawn, so a batched entity is blended between two
 * snapshots instead of stopping and jumping at each one.
 */
interface Track {
  snaps: Snapshot[];
  gap: number;
  lag: number;
  /** Players: where it was last drawn (local time `at`), see CATCH_UP_SPEED. */
  drawn?: { x: number; y: number; at: number };
}

/**
 * Events: "you" -> { state: EntityState; ack?: number }, "removed" -> entity id,
 * "objects" -> objects msg (or full list on welcome), "rocks" -> rock msg (or the set on welcome).
 * sample(now) picks the drawing time itself (state/playback.ts): pass the current recv-clock time,
 * the same clock apply() gets.
 */
export const createStore: CreateStore = () => {
  const buffers = new Map<string, Track>();
  const playback = createPlayback();
  let sampledAt: number | null = null;
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
    let track = buffers.get(s.id);
    if (!track) buffers.set(s.id, (track = { snaps: [], gap: TICK_MS, lag: 0 }));
    const buf = track.snaps;
    // Out-of-order or same-time receipt: keep the buffer monotonic, newest state wins.
    const last = buf[buf.length - 1];
    if (last && at <= last.at) last.s = s;
    else {
      if (last && !last.s.moving && at - last.at > TICK_MS * 1.5) {
        // Ticks only carry changes, so silence meant it stood still until the tick before this
        // one. Without this the first step would be smeared over the whole time it stood.
        buf.push({ at: at - TICK_MS, s: last.s });
      } else if (last && last.s.moving && s.moving) {
        track.gap += (Math.min(at - last.at, MAX_GAP_MS) - track.gap) * GAP_WEIGHT;
      }
      buf.push({ at, s });
    }
    // Keep ~1 s, but never drop below two snapshots so we can still interpolate/extrapolate.
    const cutoff = at - HISTORY_MS;
    let drop = 0;
    while (buf.length - drop > 2 && buf[drop]!.at < cutoff) drop++;
    if (drop) buf.splice(0, drop);
  };

  /** Moves a drawn player toward `s` at no more than CATCH_UP_SPEED (see there). */
  const catchUp = (track: Track, s: EntityState, now: number): EntityState => {
    if (s.kind !== "player") return s;
    const d = track.drawn;
    const dx = d ? s.x - d.x : 0;
    const dy = d ? s.y - d.y : 0;
    const len = Math.hypot(dx, dy);
    const max = d ? (CATCH_UP_SPEED * Math.max(0, now - d.at)) / 1000 : 0;
    if (!d || len <= max || len > SNAP_DIST) {
      track.drawn = { x: s.x, y: s.y, at: now };
      return s;
    }
    track.drawn = { x: d.x + (dx / len) * max, y: d.y + (dy / len) * max, at: Math.max(d.at, now) };
    return { ...s, x: track.drawn.x, y: track.drawn.y };
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
          playback.observe(msg.serverTime, recvTime);
          for (const e of msg.entities) push(e, msg.serverTime);
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
          playback.observe(msg.at, recvTime);
          for (const e of msg.upd) {
            push(e, msg.at);
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
      const buf = buffers.get(id)?.snaps;
      return buf && buf.length ? buf[buf.length - 1]!.s : undefined;
    },

    sample(renderTime) {
      const at = playback.time(renderTime);
      const dt = sampledAt === null ? 0 : Math.max(0, renderTime - sampledAt);
      sampledAt = Math.max(sampledAt ?? renderTime, renderTime);
      const out: EntityState[] = [];
      for (const [id, track] of buffers) {
        if (id === store.youId || !track.snaps.length) continue;
        // Drawn past its newest snapshot while it was walking: the next one is late, so fall back.
        const newest = track.snaps[track.snaps.length - 1]!;
        const starved = newest.s.moving ? Math.max(0, at - track.lag - newest.at) : 0;
        const want = Math.min(MAX_GAP_MS, Math.max(track.gap - TICK_MS, starved > 0 ? track.lag + starved : 0));
        track.lag += Math.max(-LAG_SHRINK * dt, Math.min(LAG_GROW * dt, want - track.lag));
        out.push(catchUp(track, sampleBuffer(track.snaps, at - track.lag), renderTime));
      }
      return out;
    },

    renderDelay() {
      return playback.delay();
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
      playback.reset();
      sampledAt = null;
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
