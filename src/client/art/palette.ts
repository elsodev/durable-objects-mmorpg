// Cozy LPC-like palette plus colour helpers for the procedural placeholders.
// Shadows drift toward cool purple and highlights toward warm yellow, which is what makes
// flat fills read as hand-shaded pixel art instead of programmer rectangles.

export type Rgb = number; // 0xRRGGBB

const r = (c: Rgb) => (c >> 16) & 0xff;
const g = (c: Rgb) => (c >> 8) & 0xff;
const b = (c: Rgb) => c & 0xff;
const pack = (rr: number, gg: number, bb: number): Rgb =>
  (clamp8(rr) << 16) | (clamp8(gg) << 8) | clamp8(bb);
function clamp8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function mix(a: Rgb, c: Rgb, t: number): Rgb {
  return pack(r(a) + (r(c) - r(a)) * t, g(a) + (g(c) - g(a)) * t, b(a) + (b(c) - b(a)) * t);
}

const SHADOW_TINT = 0x2a1f3d;
const LIGHT_TINT = 0xfff4c8;

/** k < 0 darkens toward a cool shadow, k > 0 lightens toward warm light. |k| in 0..1. */
export function shade(c: Rgb, k: number): Rgb {
  return k < 0 ? mix(c, SHADOW_TINT, -k) : mix(c, LIGHT_TINT, k);
}

/** Dark outline for a fill colour: much darker, same hue family. */
export function outlineOf(c: Rgb): Rgb {
  return mix(c, 0x1a1020, 0.72);
}

/** FNV-1a string hash. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG so every placeholder looks the same on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(list: readonly T[], n: number): T {
  return list[Math.abs(Math.floor(n)) % list.length];
}

export const P = {
  outline: 0x221a26,
  black: 0x1b1622,
  white: 0xf4efe2,
  shadow: 0x000000,

  grass: 0x4f8f3a,
  grassDark: 0x3f7a30,
  grassLight: 0x67a648,
  grassTuft: 0x80bd56,
  leaf: 0x4c8f34,
  leafDark: 0x2f6227,
  leafLight: 0x79b84a,
  pine: 0x2c5a3e,

  dirt: 0xb68a58,
  dirtDark: 0x977046,
  dirtLight: 0xcba373,
  sand: 0xe0c98f,
  sandDark: 0xc9ae74,
  water: 0x2f84a8,
  waterDark: 0x256b8e,
  waterLight: 0x5fb3d0,
  foam: 0xbfe6ee,
  stone: 0x77737d,
  stoneDark: 0x58545f,
  stoneLight: 0x928e98,
  wood: 0xa8743f,
  woodDark: 0x7a5028,
  woodLight: 0xc48d55,
  bark: 0x6b4428,
  tilled: 0x7a5232,
  tilledDark: 0x5c3c22,
  tilledLight: 0x8f6440,
  wetTilled: 0x553a27,
  wetTilledDark: 0x3d2a1b,
  wetTilledLight: 0x6a4a33,
  caveWall: 0x4d413c,
  caveWallLight: 0x6e5f56,
  brick: 0xb65a3c,
  brickDark: 0x8a3f2a,
  brickTan: 0xc9a46a,
  plaster: 0xe6d6b4,
  void: 0x15121b,

  roofBrown: 0x7b4a2e,
  roofRed: 0xb9472f,
  roofSlate: 0x3c3f58,
  roofGreen: 0x4d6b45,
  glass: 0x2b3446,
  glassLight: 0x9fc9dc,
  doorDark: 0x3b2318,
  iron: 0x3a3a44,
  ironLight: 0x6d6e7c,
  gold: 0xe6b84a,
  flame: 0xf39a2d,
  flameHot: 0xffe27a,
  cloth: 0xc8402f,
  cream: 0xf1e3c2,

  copper: 0xd27a3c,
  copperLight: 0xf0a865,
  ironOre: 0xc7c2c9,
  gem: 0x9b5ee0,
  gemLight: 0x7fe8f0,
} as const;
