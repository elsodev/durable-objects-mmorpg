// What a villager snaps when they catch you peeing in public. Fixed lines: no LLM here, it has to
// be instant and it must never be talked round.
const LINES = [
  "Ew! Not here!",
  "Have you no shame?",
  "That's disgusting! Don't talk to me.",
  "In the middle of the village?! Unbelievable.",
  "I'm telling the mayor about this.",
  "Right in front of me? We're done.",
] as const;

// `nth` is the witness's place in the crowd, so two villagers catching you at once say different things.
export function scoldLine(rand: () => number, nth = 0): string {
  const start = Math.min(LINES.length - 1, Math.floor(rand() * LINES.length));
  return LINES[(start + nth) % LINES.length]!;
}
