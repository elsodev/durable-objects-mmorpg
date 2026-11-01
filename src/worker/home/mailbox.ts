// The owner's mailbox: letters the home keeps (a visitor helped harvest, an invite was declined,
// furniture that didn't fit after the move) and parcels of items waiting for a free bag slot.
// Pure helpers; HomeRoom stores the lists and sends the "mail" message.
import { MAX_MAIL_NOTES, MAX_NOTE_LEN, type MailNote, type MailServerMsg, type Parcel } from "../../shared/mail";
import { INVITE_TTL_MS, type InviteNotice } from "../../shared/visits";
import type { Inventory, ItemId } from "../../shared/types";
import { addItem } from "../../shared/engine";
import { getItem } from "../../shared/items";

export interface MailState {
  notes: MailNote[];
  parcels: Parcel[];
  /** When the owner last opened the mailbox. */
  readAt: number;
}

export function emptyMail(): MailState {
  return { notes: [], parcels: [], readAt: 0 };
}

export function sanitizeMail(raw: unknown): MailState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<MailState>;
  const notes = (Array.isArray(o.notes) ? o.notes : [])
    .filter((n): n is MailNote => !!n && typeof n.id === "string" && typeof n.text === "string" && typeof n.at === "number")
    .slice(-MAX_MAIL_NOTES)
    .map((n) => ({ id: n.id.slice(0, 32), at: n.at, text: n.text.slice(0, MAX_NOTE_LEN) }));
  const parcels = (Array.isArray(o.parcels) ? o.parcels : [])
    .filter((p): p is Parcel => !!p && !!getItem(p.item) && Number.isInteger(p.qty) && p.qty > 0)
    .slice(0, 24)
    .map((p) => ({ item: p.item, qty: Math.min(p.qty, 999) }));
  return { notes, parcels, readAt: typeof o.readAt === "number" ? o.readAt : 0 };
}

/** Adds a letter (the oldest go once there are too many). */
export function addNote(mail: MailState, text: string, now: number): MailNote {
  const note: MailNote = { id: `n${now.toString(36)}${mail.notes.length}`, at: now, text: text.slice(0, MAX_NOTE_LEN) };
  mail.notes.push(note);
  if (mail.notes.length > MAX_MAIL_NOTES) mail.notes.splice(0, mail.notes.length - MAX_MAIL_NOTES);
  return note;
}

export function addParcel(mail: MailState, item: ItemId, qty = 1): void {
  const p = mail.parcels.find((x) => x.item === item);
  if (p) p.qty += qty;
  else mail.parcels.push({ item, qty });
}

/** When an invite arrived (invites carry only their expiry). */
const inviteAt = (n: InviteNotice) => n.expiresAt - INVITE_TTL_MS;

/** Invites and letters that arrived since the mailbox was last opened; parcels always count. */
export function unreadCount(mail: MailState, invites: readonly InviteNotice[]): number {
  const letters = mail.notes.filter((n) => n.at > mail.readAt).length;
  const fresh = invites.filter((n) => inviteAt(n) > mail.readAt).length;
  return letters + fresh + (mail.parcels.length > 0 ? 1 : 0);
}

export function mailMsg(mail: MailState, invites: InviteNotice[], open = false): MailServerMsg {
  return {
    t: "mail",
    invites: invites.map((n) => ({ ...n })),
    notes: mail.notes.map((n) => ({ ...n })),
    parcels: mail.parcels.map((p) => ({ ...p })),
    unread: unreadCount(mail, invites),
    ...(open ? { open: true } : {}),
  };
}

/** Moves parcels into the bag, one item at a time, as far as it has room. Returns what was taken. */
export function takeParcels(mail: MailState, inv: Inventory): Parcel[] {
  const taken: Parcel[] = [];
  for (const p of mail.parcels) {
    let n = 0;
    while (n < p.qty && addItem(inv, p.item, 1)) n++;
    if (n > 0) taken.push({ item: p.item, qty: n });
    p.qty -= n;
  }
  mail.parcels = mail.parcels.filter((p) => p.qty > 0);
  return taken;
}
