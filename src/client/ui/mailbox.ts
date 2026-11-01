// Mailbox panel (#mailbox-panel), opened by interacting with the mailbox beside your house:
// home invites waiting for an answer, friend requests (read from /api/friends), letters and
// parcels. Raises the mailbox flag (onFlag) while something is unread. Every name and letter is
// untrusted text: textContent only.
import type { FriendRequestEntry } from "../../shared/friends";
import type { MailServerMsg } from "../../shared/mail";
import type { InviteNotice } from "../../shared/visits";
import { friendsApi as defaultApi, type FriendsApi } from "./friends-api";
import { itemLabel } from "./homeui";
import { ago, expiresIn, flagUp, loadSeen, requestKey, saveSeen } from "./mailbox-logic";
import { uiSound } from "./sound";
import "./styles/mailbox.css";

export interface MailboxUiOpts {
  acceptInvite(n: InviteNotice): void;
  declineInvite(n: InviteNotice): void;
  /** "Take" on the parcels: asks the server to move them into the bag. */
  takeParcels(): void;
  notice(text: string, kind: "info" | "error" | "loot"): void;
  /** Flag on the mailbox prop. */
  onFlag(up: boolean): void;
  now(): number;
  isGuest(): boolean;
  api?: FriendsApi;
}

export interface MailboxUi {
  /** Server mailbox contents; opens the panel when msg.open. */
  set(msg: MailServerMsg): void;
  /** Re-reads friend requests (on arriving in the yard) to update the flag. */
  refreshRequests(): Promise<void>;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

function btn(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `dm-btn dm-btn-small ${className}`.trim(), text);
  b.type = "button";
  b.addEventListener("pointerenter", () => uiSound("hover"));
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    uiSound("click");
    onClick();
  });
  return b;
}

export function createMailboxUi(root: HTMLElement, opts: MailboxUiOpts): MailboxUi {
  const api = opts.api ?? defaultApi;
  const panel = el("div", "dm-panel mb-panel");
  panel.id = "mailbox-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Mailbox");
  const head = el("div", "dm-panel-header");
  add(head, el("span", "dm-title", "Mailbox"), btn("✕", "dm-close", () => close()));
  const body = el("div", "mb-body");
  add(panel, head, body);
  root.appendChild(panel);

  let mail: MailServerMsg = { t: "mail", invites: [], notes: [], parcels: [], unread: 0 };
  let requests: FriendRequestEntry[] = [];
  const seen = loadSeen();

  const syncFlag = () => opts.onFlag(flagUp(panel.hidden ? mail.unread : 0, requests, seen));

  function section(title: string, count: number): HTMLElement {
    const s = el("section", "mb-section");
    s.appendChild(el("h3", "mb-heading", count > 0 ? `${title} (${count})` : title));
    body.appendChild(s);
    return s;
  }

  function row(parent: HTMLElement, main: string, sub: string, ...buttons: HTMLButtonElement[]): void {
    const li = el("div", "mb-row");
    const text = el("div", "mb-text");
    add(text, el("div", "mb-main", main), el("div", "mb-sub", sub));
    const acts = el("div", "mb-actions");
    add(acts, ...buttons);
    add(li, text, acts);
    parent.appendChild(li);
  }

  function render(): void {
    body.replaceChildren();
    const now = opts.now();
    const invites = mail.invites.filter((n) => n.expiresAt > now);
    const inv = section("Home invites", invites.length);
    if (invites.length === 0) inv.appendChild(el("p", "mb-empty", "No invites right now."));
    for (const n of invites) {
      row(
        inv,
        `${n.fromName} invited you over`,
        expiresIn(n.expiresAt, now),
        btn("Visit", "dm-btn-primary", () => {
          close();
          opts.acceptInvite(n);
        }),
        btn("No thanks", "", () => {
          mail = { ...mail, invites: mail.invites.filter((x) => x.fromId !== n.fromId) };
          opts.declineInvite(n);
          render();
        }),
      );
    }

    const fr = section("Friend requests", requests.length);
    if (opts.isGuest()) fr.appendChild(el("p", "mb-empty", "Create an account to make friends."));
    else if (requests.length === 0) fr.appendChild(el("p", "mb-empty", "No new friend requests."));
    for (const r of requests) {
      const answer = (accept: boolean) => async () => {
        const res = await api.respond(r.userId, accept);
        if (!res.ok) return opts.notice(res.error, "error");
        opts.notice(accept ? `You and ${r.name} are now friends.` : `Declined ${r.name}'s request.`, "info");
        requests = requests.filter((x) => x.userId !== r.userId);
        render();
        syncFlag();
      };
      row(fr, `${r.name} wants to be friends`, ago(r.at, now), btn("Accept", "dm-btn-primary", answer(true)), btn("Decline", "", answer(false)));
    }

    if (mail.parcels.length > 0) {
      const pc = section("Parcels", mail.parcels.length);
      const names = mail.parcels.map((p) => `${itemLabel(p.item).name} ×${p.qty}`).join(", ");
      row(pc, names, "Waiting for room in your bag", btn("Take", "dm-btn-primary", () => opts.takeParcels()));
    }

    const notes = [...mail.notes].reverse();
    const lt = section("Letters", 0);
    if (notes.length === 0) lt.appendChild(el("p", "mb-empty", "No letters yet."));
    for (const n of notes) {
      const li = el("div", "mb-letter");
      add(li, el("div", "mb-letter-text", n.text), el("div", "mb-sub", ago(n.at, now)));
      lt.appendChild(li);
    }
  }

  async function refreshRequests(): Promise<void> {
    if (opts.isGuest()) {
      requests = [];
      return syncFlag();
    }
    const res = await api.list();
    if (res.ok) requests = res.data.incoming ?? [];
    if (!panel.hidden) {
      for (const r of requests) seen.add(requestKey(r));
      saveSeen(seen);
      render();
    }
    syncFlag();
  }

  function open(): void {
    const wasHidden = panel.hidden;
    panel.hidden = false;
    if (wasHidden) uiSound("open");
    render();
    void refreshRequests();
  }

  function close(): void {
    if (panel.hidden) return;
    panel.hidden = true;
    // Opening read everything that was listed.
    mail = { ...mail, unread: 0 };
    syncFlag();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !panel.hidden) close();
  };
  window.addEventListener("keydown", onKey);

  return {
    set(msg) {
      mail = msg;
      if (msg.open) open();
      else if (!panel.hidden) render();
      syncFlag();
    },
    refreshRequests,
    close,
    isOpen: () => !panel.hidden,
    destroy() {
      window.removeEventListener("keydown", onKey);
      panel.remove();
    },
  };
}
