// A player's energy as a room holds it: stamina, the worn-out flag and the dash time not yet
// charged. ZoneRoom keeps it on the player, HomeRoom in the save; both settle it the same way so
// running out of stamina means the same thing everywhere (see shared/engine/pace.ts).
import { drainDash } from "../../shared/engine";

export interface EnergyState {
  stamina: number;
  exhausted: boolean;
  /** Dash time under one stamina point, carried between ticks. */
  dashCarry: number;
}

/** none: nothing changed; changed: stamina moved; exhausted: it just ran out (show the notice). */
export type EnergyChange = "none" | "changed" | "exhausted";

/** Marks the player worn out once stamina reaches 0. Call after every stamina write. */
export function settleEnergy(e: EnergyState, changed: boolean): EnergyChange {
  if (e.stamina <= 0 && !e.exhausted) {
    e.exhausted = true;
    e.dashCarry = 0;
    return "exhausted";
  }
  return changed ? "changed" : "none";
}

/** Charges `dashedMs` of running against stamina. */
export function chargeDash(e: EnergyState, dashedMs: number): EnergyChange {
  if (dashedMs <= 0) return "none";
  const d = drainDash(e.stamina, e.dashCarry, dashedMs);
  e.stamina = d.stamina;
  e.dashCarry = d.carryMs;
  return settleEnergy(e, d.spent > 0);
}

/** Takes up to `cost` stamina (tools, wrong-tool hits). */
export function spendEnergy(e: EnergyState, cost: number): EnergyChange {
  const take = Math.min(Math.max(0, e.stamina), Math.max(0, cost));
  e.stamina -= take;
  return settleEnergy(e, take > 0);
}
