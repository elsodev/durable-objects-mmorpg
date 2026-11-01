// Combat feedback from the server's hit / hurt / loot events: floating damage numbers, the hit
// flash and chips, the predicted knockback slide, the hurt blink and screen shake, the death
// squash and the loot popping out. Everything is cosmetic; the server already decided.
import type { Camera } from "../contracts";
import type { ServerMsg } from "../../shared/protocol";
import type { EntityState } from "../../shared/types";
import type { ChipKind } from "../render/hit-fx";
import { hitLabel, hurtShake } from "./combat-fx-logic";
import type { World } from "./world";

/** Monsters are shorter than people: their numbers start this much lower (tiles). */
const MONSTER_TEXT_DROP = 0.7;
const CHIPS: Record<string, ChipKind> = { slime: "slime", bat: "bat", rock_crab: "rock_crab" };

export interface CombatFxDeps {
  world(): World | null;
  youId(): string | null;
  camera: Camera;
  latest(id: string): EntityState | undefined;
}

export interface CombatFx {
  onHit(msg: Extract<ServerMsg, { t: "hit" }>): void;
  onHurt(msg: Extract<ServerMsg, { t: "hurt" }>): void;
  onLoot(msg: Extract<ServerMsg, { t: "loot" }>): void;
}

/** Tiles your own damage numbers start above the usual float height. */
const HURT_TEXT_LIFT = 0.8;

export function createCombatFx(d: CombatFxDeps): CombatFx {
  return {
    onHit(msg) {
      const w = d.world();
      if (!w) return;
      const e = d.latest(msg.id);
      const at = e ? { x: e.x, y: e.y } : msg.at;
      const label = hitLabel(msg);
      // floatText starts a character's height up; monsters are about half that.
      w.effects.floatText({ x: at.x, y: at.y + MONSTER_TEXT_DROP }, label.text, label.kind);
      if (msg.miss) return;
      w.entities.flash(msg.id);
      const chip = CHIPS[e?.sprite ?? ""] ?? "stone";
      // hitFx bursts from a tile's top-left; lift them to the body.
      const tile = { x: at.x - 0.5, y: at.y - 1 };
      if (msg.kill) {
        w.entities.die?.(msg.id);
        w.hitFx.chips(tile, chip, 8 + Math.floor(Math.random() * 4), 0.2);
        w.hitFx.chips(tile, chip, 5, 0.5);
        w.effects.burst(at, "hit");
        w.effects.burst(at, "dust");
        return;
      }
      w.hitFx.chips(tile, chip, 3 + Math.floor(Math.random() * 3), 0.3);
      if (msg.kb) w.entities.nudge?.(msg.id, msg.kb);
    },

    onHurt(msg) {
      const w = d.world();
      if (!w) return;
      w.entities.blink?.(msg.id, msg.ms);
      w.entities.flash(msg.id);
      if (msg.id !== d.youId()) return;
      const e = d.latest(msg.id);
      // Lifted clear of your name tag and health bar, which sit where floatText starts.
      if (e) w.effects.floatText({ x: e.x, y: e.y - HURT_TEXT_LIFT }, `-${msg.dmg}`, "hurt");
      const s = hurtShake(msg.dmg);
      d.camera.shake?.(s.ms, s.amp);
    },

    onLoot(msg) {
      const w = d.world();
      if (!w || msg.items.length === 0) return;
      w.hitFx.drops({ x: msg.at.x, y: msg.at.y + 0.2 }, msg.items);
    },
  };
}
