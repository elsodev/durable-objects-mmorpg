// Right-click menu on a bag or hotbar slot: which choices it offers for a stack.

export interface SlotMenuChoice {
  label: string;
  /** How many to drop; null drops the whole stack. */
  qty: number | null;
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
