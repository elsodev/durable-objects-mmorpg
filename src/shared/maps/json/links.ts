// Cross-map checks for a set of built maps: every exit lands on a spawn that exists, and every
// shared way back up has a spawn to return to in each map it serves. Run by the tests over all
// maps (a single file can't know its neighbours).
import type { MapData, MapId } from "../../types";

/** Problems found, as readable lines; empty when every link holds. */
export function checkMapLinks(maps: readonly MapData[], lookup: (id: MapId) => MapData | undefined): string[] {
  const out: string[] = [];
  for (const m of maps) {
    for (const e of m.exits) {
      const dest = lookup(e.map ?? e.to);
      if (!dest) out.push(`${m.zone}: exit to unknown map ${e.to}`);
      else if (!Object.hasOwn(dest.spawns, e.spawn)) out.push(`${m.zone}: exit to ${e.to} lands on missing spawn ${e.spawn}`);
      for (const z of e.back ?? []) {
        const up = lookup(z);
        if (!up) out.push(`${m.zone}: way back to unknown map ${z}`);
        else if (!Object.hasOwn(up.spawns, `from_${m.zone}`)) out.push(`${m.zone}: way back to ${z} needs spawn from_${m.zone} there`);
        if (!Object.hasOwn(m.spawns, `from_${z}`)) out.push(`${m.zone}: needs spawn from_${z} (arrivals from ${z})`);
      }
    }
  }
  return out;
}
