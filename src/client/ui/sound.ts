// UI sound hook shared by every DOM UI module. Silent until the audio module installs a player.
export type UiSoundKey = "click" | "hover" | "open" | "close" | "tab" | "confirm" | "error" | "select";

let player: ((key: string) => void) | null = null;

export function setUiSoundPlayer(fn: ((key: string) => void) | null): void {
  player = fn;
}

export function uiSound(key: UiSoundKey | (string & {})): void {
  if (!player) return;
  try {
    player(key);
  } catch {
    // A broken sound must never break the UI.
  }
}
