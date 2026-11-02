// A village cat wandering along the bottom of the start screen, drawn from the same sheet the
// game uses. Decoration only: no pointer events, hidden from screen readers, and it sits still
// for viewers who prefer reduced motion. It stops itself once its element leaves the page.
import { CAT_FRAME, CAT_SHEET, catFrame, initialCat, stepCat, stillCat, type CatState } from "./login-cat-logic";

const SHEET_URL = "/assets/lpc/animals/cat_ginger.png";
/** Never step more than this at once, so a background tab doesn't teleport the cat. */
const MAX_DT = 0.1;

function scaleFor(width: number): number {
  return width < 480 ? 2 : 3;
}

export function mountLoginCat(parent: HTMLElement): { destroy(): void } {
  const el = document.createElement("div");
  el.className = "dm-login-cat";
  el.setAttribute("aria-hidden", "true");
  const sprite = document.createElement("div");
  sprite.className = "dm-login-cat-sprite";
  el.appendChild(sprite);
  parent.appendChild(el);

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = window.innerWidth;
  let scale = scaleFor(width);
  let state: CatState = reduced ? stillCat(width, scale) : initialCat(width, scale, Math.random);
  let raf = 0;
  let last = 0;

  const draw = () => {
    const size = CAT_FRAME * scale;
    const { row, col } = catFrame(state);
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translateX(${Math.round(state.x)}px)`;
    sprite.style.backgroundImage = `url("${SHEET_URL}")`;
    sprite.style.backgroundSize = `${CAT_SHEET.w * scale}px ${CAT_SHEET.h * scale}px`;
    sprite.style.backgroundPosition = `${-col * size}px ${-row * size}px`;
  };

  const tick = (now: number) => {
    if (!el.isConnected) return;
    const dt = last ? Math.min(MAX_DT, (now - last) / 1000) : 0;
    last = now;
    state = stepCat(state, dt, width, scale, Math.random);
    draw();
    raf = requestAnimationFrame(tick);
  };

  const onResize = () => {
    width = window.innerWidth;
    scale = scaleFor(width);
    if (reduced) state = stillCat(width, scale);
    draw();
  };
  window.addEventListener("resize", onResize);
  draw();
  if (!reduced) raf = requestAnimationFrame(tick);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      el.remove();
    },
  };
}
