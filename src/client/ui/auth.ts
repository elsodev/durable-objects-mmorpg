// Start screen (guest / sign in / create account) and the guest-upgrade account form.
// Better Auth client with the anonymous plugin; Turnstile tokens go in the x-captcha-response header.
import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";
import type { SessionUser } from "./index";
import { uiSound } from "./sound";
import { createLogoHeading } from "./logo";
import { mountLoginCat } from "./login-cat";
import { startScreenFooter } from "./start-footer";
import { CaptchaError, createCaptcha, type Captcha } from "./turnstile";
import {
  MAX_NAME_LEN,
  MAX_PASSWORD_LEN,
  MIN_PASSWORD_LEN,
  cleanName,
  friendlyAuthError,
  parseNameCheck,
  toSessionUser,
  validateEmail,
  validateName,
  validatePassword,
  type Mode,
  type RawUser,
} from "./auth-logic";
import { NAME_PATTERN, NAME_RULE_TEXT } from "../../shared/names";
import "./styles/auth.css";

const CAPTCHA_HEADER = "x-captcha-response";

function makeClient() {
  return createAuthClient({ baseURL: `${window.location.origin}/api/auth`, plugins: [anonymousClient()] });
}
let client: ReturnType<typeof makeClient> | null = null;
/** Lazily created so importing this module never touches window (tests, SSR-less tooling). */
export function authClient(): ReturnType<typeof makeClient> {
  client ??= makeClient();
  return client;
}

/** Sign out of Better Auth (for the HUD's sign-out button / GameApi.signOut). */
export async function signOutSession(): Promise<void> {
  await authClient().signOut();
}

// ---------------------------------------------------------------- DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function field(label: string, input: HTMLInputElement): HTMLLabelElement {
  return el("label", { class: "auth-field" }, el("span", { class: "auth-label", text: label }), input);
}

function captchaHeaders(token: string | null): Record<string, string> {
  return token ? { [CAPTCHA_HEADER]: token } : {};
}

/** Asks the server whether a name is free; a network failure lets the submit decide. */
async function nameAvailable(name: string, forWho: "account" | "guest"): Promise<string | null> {
  try {
    const res = await fetch(`/api/name-check?for=${forWho}&name=${encodeURIComponent(name)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const r = parseNameCheck(await res.json());
    return r.ok ? null : r.reason;
  } catch {
    return null;
  }
}

/** Name inputs: same rule as the server (3-16 letters, numbers or _). */
function nameInput(id: string): HTMLInputElement {
  return el("input", {
    id,
    type: "text",
    autocomplete: "nickname",
    maxlength: String(MAX_NAME_LEN),
    minlength: "3",
    pattern: NAME_PATTERN,
    title: NAME_RULE_TEXT,
    placeholder: "Farmer name (A-Z, 0-9, _)",
    spellcheck: "false",
  });
}

/** Fetch the current session; network failures count as "no session" so the form still shows. */
async function currentUser(fresh = false): Promise<SessionUser | null> {
  try {
    const res = await authClient().getSession(fresh ? { query: { disableCookieCache: true } } : undefined);
    const user = res.data?.user as RawUser | undefined;
    return user ? toSessionUser(user) : null;
  } catch {
    return null;
  }
}

interface Busy {
  set(on: boolean, label?: string): void;
}
function busyButton(btn: HTMLButtonElement, form: HTMLElement): Busy {
  return {
    set(on, label) {
      if (on) {
        btn.dataset.idle ??= btn.textContent ?? "";
        btn.textContent = label ?? "Please wait…";
      } else if (btn.dataset.idle !== undefined) {
        btn.textContent = btn.dataset.idle;
        delete btn.dataset.idle;
      }
      btn.disabled = on;
      form.setAttribute("aria-busy", String(on));
      for (const i of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) i.disabled = on;
    },
  };
}

// ---------------------------------------------------------------- account form (sign in / sign up)

interface AccountFormHandle {
  root: HTMLElement;
  /** Called when the form becomes visible (renders the captcha lazily). */
  show(): void;
  setMode(mode: Mode): void;
  destroy(): void;
}

function accountForm(
  initial: Mode,
  onUser: (u: SessionUser) => void,
  setError: (msg: string | null) => void,
): AccountFormHandle {
  let mode: Mode = initial;
  let captcha: Captcha | null = null;
  let captchaPending: Promise<Captcha> | null = null;

  const name = nameInput("auth-name");
  const email = el("input", { id: "auth-email", type: "email", autocomplete: "email", placeholder: "you@example.com" });
  const password = el("input", {
    id: "auth-password",
    type: "password",
    minlength: String(MIN_PASSWORD_LEN),
    maxlength: String(MAX_PASSWORD_LEN),
    placeholder: `At least ${MIN_PASSWORD_LEN} characters`,
  });
  const nameField = field("Farmer name", name);
  const captchaBox = el("div", { class: "auth-captcha" });
  const submit = el("button", { id: "auth-submit", type: "submit", class: "auth-button auth-primary" });
  const form = el(
    "form",
    { class: "auth-form", novalidate: "" },
    nameField,
    field("Email", email),
    field("Password", password),
    captchaBox,
    submit,
  );
  const busy = busyButton(submit, form);

  const applyMode = () => {
    nameField.hidden = mode !== "signup";
    submit.textContent = mode === "signup" ? "Create account" : "Sign in";
    password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    form.dataset.mode = mode;
  };
  applyMode();

  const ensureCaptcha = () => {
    captchaPending ??= createCaptcha(captchaBox, "visible").then((c) => (captcha = c));
    return captchaPending;
  };

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    void run();
  });

  async function run(): Promise<void> {
    const n = cleanName(name.value);
    const problem =
      (mode === "signup" ? validateName(name.value) : null) ?? validateEmail(email.value) ?? validatePassword(password.value);
    if (problem) {
      setError(problem);
      (mode === "signup" && validateName(name.value) ? name : validateEmail(email.value) ? email : password).focus();
      return;
    }
    if (mode === "signup") {
      const taken = await nameAvailable(n, "account");
      if (taken) {
        setError(taken);
        name.focus();
        return;
      }
    }
    setError(null);
    busy.set(true, "Checking you're human…");
    let cap: Captcha | null = null;
    try {
      cap = await ensureCaptcha();
      const token = await cap.token();
      busy.set(true, mode === "signup" ? "Planting your farm…" : "Opening the gate…");
      const fetchOptions = { headers: captchaHeaders(token) };
      const res =
        mode === "signup"
          ? await authClient().signUp.email({ email: email.value.trim(), password: password.value, name: n, fetchOptions })
          : await authClient().signIn.email({ email: email.value.trim(), password: password.value, fetchOptions });
      if (res.error) {
        setError(friendlyAuthError(res.error, mode));
        cap.reset();
        busy.set(false);
        password.select();
        return;
      }
      const raw = res.data?.user as RawUser | undefined;
      const user = (await currentUser(true)) ?? (raw ? toSessionUser({ ...raw, isAnonymous: false }) : null);
      if (!user) throw new Error("no session after sign-in");
      uiSound("confirm");
      onUser(user);
    } catch (err) {
      setError(err instanceof CaptchaError ? err.message : friendlyAuthError(null, mode));
      cap?.reset();
      busy.set(false);
    }
  }

  return {
    root: form,
    show() {
      void ensureCaptcha();
    },
    setMode(m) {
      mode = m;
      applyMode();
      setError(null);
    },
    destroy() {
      captcha?.destroy();
    },
  };
}

// ---------------------------------------------------------------- shared shell pieces

function errorArea(): { box: HTMLElement; set(msg: string | null): void } {
  const box = el("p", { id: "auth-error", class: "auth-error", role: "alert", "aria-live": "assertive" });
  box.hidden = true;
  return {
    box,
    set(msg) {
      box.textContent = msg ?? "";
      box.hidden = !msg;
      if (msg) uiSound("error");
    },
  };
}

interface TabSpec<K extends string> {
  key: K;
  id: string;
  label: string;
}
function tabBar<K extends string>(tabs: TabSpec<K>[], onSelect: (k: K) => void): { bar: HTMLElement; select(k: K): void } {
  const buttons = new Map<K, HTMLButtonElement>();
  const bar = el("div", { class: "auth-tabs", role: "tablist" });
  const select = (k: K) => {
    for (const [key, b] of buttons) {
      b.setAttribute("aria-selected", String(key === k));
      b.tabIndex = key === k ? 0 : -1;
    }
    onSelect(k);
  };
  for (const t of tabs) {
    const b = el("button", { id: t.id, type: "button", role: "tab", class: "auth-tab", text: t.label });
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-selected") === "true") return;
      uiSound("click");
      select(t.key);
    });
    buttons.set(t.key, b);
    bar.appendChild(b);
  }
  bar.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    const keys = [...buttons.keys()];
    const cur = keys.findIndex((k) => buttons.get(k)!.getAttribute("aria-selected") === "true");
    const next = keys[(cur + (ev.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length]!;
    uiSound("click");
    select(next);
    buttons.get(next)!.focus();
  });
  return { bar, select };
}

// ---------------------------------------------------------------- mountAuth

export async function mountAuth(root: HTMLElement): Promise<SessionUser> {
  const existing = await currentUser();
  if (existing) return existing;

  return new Promise<SessionUser>((resolve) => {
    const err = errorArea();
    let finished = false;
    const finish = (u: SessionUser) => {
      if (finished) return;
      finished = true;
      guestCaptcha?.destroy();
      account.destroy();
      cat.destroy();
      screen.remove();
      resolve(u);
    };

    // Guest panel
    const guestName = nameInput("auth-guest-name");
    const guestSubmit = el("button", { id: "auth-guest-submit", type: "submit", class: "auth-button auth-primary", text: "Play as guest" });
    const guestCaptchaBox = el("div", { class: "auth-captcha" });
    const guestForm = el(
      "form",
      { class: "auth-form", novalidate: "" },
      field("Farmer name", guestName),
      el("p", { class: "auth-hint", text: "Guests can tend their own farm. Create an account later to visit the village." }),
      guestCaptchaBox,
      guestSubmit,
    );
    const guestBusy = busyButton(guestSubmit, guestForm);
    let guestCaptcha: Captcha | null = null;
    let guestCaptchaPending: Promise<Captcha> | null = null;
    const ensureGuestCaptcha = () => {
      guestCaptchaPending ??= createCaptcha(guestCaptchaBox, "managed").then((c) => (guestCaptcha = c));
      return guestCaptchaPending;
    };

    guestForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (guestSubmit.disabled) return;
      void playAsGuest();
    });

    async function playAsGuest(): Promise<void> {
      const problem = validateName(guestName.value);
      if (problem) {
        err.set(problem);
        guestName.focus();
        return;
      }
      const name = cleanName(guestName.value);
      const taken = await nameAvailable(name, "guest");
      if (taken) {
        err.set(taken);
        guestName.focus();
        return;
      }
      err.set(null);
      guestBusy.set(true, "Checking you're human…");
      let cap: Captcha | null = null;
      try {
        cap = await ensureGuestCaptcha();
        const token = await cap.token();
        guestBusy.set(true, "Planting your farm…");
        const res = await authClient().signIn.anonymous({ fetchOptions: { headers: captchaHeaders(token) } });
        if (res.error) {
          err.set(friendlyAuthError(res.error, "guest"));
          cap.reset();
          guestBusy.set(false);
          return;
        }
        // The session exists now; a failed rename (e.g. the name was taken a moment ago) keeps the
        // unique "Guest_xxxxxx" placeholder the server gave the guest.
        await authClient()
          .updateUser({ name })
          .catch(() => undefined);
        const raw = res.data?.user as RawUser | undefined;
        const user = (await currentUser(true)) ?? (raw ? toSessionUser({ ...raw, name, isAnonymous: true }) : null);
        if (!user) throw new Error("no session after guest sign-in");
        uiSound("confirm");
        finish(user);
      } catch (e) {
        err.set(e instanceof CaptchaError ? e.message : friendlyAuthError(null, "guest"));
        cap?.reset();
        guestBusy.set(false);
      }
    }

    const account = accountForm("signin", finish, err.set);

    const panels = el("div", { class: "auth-panels" }, guestForm, account.root);
    type Tab = "guest" | Mode;
    const tabs = tabBar<Tab>(
      [
        { key: "guest", id: "auth-tab-guest", label: "Guest" },
        { key: "signin", id: "auth-tab-signin", label: "Sign in" },
        { key: "signup", id: "auth-tab-signup", label: "Create account" },
      ],
      (k) => {
        err.set(null);
        guestForm.hidden = k !== "guest";
        account.root.hidden = k === "guest";
        if (k === "guest") {
          void ensureGuestCaptcha();
          guestName.focus();
        } else {
          account.setMode(k);
          account.show();
          (account.root.querySelector<HTMLInputElement>(k === "signup" ? "#auth-name" : "#auth-email") ?? null)?.focus();
        }
      },
    );

    const screen = el(
      "div",
      { class: "auth-screen" },
      el(
        "div",
        { class: "auth-card", role: "dialog", "aria-labelledby": "auth-title" },
        createLogoHeading({ id: "auth-title", className: "auth-title" }),
        el("p", { class: "auth-tagline", text: "Grow crops, befriend villagers and explore the caves of Mossbrook valley." }),
        tabs.bar,
        err.box,
        panels,
        startScreenFooter(),
      ),
    );
    root.appendChild(screen);
    const cat = mountLoginCat(screen);
    tabs.select("guest");
  });
}

// ---------------------------------------------------------------- mountAccountForm (guest upgrade)

export function mountAccountForm(container: HTMLElement, opts: { reason?: string }): Promise<SessionUser | null> {
  return new Promise<SessionUser | null>((resolve) => {
    const err = errorArea();
    let finished = false;
    const finish = (u: SessionUser | null) => {
      if (finished) return;
      finished = true;
      account.destroy();
      wrap.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(u);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      uiSound("click");
      finish(null);
    };

    const account = accountForm("signup", finish, err.set);
    const tabs = tabBar<Mode>(
      [
        { key: "signup", id: "auth-tab-signup", label: "Create account" },
        { key: "signin", id: "auth-tab-signin", label: "Sign in" },
      ],
      (k) => {
        err.set(null);
        account.setMode(k);
        account.show();
        account.root.querySelector<HTMLInputElement>(k === "signup" ? "#auth-name" : "#auth-email")?.focus();
      },
    );
    const cancel = el("button", { id: "auth-cancel", type: "button", class: "auth-button auth-secondary", text: "Not now" });
    cancel.addEventListener("click", () => {
      uiSound("click");
      finish(null);
    });

    const reason = opts.reason?.trim();
    const wrap = el(
      "div",
      { class: "auth-card auth-card-inline" },
      el("h2", { class: "auth-subtitle", text: "Save your farm" }),
      el("p", {
        class: "auth-tagline",
        text: (reason ? `${reason.slice(0, 200)} ` : "") + "Your guest farm comes with you.",
      }),
      tabs.bar,
      err.box,
      account.root,
      cancel,
    );
    container.appendChild(wrap);
    document.addEventListener("keydown", onKey, true);
    tabs.select("signup");
  });
}
