// Emote icons as 12x12 pixel maps, drawn in code (original art, CC0; see assets/emotes/CREDITS.md).
// Pure data + a DOM-free validity check, so tests can run without a canvas.
import { BUBBLES, type BubbleCode } from "../../shared/emotes";

/** "." is transparent. */
export const EMOTE_PALETTE: Record<string, string> = {
  k: "#3b2a1a",
  y: "#ffd75e",
  o: "#f08a4b",
  r: "#e5533d",
  w: "#ffffff",
  b: "#5aa9e6",
  p: "#f49ac1",
  g: "#6fd35a",
  G: "#9a9a9a",
};

const FACE_TOP = ["...kkkkkk...", "..kyyyyyyk..", ".kyyyyyyyyk.", "kyyyyyyyyyyk"];
const FACE_BOTTOM = [".kyyyyyyyyk.", "..kyyyyyyk..", "...kkkkkk..."];
const HAPPY_EYES = ["kyyykyykyyyk", "kyykykkykyyk"];

export const EMOTE_PIXELS: Record<BubbleCode, string[]> = {
  wave: [
    "...k.k.k....",
    "..kykykyk.G.",
    "..kykykyk..G",
    "..kykykyk.G.",
    "kkkyyyyyyk..",
    "kyykyyyyyk..",
    ".kyyyyyyyk..",
    "..kyyyyyyk..",
    "...kyyyyk...",
    "....kkkk....",
    "............",
    "............",
  ],
  heart: [
    "............",
    "..kkk..kkk..",
    ".krrrkkrrrk.",
    "krrwrrrrrrrk",
    "krwrrrrrrrrk",
    "krrrrrrrrrrk",
    ".krrrrrrrrk.",
    "..krrrrrrk..",
    "...krrrrk...",
    "....krrk....",
    ".....kk.....",
    "............",
  ],
  laugh: [
    ...FACE_TOP,
    ...HAPPY_EYES,
    "kyyyyyyyyyyk",
    "kyykkkkkkyyk",
    "kyykrrrrkyyk",
    ".kyykkkkyyk.",
    "..kyyyyyyk..",
    "...kkkkkk...",
  ],
  angry: [
    "...kkkkkk...",
    "..kooooook..",
    ".kkkooookkk.",
    "kookkookkook",
    "koookookoook",
    "koookookoook",
    "kooooooooook",
    "kooooooooook",
    "kookkkkkkook",
    ".kooooooook.",
    "..kooooook..",
    "...kkkkkk...",
  ],
  sad: [
    ...FACE_TOP,
    "kyyykyykyyyk",
    "kyyykyykyyyk",
    "kyybyyyyyyyk",
    "kyybyyyyyyyk",
    "kyyykkkkyyyk",
    ".kykyyyykyk.",
    "..kyyyyyyk..",
    "...kkkkkk...",
  ],
  sleepy: [
    "............",
    ".bbbbbb.....",
    ".....bb.....",
    "....bb......",
    "...bb.......",
    "..bb........",
    ".bbbbbb.....",
    ".......bbbb.",
    ".........b..",
    "........b...",
    ".......bbbb.",
    "............",
  ],
  surprised: [
    "...kkkkkk...",
    "..kyyyyyyk..",
    ".kykkyykkyk.",
    "kyyyyyyyyyyk",
    "kyykkyykkyyk",
    "kyykkyykkyyk",
    "kyyyyyyyyyyk",
    "kyyyykkyyyyk",
    "kyyykrrkyyyk",
    ".kyyykkyyyk.",
    "..kyyyyyyk..",
    "...kkkkkk...",
  ],
  music: [
    "............",
    ".....kkkkkk.",
    ".....kbbbbk.",
    ".....kkkkkk.",
    ".....k....k.",
    ".....k....k.",
    "..kkkk.kkkk.",
    ".kbbbk.kbbbk",
    ".kbbbk.kbbbk",
    "..kkk...kkk.",
    "............",
    "............",
  ],
  idea: [
    "....kkkk....",
    "...kyyyyk...",
    "..kywyyyyk..",
    "..kwyyyyyk..",
    "..kyyyyyyk..",
    "..kyyyyyyk..",
    "...kyyyyk...",
    "....kyyk....",
    "....kGGk....",
    "....kGGk....",
    ".....kk.....",
    "............",
  ],
  sweat: [
    ".....kk.....",
    "....kbbk....",
    "....kbbk....",
    "...kbbbbk...",
    "...kbwbbk...",
    "..kbwbbbbk..",
    "..kbwbbbbk..",
    "..kbbbbbbk..",
    "..kbbbbbbk..",
    "...kbbbbk...",
    "....kkkk....",
    "............",
  ],
  ok: [
    "............",
    "..........kk",
    ".........kgk",
    "........kggk",
    ".kk....kggk.",
    "kggk..kggk..",
    ".kggkkggk...",
    "..kggggk....",
    "...kggk.....",
    "....kk......",
    "............",
    "............",
  ],
  thanks: [
    ...FACE_TOP,
    ...HAPPY_EYES,
    "kppyyyyyyppk",
    "kyykyyyykyyk",
    "kyyykkkkyyyk",
    ...FACE_BOTTOM,
  ],
  // A frightened animal: blanched forehead, worried brows, wide eyes, a chattering mouth.
  scared: [
    "...kkkkkk...",
    "..kbbbbbbk..",
    ".kbbbbbbbbk.",
    "kbbbkbbkbbbk",
    "kykkyyyykkyk",
    "kywwwyywwwyk",
    "kywkwyywkwyk",
    "kyyyyyyyyyyk",
    "kyyykykykyyk",
    ".kykykykyyk.",
    "..kyyyyyyk..",
    "...kkkkkk...",
  ],
};

/** Problems with the pixel maps (empty when all are well-formed). */
export function emotePixelProblems(): string[] {
  const out: string[] = [];
  for (const code of BUBBLES) {
    const rows = EMOTE_PIXELS[code];
    if (!rows || rows.length !== 12) out.push(`${code}: needs 12 rows`);
    rows?.forEach((r, i) => {
      if (r.length !== 12) out.push(`${code}: row ${i} has ${r.length} columns`);
      for (const ch of r) if (ch !== "." && !Object.hasOwn(EMOTE_PALETTE, ch)) out.push(`${code}: unknown color "${ch}"`);
    });
  }
  return out;
}
