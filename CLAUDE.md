# DurableMMO

Cozy multiplayer farming game with light monster hunting and mining, running on Cloudflare Workers and Durable Objects.

## Architecture

- **Worker** (`src/worker/index.ts`) is the only entry point: Better Auth at `/api/auth/*`, `/api/me`, uploads at `/api/uploads`, R2 files at `/files/*`, WebSockets at `/ws/:zone`, and the static client for everything else.
- **ZoneRoom** Durable Object (`src/worker/zone.ts`): one per shared map (`village`, `quarry`, `riverside`, `caves`). Authoritative tick loop at 10 Hz, players, NPCs, monsters, rocks, shops, village goals.
- **HomeRoom** Durable Object (`src/worker/home.ts`): one per player (`idFromName(userId)`). The player's save file (inventory, coins, hp, farm tiles, placed objects) and their private home map. Zones load and save players through its RPC methods.
- **SocialRoom** Durable Object (`src/worker/social/room.ts`): one global instance behind `/ws/social`. World chat, whispers by name, presence (ZoneRoom/HomeRoom report joins/leaves via `presence()`), "today" stats (`recordStat()`), and `notify(userId, payload)` / `presenceOf(ids)` for other Durable Objects. Call it fire-and-forget through `src/worker/social/hooks.ts`.
- **NpcAgent** Durable Object (`src/worker/npc/think/agent.ts`, Cloudflare Project Think `@cloudflare/think`): one per (NPC, player), `idFromName("<npcId>:<userId>")`. Holds only that pair's memory and transcript, so an NPC never knows about other players. Its tools return intents; ZoneRoom validates and applies them. Personas live in `src/worker/npc/bible.ts`.
- **D1** holds Better Auth tables only (plus a unique index on `lower(name)`). **R2** (`FILES`) holds art and player uploads. **Workers AI** writes NPC lines; **Clef** (`@cf/cloudflare/clef` on Workers AI, `JEV_MODEL`; the code still calls the decision path "Jev") makes fast typed NPC decisions. All NPC model calls go through the AI Gateway in `AI_GATEWAY_ID`.
- **Client** (`src/client`): PixiJS v8 with WebGPU preferred and WebGL fallback. `src/client/ui` is the DOM login screen and HUD; the game talks to it only through the `GameApi` / `Hud` interfaces in `src/client/ui/index.ts`.
- **Shared code** (`src/shared`) runs on both server and client: `types.ts`, `protocol.ts` (every WebSocket message), `engine/` (movement, collisions, pathfinding, inventory, crops, `canPlace`, monsters), `items.ts`, `maps/` (maps built in code from a fixed seed).

## Rules that keep the game correct

- The server is authoritative. Clients send intents (`ClientMsg`); the server validates range, ownership, quantities, slots and speed for every message, and may answer with `reject`.
- Identity inside Durable Objects comes only from the `x-dmmo-*` headers the Worker sets after checking the session. The Worker strips client-supplied copies.
- Only the owner may connect to or change their `HomeRoom`.
- Use the WebSocket Hibernation API (`ctx.acceptWebSocket`, `serializeAttachment`). Rebuild in-memory state from `ctx.getWebSockets()` in the constructor. Run the tick timer only while sockets are connected, so empty zones hibernate.
- Never block the tick on network calls (NPC AI, RPC). Run them async and apply results when they arrive.
- Crops grow from timestamps (`plantedAt`, watered days), never from a running timer.
- Keep inventory reads and writes synchronous once loaded; don't `await` between reading and writing a player's inventory.

## Coding standards

- TypeScript strict. `npx tsc --noEmit` must pass with zero errors.
- Shared code in `src/shared` stays pure: no DOM, no Node or Workers APIs, no `Date.now()` or `Math.random()` inside engine functions (pass `now` and `rand` in).
- Change `src/shared/protocol.ts` and `types.ts` by adding, not renaming or removing, unless every caller is updated in the same change.
- Small modules with one job each; no god files. Comments explain why, not what.
- Text from players or LLMs is untrusted: cap its length, never render it as HTML, and never let it pick actions outside the NPC's allowed list.
- NPC memory is per (NPC, player). Never put another player's name, chat or actions into an NPC's prompt, cache or memory. Every model call reserves AiBudget first.
- Tests use Vitest in `test/`. Add tests for engine, maps, NPC rules and server helpers when changing them.
- Art must be CC0 or properly licensed and credited in `src/client/public/assets/**/CREDITS.md`.

## Commands

- `npm run dev:local`: build the client and run everything locally with `wrangler dev --env local` (no Workers AI; NPCs use scripted lines)
- `npm run dev`: same with the real Workers AI binding (needs `wrangler login`)
- `npm run db:migrate:local`: create the Better Auth tables in local D1
- `npm test`, `npm run typecheck`, `npm run e2e` (Playwright: sign up and play through the main flow)
- `npm run deploy`

## Guides

Read these before adding or changing art:

- [docs/guides/assets.md](docs/guides/assets.md): where art lives, licences and credits, style rules, cutting rects, anchors, footprints, furniture, layering, and the checklist before committing art.
- [docs/guides/animated-sprites.md](docs/guides/animated-sprites.md): characters, action and tool layers, monsters, looping props and lids.
- [docs/guides/sprite-lifecycle.md](docs/guides/sprite-lifecycle.md): art that changes state, such as crop stages, wilting and death, soil, trees and stumps, rocks and bins.

## Repo hygiene

- This repo is public: commit code, config, tests, the README and the guides in `docs/guides`. Plans, research notes and design docs stay out of the repo.
- Commits are authored by the repo owner; don't add AI attribution trailers.
