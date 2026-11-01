// Audio seam. The session calls these hooks; they are no-ops until an audio module registers itself
// with setAudioHooks() (or passes `audio` to startSession). Keys are free-form, e.g. "tool_hoe",
// "plant", "loot", "error", "door", "place", "interact", "chat".
import type { ZoneId } from "../../shared/types";

export interface AudioHooks {
  playSfx(key: string): void;
  setMusicZone(zone: ZoneId | null): void;
}

const noop: AudioHooks = { playSfx() {}, setMusicZone() {} };
let hooks: AudioHooks = noop;

export function setAudioHooks(h: Partial<AudioHooks> | null): void {
  hooks = h ? { ...noop, ...h } : noop;
}

export function playSfx(key: string): void {
  try {
    hooks.playSfx(key);
  } catch (err) {
    console.warn("playSfx failed", err);
  }
}

export function setMusicZone(zone: ZoneId | null): void {
  try {
    hooks.setMusicZone(zone);
  } catch (err) {
    console.warn("setMusicZone failed", err);
  }
}
