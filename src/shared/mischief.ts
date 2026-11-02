// Mischief: an animal (Happy the husky) that often bolts when you pet it, or grabs a meal and runs.
// Pure: the caller passes the server's rand, so tests can fix the roll.
import type { VillageAnimal } from "./animals";

/** Whether a pet ends in a getaway (no affection, nothing used up: chase it and try again). */
export function rollsAway(def: VillageAnimal, atHome: boolean, rand: () => number): boolean {
  const m = def.mischief;
  if (!m) return false;
  return rand() < (atHome ? m.homeRun : m.run);
}

/** Whether a meal is snatched and carried off (it still counts as the day's meal). */
export function rollsSnatch(def: VillageAnimal, atHome: boolean, rand: () => number): boolean {
  const m = def.mischief;
  if (!m) return false;
  return rand() < (atHome ? m.homeSnatch : m.snatch);
}

const BOLT_LINES = [
  "{name} bolts off with a cheeky yip!",
  "{name} wriggles free and zooms away!",
  "{name} dodges your hand and dashes off, tail high!",
  "{name} play-bows, then sprints away. Catch me!",
] as const;

/** The notice for a getaway; `roll` (0..1) picks the line. */
export function boltLine(name: string, roll: number): string {
  const i = Math.min(BOLT_LINES.length - 1, Math.max(0, Math.floor(roll * BOLT_LINES.length)));
  return BOLT_LINES[i]!.replace("{name}", name);
}
