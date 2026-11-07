// Tracks the visible height (it shrinks when the phone keyboard opens, which 100vh and 100dvh
// ignore on iOS) in the --dm-vvh CSS variable, so full-screen sheets keep their input in view.
let installed = false;

export function trackVisualViewport(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const vv = window.visualViewport;
  const root = document.documentElement;
  const sync = () => {
    const h = vv?.height ?? window.innerHeight;
    if (h > 0) root.style.setProperty("--dm-vvh", `${Math.round(h)}px`);
  };
  sync();
  (vv ?? window).addEventListener("resize", sync);
}
