// The level panel (#hud-level, top right under the menu): a gold badge with your level and the XP
// bar toward the next one. XP from a kill slides the bar along with a "+8 XP" chip; a level-up
// runs it to full, pops the badge and refills from empty. Numbers come from the server only.
import { barSteps, BAR_STEP_MS, gainText, levelTitle, xpText, type LevelView } from "./level-badge-logic";
import { replayClass } from "./buy-fx";
import "./styles/level.css";

export interface LevelBadge {
  readonly el: HTMLElement;
  set(view: LevelView, gain?: number): void;
}

function span(className: string, text = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = className;
  if (text) s.textContent = text;
  return s;
}

export function createLevelBadge(parent: HTMLElement, reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches): LevelBadge {
  const root = document.createElement("div");
  root.id = "hud-level";
  root.className = "dm-panel hud-level";
  root.hidden = true;
  const badge = span("hud-level-badge");
  const num = span("hud-level-num", "1");
  num.id = "hud-level-num";
  badge.appendChild(span("hud-level-lv", "LV"));
  badge.appendChild(num);
  const body = span("hud-level-body");
  const track = span("hud-level-track");
  const fill = span("hud-level-fill");
  fill.id = "hud-xp-fill";
  track.appendChild(fill);
  const text = span("hud-level-text", "0 / 25 XP");
  text.id = "hud-xp-text";
  const chip = span("hud-level-gain");
  chip.id = "hud-xp-gain";
  chip.setAttribute("aria-hidden", "true");
  body.appendChild(track);
  body.appendChild(text);
  root.appendChild(badge);
  root.appendChild(body);
  root.appendChild(chip);
  root.setAttribute("role", "group");
  parent.appendChild(root);

  let shown: LevelView | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];

  function setFill(to: number, animate: boolean): void {
    fill.classList.toggle("is-instant", !animate);
    fill.style.width = `${Math.round(to * 1000) / 10}%`;
  }

  return {
    el: root,
    set(view, gain) {
      root.hidden = false;
      const prev = shown;
      shown = view;
      const r = reduced();
      for (const t of timers) clearTimeout(t);
      timers = [];
      barSteps(prev, view, r).forEach((s, i) => {
        if (i === 0) setFill(s.to, s.animate);
        else timers.push(setTimeout(() => setFill(s.to, s.animate), BAR_STEP_MS * i));
      });
      text.textContent = xpText(view);
      root.title = levelTitle(view);
      root.setAttribute("aria-label", `Level ${view.level}, ${xpText(view)}`);
      const up = prev !== null && view.level > prev.level;
      // The number changes as the bar tops out, so the pop lands with it.
      const showLevel = () => {
        num.textContent = String(view.level);
        if (up && !r) replayClass(badge, "is-up");
      };
      if (up && !r) timers.push(setTimeout(showLevel, BAR_STEP_MS));
      else showLevel();
      const g = gainText(gain);
      if (g && prev) {
        chip.textContent = g;
        replayClass(chip, "is-on");
        if (!r) replayClass(track, "is-gain");
      }
    },
  };
}
