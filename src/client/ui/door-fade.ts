// Short fade to black through the house door: cover() when you step onto the door (predicted),
// reveal() once the other side's welcome has been drawn. A cover that never gets its welcome
// lifts by itself, so a refused door can't leave the screen black.
import "./styles/mailbox.css";

export const FADE_MS = 180;
const STUCK_MS = 1500;

export interface DoorFade {
  cover(): void;
  reveal(): void;
  covered(): boolean;
  destroy(): void;
}

export function createDoorFade(root: HTMLElement): DoorFade {
  const veil = document.createElement("div");
  veil.className = "door-fade";
  veil.id = "door-fade";
  root.appendChild(veil);
  let on = false;
  let stuck: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (stuck) clearTimeout(stuck);
    stuck = null;
  };
  const api: DoorFade = {
    cover() {
      if (on) return;
      on = true;
      veil.classList.add("is-on");
      clear();
      stuck = setTimeout(() => api.reveal(), STUCK_MS);
    },
    reveal() {
      clear();
      if (!on) {
        // Not covered (e.g. the server moved you): flash dark, then fade in.
        veil.classList.add("is-on", "is-instant");
        void veil.offsetWidth;
        veil.classList.remove("is-instant");
      }
      on = false;
      requestAnimationFrame(() => veil.classList.remove("is-on"));
    },
    covered: () => on,
    destroy() {
      clear();
      veil.remove();
    },
  };
  return api;
}
