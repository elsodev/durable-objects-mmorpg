// UI sound hook shared by every DOM UI module. Silent until the audio module installs a player.
export type UiSoundKey = "click" | "hover" | "open" | "close" | "tab" | "confirm" | "error" | "select";

let player: ((key: string) => void) | null = null;
let quiet = 0;

/** Runs `fn` with UI sounds muted (a container that plays its own sound drives a panel). */
export function quietly<T>(fn: () => T): T {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}

export function setUiSoundPlayer(fn: ((key: string) => void) | null): void {
  player = fn;
}

export function uiSound(key: UiSoundKey | (string & {})): void {
  if (!player || quiet > 0) return;
  try {
    player(key);
  } catch {
    // A broken sound must never break the UI.
  }
}
