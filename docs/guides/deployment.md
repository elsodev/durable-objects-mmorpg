# Deployment guide

How to deploy Mossbrook to your own Cloudflare account, set admins, turn on the optional services and tune drop rates.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create durable-mmo-auth          # copy the database_id into wrangler.jsonc (both d1_databases entries)
npx wrangler r2 bucket create durable-mmo-files
npx wrangler secret put BETTER_AUTH_SECRET        # 32+ random characters
npx wrangler secret put BETTER_AUTH_URL           # your public origin, e.g. https://durable-mmo.example.workers.dev
npx wrangler secret put TURNSTILE_SECRET_KEY      # from the Turnstile dashboard
npm run db:migrate:remote
npm run deploy                                    # vite build, then wrangler deploy
```

Set `TURNSTILE_SITE_KEY` in `wrangler.jsonc` → `vars` before deploying. `BETTER_AUTH_URL` can be a var instead of a secret.

To keep account-specific values out of `wrangler.jsonc`, put them in a git-ignored `.env.production` instead (copy `.env.production.example`) and run `npm run deploy:prod`. It writes `D1_DATABASE_ID` and `TURNSTILE_SITE_KEY` into a generated, git-ignored `wrangler.production.jsonc`, applies the remote D1 migrations, and deploys with the other keys as secrets. `node scripts/deploy-prod.mjs --dry-run` shows what it would do without deploying.

## Admins

Admins are set only by the Worker's environment: `ADMIN_EMAILS` is a comma-separated list of account emails (case-insensitive; `ADMIN_EMAIL` works too). Keep it out of this public repo by making it a secret:

```sh
npx wrangler secret put ADMIN_EMAILS              # e.g. you@example.com,friend@example.com
```

With `npm run deploy:prod`, set `ADMIN_EMAILS` in `.env.production` instead and it is uploaded as a secret. Sign up with that email before you set it: the game doesn't verify emails, so whoever registers an address first owns it. Guests are never admins. Locally, put `ADMIN_EMAILS=you@example.com` in `.dev.vars` or pass `--var ADMIN_EMAILS:you@example.com`.

The Worker checks the session, compares the account's email and tells the Durable Objects with a server-set `x-dmmo-admin` header (a client-sent copy is stripped like every `x-dmmo-*` header). Admins get:

- **`/shout message`** (or Options → Shout): up to 200 characters of plain text, one shout per 10 s. It goes to every online player through the global `SocialRoom` and shows as a banner at the top of the screen that scrolls the text as a marquee between a rising and a falling chime. Anyone can close it with ✕; with reduced motion the text stays still. Players who come online within 5 minutes still see the latest shout.
- **`/kick name [reason]`** or **Kick** on the player card (two clicks): closes all of that player's sockets with close code 4451 and bans them. For admins `/kick` means this; the home "send a visitor home" stays on the visitors list. Admins can't kick themselves or other admins. **`/unban name`** lifts it. Every kick and unban is logged.
- A glowing golden **halo** over their head that everyone sees (`EntityState.admin`).

Bans live in `SocialRoom` storage (`ban:<userId>`, plus `banip:<ip>` for the addresses their sockets and sessions came from, lifted after 30 days). On every socket, `/api/*` call and sign-in or sign-up, the Worker checks the account and an HMAC-signed `dmmo_ban` cookie (httpOnly, 400 days, signed with `BETTER_AUTH_SECRET`, set on the removed player's browser), plus the `CF-Connecting-IP` address for signed-in players and sign-in or sign-up attempts, and answers 451. The start screen asks `GET /api/standing` first and shows "You've been removed from Mossbrook." Admins are never refused, so an address ban can't lock you out of `/unban`. An address ban also stops anyone else signing in from that address (a shared home or school network) until it lapses or you `/unban`.

## Optional services


- **Workers AI** is on by default in production (`NPC_AI_MODE=on`, model in `NPC_MODEL`). `AI_DAILY_NEURONS` caps daily spend. When the budget runs out NPCs fall back to scripted lines.
- **AI Gateway**: `AI_GATEWAY_ID` (default `durable-mmo`) routes every NPC model call through that gateway, for logs, caching and Unified Billing. Create a gateway with that name in the dashboard (AI → AI Gateway) or change the var to yours. Set it to `""` to call Workers AI directly.
- **Typed NPC decisions** use `JEV_MODEL` (default `@cf/cloudflare/clef-flash`, billed as normal Workers AI: $0.038 per million input tokens, output free; `@cf/cloudflare/clef` is $0.24, and then raise `JEV_UNITS` in `src/worker/game/npcGate.ts` to about 12). `typesafe/jev` also works but is a third-party model billed through Unified Billing credits. Set `JEV_MODEL` to `""` for rule-based decisions only. Failed or slow decision calls (1.5 s) fall back to rules.
- **Turnstile** captcha on sign-up and sign-in: the site key and secret above. Without a secret, production sign-up and sign-in answer 503. Set `CAPTCHA_DISABLED=1` to run without a captcha on purpose.

## AI spend limits (neurons)

Workers AI bills in **neurons**, its unit of compute. Every villager AI call is counted against a daily budget before it runs, so a busy day can't run up an unexpected bill. When a limit is reached, villagers keep talking with scripted lines and rule-based decisions until the next UTC day; nothing breaks.

### What counts

The `AiBudget` Durable Object (one global instance) adds up estimated neurons per UTC day. The estimates live in `src/worker/game/npcGate.ts`:

| Call | Estimated neurons | Constant |
|---|---|---|
| One villager reply in a shared map (an agent turn on `NPC_AGENT_MODEL`) | 50 | `AGENT_UNITS` |
| One spoken line on `NPC_MODEL`, when no agent is used | 30 | `SPEAK_UNITS` |
| One decision call on `JEV_MODEL` (Clef Flash) | 2 | `JEV_UNITS` |

A normal reply costs about 52 neurons (an agent turn plus one decision). A reply that is also judged for hearts makes two decision calls, so about 54. The sheriff's insult check is one decision call (2).

### The limits

| Limit | Default | Where to change it |
|---|---|---|
| Neurons per UTC day, all players together | 9,000 (about 170 villager replies) | `AI_DAILY_NEURONS` var |
| AI replies per player per UTC day | 40 | `PER_USER_DAILY_REPLIES` in `src/worker/npc/budget-logic.ts` |
| Largest single request | 200 neurons | `MAX_UNITS_PER_REQUEST` in `src/worker/npc/budget-logic.ts` |
| AI replies per player per villager | 1 every 10 s | `AI_REPLY_INTERVAL_MS` in `src/worker/game/npcGate.ts` |
| Same text to the same villager | reuses the cached reply for 10 min | `REPLY_CACHE_MS` in `src/worker/game/npcGate.ts` |
| Conversations per villager at once | 1, with up to 2 players queued | `TALK_QUEUE_MAX` in `src/worker/game/npcGate.ts` |

The default of 9,000 keeps the game inside Workers AI's daily free allocation (10,000 neurons a day at the time of writing). Above that, Workers AI on the paid plan charges per 1,000 neurons; check [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) for current rates.

### Changing the daily budget

`AI_DAILY_NEURONS` is a whole number of neurons. Empty, negative or non-numeric values fall back to 9,000, and `0` stops all villager AI calls.

- In `wrangler.jsonc`, change `"AI_DAILY_NEURONS"` under `vars` (production) or under `env.local.vars` (local), then deploy.
- Or override it for one deploy: `npx wrangler deploy --var AI_DAILY_NEURONS:30000`.
- Or edit it in the Cloudflare dashboard (Workers → your Worker → Settings → Variables). The next `wrangler deploy` replaces it with the value in `wrangler.jsonc`, so change that too.
- Locally: `npx wrangler dev --env local --var AI_DAILY_NEURONS:30000`. Local dev has no Workers AI binding by default, so this only matters with `npm run dev`.

The new value applies to the next AI call; spend already recorded today still counts.

Rough sizing: each player who chats a lot uses up to 40 replies × 52 neurons, about 2,100 neurons a day. So 9,000 covers about 4 heavy talkers, 30,000 about 14, and 100,000 about 48. Most players use far fewer.

### Changing what each call costs

The estimates are deliberately rounded up. If you switch models, update the constants in `src/worker/game/npcGate.ts` to match:

- A bigger `NPC_AGENT_MODEL` or `NPC_MODEL` costs more per token, so raise `AGENT_UNITS` or `SPEAK_UNITS`.
- For `JEV_MODEL = "@cf/cloudflare/clef"` (about six times the price of Clef Flash), raise `JEV_UNITS` to about 12.
- With `JEV_MODEL` empty, decisions use rules and cost nothing.

To see real usage, open the AI Gateway named in `AI_GATEWAY_ID` in the Cloudflare dashboard (AI → AI Gateway); it logs every villager model call with its tokens and cost. Compare that with the budget's estimates and adjust the constants if they drift.

### Turning villager AI off

Set `NPC_AI_MODE` to `off` (as `npm run dev:local` does). Villagers then use scripted lines and word lists only, and no neurons are spent.

## Drop rates

Every random drop in the game goes through one helper (`src/shared/engine/dropRate.ts`), so you can turn drops up or down with Worker vars. Defaults are in `wrangler.jsonc` → `vars`; locally you can also set them in `.dev.vars` or with `--var DROP_RATE:2`.

| Var | Scales | Default |
|---|---|---|
| `DROP_RATE` | every chance drop below, unless its own var is set | `1` |
| `DROP_RATE_MONSTER` | monster loot and seeds dropped by monsters | unset (uses `DROP_RATE`) |
| `DROP_RATE_ROCK` | bonus rock drops and silver rocks in the caves | unset |
| `DROP_RATE_CHEST` | the cave chests' second roll and bonus finds | unset |
| `DROP_RATE_FORAGE` | how much forage a zone grows | unset |
| `DROP_RATE_GIFT` | villagers' heart-milestone gifts | unset |
| `DROP_RATE_HARVEST` | extra crops from a harvest | unset |
| `DROP_RATE_RARE` | rare items wherever they drop: gems, diamond and gold rocks, gold ore, rare seeds, furniture. Wins over the category var | unset |

Each value is a multiplier on the chance (`2` doubles it, `0.5` halves it, `0` turns those drops off). Values are clamped to 0..10, empty or non-numeric values are ignored, and an effective chance never goes above 100%. Guaranteed drops (the ore a rock always gives, wood from trees, a villager's gift at full hearts) are never scaled. Each Durable Object reads the vars once when it starts.

## Safety checks at startup

The Worker does not serve `/api` or `/ws` while `BETTER_AUTH_SECRET` is missing, shorter than 32 characters, or a placeholder. WebSocket upgrades are accepted only from the `BETTER_AUTH_URL` origin. A daily cron deletes guest accounts idle for more than 30 days.

## Limitations

### Limits this game sets

| Limit | Value | Why |
|---|---|---|
| Players per map copy | 60 (`ZONE_CAP`) | One object runs the whole map's tick on a single thread. Past 60, the next player joins a copy ("Mossbrook Village · 2"), and players in different copies don't see each other. |
| Copies per map | 8 (`MAX_COPIES`) | So 480 players per map at most. Further joins get "full". |
| AI spend per day | `AI_DAILY_NEURONS` (9,000 by default) | When it runs out, villagers fall back to scripted lines until the next UTC day. |

### Limits set by the platform

- **Storage per object:** up to 10 GB, so one player's save has plenty of room.
- **Value or row size:** at most 2 MB. Saves are split into separate keys (inventory, farm, objects, mail, containers) to stay far below it.
- **WebSocket message size:** at most 32 MiB. Game messages are a few KB.
- **Per-socket attachment:** at most 16 KB. Only identity and a few small fields go there.
- **Requests per object:** about 1,000 a second (a soft limit). This is one more reason maps split into copies instead of growing.
- **One location per object:** an object lives in one Cloudflare location, picked near whoever first used it, so players far from a map's room see more ping.
- **Workers AI isn't available offline:** `npm run dev:local` has no AI binding, so villagers use scripted lines and word lists.
- **D1 holds accounts only:** game state lives in Durable Objects, so a player's whole game can't be queried with SQL across all players.
