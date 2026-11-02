// Global announcement banner (#shout-banner): an admin's /shout, centred at the top of the screen,
// scrolling as a marquee between a rising chime (start) and a falling one (end). Anyone can close it
// with the ✕ (no end chime then: they asked for quiet). With prefers-reduced-motion the text sits
// still and wraps. Text and the admin's name are untrusted: textContent only.
import type { Shout } from "../../shared/admin";
import { isNewShout, marqueeTiming, SEEN_KEY, showMs, shoutTitle, staticMs } from "./shout-banner-logic";
import { uiSound } from "./sound";
import "./styles/shout.css";

export interface ShoutBanner {
  show(s: Shout): void;
  close(): void;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const LEAVE_MS = 260;

/** A little pixel bell, drawn from rects so it stays crisp at any zoom. */
function bellIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("shout-bell");
  const px: [number, number, number, number, string][] = [
    [5, 0, 2, 1, "#8a5a34"],
    [4, 1, 4, 1, "#e8b33a"],
    [3, 2, 6, 1, "#e8b33a"],
    [3, 3, 6, 3, "#e8b33a"],
    [2, 6, 8, 2, "#e8b33a"],
    [1, 8, 10, 1, "#b8860b"],
    [5, 9, 2, 2, "#8a5a34"],
    [4, 2, 1, 4, "#fbe7a6"],
  ];
  for (const [x, y, w, h, fill] of px) {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(h));
    r.setAttribute("fill", fill);
    svg.appendChild(r);
  }
  return svg;
}

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    // private mode: the in-memory copy still stops repeats this session
  }
}

export function createShoutBanner(
  root: HTMLElement,
  opts: {
    reducedMotion?: () => boolean;
    /** Screen y for the banner's top edge (below the HUD's top menu); CSS decides when absent. */
    top?: () => number | null;
  } = {},
): ShoutBanner {
  const reduced = opts.reducedMotion ?? (() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const box = document.createElement("div");
  box.id = "shout-banner";
  box.className = "shout-banner";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.hidden = true;

  const icon = document.createElement("div");
  icon.className = "shout-icon";
  icon.appendChild(bellIcon());
  const body = document.createElement("div");
  body.className = "shout-body";
  const title = document.createElement("div");
  title.className = "shout-title";
  title.id = "shout-title";
  const track = document.createElement("div");
  track.className = "shout-track";
  const text = document.createElement("span");
  text.className = "shout-text";
  text.id = "shout-text";
  track.appendChild(text);
  body.appendChild(title);
  body.appendChild(track);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "dm-close shout-close";
  close.id = "shout-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss announcement");
  close.title = "Dismiss";
  box.appendChild(icon);
  box.appendChild(body);
  box.appendChild(close);
  root.appendChild(box);

  let seen = readSeen();
  let showing: Shout | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (endTimer) clearTimeout(endTimer);
    if (leaveTimer) clearTimeout(leaveTimer);
    endTimer = leaveTimer = null;
  };

  function hide(withChime: boolean): void {
    if (!showing) return;
    seen = showing.id;
    writeSeen(showing.id);
    showing = null;
    clearTimers();
    if (withChime) uiSound("announce_end");
    box.classList.remove("is-in");
    box.classList.add("is-out");
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      if (!showing) box.hidden = true;
    }, LEAVE_MS);
  }

  function startMarquee(): number {
    const still = reduced();
    box.classList.toggle("is-static", still);
    text.style.animation = "none";
    if (still) return staticMs(text.textContent ?? "");
    const t = marqueeTiming(track.clientWidth, text.scrollWidth);
    text.style.setProperty("--shout-from", `${t.fromPx}px`);
    text.style.setProperty("--shout-to", `${t.toPx}px`);
    text.style.transform = `translateX(${t.fromPx}px)`;
    // Restart the animation from its first frame for a new shout.
    void text.offsetWidth;
    text.style.animation = `dm-shout-scroll ${t.passMs}ms linear 0s ${showMs(t) / t.passMs} both`;
    return showMs(t);
  }

  close.addEventListener("click", (e) => {
    e.stopPropagation();
    uiSound("click");
    hide(false);
  });
  // The banner sits over the game: clicks on it never walk or swing a tool.
  box.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    show(s) {
      if (!isNewShout(s, seen, showing?.id ?? null)) return;
      clearTimers();
      showing = s;
      title.textContent = shoutTitle(s);
      text.textContent = s.text;
      box.setAttribute("aria-label", `${shoutTitle(s)}: ${s.text}`);
      const top = opts.top?.() ?? null;
      box.style.top = top !== null ? `${Math.round(top)}px` : "";
      box.hidden = false;
      box.classList.remove("is-out");
      box.classList.remove("is-in");
      void box.offsetWidth;
      box.classList.add("is-in");
      uiSound("announce_start");
      const ms = startMarquee();
      const id = s.id;
      endTimer = setTimeout(() => {
        endTimer = null;
        if (showing?.id === id) hide(true);
      }, ms);
    },
    close: () => hide(false),
    destroy() {
      clearTimers();
      box.remove();
    },
  };
}
