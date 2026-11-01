# DurableMMO

A cozy multiplayer farming game set in the valley of Mossbrook, with light monster hunting and mining. The server runs on Cloudflare Workers and Durable Objects, the client is PixiJS v8 (WebGPU with a WebGL fallback), and the art is from the Liberated Pixel Cup (LPC).

## Features

- Your own home farm: till, plant, water and harvest crops that grow in real time, and place furniture and fences
- Shared zones (village, riverside, caves) with other players, chat, shops and village goals everyone contributes to
- Mining and light combat against slimes, bats and rock crabs
- Ten villagers who chat and react. Their decisions come from rules, optionally TypeSafe Jev, with lines from Workers AI
- Character creator, guest play with an upgrade to a full account later, music and sound effects

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

   Leave `TURNSTILE_*` empty. `TYPESAFE_API_KEY` is optional.

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
- has no Workers AI binding, so NPCs use scripted lines (`NPC_AI_MODE=off`). They still remember you: each NPC keeps a private memory per player (your name, gifts, things you told it). Outside your home, press Q next to a villager to give them the selected hotbar item (at home Q eats).
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

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/elsodev/durable-objects-mmorpg)

The button forks this repo into your GitHub account, creates the D1 database, the R2 bucket and the Durable Objects, builds the client, deploys the Worker and applies the D1 migrations. It asks you for `BETTER_AUTH_SECRET` (32+ random characters, e.g. `openssl rand -base64 32`). After the first deploy, open the Worker's settings in the Cloudflare dashboard and add:

- `BETTER_AUTH_URL`: your Worker's public URL, e.g. `https://durable-mmo.<you>.workers.dev`.
- Turnstile: `TURNSTILE_SITE_KEY` (variable) and `TURNSTILE_SECRET_KEY` (secret), or `CAPTCHA_DISABLED=1` to run without a captcha.

### Deploy by hand

```sh
npx wrangler login
npx wrangler d1 create durable-mmo-auth          # optional: wrangler deploy creates it if missing
npx wrangler r2 bucket create durable-mmo-files
npx wrangler secret put BETTER_AUTH_SECRET        # 32+ random characters
npx wrangler secret put BETTER_AUTH_URL           # your public origin, e.g. https://durable-mmo.example.workers.dev
npx wrangler secret put TURNSTILE_SECRET_KEY      # from the Turnstile dashboard
npm run deploy                                    # vite build, wrangler deploy, then remote D1 migrations
```

Set `TURNSTILE_SITE_KEY` in `wrangler.jsonc` → `vars` before deploying. `BETTER_AUTH_URL` can be a var instead of a secret.

Optional services:

- **Workers AI** is on by default in production (`NPC_AI_MODE=on`, model in `NPC_MODEL`). `AI_DAILY_NEURONS` caps daily spend. When the budget runs out NPCs fall back to scripted lines.
- **TypeSafe Jev** for typed NPC decisions: `npx wrangler secret put TYPESAFE_API_KEY`. Without it NPCs use rule-based decisions.
- **Turnstile** captcha on sign-up and sign-in: the site key and secret above. Without a secret, production sign-up and sign-in answer 503. Set `CAPTCHA_DISABLED=1` to run without a captcha on purpose.

The Worker does not serve `/api` or `/ws` while `BETTER_AUTH_SECRET` is missing, shorter than 32 characters, or a placeholder. WebSocket upgrades are accepted only from the `BETTER_AUTH_URL` origin. A daily cron deletes guest accounts idle for more than 30 days.

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
migrations/   D1 migrations (Better Auth tables, friends, unique names)
test/         Vitest tests
scripts/      e2e.mjs (Playwright)
```

## Chat and names

- Chat channels: **Zone** (everyone in your zone, speech bubbles), **World** (everyone online, `/world` or the World tab) and **whispers** (`/w name message`, `/r message` to reply, or click a name in the chat log or a player). Bubbles show the first 5 words; the log has the full line. `/emote wave` (or the picker next to the input) shows an emote above your head to the zone.
- World chat and whispers go over a second WebSocket, `/ws/social`, to one global `SocialRoom`. Guests can read world chat but not send world chat or whispers.
- Names are 3-16 letters, numbers or `_`, unique ignoring case (`migrations/0006_unique_names.sql`); the forms check `GET /api/name-check` before submitting. Guests start as `Guest_xxxxxx` and then take the name they typed if it is free. An account may claim a name a guest holds; that guest goes back to a `Guest_xxxxxx` name. Names from before this rule are shown with other characters replaced by `_`.

## Credits

DurableMMO's art, music and sound come from many generous creators. Thank you all. The in-game **Credits** button, on the start screen and in the HUD menu, lists them too.

### Theme song and music

All music is CC0 1.0. It's credited here anyway, with thanks.

| Where it plays | Track | Artist | Source |
|---|---|---|---|
| **Theme / title menu** | **Beary Fishy Menu Screen** | **Memoraphile (You're Perfect Studio)** | https://opengameart.org/content/gone-fishin |
| Village | Gone Fishin' | Memoraphile (You're Perfect Studio) | https://opengameart.org/content/gone-fishin |
| Home farm | Champ de tournesol | Komiku | https://opengameart.org/content/champ-de-tournesol |
| Riverside | Down the River | Komiku | https://opengameart.org/content/down-the-river |
| Night | Meadow Thoughts | Écrivain | https://opengameart.org/content/meadow-thoughts |
| Festival | Medieval: Minstrel Dance | RandomMind | https://opengameart.org/content/medieval-minstrel-dance |
| Caves | Tha'el Mines (JRPG Pack 1: Exploration) | Juhani Junkala (SubspaceAudio) | https://opengameart.org/content/jrpg-pack-1-exploration |
| Battle sting | Charge | Beatscribe | https://github.com/Beatscribe/homebrew_vgm |

### Sound effects

- **Kenney** (kenney.nl), CC0: Interface Sounds, RPG Audio and Impact Sounds.
- **"Oculus Audio Pack 01" by Oculus VR, LLC**, CC BY 4.0: https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/
- **columbia23** (spider) and **suonho** (bat) on Freesound, CC BY 3.0.
- These CC0 creators: **artisticdude** (RPG Sound Pack), **MedicineStorm** (Medieval weapon sounds), **AntumDeluge** and **polymorpheva** (bat screeches), **toefur**, **Darsycho**, **rubberduck**, **EZduzziteh** and **Spring Spring**.

### Art

All art is Liberated Pixel Cup (LPC) style, under CC-BY-SA 3.0, GPL 3.0 or 2.0, OGA-BY 3.0, CC-BY 3.0 or CC0; many files are multi-licensed. Main artists include:

- Lanea Zimmerman (Sharm)
- Eliza Wyatt (ElizaWy / DeathsDarling)
- Stephen Challener (Redshrike)
- bluecarrot16
- Johannes Sjölund (wulax)
- Matthew Krohn (makrohn)
- JaidynReiman
- Benjamin K. Smith (BenCreating)
- Hyptosis
- Daniel Eddeland (Daneeklu)
- Daniel Armstrong (HughSpectrum)
- Manuel Riecke (MrBeast)
- Jetrel
- Reemax
- TheraHedwig
- Nila122
- Pierre Vigier (pvigier)
- Durrani
- Evert
- MuffinElZangano
- many more, listed per file

Some art is our own drawing, released as CC0: the emotes, the log walls, the doormat, the mine cart, the light glows, and a few icons.

### Asset source repositories

We took art and audio from these repositories. Each file's exact source is in the CREDITS files listed below.

| Repository | Used for |
|---|---|
| https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator | Character bodies, heads, hair, clothes, tools and action frames |
| https://github.com/ElizaWy/LPC | Terrain, buildings, crops, props, interiors and furniture |
| https://github.com/OpenGameArt/LiberatedPixelCup | Original LPC base assets |
| https://github.com/LiberatedPixelCup/RPG_Maker_MZ_LPC_Starter_Kit | Tiles and props |
| https://github.com/DrJamgo/love2d-lpc-tiles | Terrain tiles (GPL-3.0) |
| https://gitlab.com/vagabondgame/lpc-characters | Character layer references |
| https://github.com/KrasimirKralev/harvest-hollow | Prepared music tracks (title, village, home, riverside, night, festival) |
| https://github.com/dancohen88/family | Caves music |
| https://github.com/Beatscribe/homebrew_vgm | Battle sting |
| https://github.com/Calinou/kenney-interface-sounds | Kenney Interface Sounds |
| https://github.com/Boyquotes/kenney-rpg-audio-for-godot | Kenney RPG Audio |
| https://github.com/Boyquotes/kenney-impact-sounds-for-godot | Kenney Impact Sounds |
| https://github.com/facebookincubator/Meta-open-sound | Oculus Audio Pack 01 |
| https://github.com/mascari4615/Witch-Mendokusai | artisticdude's RPG Sound Pack |
| https://github.com/bodangren/advantage-forge | MedicineStorm's weapon swings |
| https://github.com/ARKOUDAKII/EternalRain | Bat screeches |
| https://github.com/VoxeLibre/VoxeLibre | Spider and bat sounds |

### Full per-file credits

- `src/client/public/assets/lpc/CREDITS.md`: LPC art
- `src/client/public/assets/lpc/custom/CREDITS-custom.md`: character creator layers, tools and action sheets
- `src/client/public/assets/audio/CREDITS.md`: music and sound effects
- `src/client/public/assets/emotes/CREDITS.md`: emote icons

Assets keep their own licenses as listed in those files.

## License

The code is licensed under the **Apache License 2.0** (see [LICENSE](LICENSE)). Copyright 2026 Elson Tan.

You may copy, modify and redistribute it, including for commercial use, as long as you keep the [NOTICE](NOTICE) file and credit the original repository: **https://github.com/elsodev/durable-objects-mmorpg**.

Art, music and sound effects in `src/client/public/assets/` are not covered by the Apache License. They keep their own licenses, as listed in the Credits section above.
