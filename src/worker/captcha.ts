// Captcha must fail closed: a deploy that forgot TURNSTILE_SECRET_KEY refuses sign-ups and
// sign-ins instead of silently running without bot protection.
import type { Env } from "./env";
import { isLocalEnv } from "./http/origin";

export type CaptchaMode = "on" | "off" | "misconfigured";

export function captchaMode(env: Pick<Env, "TURNSTILE_SECRET_KEY" | "CAPTCHA_DISABLED" | "DMMO_ENV">): CaptchaMode {
  if (env.TURNSTILE_SECRET_KEY) return "on";
  if (isLocalEnv(env) || env.CAPTCHA_DISABLED === "1") return "off";
  return "misconfigured";
}
