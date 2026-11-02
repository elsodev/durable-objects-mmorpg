// The top menu's 16x16 pixel icons, drawn for this project (CC0). Each icon is a grid of palette
// keys so the art stays reviewable in a diff; it becomes a crisp SVG data URL, which scales by
// whole pixels without the blur a PNG gets at odd device pixel ratios.

/** One shared palette keeps the outlines and shading consistent across icons. */
export const MENU_ICON_PALETTE: Readonly<Record<string, string>> = {
  k: "#3b2418", // outline
  b: "#b0703f", // leather
  B: "#7f4a28", // leather shade
  l: "#d9975a", // leather light
  g: "#f5cf4f", // gold
  G: "#c48f1e", // gold shade
  p: "#f7e9c4", // paper
  P: "#dcc590", // paper shade
  i: "#8a6a4a", // ink
  v: "#5fae3e", // leaf
  V: "#3d7d2a", // leaf shade
  u: "#4f8fd6", // water
  U: "#9cc8f2", // water light
  r: "#e0485a", // red
  R: "#a82a3c", // red shade
  w: "#fff6e0", // highlight
  s: "#f3c49c", // skin
  h: "#7a4523", // hair
  o: "#e08a2e", // ginger hair
  m: "#b3bcc8", // metal
  M: "#76828f", // metal shade
  n: "#3f3557", // doorway
  q: "#9a62d6", // violet
  Q: "#6a3fa8", // violet shade
  y: "#ffd94a", // gold light
  Y: "#e8962a", // amber
};

export const MENU_ICON_SIZE = 16;

export const MENU_ICONS = {
  bag: [
    "................",
    "......kkkk......",
    ".....kBkkBk.....",
    "....kBk..kBk....",
    "..kkkkkkkkkkkk..",
    ".kllllllllllllk.",
    ".klbbbbbbbbbbbk.",
    ".kbbbbbbbbbbbBk.",
    ".kkkkkkggkkkkkk.",
    ".kbbbbkgGkbbbBk.",
    ".klbbbbkkbbbbBk.",
    ".klbbbbbbbbbbBk.",
    ".kbbbbbbbbbbbBk.",
    ".kBBBBBBBBBBBBk.",
    "..kkkkkkkkkkkk..",
    "................",
  ],
  goals: [
    ".kkkkkkkkkkkkkk.",
    "kwppppppppppPPPk",
    ".kkkkkkkkkkkkkk.",
    "..kPPPPPPPPPPk..",
    "..kppppvpppppk..",
    "..kpvpvppiiipk..",
    "..kppvpppppppk..",
    "..kppppppppppk..",
    "..kppppvpppppk..",
    "..kpvpvppiiipk..",
    "..kppvpppppppk..",
    "..kppppppppppk..",
    ".kkkkkkkkkkkkkk.",
    "kwppppppppppPPPk",
    ".kkkkkkkkkkkkkk.",
    "................",
  ],
  friends: [
    "................",
    "................",
    "..kkkkk.........",
    ".khhhhhk........",
    ".khssshk.kkkkk..",
    ".kskskskkoooook.",
    "..kkkkk.kosssok.",
    ".kuuuuukksksksk.",
    ".kUuuuuk.kkkkk..",
    ".kuuuuukkrrrrrk.",
    ".kuuuuukkwrrrrk.",
    ".kkkkkkkkrrrrRk.",
    "........krrrrRk.",
    "........kkkkkkk.",
    "................",
    "................",
  ],
  hearts: [
    "................",
    "..kkkk....kkkk..",
    ".krrrrk..krrrrk.",
    "krwwrrrkkrrrrrRk",
    "krwrrrrrrrrrrrRk",
    "krrrrrrrrrrrrrRk",
    "krrrrrrrrrrrrRRk",
    ".krrrrrrrrrrrRk.",
    "..krrrrrrrrrRk..",
    "...krrrrrrrRk...",
    "....krrrrrRk....",
    ".....krrrRk.....",
    "......krRk......",
    ".......kk.......",
    "................",
    "................",
  ],
  map: [
    "................",
    ".....kkkkkk.....",
    "kkkkkkPPPPkkkkkk",
    "kppppkPPPPkppppk",
    "kpvvpkPuuPkppppk",
    "kvvvpkuuuPkprprk",
    "kvvvpkuuuPkpprpk",
    "kpvppkPuuPkprprk",
    "kppppkPPPPkppppk",
    "kprppkPPPPkpvvpk",
    "kpprpkrPrPkvvvpk",
    "kppppkPPPrkpvvpk",
    "kppppkPPPPkppppk",
    "kkkkkkPPPPkkkkkk",
    ".....kkkkkk.....",
    "................",
  ],
  options: [
    "................",
    "......kkkk......",
    "..kkk.kmmk.kkk..",
    "..kwwkkmmkkmmk..",
    "..kwwmmmmmmmmk..",
    "...kmmmmmmmmk...",
    ".kkkmmmkkmmMkkk.",
    ".kmmmmk..kMMMMk.",
    ".kmmmmk..kMMMMk.",
    ".kkkmmmkkMMMkkk.",
    "...kmmmMMMMMk...",
    "..kmmmMMMMMMMk..",
    "..kmmkkMMkkMMk..",
    "..kkk.kMMk.kkk..",
    "......kkkk......",
    "................",
  ],
  signout: [
    "................",
    ".kkkkkkkkk......",
    ".kBbbbbbBk......",
    ".kbknnnkbk......",
    ".kbknnnkbkkk....",
    ".kbknnnkbkkvk...",
    ".kbkkkkkkkkvvk..",
    ".kbkkvvvvvvvvvk.",
    ".kbkkVVVVVVVVVk.",
    ".kbkkkkkkkkVVk..",
    ".kbknnnkbkkVk...",
    ".kbknnnkbkkk....",
    ".kbknnnkbk......",
    ".kbkkkkkbk......",
    "kkkkkkkkkkk.....",
    "................",
  ],
  sound: [
    "................",
    "................",
    ".......kk.......",
    "......kwk...u...",
    ".....kwmk....u..",
    ".kkkkwmmk....Uu.",
    ".kwwwmmmk.uU..u.",
    ".kwmmmmmk..u..u.",
    ".kmmmmmMk..u..u.",
    ".kMMMMMMk.uU..u.",
    ".kkkkMMMk....Uu.",
    ".....kMMk....u..",
    "......kMk...u...",
    ".......kk.......",
    "................",
    "................",
  ],
  muted: [
    "................",
    "................",
    ".......kk.......",
    "......kwk.......",
    ".....kwmk.......",
    ".kkkkwmmk.......",
    ".kwwwmmmkrr..rr.",
    ".kwmmmmmk.rrrr..",
    ".kmmmmmMk..RR...",
    ".kMMMMMMk.RrrR..",
    ".kkkkMMMkRR..RR.",
    ".....kMMk.......",
    "......kMk.......",
    ".......kk.......",
    "................",
    "................",
  ],
  music: [
    "................",
    ".......kkk......",
    ".......kqqkk....",
    ".......kqkqqk...",
    ".......kqkkqqk..",
    ".......kqk.kqk..",
    ".......kqk..kk..",
    ".......kqk......",
    ".......kqk......",
    "...kkkkkqk......",
    "..kqqqqqqk......",
    ".kqwqqqqqk......",
    ".kqqqqqqQk......",
    "..kkkkkkk.......",
    "................",
    "................",
  ],
  sfx: [
    "................",
    ".......kk.......",
    ".......kk.......",
    "......kyyk......",
    "......kyyk......",
    ".....kyyyYk.....",
    "..kkkyywwYYkkk..",
    "kkyyyywwwwYYYYkk",
    "kkyyyywwwwYYYYkk",
    "..kkkyywwYYkkk..",
    ".....kyYYYk.....",
    "......kYYk......",
    "......kYYk......",
    ".......kk.......",
    ".......kk.......",
    "................",
  ],
} as const satisfies Record<string, readonly string[]>;

export type MenuIconName = keyof typeof MENU_ICONS;

/**
 * SVG markup for a grid: one path per colour, one rect-run per horizontal stretch of a colour.
 * "." is transparent.
 */
export function pixelIconSvg(grid: readonly string[], palette: Readonly<Record<string, string>> = MENU_ICON_PALETTE): string {
  const runs = new Map<string, string[]>();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      const color = key === "." ? undefined : palette[key];
      if (color) {
        let list = runs.get(color);
        if (!list) runs.set(color, (list = []));
        list.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      }
      x = end;
    }
  });
  const w = Math.max(0, ...grid.map((r) => r.length));
  const paths = [...runs].map(([color, d]) => `<path fill="${color}" d="${d.join("")}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${grid.length}" viewBox="0 0 ${w} ${grid.length}" shape-rendering="crispEdges">${paths}</svg>`;
}

const urlCache = new Map<MenuIconName, string>();

export function menuIconUrl(name: MenuIconName): string {
  let url = urlCache.get(name);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pixelIconSvg(MENU_ICONS[name]))}`;
    urlCache.set(name, url);
  }
  return url;
}

/** Decorative icon element: the button around it carries the accessible name. */
export function menuIcon(name: MenuIconName, className = "dm-btn-icon"): HTMLImageElement {
  const img = document.createElement("img");
  img.className = className;
  img.src = menuIconUrl(name);
  img.alt = "";
  img.width = MENU_ICON_SIZE;
  img.height = MENU_ICON_SIZE;
  img.draggable = false;
  img.setAttribute("aria-hidden", "true");
  img.dataset.icon = name;
  return img;
}
