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
