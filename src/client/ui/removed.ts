// "You've been removed from Mossbrook." A full-screen card shown when an admin kicked this account
// (or this browser / address is still banned). It replaces everything and offers no way back in.
import { REMOVED_TEXT } from "../../shared/admin";
import "./styles/removed.css";

export const REMOVED_ID = "dmmo-removed";

export function showRemoved(root: HTMLElement = document.body): HTMLElement {
  const old = document.getElementById(REMOVED_ID);
  if (old) return old;
  const screen = document.createElement("div");
  screen.id = REMOVED_ID;
  screen.className = "removed-screen";
  screen.setAttribute("role", "alertdialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-labelledby", "removed-title");
  const card = document.createElement("div");
  card.className = "dm-panel removed-card";
  const sign = document.createElement("div");
  sign.className = "removed-sign";
  sign.setAttribute("aria-hidden", "true");
  sign.textContent = "Closed";
  const title = document.createElement("h2");
  title.id = "removed-title";
  title.className = "removed-title";
  title.textContent = REMOVED_TEXT;
  const p = document.createElement("p");
  p.className = "removed-text";
  p.textContent = "An admin has closed the gate to the valley for this account. You can't play here any more.";
  card.appendChild(sign);
  card.appendChild(title);
  card.appendChild(p);
  screen.appendChild(card);
  root.appendChild(screen);
  return screen;
}

/** True when GET /api/standing says this account or browser was removed (network trouble: false). */
export async function checkRemoved(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn("/api/standing", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 451) return true;
    const body = (await res.json()) as { removed?: unknown };
    return body?.removed === true;
  } catch {
    return false;
  }
}
