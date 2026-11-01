// Client entry: sign in on the start screen, then start the game session.
import { installAudio } from "./audio/player";
import { showFatal } from "./game/errors";
import { startSession } from "./game/session";
import { watchStart } from "./game/start-watch";
import { mountAuth } from "./ui";
import { createLoadingScreen, type LoadingScreen } from "./ui/loading";

/** Audio counts as loaded once its manifest and common sounds are in, or after a short wait. */
function waitForAudio(ready: Promise<void>, loading: LoadingScreen): void {
  void Promise.race([ready, new Promise((r) => setTimeout(r, 4000))]).then(() => loading.done("audio"));
}

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
  const audio = installAudio();
  let loading: LoadingScreen | null = null;
  try {
    const user = await mountAuth(ui);
    stage = "start";
    loading = createLoadingScreen(root);
    waitForAudio(audio.ready(), loading);
    // Canvas text (name tags, signposts) is rasterised once, so the pixel font must be ready first.
    await Promise.race([
      document.fonts?.load('13px "Pixelify Sans"').catch(() => undefined),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    // A renderer that never initialises, or a first connection that never comes up, would
    // otherwise leave a blank page: after 15 s say which one we're waiting on.
    const watch = watchStart(root);
    let ready = false;
    try {
      const session = await startSession({ game, ui }, user, {
        loading,
        onReady: () => {
          ready = true;
          watch.done();
        },
      });
      if (!ready) watch.stage("connection");
      window.addEventListener("pagehide", () => session.destroy(), { once: true });
    } catch (err) {
      watch.done();
      throw err;
    }
  } catch (err) {
    console.error(err);
    loading?.destroy();
    showFatal(root, stage === "sign in" ? "Couldn't sign you in" : "Mossbrook couldn't start", err);
  }
}

void main();
