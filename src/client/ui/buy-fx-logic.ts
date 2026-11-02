// When the shop shows "the coins left your wallet": only once the server's new inventory proves it.

/** A Buy press waiting for the server's answer. */
export interface PendingBuy {
  total: number;
  coinsBefore: number;
  /** ms timestamp of the press; an answer this late is from something else. */
  at: number;
}

export const BUY_FX_WAIT_MS = 3000;

/** The coins actually spent by `pending`, or 0 when this update isn't its answer (reject, timeout). */
export function spentOnBuy(pending: PendingBuy | null, coinsNow: number, now: number): number {
  if (!pending || now - pending.at > BUY_FX_WAIT_MS) return 0;
  const spent = pending.coinsBefore - coinsNow;
  return spent > 0 ? spent : 0;
}
