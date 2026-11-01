// Player health: damage, fainting and slow out-of-combat regeneration.
import type { EntityState } from "../../shared/types";

export const REGEN_DELAY_MS = 5000;
export const REGEN_EVERY_MS = 2000;
export const REGEN_AMOUNT = 2;

/** Applies damage; returns true if the player fainted (hp would reach 0). hp is then refilled. */
export function applyDamage(e: EntityState, damage: number): boolean {
  const max = e.maxHp ?? 100;
  const hp = (e.hp ?? max) - Math.max(0, damage);
  if (hp <= 0) {
    e.hp = max;
    return true;
  }
  e.hp = hp;
  return false;
}

/** Heals a little if the player hasn't been hurt recently. Returns true if hp changed. */
export function regen(e: EntityState, now: number, lastHurt: number, lastRegen: number): boolean {
  const max = e.maxHp ?? 100;
  if ((e.hp ?? max) >= max || now - lastHurt < REGEN_DELAY_MS || now - lastRegen < REGEN_EVERY_MS) return false;
  e.hp = Math.min(max, (e.hp ?? max) + REGEN_AMOUNT);
  return true;
}
