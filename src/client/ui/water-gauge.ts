// The watering can's water level, drawn as a small bar along the bottom of its slot (hotbar and
// inventory) instead of a line of text in the status panel.
import type { ItemId } from "../../shared/types";
import { gaugeFill, type WaterLevel } from "./water-gauge-logic";

export { gaugeLabel, holdsWater, type WaterLevel } from "./water-gauge-logic";

/** The bar element for a slot, or null when the slot shows none. */
export function waterGauge(item: ItemId, level: WaterLevel | null): HTMLElement | null {
  const fill = gaugeFill(item, level);
  if (fill === null || !level) return null;
  const bar = document.createElement("span");
  bar.className = `slot-water${fill <= 0 ? " is-empty" : ""}`;
  bar.setAttribute("aria-hidden", "true");
  const inner = document.createElement("span");
  inner.className = "slot-water-fill";
  inner.style.width = `${Math.round(fill * 100)}%`;
  bar.appendChild(inner);
  return bar;
}
