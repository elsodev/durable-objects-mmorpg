// Level feedback from the server's xp / levelUp messages: the HUD level panel, the "+8 XP" float
// where the monster fell (or over you for a sale), and the level-up burst and chime over whoever
// levelled. Cosmetic only: the server already decided every number.
import type { ServerMsg } from "../../shared/protocol";
import type { EntityState, Vec2 } from "../../shared/types";
import type { Hud } from "../ui";
import { levelUpHeard, xpFloat } from "./level-fx-logic";
import type { World } from "./world";

export interface LevelFxDeps {
  world(): World | null;
  hud: Pick<Hud, "setLevel">;
  youId(): string | null;
  /** Your predicted entity (null before welcome). */
  you(): EntityState | null;
  /** Where someone else is drawn right now (interpolated), or undefined once they are gone. */
  drawnAt(id: string): Vec2 | undefined;
  playSfx(key: string): void;
  reducedMotion(): boolean;
  /** Runs `fn` after `ms` (the float waits for the kill's damage number to clear). */
  later(fn: () => void, ms: number): void;
}

export interface LevelFx {
  onXp(msg: Extract<ServerMsg, { t: "xp" }>): void;
  onLevelUp(msg: Extract<ServerMsg, { t: "levelUp" }>): void;
}

export function createLevelFx(d: LevelFxDeps): LevelFx {
  const posOf = (id: string): Vec2 | null => {
    if (id === d.youId()) {
      const me = d.you();
      return me ? { x: me.x, y: me.y } : null;
    }
    return d.drawnAt(id) ?? null;
  };
  return {
    onXp(msg) {
      d.hud.setLevel?.({ level: msg.level, xp: msg.xp, next: msg.next }, msg.gain);
      const me = d.you();
      const f = xpFloat(msg, me ? { x: me.x, y: me.y } : null);
      if (!f) return;
      d.later(() => d.world()?.effects.floatText(f.at, f.text, "xp"), f.delayMs);
    },
    onLevelUp(msg) {
      const w = d.world();
      if (!w) return;
      const at = posOf(msg.id);
      if (!at) return;
      w.effects.levelUp?.(() => posOf(msg.id), msg.level, d.reducedMotion());
      const me = d.you();
      if (levelUpHeard(msg.id === d.youId(), at, me)) d.playSfx("level_up");
    },
  };
}
