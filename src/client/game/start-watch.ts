// Start-up watchdog: if the renderer or the first connection hasn't come up in time, say so on
// screen (and in the console) instead of leaving a blank page. A loading screen can replace the
// text; this only sets it.

export const START_TIMEOUT_MS = 15_000;

export type StartStage = "renderer" | "connection";

export function startStatusText(stage: StartStage): string {
  return stage === "renderer"
    ? "Still starting… the graphics renderer hasn't come up. Try reloading, or turn on hardware acceleration."
    : "Still connecting to Mossbrook… check your connection, or reload to try again.";
}

export interface StartWatch {
  /** The stage start-up is waiting on now. */
  stage(s: StartStage): void;
  /** Start-up finished: cancel the timer and clear any status text. */
  done(): void;
}

export function watchStart(root: HTMLElement, timeoutMs = START_TIMEOUT_MS): StartWatch {
  let stage: StartStage = "renderer";
  let el: HTMLElement | null = null;
  const timer = setTimeout(() => {
    console.error(`[dmmo] start-up timed out after ${timeoutMs} ms waiting for the ${stage}`);
    el = document.createElement("p");
    el.id = "dmmo-start-status";
    el.setAttribute("role", "status");
    el.textContent = startStatusText(stage);
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      top: "45%",
      transform: "translate(-50%, -50%)",
      maxWidth: "min(32em, calc(100vw - 32px))",
      margin: "0",
      padding: "12px 16px",
      borderRadius: "8px",
      background: "rgba(20, 30, 22, 0.9)",
      color: "#f3ecd8",
      fontFamily: "system-ui, sans-serif",
      textAlign: "center",
      zIndex: "999",
    } satisfies Partial<CSSStyleDeclaration>);
    root.appendChild(el);
  }, timeoutMs);
  return {
    stage(s) {
      stage = s;
      if (el) el.textContent = startStatusText(s);
    },
    done() {
      clearTimeout(timer);
      el?.remove();
      el = null;
    },
  };
}
