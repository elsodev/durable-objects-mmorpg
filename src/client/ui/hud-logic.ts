// Pure HUD logic (no DOM), shared by ui/hud.ts and tested in test/fe-ui-shell.test.ts.
import type { Inventory, InventorySlot } from "../../shared/types";

export const HOTBAR_SIZE = 8;
const MAX_HEARTS = 10;

export type HeartState = "full" | "half" | "empty";

/** One heart per 2 hp, at most 10 hearts (larger pools are scaled onto 10). */
export function heartStates(hp: number, maxHp: number): HeartState[] {
  const max = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 0;
  if (max === 0) return [];
  const cur = Math.min(Math.max(Number.isFinite(hp) ? hp : 0, 0), max);
  const n = Math.min(MAX_HEARTS, Math.ceil(max / 2));
  const per = max / n;
  const out: HeartState[] = [];
  for (let i = 0; i < n; i++) {
    const v = cur - i * per;
    out.push(v >= per - 1e-9 ? "full" : v >= per / 2 - 1e-9 ? "half" : "empty");
  }
  return out;
}

/** The first 8 inventory slots, null where empty. */
export function hotbarSlots(inv: Inventory | null): (InventorySlot | null)[] {
  const out: (InventorySlot | null)[] = [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const s = inv?.slots[i];
    out.push(s && s.qty > 0 ? s : null);
  }
  return out;
}

export function pingLevel(ms: number): "good" | "ok" | "bad" {
  return ms < 120 ? "good" : ms < 300 ? "ok" : "bad";
}

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

export function isTypingTarget(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Which HUD shortcut a keydown triggers, or null (modifiers, auto-repeat and typing are ignored). */
export function shortcutFor(e: KeyLike, typing: boolean): "inventory" | "goals" | "friends" | "escape" | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null;
  if (typing || isTypingTarget(e.target)) return null;
  const k = e.key.toLowerCase();
  if (k === "i") return "inventory";
  if (k === "g") return "goals";
  if (k === "o") return "friends";
  if (k === "escape") return "escape";
  return null;
}
