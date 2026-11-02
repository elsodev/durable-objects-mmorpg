// Right-click menu on a bag or hotbar slot: which choices it offers for a stack.

export interface SlotMenuChoice {
  label: string;
  /** How many to drop (or put in the trade); null means the whole stack. */
  qty: number | null;
  /** What the choice does; absent means drop. */
  action?: "drop" | "trade";
}

/** While a trade window is open: "Add to trade" for one, else Add 1 / Add 10 / Add all (n). */
export function tradeMenuChoices(qty: number): SlotMenuChoice[] {
  if (!(qty > 1)) return [{ label: "Add to trade", qty: null, action: "trade" }];
  const out: SlotMenuChoice[] = [{ label: "Add 1 to trade", qty: 1, action: "trade" }];
  if (qty > 10) out.push({ label: "Add 10 to trade", qty: 10, action: "trade" });
  out.push({ label: `Add all (${qty}) to trade`, qty: null, action: "trade" });
  return out;
}

/** "Drop" for one item; "Drop 1" and "Drop all (n)" for a stack. */
export function slotMenuChoices(qty: number): SlotMenuChoice[] {
  if (!(qty > 1)) return [{ label: "Drop", qty: null }];
  return [
    { label: "Drop 1", qty: 1 },
    { label: `Drop all (${qty})`, qty: null },
  ];
}

/** Keeps a `w`×`h` menu opened at (x, y) inside a `vw`×`vh` viewport, 4px from the edges. */
export function menuPosition(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  const pad = 4;
  return {
    x: Math.max(pad, Math.min(x, vw - w - pad)),
    y: Math.max(pad, Math.min(y, vh - h - pad)),
  };
}
