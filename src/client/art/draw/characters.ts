// Full frame sets for any character key: humanoids (players, NPCs, unknown keys) and monsters.
import type { Facing } from "../../../shared/types";
import type { PixelGrid } from "./grid";
import { drawHumanoid, FEET_Y, FRAME, WALK_PHASES } from "./humanoid";
import { lookFor } from "./looks";
import { drawMonster, type MonsterKind } from "./monsters";

export const FACINGS: Facing[] = ["down", "left", "right", "up"];
export const WALK_FRAMES = 4;
export const ATTACK_FRAMES = 3;

export interface CharacterFrames {
  walk: Record<Facing, PixelGrid[]>;
  idle: Record<Facing, PixelGrid>;
  attack?: Record<Facing, PixelGrid[]>;
  /** Feet point in frame pixels. */
  feet: { x: number; y: number };
  size: number;
}

const MONSTERS = new Set<string>(["slime", "bat", "rock_crab"]);

export function monsterKind(key: string): MonsterKind | null {
  if (MONSTERS.has(key)) return key as MonsterKind;
  // Tolerate variants like "slime_blue" that the server may add later.
  for (const m of MONSTERS) if (key.startsWith(`${m}_`)) return m as MonsterKind;
  return null;
}

export function drawCharacter(key: string): CharacterFrames {
  const walk = {} as Record<Facing, PixelGrid[]>;
  const idle = {} as Record<Facing, PixelGrid>;
  const m = monsterKind(key);
  if (m) {
    for (const f of FACINGS) {
      walk[f] = Array.from({ length: WALK_FRAMES }, (_, i) => drawMonster(m, f, i));
      // Monsters keep breathing/flapping when idle; frame 0 is the rest pose.
      idle[f] = drawMonster(m, f, m === "bat" ? 1 : 0);
    }
    return { walk, idle, feet: { x: FRAME / 2, y: FEET_Y }, size: FRAME };
  }
  const look = lookFor(key);
  const attack = {} as Record<Facing, PixelGrid[]>;
  for (const f of FACINGS) {
    walk[f] = WALK_PHASES.map((phase) => drawHumanoid(look, { facing: f, phase, bob: phase === 0 ? -1 : 0 }));
    idle[f] = drawHumanoid(look, { facing: f, phase: 0, bob: 0 });
    attack[f] = Array.from({ length: ATTACK_FRAMES }, (_, i) =>
      drawHumanoid(look, { facing: f, phase: 0, bob: 0, attack: i }),
    );
  }
  return { walk, idle, attack, feet: { x: FRAME / 2, y: FEET_Y }, size: FRAME };
}
