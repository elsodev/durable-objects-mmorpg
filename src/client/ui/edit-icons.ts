// Edit mode's 16x16 pixel icons, drawn for this project (CC0) in the menu icons' palette, so the
// pencil, turn arrow, cross and fence sit beside the bag icon without looking borrowed.
import { MENU_ICON_SIZE, menuIcon, pixelIconSvg } from "./menu-icons";

export const EDIT_ICONS = {
  pencil: [
    "................",
    "...........kk...",
    "..........krrk..",
    ".........krRRk..",
    "........kmmMk...",
    ".......kyykk....",
    "......kyYYk.....",
    ".....kyYYk......",
    "....kyYYk.......",
    "...kyYYk........",
    "..kpYYk.........",
    "..kppk..........",
    "..kik...........",
    "..kk............",
    "................",
    "................",
  ],
  turn: [
    "................",
    ".....kkkkk......",
    "...kkuuuuukk.k..",
    "..kuuUUUUuuukUk.",
    ".kuUkkkkkkUuuUk.",
    ".kuk......kuUUk.",
    "kuUk.....kUUUUk.",
    "kuk......kkkkkk.",
    "kuk.............",
    "kuUk......kk....",
    ".kuk.....kuk....",
    ".kuUkkkkkuUk....",
    "..kuuUUUuuk.....",
    "...kkuuuukk.....",
    ".....kkkk.......",
    "................",
  ],
  close: [
    "................",
    "................",
    "...kk......kk...",
    "..krrk....krrk..",
    "..krRrk..krRrk..",
    "...krRrkkrRrk...",
    "....krRrrRrk....",
    ".....krRRrk.....",
    ".....krRRrk.....",
    "....krRrrRrk....",
    "...krRrkkrRrk...",
    "..krRrk..krRrk..",
    "..krrk....krrk..",
    "...kk......kk...",
    "................",
    "................",
  ],
  fence: [
    "................",
    "..kk....kk....kk",
    ".kbbk..kbbk..kbb",
    ".kbBk..kbBk..kbB",
    "kkkkkkkkkkkkkkkk",
    "kllllllllllllllk",
    "kBBBBBBBBBBBBBBk",
    "kkbBkkkkbBkkkkbB",
    ".kbBk..kbBk..kbB",
    "kkkkkkkkkkkkkkkk",
    "kllllllllllllllk",
    "kBBBBBBBBBBBBBBk",
    "kkbBkkkkbBkkkkbB",
    ".kbBk..kbBk..kbB",
    ".kkkk..kkkk..kkk",
    "................",
  ],
} as const;

export type EditIconName = keyof typeof EDIT_ICONS | "bag";

const cache = new Map<string, string>();

/** Decorative icon element: the button around it carries the accessible name. */
export function editIcon(name: EditIconName): HTMLImageElement {
  if (name === "bag") return menuIcon("bag", "edit-icon");
  let url = cache.get(name);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pixelIconSvg(EDIT_ICONS[name]))}`;
    cache.set(name, url);
  }
  const img = document.createElement("img");
  img.className = "edit-icon";
  img.src = url;
  img.alt = "";
  img.width = MENU_ICON_SIZE;
  img.height = MENU_ICON_SIZE;
  img.draggable = false;
  img.setAttribute("aria-hidden", "true");
  return img;
}
