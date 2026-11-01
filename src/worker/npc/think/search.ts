// FTS5 query for searching one pair's transcript with the player's words.

/** Quoted terms OR'ed together, so punctuation or FTS operators in player text can't break the query. */
export function searchQuery(text: string): string | null {
  const words = [...new Set(text.toLowerCase().match(/\p{L}{4,}/gu) ?? [])].slice(0, 5);
  return words.length ? words.map((w) => `"${w}"`).join(" OR ") : null;
}
