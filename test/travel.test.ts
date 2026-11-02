import { describe, expect, it } from "vitest";
import { isTravelZone, TRAVEL_MIN_INTERVAL_MS, travelBlock } from "../src/shared/travel";
import { validateClientMsg } from "../src/shared/validate";
import { mapRows } from "../src/client/ui/map-pane-logic";

describe("fast travel rules", () => {
  it("accepts only the island's places", () => {
    for (const r of mapRows(null)) expect(isTravelZone(r.id), r.id).toBe(true);
    expect(validateClientMsg({ t: "travel", to: "caves" })).toEqual({ t: "travel", to: "caves" });
    expect(validateClientMsg({ t: "travel", to: "int_inn" })).toBeNull();
    expect(validateClientMsg({ t: "travel", to: "home_in" })).toBeNull();
  });

  it("won't travel to where you are, or twice in a burst", () => {
    expect(travelBlock("village", "village", 10_000, 0)).toMatch(/already/);
    expect(travelBlock("village", "int_inn", 10_000, 0)).toBeNull();
    expect(travelBlock("caves", "village", 1000, 0)).toMatch(/moment/);
    expect(travelBlock("caves", "village", TRAVEL_MIN_INTERVAL_MS, 0)).toBeNull();
  });
});
