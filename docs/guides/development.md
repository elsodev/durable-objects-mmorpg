# Development guide

How to run Mossbrook locally, test it, and find your way around the code. For the rules every change must follow, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Requirements

- Node.js 22 or newer, and npm
- A Cloudflare account only to deploy or to use Workers AI locally. `npm run dev:local` works offline without one.

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create `.dev.vars` from the example and set a secret of at least 32 characters:

   ```sh
   cp .dev.vars.example .dev.vars
   openssl rand -base64 32   # paste the output after BETTER_AUTH_SECRET=
   ```

   Leave `TURNSTILE_*` empty.

3. Create the auth tables in the local D1 database (stored under `.wrangler/`):

   ```sh
   npm run db:migrate:local
   ```

   This runs `wrangler d1 migrations apply durable-mmo-auth --local --env local`.

4. Build the client and start the Worker:

   ```sh
   npm run dev:local
   ```

5. Open http://localhost:8787, type a farmer name and press **Play as guest**. Guests can play on their own farm. Create an account (any email works locally) to visit the shared zones.

### How local differs from production

`npm run dev:local` runs `wrangler dev --env local`, which:

- turns the Turnstile captcha off (empty keys and `DMMO_ENV=local`)
- has no Workers AI binding, so NPCs use scripted lines (`NPC_AI_MODE=off`) and replies in the conversation window are judged by word lists instead of Jev. They still remember you: each NPC keeps a private memory per player (your name, gifts, things you told it). Outside your home, press Q next to a villager to give them the selected hotbar item (at home Q eats).
- turns on dev tools (`DEV_TOOLS=on`): at home, `/day` ends the day (like sleeping) and `/time 21` sets the clock

`npm run dev` uses the default environment with the real Workers AI binding. It needs `npx wrangler login`, plus `CAPTCHA_DISABLED=1` in `.dev.vars` unless you set up Turnstile keys.

If you use another port, pass the matching auth origin, for example:

```sh
npx wrangler dev --env local --port 8796 --var BETTER_AUTH_URL:http://localhost:8796
```

## Tests

```sh
npm run typecheck   # tsc for the combined, worker and client configs
npm test            # Vitest unit tests in test/
npm run e2e         # Playwright browser run against a running dev server
```

`npm run e2e` expects the Worker from `npm run dev:local` to be running. It reads `BASE_URL` (default `http://localhost:8787`), writes screenshots to `SHOTS_DIR` (default `test-results/e2e`), and uses an installed `playwright` package or the Chromium at `CHROMIUM_PATH`:

```sh
BASE_URL=http://localhost:8796 npm run e2e
```

`npm run e2e:playtest` plays every feature with two accounts and a guest (chat, PMs, emotes, friends, NPC memory, interiors and seats, monsters, farming, night and sleep, home visits) and saves numbered screenshots to `SHOTS_DIR` (default `test-results/playtest`) for a visual check. It clears the local D1 sign-up rate limit first, so run it only against `npm run dev:local`.

## Project layout

```
src/
  worker/     Worker entry, Better Auth, HTTP routes, ZoneRoom / HomeRoom / AiBudget Durable Objects
    game/     server game logic (sessions, shops, goals, monsters, rate limits)
    npc/      NPC catalog, rules, Jev and Workers AI glue
    social/   SocialRoom Durable Object: world chat, whispers, presence, server stats
    friends/  friend requests and the /api/friends routes
  shared/     code used by server and client: protocol, types, items, engine/, maps/
  client/     PixiJS client
    game/ render/ net/ state/ art/ audio/ ui/
    public/assets/   art, audio and their CREDITS files
migrations/   D1 migrations (Better Auth tables, friends, unique names, mutes, feedback)
test/         Vitest tests
scripts/      e2e.mjs (Playwright)
```
