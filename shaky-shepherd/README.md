# Snake Game

A client-side Snake game built with [Astro](https://astro.build) and TypeScript. It runs entirely in
your browser — no backend, no login, no ads. Scores and daily progress are saved locally on your
device.

Played at `<base>/Snake-Game/` (deployed to GitHub Pages).

## Game modes

- **Classic** — the original: eat fruit, grow, and don't hit the wall or your own tail.
- **Time Attack** — 60 seconds on the clock. Score as much as you can before time runs out.
- **Zen** — walls wrap around: leave one edge, appear on the other. Only your own tail ends the run.
- **Daily** — a seeded challenge for your local calendar day. Fruit never spawns on the snake, so the
  board always stays winnable. Complete it to keep your streak alive; your best and run history are
  stored locally per day.

Every mode tracks its own best score and best length.

## Controls

- **Steer:** arrow keys or W / A / S / D.
- **Start / pause / resume:** Space.
- **Pause:** P (the game also pauses when the tab loses focus).
- **Restart:** R, or the Play again button on the results screen.
- **Touch:** swipe on the board or use the on-screen direction pad.

## Development

```sh
npm ci          # install dependencies
npm run dev     # start the dev server (use `astro dev --background` for a background server)
npm test        # run unit tests (node --test on src/game/*.test.ts)
npm run test:e2e# run the Playwright suite (spins up dev + preview servers automatically)
npx astro check # type-check the Astro project
npm run build   # build the production site into ./dist/
npm run preview # preview the built site locally
```

### Testing

- **Unit tests** (`src/game/*.test.ts`): run with `node --test` via `npm test`.
- **End-to-end tests** (`e2e/`): Playwright. The config declares a top-level `webServer` array with a
  `dev` project (port 4322, in-browser dev hooks) and a `prod` project (port 4323, built output).
  Servers are started and stopped automatically; run the whole suite with `npm run test:e2e`.

## Project structure

```text
/
├── e2e/                  Playwright specs (dev hooks + production smoke tests)
├── scripts/
│   └── e2e-server.mjs    foreground Astro dev/preview wrapper for Playwright webServer
├── public/               static assets (favicon, og image, sitemap, robots)
└── src/
    ├── components/       Astro components (board stage, stat rail, info rail, SEO content)
    ├── game/             pure game logic + tests (core, modes, daily, timing, storage)
    ├── layouts/          page layout
    └── pages/            routes (index only)
```

The game engine lives in `src/game/`: `core.ts` is the dependency-free simulation,
`modes.ts` is pure mode configuration, and `game.ts` wires the engine to the DOM, canvas, audio, and
localStorage.

## Deployment

The site is deployed to GitHub Pages from the `deploy.yml` workflow. `astro.config.mjs` sets
`base: '/Snake-Game/'`.

## Security

The page ships a strict Content-Security-Policy (see `src/layouts/Layout.astro`):
`default-src 'none'` with scripts restricted to `'self'` plus SHA-256 hashes for the two inline
Google Analytics snippets and their origins, styles to `'self' 'unsafe-inline'`, fonts and images to
`'self'`, and `base-uri`/`form-action`/`frame-ancestors` locked down. If you edit the inline analytics
script in `Layout.astro`, you must recompute its SHA-256 hash and update the CSP, or the browser will
block it.