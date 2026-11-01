// Pure view model for the global stats panel (#hud-stats). Shown in shared zones only.
import type { SocialStats } from "../../shared/social";
import { isInteriorZone, type ZoneId } from "../../shared/types";

export interface StatRow {
  key: "online" | "zone" | "today";
  label: string;
  value: string;
}

const OUTDOOR_LABEL: Record<string, string> = { village: "village", riverside: "riverside", caves: "caves", home: "home" };

/** "in the village", "in the inn", "in Pip's house". */
function zonePhrase(zone: ZoneId): string {
  if (!isInteriorZone(zone)) return `in the ${OUTDOOR_LABEL[zone] ?? zone}`;
  if (zone.startsWith("int_house_")) {
    const owner = zone.slice("int_house_".length);
    return `in ${owner.charAt(0).toUpperCase()}${owner.slice(1)}'s house`;
  }
  return `in the ${zone.slice("int_".length).replace("townhall", "town hall")}`;
}

export function statsVisible(zone: ZoneId | null, stats: SocialStats | null): boolean {
  return !!stats && zone !== null && zone !== "home";
}

function fmt(n: number | undefined): string {
  return Math.max(0, Math.floor(n ?? 0)).toLocaleString("en-US");
}

/** Online world-wide, players in this zone, and today's crops shipped (harvested as fallback). */
export function statRows(stats: SocialStats, zone: ZoneId): StatRow[] {
  const shipped = stats.today.crops_shipped ?? 0;
  const today =
    shipped > 0 || !stats.today.crops_harvested
      ? { label: "crops shipped today", value: fmt(shipped) }
      : { label: "crops harvested today", value: fmt(stats.today.crops_harvested) };
  return [
    { key: "online", label: "online", value: fmt(stats.online) },
    { key: "zone", label: zonePhrase(zone), value: fmt(stats.zones[zone]) },
    { key: "today", ...today },
  ];
}
