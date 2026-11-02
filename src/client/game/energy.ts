// Your energy as the client sees it: whether you are worn out, so prediction moves at the server's
// speed (shared/engine/pace.ts), Shift explains why it doesn't run, and farm swings that the server
// would refuse are stopped before they start.
import type { Predictor } from "../contracts";
import { farmLocked, FARM_LOCKED_NOTICE, NO_DASH_NOTICE } from "../../shared/engine";
import type { ToolOutcome } from "../../shared/engine/toolRules";

/** The "too worn out to dash" notice at most this often while Shift is tapped. */
export const NO_DASH_NOTICE_MS = 5000;

export interface EnergyDeps {
  predictor: Pick<Predictor, "setLimits">;
  notice(text: string, kind: "info" | "error"): void;
}

export interface Energy {
  readonly exhausted: boolean;
  /** Your stamina report from the zone (`stamina`) or your home (`homeState`). */
  setExhausted(exhausted: boolean): void;
  /** Visitors walk: their own stamina isn't loaded in someone else's home. */
  setVisiting(visiting: boolean): void;
  /** Shift went down with a direction; a worn-out player is told why nothing happens. */
  dashPressed(now: number): void;
  /** True (and a notice) when a worn-out swing would be farm work at home. */
  blocksUse(outcome: ToolOutcome | null, atHome: boolean): boolean;
}

export function createEnergy(deps: EnergyDeps): Energy {
  let exhausted = false;
  let visiting = false;
  let lastNoDash = -Infinity;
  const apply = () => deps.predictor.setLimits?.({ tired: exhausted && !visiting, canDash: !visiting });
  return {
    get exhausted() {
      return exhausted && !visiting;
    },
    setExhausted(on) {
      exhausted = on;
      apply();
    },
    setVisiting(on) {
      visiting = on;
      apply();
    },
    dashPressed(now) {
      if (!exhausted || visiting || now - lastNoDash < NO_DASH_NOTICE_MS) return;
      lastNoDash = now;
      deps.notice(NO_DASH_NOTICE, "info");
    },
    blocksUse(outcome, atHome) {
      if (!atHome || visiting || !outcome?.ok || !farmLocked(exhausted, outcome.effect)) return false;
      deps.notice(FARM_LOCKED_NOTICE, "error");
      return true;
    },
  };
}
