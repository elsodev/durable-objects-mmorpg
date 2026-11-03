# Contributing to DurableMMO

Thanks for helping make Mossbrook better. Bug reports, ideas, fixes, art and new features are all welcome.

## Ways to help

- **Report a bug.** Open an issue with what you did, what you expected and what happened. Add a screenshot and your browser if it's visual. In game, the bug button at the bottom right sends a report with a screenshot too.
- **Suggest a feature.** Open an issue first for anything bigger than a small fix, so we can agree on the shape before you build it.
- **Send a pull request.** Fork the repo, make a branch from `main`, and open a PR against `main`.

## Getting set up

Follow [Run locally](README.md#run-locally) in the README. In short:

```sh
npm install
cp .dev.vars.example .dev.vars   # set BETTER_AUTH_SECRET to 32+ random characters
npm run db:migrate:local
npm run dev:local                # http://localhost:8787
```

`npm run dev:local` needs no Cloudflare account. Villagers use scripted lines there, and dev tools such as `/day` and `/time 21` are on.

## Before you open a pull request

Run the same checks CI runs. All three must pass:

```sh
npm run typecheck
npm test
npm run build
```

For anything players can see, also play it in the browser and attach screenshots (desktop and phone width) to the PR. `npm run e2e` and `npm run e2e:playtest` drive the game with Playwright against a running `npm run dev:local`.

Keep each PR to one change, and explain why it's needed, not just what it does.

## How the game is built

The [README](README.md#how-it-runs-on-cloudflare) explains the architecture. The rules that keep the game correct:

- **The server is authoritative.** Clients send intents; the Worker and Durable Objects check range, ownership, quantities, slots and speed for every message, and may answer with `reject`. Never trust a number the client sends.
- **Identity comes from the Worker.** Durable Objects read who a player is only from the headers the Worker sets after checking the session. Only the owner may change their home.
- **Durable Objects must be able to sleep.** Use the WebSocket Hibernation API, run tick timers only while players are connected, and don't add alarms or timers that reschedule themselves. Idle maps should cost nothing.
- **Never block the tick.** AI and RPC calls run in the background; apply their results when they arrive.
- **Time comes from timestamps.** Crops, regrowth and respawns are worked out from stored times, not from running timers.
- **Keep inventory changes synchronous.** Don't `await` between reading and writing a player's inventory.

## Code style

- TypeScript in strict mode, with zero type errors.
- Code in `src/shared` runs on both server and client, so it stays pure: no DOM, no Node or Workers APIs, and no `Date.now()` or `Math.random()` inside engine functions (pass `now` and `rand` in).
- Change `src/shared/protocol.ts` and `src/shared/types.ts` by adding fields and messages. Rename or remove something only if every caller changes in the same PR.
- Small modules with one job each. Comments explain why, not what.
- Text from players or AI is untrusted: cap its length, never render it as HTML, and never let it choose actions outside a villager's allowed list.
- Add or update Vitest tests in `test/` when you change engine code, maps, villager rules or server helpers.
- Database changes go in a new numbered file in `migrations/`; never edit one that has already shipped.

## Art, music and sound

Every asset must be CC0 or under a license that allows use in this game, and must be credited in the `CREDITS.md` next to it under `src/client/public/assets/`, with its title, author, license, source link and any changes you made. Assets you made yourself need an entry too. Don't add assets taken from other games.

## Security

If you find a security problem (for example a way to change another player's save, get admin rights or upload a harmful file), please don't open a public issue. Report it privately through GitHub's **Report a vulnerability** button on the repository's Security tab. If that button isn't there, open an issue that only asks for a private contact, with no details.

## License

By contributing, you agree that your code is released under the [MIT License](LICENSE). Assets you add keep the license you credit them under.
