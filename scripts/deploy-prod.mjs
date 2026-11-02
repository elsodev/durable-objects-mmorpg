// Production deploy from the git-ignored .env.production, so the committed wrangler.jsonc keeps
// placeholders instead of account-specific IDs. Renders wrangler.production.jsonc (git-ignored,
// next to wrangler.jsonc so relative paths still resolve), applies D1 migrations, then deploys
// with every other non-empty key uploaded as a Worker secret.
//
//   node scripts/deploy-prod.mjs            migrate + deploy
//   node scripts/deploy-prod.mjs --dry-run  render the config and list secret names only
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

const ENV_FILE = ".env.production";
const TEMPLATE = "wrangler.jsonc";
const OUTPUT = "wrangler.production.jsonc";
const DB_NAME = "durable-mmo-auth";
// Keys written into the config instead of being uploaded as secrets.
const PLACEHOLDERS = {
  D1_DATABASE_ID: "REPLACE_WITH_YOUR_D1_ID",
  TURNSTILE_SITE_KEY: "REPLACE_WITH_YOUR_TURNSTILE_SITE_KEY",
};
// Values go inside JSON strings, so only allow characters that can't break out of one.
const SAFE_VALUE = /^[\w-]*$/;

function fail(message) {
  console.error(`deploy-prod: ${message}`);
  process.exit(1);
}

function readEnv() {
  let text;
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {
    fail(`${ENV_FILE} not found. Copy ${ENV_FILE}.example and fill it in.`);
  }
  const env = parseEnv(text);
  if (!env.D1_DATABASE_ID) fail("D1_DATABASE_ID is required.");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) fail("BETTER_AUTH_SECRET must be 32+ characters.");
  if (!/^https:\/\/[^/]+$/.test(env.BETTER_AUTH_URL ?? "")) fail("BETTER_AUTH_URL must be an https origin with no trailing slash.");
  if (!env.TURNSTILE_SECRET_KEY && env.CAPTCHA_DISABLED !== "1") fail("Set TURNSTILE_SECRET_KEY, or CAPTCHA_DISABLED=1 to run without a captcha.");
  return env;
}

function renderConfig(template, env) {
  let out = template;
  for (const [key, placeholder] of Object.entries(PLACEHOLDERS)) {
    const value = env[key] ?? "";
    if (!SAFE_VALUE.test(value)) fail(`${key} has unexpected characters.`);
    if (!out.includes(placeholder)) fail(`${TEMPLATE} no longer contains ${placeholder}; update this script.`);
    out = out.replaceAll(placeholder, value);
  }
  return out;
}

function secretsFrom(env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => !(key in PLACEHOLDERS) && value !== ""));
}

function wrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const env = readEnv();
writeFileSync(OUTPUT, renderConfig(readFileSync(TEMPLATE, "utf8"), env));
const secrets = secretsFrom(env);
console.log(`deploy-prod: wrote ${OUTPUT}; secrets: ${Object.keys(secrets).join(", ")}`);
if (process.argv.includes("--dry-run")) process.exit(0);

wrangler(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", OUTPUT]);
// The secrets file lives outside the repo and is removed even if the deploy fails.
const dir = mkdtempSync(join(tmpdir(), "dmmo-deploy-"));
try {
  const secretsFile = join(dir, "secrets.json");
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  wrangler(["deploy", "-c", OUTPUT, "--secrets-file", secretsFile]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
