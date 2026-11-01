// Debug ASCII renderer: one character per tile. Handy in tests and when tweaking layouts.
// Legend (later layers win): ground  . grass  : dirt  , sand  ~ water  _ stone  = wood
//   " tilled  # cave wall  W wall  (space) void;  T tree  * bush  o rock_deco  P other prop
//   R rock (mining node)  E exit  S spawn  N npc  M monster spawn

import { Ground, type MapData } from "../types";

const GROUND_CHARS: Record<Ground, string> = {
  [Ground.Void]: " ",
  [Ground.Grass]: ".",
  [Ground.Dirt]: ":",
  [Ground.Sand]: ",",
  [Ground.Water]: "~",
  [Ground.Stone]: "_",
  [Ground.Wood]: "=",
  [Ground.Tilled]: '"',
  [Ground.CaveWall]: "#",
  [Ground.Wall]: "W",
};

const PROP_CHARS: Record<string, string> = { tree: "T", bush: "*", rock_deco: "o" };

export function mapToAscii(map: MapData): string {
  const { width, height } = map;
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) row.push(GROUND_CHARS[map.ground[y * width + x]!] ?? "?");
    grid.push(row);
  }
  const put = (x: number, y: number, c: string) => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (ty >= 0 && ty < height && tx >= 0 && tx < width) grid[ty]![tx] = c;
  };
  for (const p of map.props)
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) put(x, y, PROP_CHARS[p.type] ?? "P");
  for (const r of map.rocks ?? []) put(r.x, r.y, "R");
  for (const e of map.exits) for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) put(x, y, "E");
  for (const s of Object.values(map.spawns)) put(s.x, s.y, "S");
  for (const n of map.npcs) put(n.x, n.y, "N");
  for (const m of map.monsters) put(m.x, m.y, "M");
  return grid.map((r) => r.join("")).join("\n");
}
