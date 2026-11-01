// Combat and monster sounds derived from entity snapshots (the protocol has no explicit combat
// events). Pure apart from the injected `play`, so it is unit-tested in test/fe-combat-sfx.test.ts.
import { monsterSfxKey } from "../audio/audio-logic";
import type { EntityState, Vec2 } from "../../shared/types";

/** A monster this close that starts moving toward you counts as noticing you. */
export const AGGRO_RANGE = 5;
/** Monsters within this range make occasional idle noises. */
export const IDLE_RANGE = 8;
/** Per-monster quiet time after an aggro sound. */
export const AGGRO_COOLDOWN_MS = 8_000;
/** Per-monster gap between idle noises; the actual gap is randomised up to 2x this. */
export const IDLE_GAP_MS = 6_000;
/** A monster that vanishes this soon after a hit died (rather than leaving view). */
export const DEATH_WINDOW_MS = 2_000;
/** Distance from the swing target within which a monster counts as "something to hit". */
export const SWING_REACH = 1.2;

interface MonsterTrack {
  kind: string;
  hp?: number;
  dist: number;
  approaching: boolean;
  lastHitAt: number;
  aggroAt: number;
  idleAt: number;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export interface CombatSfx {
  /** Entity updates from a tick; `youId` is the local player. */
  onTick(upd: readonly EntityState[], del: readonly string[], youId: string | null, now: number): void;
  /** Every frame: aggro and idle noises from the monsters around you. */
  frame(monsters: readonly EntityState[], you: Vec2 | null, now: number): void;
  /** The local player swung a sword at `target`; plays a miss if nothing is there. */
  swing(target: Vec2, monsters: readonly EntityState[]): void;
  reset(): void;
}

export function createCombatSfx(play: (key: string) => void, rand: () => number = Math.random): CombatSfx {
  const monsters = new Map<string, MonsterTrack>();
  let youHp: number | undefined;
  let youPos: Vec2 | null = null;

  const track = (e: EntityState, now: number): MonsterTrack => {
    let t = monsters.get(e.id);
    if (!t) {
      t = { kind: e.sprite, dist: Infinity, approaching: false, lastHitAt: -Infinity, aggroAt: -Infinity, idleAt: now + rand() * IDLE_GAP_MS };
      monsters.set(e.id, t);
    }
    return t;
  };

  const nearestKind = (): string | null => {
    let best: MonsterTrack | null = null;
    for (const t of monsters.values()) if (!best || t.dist < best.dist) best = t;
    return best && best.dist <= AGGRO_RANGE ? best.kind : null;
  };

  return {
    onTick(upd, del, youId, now) {
      for (const e of upd) {
        if (e.id === youId) {
          if (e.hp !== undefined && youHp !== undefined && e.hp < youHp) {
            if (e.hp <= 0) play("player_faint");
            else play("player_hurt");
            const kind = nearestKind();
            if (kind) play(monsterSfxKey(kind, "attack"));
          }
          if (e.hp !== undefined) youHp = e.hp;
          youPos = { x: e.x, y: e.y };
          continue;
        }
        if (e.kind !== "monster") continue;
        const t = track(e, now);
        if (e.hp !== undefined && t.hp !== undefined && e.hp < t.hp) {
          t.lastHitAt = now;
          if (e.hp <= 0) {
            play(monsterSfxKey(t.kind, "die"));
            t.lastHitAt = -Infinity; // already announced; don't repeat on removal
          } else {
            play("sword_hit");
            play(monsterSfxKey(t.kind, "hurt"));
          }
        }
        if (e.hp !== undefined) t.hp = e.hp;
      }
      for (const id of del) {
        const t = monsters.get(id);
        if (!t) continue;
        monsters.delete(id);
        if (now - t.lastHitAt < DEATH_WINDOW_MS) play(monsterSfxKey(t.kind, "die"));
      }
    },

    frame(list, you, now) {
      if (you) youPos = you;
      if (!youPos) return;
      const p = youPos;
      for (const e of list) {
        if (e.kind !== "monster") continue;
        const t = track(e, now);
        if (t.hp === undefined && e.hp !== undefined) t.hp = e.hp;
        const d = dist(e, p);
        const approaching = !!e.moving && d < t.dist - 1e-3;
        if (approaching && !t.approaching && d <= AGGRO_RANGE && now - t.aggroAt >= AGGRO_COOLDOWN_MS) {
          t.aggroAt = now;
          t.idleAt = now + IDLE_GAP_MS; // don't stack an idle noise on top
          play(monsterSfxKey(t.kind, "aggro"));
        } else if (d <= IDLE_RANGE && now >= t.idleAt) {
          // Nearer monsters chatter more often (the player API has no per-sound volume).
          t.idleAt = now + IDLE_GAP_MS * (1 + rand()) * (0.5 + d / IDLE_RANGE);
          play(monsterSfxKey(t.kind, "idle"));
        }
        t.approaching = approaching;
        t.dist = d;
      }
    },

    swing(target, list) {
      const center = { x: Math.floor(target.x) + 0.5, y: Math.floor(target.y) + 0.5 };
      const hit = list.some((e) => e.kind === "monster" && (e.hp ?? 1) > 0 && dist(e, center) <= SWING_REACH);
      play(hit ? "tool_sword" : "sword_miss");
    },

    reset() {
      monsters.clear();
      youHp = undefined;
      youPos = null;
    },
  };
}
