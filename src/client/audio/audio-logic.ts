// Pure audio helpers: key mapping, variant/pitch picks, throttling and settings parsing.
// No DOM or Web Audio here so the rules can be unit-tested under the worker tsconfig.
import { isCaveDepthZone } from "../../shared/types";

export interface MusicEntry {
  file: string;
  loop: boolean;
  volume: number;
  fallback?: string;
}

export interface SfxEntry {
  files: string[];
  volume: number;
}

export interface AudioManifest {
  music: Record<string, MusicEntry>;
  sfx: Record<string, SfxEntry>;
}

/** Game and UI seam keys that differ from the manifest's names. Keys already in the manifest pass through. */
export const KEY_MAP: Readonly<Record<string, string>> = {
  // UI (ui/sound.ts)
  click: "ui_click",
  hover: "ui_hover",
  open: "ui_open",
  close: "ui_close",
  tab: "ui_tab",
  confirm: "ui_confirm",
  cancel: "ui_cancel",
  select: "ui_slot",
  toggle: "ui_toggle",
  // Game (game/audio.ts)
  tool_hoe: "hoe",
  tool_water: "water",
  tool_pickaxe: "pick_hit",
  tool_sword: "sword_swing",
  tool_axe: "pick_swing",
  /** Wrong tool: it bounces off. */
  tool_clunk: "pick_hit",
  tree_chop: "hoe",
  tree_fall: "place",
  door: "zone_change",
  loot: "coins",
  interact: "ui_click",
  goal: "goal_complete",
  // Combat (player)
  attack_hit: "sword_hit",
  attack_miss: "sword_miss",
  tool_pickaxe_swing: "pick_swing",
  faint: "player_faint",
  spawn: "monster_spawn",
  // The rock crab is drawn as a spider; accept either name.
  spider_idle: "rock_crab_idle",
  spider_aggro: "rock_crab_aggro",
  spider_attack: "rock_crab_attack",
  spider_hurt: "rock_crab_hurt",
  spider_die: "rock_crab_die",
};

/** Monster kinds with their own sfx set: `<kind>_idle|aggro|attack|hurt|die`. */
export const MONSTER_SFX_KINDS = ["slime", "bat", "rock_crab"] as const;
export const MONSTER_SFX_EVENTS = ["idle", "aggro", "attack", "hurt", "die"] as const;
/** Combat keys the manifest provides beyond the monster sets. */
export const COMBAT_SFX_KEYS = ["sword_hit", "sword_miss", "pick_swing", "player_hurt", "player_faint", "monster_spawn"] as const;

/** Seam key for a monster event, e.g. monsterSfxKey("bat", "aggro") -> "bat_aggro". */
export function monsterSfxKey(kind: string, event: (typeof MONSTER_SFX_EVENTS)[number]): string {
  return `${kind}_${event}`;
}

/** Resolve a seam key to a manifest sfx key, or null if the manifest has nothing for it. */
export function resolveSfxKey(key: string, sfx: Readonly<Record<string, unknown>>): string | null {
  const mapped = Object.prototype.hasOwnProperty.call(KEY_MAP, key) ? KEY_MAP[key]! : key;
  if (Object.prototype.hasOwnProperty.call(sfx, mapped)) return mapped;
  // "loot" prefers coins but any manifest without coins still gets a pickup sound.
  if (key === "loot" && Object.prototype.hasOwnProperty.call(sfx, "pickup")) return "pickup";
  // Older manifests only have the body-thump "hurt".
  if (key === "player_hurt" && Object.prototype.hasOwnProperty.call(sfx, "hurt")) return "hurt";
  // Unknown monster kinds and generic monster events fall back to the shared monster sounds.
  const ev = /_(hurt|die)$/.exec(mapped);
  if (ev) {
    const generic = ev[1] === "hurt" ? "monster_hit" : "monster_die";
    if (Object.prototype.hasOwnProperty.call(sfx, generic)) return generic;
  }
  return null;
}

/** Music track for a zone; null means we're on the sign-in screen. */
export function musicKeyForZone(zone: string | null, music: Readonly<Record<string, unknown>>): string | null {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(music, k);
  const key = zone ?? "title";
  if (has(key)) return key;
  // Places without a track of their own borrow one: the inn gets the lively one, homes the cosy
  // one, the quarry the open-air riverside one, the rest the village's.
  for (const k of borrowedMusic(key)) if (has(k)) return k;
  return null;
}

function borrowedMusic(zone: string): string[] {
  if (zone === "quarry") return ["riverside", "village"];
  if (isCaveDepthZone(zone)) return ["caves"];
  if (!zone.startsWith("int_")) return [];
  if (zone === "int_inn") return ["festival", "village"];
  if (zone.startsWith("int_house_")) return ["home", "village"];
  return ["village"];
}

/** Pick a variant index, avoiding an immediate repeat of `last` when there is a choice. */
export function pickVariant(count: number, last: number | undefined, rand: () => number): number {
  if (count <= 1) return 0;
  if (last === undefined || last < 0 || last >= count) return Math.min(count - 1, Math.floor(rand() * count));
  const i = Math.min(count - 2, Math.floor(rand() * (count - 1)));
  return i >= last ? i + 1 : i;
}

/** Playback rate with a small random detune, so repeated sounds don't read as machine-gunned. */
export function pitchFor(rand: () => number, spread = 0.04): number {
  return 1 + (rand() * 2 - 1) * spread;
}

/** Minimum gap between two plays of the same sfx key, in ms. */
export const MIN_GAP_MS: Readonly<Record<string, number>> = {
  ui_hover: 60,
  step_grass: 200,
  step_stone: 200,
  npc_talk: 120,
  error: 150,
};
export const DEFAULT_MIN_GAP_MS = 35;

/** Per-key rate limiter: allow() returns false if the same key played less than its gap ago. */
export class Throttle {
  private last = new Map<string, number>();
  constructor(
    private gaps: Readonly<Record<string, number>> = MIN_GAP_MS,
    private fallbackGap = DEFAULT_MIN_GAP_MS,
  ) {}

  allow(key: string, now: number): boolean {
    const gap = this.gaps[key] ?? this.fallbackGap;
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < gap) return false;
    this.last.set(key, now);
    return true;
  }
}

export const FOOTSTEP_INTERVAL_MS = 280;

/** Footstep sfx for a ground kind: hard surfaces click, everything else rustles. */
export function footstepKey(groundKind: string): "step_grass" | "step_stone" {
  return /stone|rock|cave|path|floor|wood|tile|bridge|sand|dirt/i.test(groundKind) ? "step_stone" : "step_grass";
}

export interface AudioSettings {
  muted: boolean;
  music: number;
  sfx: number;
}

export const DEFAULT_SETTINGS: AudioSettings = { muted: false, music: 0.7, sfx: 0.8 };

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Parse stored settings, tolerating anything a user or an old version may have left behind. */
export function parseSettings(raw: string | null | undefined): AudioSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>> | null;
    if (!v || typeof v !== "object") return { ...DEFAULT_SETTINGS };
    return {
      muted: typeof v.muted === "boolean" ? v.muted : DEFAULT_SETTINGS.muted,
      music: typeof v.music === "number" ? clamp01(v.music) : DEFAULT_SETTINGS.music,
      sfx: typeof v.sfx === "number" ? clamp01(v.sfx) : DEFAULT_SETTINGS.sfx,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Join a manifest-relative path onto the manifest's base URL. */
export function assetUrl(base: string, file: string): string {
  return base.replace(/\/+$/, "") + "/" + file.replace(/^\/+/, "");
}

/** Animals are heard this many tiles away (their love sounds are quiet, homely noises). */
export const ANIMAL_HEAR_RANGE = 10;

/** The happy sound an animal makes when petted or fed: dogs bark, cats purr, hens cluck. */
export function animalLoveSfx(sprite: string): string | null {
  if (sprite.startsWith("dog_")) return "dog_bark";
  if (sprite.startsWith("cat_")) return "cat_purr";
  if (sprite.startsWith("chicken_")) return "hen_cluck";
  return null;
}
