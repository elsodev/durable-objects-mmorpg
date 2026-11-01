// The mailbox beside the player's house: home invites waiting for an answer, letters (notices
// the home kept for its owner) and parcels (things that need a free bag slot to collect).
// Friend requests are listed too, but the client reads those from /api/friends itself.
import type { ItemId } from "./types";
import type { InviteNotice } from "./visits";

/** Letters kept per home (oldest dropped first). */
export const MAX_MAIL_NOTES = 20;
export const MAX_NOTE_LEN = 200;

export interface MailNote {
  id: string;
  /** Server time it arrived. */
  at: number;
  text: string;
}

export interface Parcel {
  item: ItemId;
  qty: number;
}

export type MailServerMsg =
  /**
   * Mailbox contents. Sent when the owner arrives in the yard (for the flag) and whenever it
   * changes; `open` asks the client to show the panel. `unread` counts invites and letters that
   * arrived after the owner last opened the mailbox.
   */
  {
    t: "mail";
    invites: InviteNotice[];
    notes: MailNote[];
    parcels: Parcel[];
    unread: number;
    open?: boolean;
  };

/** Interact targets on the mailbox prop: open it, or take the parcels out. */
export const MAILBOX_ID = "mailbox";
export const MAILBOX_TAKE = "mailbox:take";
