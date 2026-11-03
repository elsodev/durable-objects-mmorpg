# DurableMMO

A cozy multiplayer farming game set in the valley of Mossbrook, with light monster hunting and mining, playable in the browser. The server runs entirely on Cloudflare Workers and Durable Objects, the client is PixiJS v8 (WebGPU with a WebGL fallback), and the art is from the Liberated Pixel Cup (LPC).

## Screenshots

| | |
|---|---|
| ![Players chatting by the village fountain](.github/screenshots/village.png) | ![A home farm with crops at different stages](.github/screenshots/farm.png) |
| ![A furnished house interior](.github/screenshots/house.png) | ![Talking to a villager, with hearts and gifts](.github/screenshots/npc.png) |
| ![Fighting slimes in the caves](.github/screenshots/combat.png) | ![The player card with friends and chat](.github/screenshots/social.png) |

## Features

**Farming and home**
- Your own farm: till, plant, water and harvest over 20 crops that grow in real time. Skip a day of watering and they wilt; three dry days and they die.
- Silver and gold crops: your farming level rises with every harvest and improves the odds. Each harvest is rolled from a fixed seed, so retrying can't reroll it.
- Edit your yard: move the house, barn and plot fences, lay fences and gates, and place items from your bag. A red outline shows when a spot is blocked. Trees, rocks and the pond stay until you chop or mine them, and any cleared grass can be tilled.
- Decorate the house with furniture from the village stall, rare pieces from the caves or gifts from villagers. Change your look at the wardrobe, sleep in your bed, and keep hens in the barn.

**The village**
- Shared maps (village, riverside, the quarry and its caves) full of other players, with shops, stall keepers, the Mossy Mug inn and village goals everyone works on together.
- Sit at the bar counter and order a meal from Rue; it's served in front of you and you eat it there.
- A notice board for short player notices, with likes and dislikes.
- A town jail with a sheriff. Admins can send rule-breakers there for a set time, and so can the sheriff if you insult him enough.

**Villagers with memory**
- 13 villagers with their own personalities, routines and stories. They remember each player separately: what you told them, what you gave them and how you treated them.
- Talk to them in a conversation window. Each reply is judged good, neutral or bad and moves your hearts with them; close friends send gifts and share tips.
- Their lines come from Workers AI and their decisions from Cloudflare's Clef model, with scripted lines and rules as a fallback.

**Adventure**
- Mine stone, copper, iron, silver, gold, gem and diamond rocks across several cave floors. The rarest rocks sit deepest and need the iron pickaxe.
- Fight slimes, bats and rock crabs with swords or any tool. Monsters drop loot, rare seeds and rare items, and respawn up to a cap per map.
- Levels: earn XP from monsters and from selling your goods each day. The XP bar fills as you hunt, and a level-up shows a burst everyone nearby can see.

**Playing together**
- Zone chat with speech bubbles, world chat, whispers, emotes, friends, muting and player cards. See the [social guide](docs/guides/social.md).
- Trade items and coins face to face in a two-step trade window that the server checks before anything changes hands.
- Visit friends' farms, and invite them to yours.
- Guest play with an upgrade to a full account later, a character creator, music and sound effects, and an in-game bug report button with screenshots.

## Architecture

The whole game is one Worker plus a few Durable Objects. There is no separate game server, database server or CDN to run.

| Service | What the game uses it for |
|---|---|
| **Workers** | The single entry point (`src/worker/index.ts`): sign-up and sign-in at `/api/auth/*`, the player API, uploads, WebSocket upgrades at `/ws/:zone`, and the built client as static assets. It checks the session and passes identity to the Durable Objects in `x-dmmo-*` headers, stripping any copies the browser sent. |
| **Durable Objects: `ZoneRoom`** | One per shared map (village, riverside, quarry, each cave floor and interior). It runs the authoritative 10 Hz tick: players, villagers, monsters, rocks, trees, chests, shops, ground items and village goals. When a map is full it opens a copy (see [limits](docs/guides/deployment.md#limitations)). |
| **Durable Objects: `HomeRoom`** | One per player (`idFromName(userId)`), acting as that player's character record: inventory, coins, stamina, water, hearts, pets, barn and hens, farm tiles, furniture, the fridge, mail and their private home map. Zones load and save players through its RPC methods, and only its owner may change it. |
| **Durable Objects: `SocialRoom`** | One global room for world chat, whispers, presence, the online counts and the village notice board. |
| **Durable Objects: `NpcAgent` and `AiBudget`** | `NpcAgent` is one agent per villager and player, holding that villager's memory of you. `AiBudget` is one global counter that caps the day's AI spend. |
| **Durable Object storage (SQLite)** | Each object keeps its own state in its built-in storage: the save in `HomeRoom`, rocks, trees, chests, ground items and goals in `ZoneRoom`. Zones write player saves back every 5 seconds and when a player leaves. |
| **WebSocket Hibernation** | Every room accepts sockets with `ctx.acceptWebSocket` and keeps per-socket data in attachments. The tick only runs while someone is connected, so an empty map sleeps and costs nothing. |
| **Alarms** | `HomeRoom` sets an alarm to regrow broken rocks and trees in the yard and to end the day on time. Crops still grow from timestamps, not timers. |
| **D1** | Better Auth tables, plus friends, unique names, mutes and player feedback reports (`migrations/`). Game state never goes here. |
| **R2** | Art and player uploads, served by the Worker at `/files/*`, and feedback screenshots under the private `feedback/` prefix, which only admins can read. |
| **Workers AI** | Villagers' spoken lines. The cheaper model (`NPC_MODEL`) writes lines, and a function-calling model (`NPC_AGENT_MODEL`) runs the per-player agents. Without it, villagers use scripted lines. |
| **Turnstile** | Captcha on sign-up and sign-in. |
| **Cron Triggers** | A daily job (`src/worker/cron.ts`) deletes guest accounts idle for over 30 days, with their home, uploads and villager memories. |
| **Observability** | Worker logs are on (`"observability"` in `wrangler.jsonc`). |

Clef Flash (`@cf/cloudflare/clef-flash`, a fast 9B Workers AI decision model) makes fast typed villager decisions and judges replies in the conversation window. `JEV_MODEL` picks the model: `@cf/cloudflare/clef-flash`, the larger `@cf/cloudflare/clef`, or TypeSafe's `typesafe/jev` (which needs Unified Billing credits). With `JEV_MODEL` empty, rules and word lists do the same job. Every NPC model call (lines, Think agent turns, decisions) goes through the AI Gateway named in `AI_GATEWAY_ID`.

### AI spend limits

Every villager AI call is counted in Workers AI neurons against a daily budget, `AI_DAILY_NEURONS` (9,000 by default, about 170 villager replies a day), with at most 40 AI replies per player a day. When the budget runs out, villagers fall back to scripted lines until the next UTC day. The [deployment guide](docs/guides/deployment.md#ai-spend-limits-neurons) explains what each call costs and how to raise or lower the limits.

### How the load is kept down

- **Updates go to nearby players first.** Each player gets every tick for things within 24 tiles. Things farther away are batched to 2 updates a second (`src/worker/game/interest.ts`).
- **Slow work never holds up the tick.** AI and RPC calls run in the background, and their results apply when they arrive.
- **Loot is only sent to its owners.** Loot on the ground goes only to the players it belongs to.

## Run it

```sh
npm install
cp .dev.vars.example .dev.vars   # set BETTER_AUTH_SECRET to 32+ random characters
npm run db:migrate:local
npm run dev:local                # http://localhost:8787
```

No Cloudflare account is needed to run it locally. The [development guide](docs/guides/development.md) covers setup, tests and the project layout, and the [deployment guide](docs/guides/deployment.md) covers deploying, admins, optional AI services, drop rates and limits.

## Contributing

Contributions are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, the checks to run before a pull request, the rules that keep the game correct, and how to credit art and sound.

## Credits

DurableMMO stands on the work of many generous artists, musicians and open-source projects. Thank you all. See **[CREDITS.md](CREDITS.md)** for the music, sound effects, art and libraries the game uses, with links to the per-file credits for every asset. The in-game **Credits** button, on the start screen and in the HUD menu, lists them too.

## License

The code is open source under the [MIT License](LICENSE), copyright (c) 2026 Elson Tan.

The art, music and sound effects in `src/client/public/assets/` are **not** covered by the MIT License. Each keeps its own license (CC0, CC-BY, CC-BY-SA, OGA-BY or GPL), as listed in [CREDITS.md](CREDITS.md) and the per-file CREDITS files. If you reuse them, follow those licenses, including attribution and share-alike where required.
