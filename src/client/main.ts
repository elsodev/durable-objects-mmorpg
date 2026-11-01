// Client entry: sign in on the start screen, then start the game session.
import { installAudio } from "./audio/player";
import { showFatal } from "./game/errors";
import { startSession } from "./game/session";
import { mountAuth } from "./ui";

function ensureChild(parent: HTMLElement, id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found) return found;
  const el = document.createElement("div");
  el.id = id;
  parent.appendChild(el);
  return el;
}

async function main(): Promise<void> {
  const root = document.getElementById("app") ?? document.body;
  // index.html provides #game and #ui; create them if an older page doesn't.
  const game = ensureChild(root, "game");
  const ui = ensureChild(root, "ui");
  let stage = "sign in";
  // Before auth so the start screen's UI sounds and title music work.
  installAudio();
  try {
    const user = await mountAuth(ui);
    stage = "start";
    // Canvas text (name tags, signposts) is rasterised once, so the pixel font must be ready first.
    await Promise.race([
      document.fonts?.load('13px "Pixelify Sans"').catch(() => undefined),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    const session = await startSession({ game, ui }, user);
    window.addEventListener("pagehide", () => session.destroy(), { once: true });
  } catch (err) {
    console.error(err);
    showFatal(root, stage === "sign in" ? "Couldn't sign you in" : "Mossbrook couldn't start", err);
  }
}

void main();
