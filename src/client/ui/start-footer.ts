// Start screen footer: speaker mute toggle and the Credits button.
import { getAudio } from "../audio/player";
import { openCredits } from "./credits";
import { uiSound } from "./sound";

function muteToggle(): HTMLButtonElement | null {
  const audio = getAudio();
  if (!audio) return null;
  const b = document.createElement("button");
  b.type = "button";
  b.id = "auth-mute";
  b.className = "auth-button auth-secondary auth-footer-btn";
  const sync = () => {
    const muted = audio.isMuted();
    b.textContent = muted ? "🔇" : "🔊";
    b.setAttribute("aria-pressed", String(muted));
    b.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    b.title = b.getAttribute("aria-label")!;
  };
  const off = audio.onChange(sync);
  sync();
  b.addEventListener("click", () => {
    const wasMuted = audio.isMuted();
    audio.setMuted(!wasMuted);
    if (wasMuted) audio.playSfx("toggle");
  });
  // The start screen is removed after sign-in; drop the listener with it.
  const obs = new MutationObserver(() => {
    if (!b.isConnected) {
      off();
      obs.disconnect();
    }
  });
  queueMicrotask(() => {
    if (b.isConnected) obs.observe(document.body, { childList: true, subtree: true });
    else off();
  });
  return b;
}

export function startScreenFooter(): HTMLElement {
  const row = document.createElement("div");
  row.className = "auth-footer";
  const mute = muteToggle();
  if (mute) row.appendChild(mute);
  const credits = document.createElement("button");
  credits.type = "button";
  credits.id = "auth-credits";
  credits.className = "auth-button auth-secondary auth-footer-btn";
  credits.textContent = "Credits";
  credits.addEventListener("pointerenter", () => uiSound("hover"));
  credits.addEventListener("click", () => {
    uiSound("click");
    openCredits();
  });
  row.appendChild(credits);
  return row;
}
