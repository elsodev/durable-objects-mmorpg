// Friendly full-screen error overlay (textContent only; error text may echo server/user data).

export function showFatal(root: HTMLElement, title: string, err?: unknown): void {
  document.getElementById("dmmo-fatal")?.remove();
  const box = document.createElement("div");
  box.id = "dmmo-fatal";
  box.setAttribute("role", "alert");
  Object.assign(box.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "24px",
    background: "rgba(20, 30, 22, 0.94)",
    color: "#f3ecd8",
    fontFamily: "system-ui, sans-serif",
    textAlign: "center",
    zIndex: "1000",
  } satisfies Partial<CSSStyleDeclaration>);

  const h = document.createElement("h2");
  h.textContent = title;
  h.style.margin = "0";
  const p = document.createElement("p");
  p.textContent = friendlyReason(err);
  p.style.maxWidth = "36em";
  p.style.opacity = "0.85";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Try again";
  Object.assign(btn.style, { padding: "8px 18px", fontSize: "1rem", cursor: "pointer" });
  btn.addEventListener("click", () => location.reload());

  box.appendChild(h);
  box.appendChild(p);
  box.appendChild(btn);
  root.appendChild(box);
}

function friendlyReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/webgl|webgpu|context|renderer/i.test(msg)) {
    return "Your browser couldn't start the graphics renderer. Try enabling hardware acceleration or another browser.";
  }
  if (/fetch|network|load/i.test(msg)) return "We couldn't reach the valley. Check your connection and try again.";
  const short = msg.slice(0, 200);
  return short ? `Something went wrong: ${short}` : "Something went wrong while starting the game.";
}
