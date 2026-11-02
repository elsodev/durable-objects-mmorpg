// Loading screen: plain DOM shown while the renderer, art, audio and first zone load (Pixi is not
// ready yet, so it can't be drawn in the canvas), and briefly while switching zones.
import "./styles/loading.css";
import { createLogoHeading } from "./logo";
import { LOAD_STEPS, OUTDATED_LABEL, loadLabel, loadProgress, zoneLoadLabel, zoneProgress, type LoadStep, type ZoneStage } from "./loading-logic";

export interface LoadingScreen {
  /** A first-load step finished. */
  done(step: LoadStep): void;
  /** Show the short zone-change variant (no-op while the first load is still showing). */
  zone(name: string | null | undefined): void;
  /** A zone change moved on (socket open, welcome in). No-op unless a zone change is showing. */
  zoneStep(stage: ZoneStage): void;
  /** The server wants a map this page doesn't have: stay up and offer a refresh. */
  outdated(): void;
  /** The world is on screen: fade out. */
  ready(): void;
  readonly visible: boolean;
  destroy(): void;
}

const FADE_MS = 350;

function div(className: string, text?: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function createLoadingScreen(parent: HTMLElement): LoadingScreen {
  const root = div("dm-loading");
  root.id = "loading";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const card = div("dm-loading-card");
  const title = createLogoHeading({ className: "dm-loading-title" });
  const tagline = div("dm-loading-tagline", "A cozy farming valley");

  // A little sprout that sways while it waits (pure CSS, see loading.css).
  const sprout = div("dm-loading-sprout");
  sprout.setAttribute("aria-hidden", "true");
  for (const part of ["dm-sprout-stem", "dm-sprout-leaf left", "dm-sprout-leaf right", "dm-sprout-soil"]) sprout.appendChild(div(part));

  const bar = div("dm-loading-bar");
  const fill = div("dm-loading-fill");
  bar.appendChild(fill);
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(LOAD_STEPS.length));
  const label = div("dm-loading-label");

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "dm-btn dm-loading-refresh";
  refresh.textContent = "Refresh";
  refresh.hidden = true;
  refresh.addEventListener("click", () => location.reload());

  for (const child of [sprout, title, tagline, bar, label, refresh]) card.appendChild(child);
  root.appendChild(card);
  parent.appendChild(root);

  const doneSteps = new Set<LoadStep>();
  let firstLoad = true;
  let visible = true;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let zoneShowing = false;
  let stuck = false;

  const setBar = (fraction: number, animate = true) => {
    // Jumping back to the start of a new trip shouldn't slide backwards.
    fill.style.transition = animate ? "" : "none";
    fill.style.width = `${Math.round(fraction * 100)}%`;
    if (!animate) void fill.offsetWidth;
    fill.style.transition = "";
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  };

  const render = () => {
    const p = loadProgress(doneSteps);
    fill.style.width = `${Math.round(p * 100)}%`;
    bar.setAttribute("aria-valuenow", String(doneSteps.size));
    label.textContent = loadLabel(doneSteps);
  };
  render();

  const show = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    root.hidden = false;
    // Next frame, so the opacity transition runs from the hidden state.
    requestAnimationFrame(() => root.classList.remove("is-leaving"));
    visible = true;
  };

  return {
    done(step) {
      doneSteps.add(step);
      if (firstLoad) render();
    },
    zone(name) {
      if (stuck || (firstLoad && visible)) return;
      root.classList.add("is-zone");
      label.textContent = zoneLoadLabel(name);
      zoneShowing = true;
      setBar(zoneProgress("leaving"), false);
      show();
    },
    zoneStep(stage) {
      if (!zoneShowing || stuck) return;
      setBar(zoneProgress(stage));
    },
    outdated() {
      stuck = true;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      root.classList.add("is-zone", "is-outdated");
      label.textContent = OUTDATED_LABEL;
      refresh.hidden = false;
      show();
    },
    ready() {
      if (stuck) return;
      if (zoneShowing) {
        zoneShowing = false;
        setBar(zoneProgress("shown"));
      }
      if (firstLoad) {
        firstLoad = false;
        for (const s of LOAD_STEPS) doneSteps.add(s.id);
        render();
      }
      if (!visible) return;
      visible = false;
      root.classList.add("is-leaving");
      hideTimer = setTimeout(() => {
        root.hidden = true;
        root.classList.add("is-zone"); // later showings are the short zone-change kind
      }, FADE_MS);
    },
    get visible() {
      return visible;
    },
    destroy() {
      if (hideTimer) clearTimeout(hideTimer);
      root.remove();
    },
  };
}
