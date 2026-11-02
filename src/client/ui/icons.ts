// Item icon URLs shared by hotbar, inventory, shop and goals.
// Before art loads (or for items the art pack lacks) we draw a lettered tile tinted by item kind.
import { getItem, type ItemKind } from "../../shared/items";
import type { ItemId } from "../../shared/types";

const KIND_COLORS: Record<ItemKind | "unknown", string> = {
  seed: "#8fae5a",
  crop: "#e0a33b",
  ore: "#8a7f74",
  gem: "#5bb7c9",
  tool: "#7d8fb0",
  furniture: "#b07a4f",
  material: "#a89a6e",
  fish: "#4f88c6",
  forage: "#6fa86b",
  produce: "#e8d6a8",
  food: "#d98b5f",
  unknown: "#9a8c98",
};

let source: ((item: ItemId) => string) | null = null;
const fallbackCache = new Map<ItemId, string>();

export function setIconSource(src: (item: ItemId) => string): void {
  source = src;
}

export function iconFor(item: ItemId): string {
  if (source) {
    try {
      const url = source(item);
      if (url) return url;
    } catch {
      // fall through to the placeholder
    }
  }
  return fallbackIcon(item);
}

export function kindColor(item: ItemId): string {
  return KIND_COLORS[getItem(item)?.kind ?? "unknown"];
}

/** First letter of the item's display name (or id), uppercased; "?" if none. */
export function iconLetter(item: ItemId): string {
  const name = getItem(item)?.name ?? item;
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toUpperCase() : "?";
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function fallbackIcon(item: ItemId): string {
  const cached = fallbackCache.get(item);
  if (cached) return cached;
  const color = kindColor(item);
  const letter = iconLetter(item).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">` +
    `<rect x="2" y="2" width="28" height="28" rx="4" fill="${color}" stroke="#3b2b25" stroke-width="2"/>` +
    `<rect x="4" y="4" width="24" height="4" rx="2" fill="#ffffff" opacity="0.25"/>` +
    `<text x="16" y="22" font-family="monospace" font-size="16" font-weight="bold" text-anchor="middle" fill="#fff8e7" stroke="#3b2b25" stroke-width="0.6">${letter}</text>` +
    `</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  fallbackCache.set(item, url);
  return url;
}
