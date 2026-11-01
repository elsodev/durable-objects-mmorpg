// Friends panel (#friends-panel, O key / HUD "Friends" button): friends with online dot and zone,
// incoming and outgoing requests, add by name. Refreshes every 20 s while open and whenever the
// social socket pushes a friend notice (via ../social-events). Names are untrusted: textContent only.
import type { FriendEntry, FriendRequestEntry, FriendsList } from "../../shared/friends";
import { FRIEND_NOTICE_TYPES, MAX_FRIENDS } from "../../shared/friends";
import { onSocial } from "../social-events";
import { friendsApi as defaultApi, type FriendsApi } from "./friends-api";
import { addNameError, badgeText, CONFIRM_MS, FRIENDS_POLL_MS, inviteCommand, whisperPrefill, zoneLabel } from "./friends-logic";
import { uiSound } from "./sound";
import "./styles/friends.css";

export interface FriendsPanel {
  toggle(): void;
  open(tab?: Tab): void;
  close(): void;
  isOpen(): boolean;
  /** Sends a friend request by name (chat `/friend name`, player menu). */
  addByName(name: string): Promise<void>;
  refresh(): Promise<void>;
}

export interface FriendsPanelOpts {
  /** Sends a chat line as typed (e.g. "/invite name"). */
  sendChat(text: string): void;
  /** Puts text in the chat input and focuses it. */
  prefillChat(text: string): void;
  notice(text: string, kind: "info" | "error" | "loot"): void;
  isGuest(): boolean;
  /** Guest upgrade prompt. */
  askAccount(): void;
  /** Incoming request count changed (HUD button badge). */
  onBadge?(count: number): void;
  api?: FriendsApi;
}

type Tab = "friends" | "requests";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// appendChild only: the combined tsconfig merges Workers' HTMLRewriter Element into DOM Element,
// which breaks the typing of Element.append.
function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

function btn(text: string, className: string, onClick: (b: HTMLButtonElement) => void, sound = "click"): HTMLButtonElement {
  const b = el("button", `dm-btn dm-btn-small ${className}`.trim(), text);
  b.type = "button";
  b.addEventListener("pointerenter", () => uiSound("hover"));
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (sound) uiSound(sound);
    onClick(b);
  });
  return b;
}

export function createFriendsPanel(root: HTMLElement, opts: FriendsPanelOpts): FriendsPanel {
  const api = opts.api ?? defaultApi;

  const panel = el("div", "dm-panel fr-panel");
  panel.id = "friends-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Friends");

  const header = el("div", "dm-panel-header");
  const title = el("h2", "dm-title", "Friends");
  const closeBtn = el("button", "dm-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  add(header, title, closeBtn);

  const tabs = el("div", "fr-tabs");
  tabs.setAttribute("role", "tablist");
  const tabFriends = el("button", "fr-tab", "Friends");
  const tabRequests = el("button", "fr-tab");
  const reqLabel = el("span", "", "Requests");
  const reqBadge = el("span", "fr-badge");
  reqBadge.id = "friends-requests-badge";
  add(tabRequests, reqLabel, reqBadge);
  tabFriends.id = "friends-tab-friends";
  tabRequests.id = "friends-tab-requests";
  for (const [b, t] of [
    [tabFriends, "friends"],
    [tabRequests, "requests"],
  ] as const) {
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("pointerenter", () => uiSound("hover"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tab !== t) uiSound("tab");
      setTab(t);
    });
  }
  add(tabs, tabFriends, tabRequests);

  const addForm = el("form", "fr-add");
  const addInput = el("input", "dm-input fr-add-input");
  addInput.id = "friends-add-input";
  addInput.type = "text";
  addInput.maxLength = 16;
  addInput.autocomplete = "off";
  addInput.spellcheck = false;
  addInput.placeholder = "Player name";
  addInput.setAttribute("aria-label", "Player name to add");
  const addBtn = el("button", "dm-btn dm-btn-primary dm-btn-small", "Add friend");
  addBtn.id = "friends-add-btn";
  addBtn.type = "submit";
  addBtn.addEventListener("pointerenter", () => uiSound("hover"));
  add(addForm, addInput, addBtn);
  const msg = el("div", "fr-msg");
  msg.id = "friends-msg";
  msg.setAttribute("aria-live", "polite");

  const body = el("div", "fr-body");
  add(panel, header, tabs, addForm, msg, body);
  root.appendChild(panel);

  let tab: Tab = "friends";
  let data: FriendsList | null = null;
  let loadError: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> | null = null;

  // Typing here must not move the player or fire HUD hotkeys.
  for (const type of ["keydown", "keyup"] as const) {
    addInput.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === "keydown" && (e as KeyboardEvent).key === "Escape") addInput.blur();
    });
  }
  addInput.addEventListener("input", () => showMsg(""));
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void addByName(addInput.value);
  });

  function showMsg(text: string, kind: "ok" | "error" | "" = ""): void {
    msg.textContent = text;
    msg.dataset.kind = kind;
  }

  function setTab(t: Tab): void {
    tab = t;
    tabFriends.setAttribute("aria-selected", String(t === "friends"));
    tabRequests.setAttribute("aria-selected", String(t === "requests"));
    render();
  }

  function setBadge(n: number): void {
    const text = badgeText(n);
    reqBadge.textContent = text;
    reqBadge.hidden = !text;
    opts.onBadge?.(n);
  }

  function empty(text: string): HTMLElement {
    return el("p", "fr-empty dm-muted", text);
  }

  function friendRow(f: FriendEntry): HTMLElement {
    const row = el("li", "fr-row");
    row.dataset.userId = f.userId;
    const dot = el("span", `fr-dot ${f.online ? "is-online" : "is-offline"}`);
    dot.title = f.online ? "Online" : "Offline";
    const who = el("div", "fr-who");
    add(who, el("span", "fr-name", f.name), el("span", "fr-zone", zoneLabel(f.online, f.zone)));
    const actions = el("div", "fr-actions");
    add(
      actions,
      btn("Whisper", "fr-whisper", () => {
        opts.prefillChat(whisperPrefill(f.name));
      }),
      btn("Invite home", "fr-invite", () => {
        // The command reports success or failure itself (see hud.ts chatCommand).
        opts.sendChat(inviteCommand(f.name));
      }, "confirm"),
      confirmBtn("Remove", "fr-remove", async () => {
        const r = await api.remove(f.userId);
        if (!r.ok) return fail(r.error);
        uiSound("close");
        showMsg(`Removed ${f.name}.`, "ok");
        await refresh();
      }),
    );
    add(row, dot, who, actions);
    return row;
  }

  /** First click arms ("Sure?"), second within CONFIRM_MS runs. */
  function confirmBtn(text: string, className: string, run: () => Promise<void>): HTMLButtonElement {
    let armed: ReturnType<typeof setTimeout> | null = null;
    const b = btn(text, className, () => {
      if (!armed) {
        b.textContent = "Sure?";
        b.classList.add("dm-btn-accent");
        armed = setTimeout(() => {
          armed = null;
          b.textContent = text;
          b.classList.remove("dm-btn-accent");
        }, CONFIRM_MS);
        return;
      }
      clearTimeout(armed);
      armed = null;
      b.disabled = true;
      void run().finally(() => (b.disabled = false));
    });
    return b;
  }

  function requestRow(r: FriendRequestEntry, incoming: boolean): HTMLElement {
    const row = el("li", "fr-row");
    row.dataset.userId = r.userId;
    const who = el("div", "fr-who");
    add(who, el("span", "fr-name", r.name), el("span", "fr-zone", incoming ? "wants to be friends" : "waiting…"));
    const actions = el("div", "fr-actions");
    if (incoming) {
      add(
        actions,
        btn("Accept", "dm-btn-primary fr-accept", (b) => void respond(r, true, b), "confirm"),
        btn("Decline", "fr-decline", (b) => void respond(r, false, b)),
      );
    } else {
      add(
        actions,
        btn("Cancel", "fr-cancel", async (b) => {
          b.disabled = true;
          const res = await api.remove(r.userId);
          b.disabled = false;
          if (!res.ok) return fail(res.error);
          showMsg(`Cancelled your request to ${r.name}.`);
          await refresh();
        }),
      );
    }
    add(row, who, actions);
    return row;
  }

  async function respond(r: FriendRequestEntry, accept: boolean, b: HTMLButtonElement): Promise<void> {
    b.disabled = true;
    const res = await api.respond(r.userId, accept);
    b.disabled = false;
    if (!res.ok) return fail(res.error);
    if (accept) {
      uiSound("confirm");
      showMsg(`You and ${r.name} are now friends!`, "ok");
    } else {
      showMsg(`Declined ${r.name}.`);
    }
    await refresh();
  }

  function fail(error: string): void {
    uiSound("error");
    showMsg(error, "error");
  }

  function section(label: string, items: HTMLElement[], emptyText: string): HTMLElement[] {
    const h = el("h3", "fr-section", label);
    if (items.length === 0) return [h, empty(emptyText)];
    const ul = el("ul", "fr-list");
    add(ul, ...items);
    return [h, ul];
  }

  function render(): void {
    const guest = opts.isGuest();
    addForm.hidden = guest;
    tabs.hidden = guest;
    if (guest) {
      const box = el("div", "fr-guest");
      add(
        box,
        el("p", "", "Friends are for accounts. Create one to add friends and see when they're online."),
        btn("Create account", "dm-btn-primary", () => {
          close();
          opts.askAccount();
        }),
      );
      body.replaceChildren(box);
      return;
    }
    const friends = data?.friends ?? [];
    const incoming = data?.incoming ?? [];
    const outgoing = data?.outgoing ?? [];
    const online = friends.filter((f) => f.online).length;
    tabFriends.textContent = friends.length ? `Friends ${online}/${friends.length}` : "Friends";
    setBadge(incoming.length);

    if (!data) {
      body.replaceChildren(empty(loadError ?? "Loading…"));
      return;
    }
    if (tab === "friends") {
      if (friends.length === 0) {
        body.replaceChildren(empty("No friends yet. Add someone by name above, or right-click a player."));
        return;
      }
      const ul = el("ul", "fr-list");
      ul.id = "friends-list";
      add(ul, ...friends.map(friendRow));
      const foot = el("p", "fr-foot dm-muted", `${friends.length} / ${data.limits?.maxFriends ?? MAX_FRIENDS} friends`);
      body.replaceChildren(ul, foot);
    } else {
      body.replaceChildren(
        ...section("Incoming", incoming.map((r) => requestRow(r, true)), "No requests right now."),
        ...section("Sent", outgoing.map((r) => requestRow(r, false)), "You haven't sent any requests."),
      );
    }
  }

  async function refresh(): Promise<void> {
    if (opts.isGuest()) return render();
    if (inflight) return inflight;
    inflight = (async () => {
      const r = await api.list();
      if (r.ok) {
        data = r.data;
        loadError = null;
      } else if (!data) {
        loadError = r.error;
      }
      render();
    })().finally(() => (inflight = null));
    return inflight;
  }

  async function addByName(raw: string): Promise<void> {
    if (opts.isGuest()) {
      uiSound("error");
      opts.notice("Friends are for accounts. Create an account to add friends!", "error");
      return;
    }
    const err = addNameError(raw);
    if (err) {
      if (!isOpen()) open();
      addInput.value = raw.trim();
      return fail(err);
    }
    const name = raw.trim();
    addBtn.disabled = true;
    const r = await api.request(name);
    addBtn.disabled = false;
    if (!r.ok) {
      if (isOpen()) fail(r.error);
      else {
        uiSound("error");
        opts.notice(r.error, "error");
      }
      return;
    }
    addInput.value = "";
    const text =
      r.data.status === "accepted"
        ? `You and ${r.data.user.name} are now friends!`
        : `Friend request sent to ${r.data.user.name}.`;
    uiSound("confirm");
    if (isOpen()) showMsg(text, "ok");
    else opts.notice(text, "info");
    await refresh();
  }

  function isOpen(): boolean {
    return !panel.hidden;
  }

  function open(t: Tab = tab): void {
    if (isOpen()) {
      if (t !== tab) setTab(t);
      return;
    }
    panel.hidden = false;
    uiSound("open");
    showMsg("");
    setTab(t);
    void refresh();
    if (!pollTimer) pollTimer = setInterval(() => void refresh(), FRIENDS_POLL_MS);
  }

  function close(): void {
    if (!isOpen()) return;
    panel.hidden = true;
    uiSound("close");
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    addInput.blur();
  }

  for (const type of FRIEND_NOTICE_TYPES) {
    onSocial(type, (p) => {
      if (p.t === "friendRequest" && typeof p.fromName === "string") {
        opts.notice(`${p.fromName.slice(0, 32)} wants to be your friend. Press O to answer.`, "info");
      } else if (p.t === "friendAccepted" && typeof p.name === "string") {
        opts.notice(`${p.name.slice(0, 32)} accepted your friend request!`, "loot");
      }
      void refresh();
    });
  }
  // Presence changes (friend came online / changed zone) only matter while the list is on screen.
  onSocial("presence", () => {
    if (isOpen()) void refresh();
  });

  setTab("friends");
  // One fetch at start so the Requests badge is right before the panel is ever opened.
  if (!opts.isGuest()) void refresh();

  return {
    toggle: () => (isOpen() ? close() : open()),
    open,
    close,
    isOpen,
    addByName,
    refresh,
  };
}
