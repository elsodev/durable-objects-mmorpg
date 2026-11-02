// The "Mossbrook" title logo, drawn in code as pixel art (original art, CC0; see assets/ui/CREDITS.md).
// Pure: glyph masks are composed and shaded into a palette-indexed grid, so tests can check it
// without a canvas. ui/logo.ts paints the grid and scales it by whole pixels.

/** Palette index 0 is transparent. */
export const LOGO_PALETTE = [
  "", // 0 transparent
  "#2e1b0e", // 1 outline: dark brown
  "#fbf3dc", // 2 halo: cream, lifts the logo off dark backgrounds
  "#6b4424", // 3 extrusion, lit edge
  "#4a2c16", // 4 extrusion, shade
  "#f4f9c8", // 5 moss: cream-lime top highlight
  "#b9dc5c", // 6 moss: light
  "#86bd3e", // 7 moss: mid
  "#5c9530", // 8 moss: dark
  "#3f6e24", // 9 moss: deepest, bottom edge
  "#e6f8ff", // 10 brook: foam highlight
  "#8fd3ec", // 11 brook: light
  "#4fa9d4", // 12 brook: mid
  "#2f7db4", // 13 brook: dark
  "#235a8a", // 14 brook: deepest
  "#d9f27a", // 15 leaf: light
  "#6faa2c", // 16 leaf: dark
] as const;

const O = 1, HALO = 2, EX_LIT = 3, EX = 4;
const MOSS = [5, 6, 7, 8, 9] as const;
const BROOK = [10, 11, 12, 13, 14] as const;
const LEAF_L = 15, LEAF_D = 16;

/** Body heights: x-height for lowercase, ascender/cap above it. */
const X = 16;
const ASC = 22;

/** "#" is ink. Rows are top to bottom; every glyph sits on the same baseline. */
type Mask = string[];

const stem = (h: number, w = 4): Mask => Array.from({ length: h }, () => "#".repeat(w));

/** Union of masks; `dy` lines a part up from the top of a glyph `h` rows tall. */
function compose(h: number, w: number, parts: { m: Mask; dx?: number; dy?: number }[]): Mask {
  const rows = Array.from({ length: h }, () => Array<string>(w).fill("."));
  for (const { m, dx = 0, dy = 0 } of parts)
    m.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === "#") rows[y + dy]![x + dx] = "#";
    }));
  return rows.map((r) => r.join(""));
}

const BOWL: Mask = [
  "...########...",
  ".############.",
  "#####....#####",
  "####......####",
  "####......####",
  "####......####",
  "####......####",
  "####......####",
  "####......####",
  "####......####",
  "####......####",
  "####......####",
  "####......####",
  "#####....#####",
  ".############.",
  "...########...",
];

const GLYPHS: Record<string, Mask> = {
  M: [
    ".###.........###.",
    "#####.......#####",
    "######.....######",
    "#######...#######",
    "########.########",
    "#################",
    "####.#######.####",
    "####..#####..####",
    "####...###...####",
    "####....#....####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
    "####.........####",
  ],
  o: BOWL,
  s: [
    "...#########.",
    ".############",
    "####......###",
    "####.........",
    "####.........",
    "######.......",
    ".##########..",
    "..##########.",
    ".......######",
    ".........####",
    ".........####",
    ".........####",
    "###......####",
    "#############",
    ".###########.",
    "..#########..",
  ],
  b: compose(ASC, 13, [
    { m: [".###", ...stem(ASC - 1)] },
    { m: BOWL, dy: ASC - X },
  ]),
  r: [
    "####..#####",
    "####.######",
    "#######..##",
    "######.....",
    "#####......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
    "####.......",
  ],
  k: compose(ASC, 13, [
    { m: [".###", ...stem(ASC - 1)] },
    {
      m: [
        "....#####",
        "...####..",
        "..####...",
        ".####....",
        "#####....",
        "######...",
        "#######..",
        "###.####.",
        "##...####",
        "#....####",
        ".....####",
        ".....####",
        ".....####",
        ".....####",
        ".....####",
        ".....####",
      ],
      dx: 4,
      dy: ASC - X,
    },
  ]),
};

export interface LogoGrid {
  w: number;
  h: number;
  /** Row-major palette indices into LOGO_PALETTE. */
  px: Uint8Array;
}

const WORD = "Mossbrook";
/** Letters in the water half of the name ("brook"). */
const BROOK_FROM = 4;
const GAP = 2;
/** Small per-letter lifts for a hand-set, bouncy baseline. */
const BOUNCE = [0, 1, 0, 1, 0, 1, 0, 1, 0];
const DEPTH = 3;
const PAD_TOP = 11; // room for the sprout, its outline and halo
const PAD = 2;

export function buildLogo(): LogoGrid {
  const glyphs = [...WORD].map((c) => GLYPHS[c]!);
  const inkW = glyphs.reduce((s, g) => s + g[0]!.length, 0) + GAP * (glyphs.length - 1);
  const w = inkW + PAD * 2;
  const h = PAD_TOP + ASC + DEPTH + PAD + 1;
  const base = PAD_TOP + ASC; // first row below the letters
  const at = (x: number, y: number) => y * w + x;

  // 0 = empty, 1 = moss ink, 2 = brook ink; letterTop is each ink pixel's x-height line, for the bands.
  const ink = new Uint8Array(w * h);
  const letterTop = new Int16Array(w * h);
  let x0 = PAD;
  let glintAt = { x: 0, y: 0 };
  glyphs.forEach((g, i) => {
    const lift = BOUNCE[i] ?? 0;
    const top = base - g.length - lift;
    g.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== "#") return;
        ink[at(x0 + x, top + y)] = i >= BROOK_FROM ? 2 : 1;
        letterTop[at(x0 + x, top + y)] = base - X - lift;
      }),
    );
    if (WORD[i] === "b") glintAt = { x: x0 + 1, y: top + 3 };
    x0 += g[0]!.length + GAP;
  });

  const px = new Uint8Array(w * h);
  const isInk = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ink[at(x, y)]! > 0;

  // Extrusion: the letters pushed straight down DEPTH rows, lit where a left edge turns the corner.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (isInk(x, y)) continue;
      for (let d = 1; d <= DEPTH; d++)
        if (isInk(x, y - d)) {
          px[at(x, y)] = d === 1 && !isInk(x - 1, y - d) ? EX_LIT : EX;
          break;
        }
    }

  // Face shading: a lit top edge, a soft band, and a dark lip along every bottom edge.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = ink[at(x, y)]!;
      if (!k) continue;
      const ramp = k === 2 ? BROOK : MOSS;
      const depthFromTop = y - letterTop[at(x, y)]!;
      let shade: number;
      if (!isInk(x, y - 1)) shade = 0;
      else if (!isInk(x, y + 1)) shade = 4;
      else if (!isInk(x, y - 2) || !isInk(x - 1, y)) shade = 1;
      else {
        // Two bands with a one-row checker between them, the way 16-bit logos blend.
        const edge = Math.round(X * 0.5);
        shade = depthFromTop < edge || (depthFromTop === edge && (x + y) % 2 === 0) ? 2 : 3;
      }
      px[at(x, y)] = ramp[shade]!;
    }

  // A glint on the water half, the way light catches a brook.
  for (const [dx, dy] of [[0, 0], [-1, 1], [0, 1], [1, 1], [0, 2]] as const) px[at(glintAt.x + dx, glintAt.y + dy)] = BROOK[0];
  sprout(px, w, PAD + GLYPHS.M![0]!.length - 3, base - ASC - (BOUNCE[0] ?? 0) - 1);
  // Outline around everything drawn so far, then a cream halo outside that.
  ring(px, w, h, (i) => px[i]! !== 0, O, true);
  const out = outside(px, w, h);
  ring(px, w, h, (i) => px[i]! !== 0 || !out[i], HALO, false);
  return { w, h, px };
}

/** Empty pixels reachable from the border: the halo skips letter counters. */
function outside(px: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || px[i]) continue;
    seen[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  return seen;
}

/** Paint `color` on empty pixels touching a filled one (8-way when `diag`). */
function ring(px: Uint8Array, w: number, h: number, filled: (i: number) => boolean, color: number, diag: boolean): void {
  const hits: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (filled(y * w + x)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1 && !near; dx++) {
          if ((!dx && !dy) || (!diag && dx && dy)) continue;
          const nx = x + dx, ny = y + dy;
          near = nx >= 0 && ny >= 0 && nx < w && ny < h && filled(ny * w + nx);
        }
      if (near) hits.push(y * w + x);
    }
  for (const i of hits) px[i] = color;
}

/** A two-leaf sprout on the M's right peak; `stemX`, `stemBottom` are its root pixel. Outlined later. */
function sprout(px: Uint8Array, w: number, stemX: number, stemBottom: number): void {
  const art = [
    "........LLL..",
    "......LLLLLL.",
    ".....LLLLLLD.",
    ".LL..LLLLDD..",
    "LLLL.SDDD....",
    "LLLDDS.......",
    ".DDD.S.......",
    ".....S.......",
    ".....S.......",
  ];
  const left = stemX - 5, top = stemBottom - art.length + 1;
  art.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const v = c === "L" ? LEAF_L : c === "D" ? LEAF_D : c === "S" ? MOSS[3] : 0;
      if (v) px[(top + y) * w + left + x] = v;
    }),
  );
}
