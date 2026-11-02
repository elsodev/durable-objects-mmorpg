// Shop purchase feedback: the price floats up from the Buy button and the HUD's bag icon gives a
// little bounce, as if the item dropped into it.
import "./styles/buy-fx.css";

/** The HUD listens for this and shakes its bag button. Keeps the shop from reaching into the HUD. */
export const BAG_BUMP_EVENT = "dmmo:bag-bump";

export function bumpBag(): void {
  document.dispatchEvent(new CustomEvent(BAG_BUMP_EVENT));
}

/** Replays a one-shot CSS animation class on `node`. */
export function replayClass(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth; // restart the animation
  node.classList.add(cls);
  node.addEventListener("animationend", () => node.classList.remove(cls), { once: true });
}

export function floatCost(anchor: HTMLElement, coins: number): void {
  const r = anchor.getBoundingClientRect();
  if (r.width === 0) return;
  const tag = document.createElement("div");
  tag.className = "buy-fx-cost";
  tag.setAttribute("aria-hidden", "true");
  const coin = document.createElement("span");
  coin.className = "dm-coin";
  tag.appendChild(document.createTextNode(`-${coins}`));
  tag.appendChild(coin);
  tag.style.left = `${r.left + r.width / 2}px`;
  tag.style.top = `${r.top}px`;
  document.body.appendChild(tag);
  tag.addEventListener("animationend", () => tag.remove(), { once: true });
  setTimeout(() => tag.remove(), 1500); // reduced motion: no animationend
}
