// Pure parts of the loading screen: which steps there are, how far along we are, and what to say.

export type LoadStep = "renderer" | "art" | "audio" | "world";

export const LOAD_STEPS: readonly { id: LoadStep; label: string }[] = [
  { id: "renderer", label: "Lighting the lanterns…" },
  { id: "art", label: "Unpacking the seed packets…" },
  { id: "audio", label: "Tuning the fiddles…" },
  { id: "world", label: "Walking into Mossbrook…" },
];

/** Fraction of steps done, 0..1. Steps can finish in any order (art and audio load together). */
export function loadProgress(done: ReadonlySet<LoadStep>): number {
  const n = LOAD_STEPS.filter((s) => done.has(s.id)).length;
  return n / LOAD_STEPS.length;
}

/** Text for the first step still running, or a last word once everything is in. */
export function loadLabel(done: ReadonlySet<LoadStep>): string {
  return LOAD_STEPS.find((s) => !done.has(s.id))?.label ?? "Here we go!";
}

/** Text while switching zones; `name` is the map's display name when known. */
export function zoneLoadLabel(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `Heading to ${n}…` : "On the way…";
}

/** Stages of a zone change, in order. The bar shows how far along the trip is. */
export type ZoneStage = "leaving" | "connected" | "arrived" | "shown";

const ZONE_PROGRESS: Record<ZoneStage, number> = { leaving: 0.15, connected: 0.5, arrived: 0.85, shown: 1 };

/** Bar fraction for a zone-change stage. */
export function zoneProgress(stage: ZoneStage): number {
  return ZONE_PROGRESS[stage];
}

/** Shown when the server sends us to a map this build doesn't have: the page is older than the server. */
export const OUTDATED_LABEL = "Mossbrook has been updated. Refresh to keep playing.";
