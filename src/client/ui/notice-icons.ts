// Like and dislike thumbs for the notice board, 12x12 pixel art drawn for this project (CC0),
// rendered like the menu icons (crisp SVG). Dislike is the like flipped upside down.
import { MENU_ICON_PALETTE, pixelIconSvg } from "./menu-icons";

const PALETTE: Readonly<Record<string, string>> = { ...MENU_ICON_PALETTE, S: "#d9a074", c: "#4f8fd6", C: "#3a6fae" };

export const THUMB_UP: readonly string[] = [
  "....kk......",
  "...kwsk.....",
  "...kssk.....",
  "..kssk......",
  "kkkssskkkkk.",
  "kckssssssssk",
  "kckssssskkk.",
  "kCksssssssSk",
  "kckssssskkk.",
  "kCkssssssSk.",
  "kkkkSSSSSkk.",
  "....kkkkk...",
];

export const THUMB_DOWN: readonly string[] = [...THUMB_UP].reverse();

const urls = new Map<string, string>();

/** A decorative thumb image; the button around it carries the accessible name. */
export function thumbIcon(down: boolean): HTMLImageElement {
  const key = down ? "down" : "up";
  let url = urls.get(key);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pixelIconSvg(down ? THUMB_DOWN : THUMB_UP, PALETTE))}`;
    urls.set(key, url);
  }
  const img = document.createElement("img");
  img.className = "nb-thumb";
  img.src = url;
  img.alt = "";
  img.width = 24;
  img.height = 24;
  img.draggable = false;
  img.setAttribute("aria-hidden", "true");
  return img;
}
