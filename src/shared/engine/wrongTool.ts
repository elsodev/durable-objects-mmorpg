// Wrong-tool hits: an axe on a rock or a pickaxe on a tree rebounds and costs energy. Each hit in
// a row costs a little more, so hammering away with the wrong tool wears you out fast, while one
// mistaken swing stays cheap. Pure: the caller passes `now`.

/** A streak ends after this long without another wrong hit. */
export const WRONG_TOOL_RESET_MS = 8_000;
/** Energy for the first wrong hit in a streak; each further hit adds one, up to the cap. */
export const WRONG_TOOL_BASE_COST = 1;
export const WRONG_TOOL_MAX_COST = 6;
/** From this hit in a streak on, the notice also says it is tiring you out. */
export const WRONG_TOOL_WARN_AT = 3;

export interface WrongToolStreak {
  /** Wrong hits in a row, counting the latest. */
  count: number;
  at: number;
}

/** The streak after one more wrong hit at `now`. */
export function nextWrongToolStreak(prev: WrongToolStreak | null | undefined, now: number): WrongToolStreak {
  const going = prev && now - prev.at >= 0 && now - prev.at < WRONG_TOOL_RESET_MS;
  return { count: going ? prev.count + 1 : 1, at: now };
}

/** Energy one wrong hit costs, given its place in the streak (1 = first). */
export function wrongToolCost(count: number): number {
  const n = Math.max(1, Math.floor(count));
  return Math.min(WRONG_TOOL_MAX_COST, WRONG_TOOL_BASE_COST + n - 1);
}

/** The notice for a wrong hit: the rules' reason, plus a warning once the streak gets long. */
export function wrongToolNotice(reason: string, count: number): string {
  return count >= WRONG_TOOL_WARN_AT ? `${reason} Hitting it with the wrong tool is wearing you out.` : reason;
}

/** Decorative props that are solid stone: tools rebound off them. */
export const BOULDER_PROPS: ReadonlySet<string> = new Set(["rock_deco"]);

/**
 * Is there a boulder at tile x,y? The art stands about a tile above its 1x1 footprint, so a click
 * on its top half counts too.
 */
export function boulderAt(props: readonly { type: string; x: number; y: number; w: number; h: number }[], x: number, y: number): boolean {
  return props.some((p) => BOULDER_PROPS.has(p.type) && x >= p.x && x < p.x + p.w && y >= p.y - 1 && y < p.y + p.h);
}
