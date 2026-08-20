# Project Progress

Snake Game (Astro + TypeScript), game code under `shaky-shepherd/src/game/`.

## Completed — Session 1: Snake Gameplay Correctness

- Extracted the game engine into a pure, DOM-free module `shaky-shepherd/src/game/core.ts`
  (explicit `GameStatus` state machine: `idle | running | paused | gameover | cleared`;
  single source of truth replaces the old `running`/`paused`/`gameOver` booleans).
- Fixed tail-collision semantics: moving into the tail's cell is allowed when the tail is
  about to vacate (not eating); it remains a collision when the snake is eating and the
  tail stays put.
- Preserved the 20×20 grid model, food spawning in the interior (cells 1–18), and the
  direction queue (max 2 buffered turns, validated against the last planned direction).
- Verified rapid inputs cannot produce illegal 180° turns (each queued input is checked
  against the direction it will actually follow) and queued turns are consumed in
  deterministic FIFO order.
- Verified food can never spawn on a snake cell; verified the full-board/cleared case
  (`spawnFood` → `null` → `cleared`).
- Kept score, level, speed label/meter, and snake length synchronized after every move
  (`updateHud()` runs on every tick now).
- Restart fully resets all run state and bumps `runId`; stale game-over timers are ignored
  via the `runId` guard.
- Fixed pause/resume so it no longer starts a second animation loop (removed the redundant
  `animate()` call on resume; the single rAF loop stays alive while paused).
- Added deterministic core tests (16) runnable via `npm test` (Node's built-in test runner
  with native TS type-stripping; no new dependencies).

## Completed — Session 2: Mobile UX + Responsive Validation

### Root cause found and fixed: specificity war with scoped styles

The previous page-level responsive CSS in `src/pages/index.astro` used `:global(.stat-rail)`,
`:global(.info-rail)`, `:global(.hero)`, etc. Astro scopes each component's styles as
`.stat-rail[data-astro-cid-…]` (specificity 0,2,0), which **beat** the page's `:global()`
overrides (0,1,0). Net effect on phones: the stat rail never became the intended 3-across
scoreboard (it stacked as a 416px-tall column), shoving the board to y≈777 and the touch
controls/pause far below the fold; the landscape rails also stacked instead of forming the
intended 3-column arcade layout.

Fix: each rail now owns its own responsive rules inside its component's scoped `<style>`
(StatRail, InfoRail, Hero, TouchControls, SiteFooter), applied at full scoped specificity
with media queries ordered base → ≤1020px → ≤700px → short-landscape. `index.astro` keeps
only what belongs to the page: the `.game-layout` grid, `.board-column`, safe-area padding,
and the grid-column/row placement of the side rails. The `:global()` fix from Session 1 is
preserved where still needed (grid placement, `body.is-playing .hero` in Hero).

### Exact fixes

1. **Stat rail 3-across on ≤700px portrait** — moved into `StatRail.astro`; board top dropped
   from ~777 to ~441–490 on phones; the Start button now sits above the fold on ≥360px phones.
2. **Landscape phone board overflow** — board column now `minmax(180px, min(72vh, calc(100vw − 320px)))`
   (was forced 250px via a too-high min). At 667×375 the board is 270×270 fully on-screen
   (was 250px with bottom 41px below the fold). Slim stat/info rails now lay out as the
   intended vertical rails because their internal rules live in their own components.
3. **Info rail strip** — 3-across under the board at ≤1020px, 2-up at ≤700px (nav guide
   dropped), short-landscape right rail. `align-items: center` so the pause button doesn't
   stretch to a full card height.
4. **Pause/primary touch targets** — pause button ≥44px everywhere (48px coarse-pointer
   tablets, 52px on ≤700px / short landscape); overlay primary buttons 52px on ≤700px.
   Removed the ≤1020 `min-height: auto` on `.pause-button` that had shrunk it to 38px.
5. **Direction pad** — pointer-type driven display rules moved into `TouchControls.astro`
   (`pointer: fine` hidden, `pointer: coarse` card-styled, short-landscape hidden). Buttons
   remain 54–58px ≥44px targets with `touch-action: manipulation`.
6. **Hero** — ≤700px padding/margin, ≤360px compact sizing (start button stays above the
   fold on 320px phones), hidden during active play on ≤700px **and** on short viewports
   `max-height: 1020px` (so the board fits fully on 720p/900p laptops and tablet landscape),
   and hidden entirely in short landscape.
7. **Overlay visibility/focus bug** — `.game-overlay` previously transitioned `visibility`
   (0.3s); Chrome flips discrete `visibility` at 50% of the transition, so the freshly shown
   pause overlay stayed `visibility: hidden` ~150ms and `resumeButton.focus()` failed
   silently. Now `visibility` snaps on when showing and only delays on hide
   (`transition: opacity .3s; .hidden { transition: opacity .3s, visibility 0s .3s }`).
8. **Screen-reader status announcements** — new always-in-DOM `visually-hidden`
   `#status-announcer` (`role="status"`) announcing discrete transitions only
   ("Game started…", "Game paused.", "Game resumed.", "Game over. …"), so no per-tick noise.
   Removed the redundant `aria-live` on `#gameover-message` (it lives inside a
   `visibility: hidden` overlay when the text is set, so it could never announce reliably).
9. **Focus management** — pausing focuses the Resume button; resuming returns focus to the
   Pause button (Pause button disabled until a run starts).
10. **CSP manifest fix** — added `manifest-src 'self'` so the PWA web manifest isn't blocked
    by `default-src 'none'`.
11. **Dev-only debug hook** — `window.__serpent.getGame()` exposed only under
    `import.meta.env.DEV` (tree-shaken from the production bundle) to enable automated
    input verification; useful for future DOM-level tests.

### Verified (headless Chrome at real viewport sizes + touch emulation)

All 29 automated interaction/a11y assertions passed: desktop Space/arrows/WASD/P/R,
direction-pad no double-trigger (pointerdown applies; click with `detail>0` ignored),
swipe input, `touch-action: none` on the canvas, status announcements, focus-on-pause,
board squareness, hero hidden during play, no horizontal overflow, ≥44px targets, tablet
3-across info rail, reduced-motion (orb animation killed, no JS errors), high-DPR
(backing store capped at 2× = 1600×1600), landscape board fully on-screen.

Viewports validated: 320×568, 360×800, 375×667, 375×812, 390×844, 412×915, 430×932,
480×320, 568×320, 667×375, 740×360, 768×1024, 800×600, 820×1180, 1024×768, 1180×820,
1280×720, 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080.

### Files changed (Session 2)

- `shaky-shepherd/src/pages/index.astro` — dropped broken `:global()` rail overrides; keeps
  only page-grid rules; landscape board `minmax(180px, min(72vh, calc(100vw − 320px)))`.
- `shaky-shepherd/src/components/StatRail.astro` — 3-across ≤700px + slim landscape rules.
- `shaky-shepherd/src/components/InfoRail.astro` — 3-across ≤1020px, 2-up ≤700px, slim
  landscape rail; centered alignment.
- `shaky-shepherd/src/components/TouchControls.astro` — pointer-type + landscape display.
- `shaky-shepherd/src/components/Hero.astro` — mobile padding, ≤360px compact, play-hide on
  ≤700px/short viewports, landscape hide.
- `shaky-shepherd/src/components/SiteFooter.astro` — hidden in short landscape.
- `shaky-shepherd/src/components/GameStage.astro` — overlay visibility transition fix,
  `#status-announcer` live region, 52px primary buttons on ≤700px, removed redundant
  `aria-live` from game-over message.
- `shaky-shepherd/src/game/game.ts` — announcements, focus management, dev-only debug hook.
- `shaky-shepherd/src/layouts/Layout.astro` — `manifest-src 'self'` in CSP.
- `shaky-shepherd/src/styles/global.css` — `visually-hidden` utility.

## Completed — Session 3: Game Feel + Rendering Performance

### Rendering Performance Optimizations

1. **Background caching via OffscreenCanvas** — Static background layers (radial gradients, star field, grid lines, board border) are now pre-rendered once to an `OffscreenCanvas` at mount time. Each frame draws the cached image via single `drawImage()` call instead of recreating 3 gradients + 100 stars + 42 grid lines + border. Stars still flicker on top when not in reduced-motion mode. Falls back gracefully to per-frame rendering if OffscreenCanvas unavailable.

2. **Snake rendering overhaul** — Eliminated per-segment gradients and `shadowBlur` in the hot path. Body segments now use single `hsl()` fills with interpolated hue/lightness, drawn as simple arcs. Shadow only applied once to the whole stroke path (when not reduced-motion), not per segment. Head retains clear visual priority with highlight and eyes. Before: ~40 segments × (gradient + shadowBlur + stroke + fill) per frame. After: 1 shadow pass + ~40 simple arcs + 1 head highlight.

3. **Smooth visual interpolation** — Added frame-accurate interpolation (`interp = elapsed / moveDelay`) between logical grid positions. Snake renders at `lerp(prev, curr, interp)` without ever changing game state or collision logic. `prevSnake` snapshot captured on each `move()` and on resume. Pause/resume correctly resets `prevSnake` to avoid jump.

4. **Particle/ripple lifecycle caps** — Added `MAX_PARTICLES = 120` and `MAX_RIPPLES = 8` constants. `makeBurst()` respects remaining capacity. `drawEffects()` trims ripples array. Prevents unbounded growth during extended play.

5. **Food rendering cleanup** — Aura gradient created once per frame (not per draw call), rotation skipped entirely in reduced-motion. Core gradient unchanged.

6. **Level-up feedback** — On level increase: golden screen flash (0.18s fade), three-note ascending chime (440→554→659 Hz). Purely visual/audio; no gameplay impact.

7. **Animation loop guard** — rAF only scheduled when `isActive() || particles.length || ripples.length`. Removed redundant `animate()` calls; single loop stays alive during pause (per Session 1 fix). `lastMove` reset on resume prevents instant-move bug.

8. **Reduced-motion compliance** — Stars static (no flicker), food rotation disabled, particle count halved, ripple aging 2× faster, snake shadow omitted, interpolation still runs (deterministic, no animation).

### Before/After Rendering Cost Summary

| Metric | Before | After |
|--------|--------|-------|
| Gradients/frame | ~3 (bg) + 40×2 (snake) + 2 (food) ≈ 85 | 0 (bg cached) + 0 (snake) + 2 (food) ≈ 2 |
| ShadowBlur calls | 40/frame | 1/frame (or 0) |
| Star draws/frame | 100 | 100 (unchanged, trivial) |
| Grid draws/frame | 42 lines | 0 (cached) |
| Particle cap | unbounded | 120 |
| Ripple cap | unbounded | 8 |

### Verified

- `npm run build` — passes
- `npx astro check` — 0 errors
- `npm test` — 16/16 core tests pass
- Dev server runs without errors
- Pause/resume, reduced-motion, level-up, interpolation all functional manually

### Files changed (Session 3)

- `shaky-shepherd/src/game/game.ts` — All rendering, interpolation, caching, caps, level-up feedback

## Completed — Session 4: Results Screen + Replay Loop + Game Analytics

### Death-reason tracking (core)

- `core.ts` now carries `deathReason: 'wall' | 'self' | null` on `GameState`, set on collision
  (`hitWall ? 'wall' : 'self'`), cleared on `startRun`, `null` on `cleared`. `endGame` uses it
  for failure-specific messaging.
- Added pure helpers to `core.ts`: `formatDuration(ms)` → `m:ss`/`h:mm:ss` and
  `buildShareMessage(score, isNewBest)` → `"I scored X in Snake Game. Can you beat me?"` /
  `"New high score of X in Snake Game. Can you beat me?"`.

### Game-over experience (GameStage.astro + game.ts)

- Redesigned `#gameover-overlay` around player information and replay, keeping the visual
  language (eyebrow kicker, display-tight headline, mono stat labels, sunset accents):
  - Big SCORE value + glowing **NEW BEST** badge (toggled via `.is-new-best`).
  - Compact 3×2 stat grid: BEST, LEVEL, LENGTH, LONGEST, FRUIT, TIME.
  - Failure-specific messaging: `RUN TERMINATED / The perimeter won.` (wall),
    `RUN TERMINATED / Tangled up in yourself.` (self), `GARDEN CLEARED / The garden is clear.`
    (board cleared). Removed the old single verbose paragraph (copy reduction).
  - Primary **Play again** (R) button + secondary **Share score** button.
- `endGame(reason)` now populates all stat cells, toggles the badge, persists bests, announces a
  concise screen-reader summary, and only *then* shows the overlay (existing 390 ms burst delay).
- Responsive: grid collapses/compact on ≤480 px, 52 px touch targets ≤700 px, stats grid hidden
  in short-landscape (score + actions only). Share button hidden when no share channel exists
  (`[hidden]` + explicit `display:none` rule so `.btn-pill` display can't override it).

### Run metrics

- **Run duration**: active play time excluding pauses — `runStart`/`activeRunMs` accumulate on
  pause/resume/game-over (pause & blur/visibility auto-pause both flow through `togglePause`).
- **Longest length**: `maxLength` updated on every `move()`; final + persisted best length stored.

### Local persistence (`storage.ts`)

- New `src/game/storage.ts`: safe, never-throwing wrappers over `localStorage`
  (`readStoredNumber`, `writeStoredNumber`, `readPreference`, `writePreference` +
  `STORAGE_KEYS`). Replaces the raw `localStorage.getItem('serpent-high-score')` block.
- Persists best score (`serpent-high-score`) and best length (`serpent-best-length`).
  Preference helpers keyed under `serpent-pref:` ready for future prefs (audio/theme).

### Score sharing (`game.ts` `shareScore`)

- Web Share API when available (`navigator.share`, user-gesture click); on non-abort failure or
  missing API, clipboard fallback (`navigator.clipboard.writeText`) with a brief **Copied!**
  label; graceful no-op if neither exists (button hidden ahead of time). No login/backend.
- `share_score` GA event includes `share_method: web-share | clipboard | unsupported`.

### Google Analytics (`src/lib/analytics.ts`)

- New `trackEvent(name, params)` — fire-and-forget, try/catch-wrapped, never throws, discrete
  events only (no per-frame traffic), no PII. Mode is `'classic'` (no mode selector exists yet).
- Instrumented events + params:
  - `game_start` — score, level, snake_length, duration, mode
  - `game_over` — + is_new_best, death_reason (`wall|self|cleared`)
  - `new_high_score` — same as game_over (fired only when is_new_best)
  - `level_up` — score, level, snake_length, duration, mode
  - `pause` / `resume` — current run params
  - `share_score` — + is_new_best, share_method
- **CSP / GA loading verified end-to-end**: the existing inline GA snippet's SHA-256
  (`EclVj+…`) *does* match the emitted inline script, so `dataLayer`/`gtag` are defined and the
  snippet runs under the current CSP. The Session-3 "GA blocked" note was stale — confirmed by
  headless-browser assertion (`Array.isArray(window.dataLayer) && typeof window.gtag === 'function'`).

### Verified (headless Chrome CDP smoke harness, 32/32 checks)

1. CSP inline GA runs (`dataLayer` + `gtag` defined).
2. First run: `game_start` fires with `score 0 / level 1 / snake_length 4 / mode classic`.
3. Wall death: overlay shows `The perimeter won.` + `RUN TERMINATED`, all seven stats correct
   (`000` score, `000` best, `01` level, `4` length, `4` longest, `0` fruit, `m:ss` time), no
   NEW BEST, `game_over` with `death_reason: wall`, `is_new_best: false`, no `new_high_score`.
4. Share success: clipboard text `"I scored 0 in Snake Game. Can you beat me?"`, `share_score`
   `share_method: clipboard`.
5. Share fallback: with both `navigator.share` and `navigator.clipboard` stubbed off, click is a
   no-op, `share_score` `share_method: unsupported`.
6. Second run (replay loop): PLAY AGAIN resets overlays + `is-playing`, fires a fresh
   `game_start`.
7. Non-new high score: seeded best `050` shows in the stat rail after reload, `final-best` `050`,
   no `new_high_score`, best unchanged.
8. Analytics unavailable/blocked: `gtag = undefined` and `gtag = () => { throw … }` both leave
   gameplay + game-over fully functional.
9. New high score (dev server + `__serpent.getGame()` greedy solver, ate 2 fruits): score 20 > 5,
   NEW BEST badge shown, `final-best` `020`, `localStorage` updated, `new_high_score` +
   `game_over` fire with `is_new_best: true`, `death_reason: wall`.

`npm test` 22/22, `npx astro check` 0 errors, `npm run build` passes.

### Files changed (Session 4)

- `shaky-shepherd/src/game/core.ts` — `deathReason`, `formatDuration`, `buildShareMessage`.
- `shaky-shepherd/src/game/core.test.ts` — 6 new tests (deathReason × 4, formatDuration,
  buildShareMessage).
- `shaky-shepherd/src/game/storage.ts` — new safe localStorage wrappers.
- `shaky-shepherd/src/lib/analytics.ts` — new `trackEvent`.
- `shaky-shepherd/src/components/GameStage.astro` — results-screen overlay markup + styles.
- `shaky-shepherd/src/game/game.ts` — metrics, share, analytics, NEW BEST, reason messaging.

## Completed — Session 5: Brand, SEO and Content Quality Cleanup

### Brand identity simplified to "Snake Game"

Removed the invented "SERPENT / Serpent Systems / Arcade Protocol" organization and the unrelated
garden / solar-fruit / signal / orb metaphors from all user-visible copy. One coherent identity now
runs through the page: this is **Snake Game**.

- `TopBar.astro` — wordmark now reads "Snake Game" (tighter tracking tuned for the longer word);
  "ARCADE PROTOCOL" + pulsing live-dot replaced with a natural **How to play** anchor to `#how-to-play`.
- `Hero.astro` — subtitle rewritten ("The classic arcade game, sharpened for your browser…"); kept the
  descriptive H1 "Play *Snake Game* online." and "THE CLASSIC SNAKE GAME" eyebrow.
- `SiteFooter.astro` — "© 2026 SERPENT SYSTEMS / ALL SYSTEMS NOMINAL / HIGH-FIDELITY ARCADE" →
  "© 2026 Snake Game · Built by yashkharb" + "Free to play — no account needed".
- `GameStage.astro` overlays — "SYSTEM READY / Enter the garden / solar fruit / SIGNAL HELD / the
  garden is holding its pulse" → "GET READY / Ready to play? / steer with arrow keys, WASD, or a
  swipe / PAUSED / take a breath — pick up right where you left off". `.overlay-orb` class renamed
  `.overlay-glow`.
- `game.ts` — game-over copy: "GARDEN CLEARED / The garden is clear / The perimeter won /
  Tangled up in yourself" → "BOARD CLEARED / You cleared the whole board! / You hit the wall. /
  You ran into yourself." (same for the screen-reader announcement). Score-rail hint: "FIND THE
  FIRST ORB / SEGMENTS SYNCHRONIZED" → "EAT FRUIT TO SCORE / LENGTH N". Fatal-error banner now says
  "Snake Game could not run…".
- `InfoRail.astro` — "SOLAR FRUIT +10 ENERGY" → "FRUIT +10 POINTS". `StatRail.astro` — "VELOCITY" →
  "SPEED".
- `global.css` — token comment header updated.
- Left intact on purpose: `serpent-*` localStorage keys (renaming would discard saved scores) and
  `[serpent]` console-warn prefixes (never surface in the UI, dev-only `__serpent` hook still
  tree-shaken from the bundle).

### SEO content rewritten (much shorter, human-first)

`SeoContent.astro` went from ~7 keyword-stuffed sections (90+ lines, "google snake game", "snake
game 2 / snake game 3", repeated bolded phrases) to a concise, player-useful section:

- **How to play Snake Game** — what the game is in two sentences.
- **Controls** — keys (arrows/WASD, Space, P, R) + touch (swipe / direction pad).
- **Why this version** — no download/login, works on desktop/tablet/phone, best score saved on
  device, pause + share.
- **A few tips** — four genuine, actionable tips.

No fake reviews, ratings, or social proof were added. Section is anchored as `#how-to-play`.

### Metadata and structured data (`Layout.astro`)

- Title: `Snake Game — Play the Classic Arcade Game Online` (was keyword-stuffed).
- Description: `Play Snake Game online for free. Steer the snake, collect fruit, grow longer, and
  chase your high score. No download or login needed — works on desktop and mobile.`
- Removed the `keywords` meta tag (keyword stuffing; ignored by search engines).
- JSON-LD now a single `@graph` with **WebSite** (site root) + **VideoGame** (factual: no invented
  `author` Organization; added `gamePlatform: Web Browser`, `operatingSystem: Any web browser`).
- OG/Twitter copy updated to match; `og:image:alt` rewritten; added `application-name` and fixed
  `apple-mobile-web-app-title` to "Snake Game".
- Kept: canonical `https://yashkharb.github.io/Snake-Game/`, robots index/follow, CSP, self-hosted
  fonts, GA, favicon links, PWA manifest link.

### OG image regenerated from the actual game identity

- New 1200×630 `public/og-image.png` (was a 135 KB placeholder PNG that could not be audited
  visually): near-black canvas, faint star field + warm/cool radial washes, rounded grid board,
  orange gradient snake winding through right-angle turns with head + eyes, glowing fruit ahead of
  the head, and "Snake Game" in the real Outfit face with DM Mono kicker/meta lines.
- Generator kept at `shaky-shepherd/scripts/og-image.html` (self-renders via headless Chrome:
  `--headless=new --window-size=1200,630 --screenshot`) so the asset is reproducible; uses the
  self-hosted fonts, so it matches the live design.

### Verified

- `npm run build` passes; `npx astro check` 0 errors; `npm test` 22/22.
- Inspected `dist/index.html`: title, description, canonical
  `https://yashkharb.github.io/Snake-Game/`, OG/Twitter tags (absolute image URL + 1200×630),
  `@graph` JSON-LD (WebSite + VideoGame, no fake org), all asset paths prefixed `/Snake-Game/…`,
  no `keywords` meta, valid UTF-8 em-dash bytes (`E2 80 94`).
- Headless-Chrome smoke test (served dist at `/Snake-Game/`): game boots with no `.fatal-error`,
  new overlay/rail/footer/topbar copy present, old metaphors absent, `#how-to-play` anchor + How to
  play link present, pause button disabled pre-run.
- Production bundle contains the new game-over strings and none of the old ones
  ("GARDEN CLEARED", "perimeter won", "SIGNAL HELD", etc.).

### Files changed (Session 5)

- `shaky-shepherd/src/layouts/Layout.astro` — title/description, dropped keywords meta, `@graph`
  structured data, OG/Twitter/alt copy, app-name metadata.
- `shaky-shepherd/src/components/TopBar.astro` — "Snake Game" wordmark + How to play link.
- `shaky-shepherd/src/components/Hero.astro` — subtitle copy.
- `shaky-shepherd/src/components/SeoContent.astro` — rewritten, shortened, `#how-to-play` anchor.
- `shaky-shepherd/src/components/SiteFooter.astro` — attribution + free-to-play line.
- `shaky-shepherd/src/components/GameStage.astro` — overlay copy, `.overlay-glow` rename.
- `shaky-shepherd/src/components/StatRail.astro` / `InfoRail.astro` — SPEED / FRUIT +10 POINTS.
- `shaky-shepherd/src/game/game.ts` — game-over + HUD copy.
- `shaky-shepherd/src/styles/global.css` — comment header.
- `shaky-shepherd/public/site.webmanifest` — clean name/short_name/description.
- `shaky-shepherd/public/sitemap.xml` — lastmod 2026-08-19.
- `shaky-shepherd/public/og-image.png` — regenerated. `shaky-shepherd/scripts/og-image.html` — new
  reproducible OG-image generator (not shipped to dist).

## Completed — Session 6: Game Modes and Differentiation

### Feature architecture: a mode configuration model

The engine stays one reusable simulation (`src/game/core.ts`); modes are pure data in
`src/game/modes.ts`. The runtime (`game.ts`) holds exactly one active mode and feeds its flags
into the shared `step()` — mode identity is never branched on inside the simulation hot path.

- `GameMode` = `id | name | shortName | tagline | description` + `rules` (`wrap`, `timeLimitMs`,
  `hasObstacles`) + `scoring` (`pointsPerFruit`) + mode-specific storage keys.
- `GAME_MODES` registry, `MODE_IDS`, `DEFAULT_MODE_ID = 'classic'`, `getMode()`, `isGameModeId()`
  (the last also guards the persisted preference).
- `step(state, options)` now takes `{ rng?, wrap?, pointsPerFruit? }`; defaults reproduce the
  exact classic behavior, so the engine was not destabilized. `DeathReason` extended with `'time'`.
- Mode selection persists under `serpent-pref:mode`; switching modes resets the run to a fresh
  idle state (board, overlays, HUD, bests) without touching the engine.
- Best score/length are mode-specific (`serpent-time-attack-best`, `serpent-zen-best`, …).
  Classic keeps the legacy `serpent-high-score` / `serpent-best-length` keys so saved records
  survive.
- `formatCountdown(ms)` added (rounds up to the next whole second) for the countdown display.

### Completed modes

1. **CLASSIC** — unchanged standard Snake: walls and your own tail end the run, 10 pts/fruit,
   level/speed ramp. Regression-verified (still dies at the wall exactly as before).
2. **TIME ATTACK** — fixed 60-second limit; maximize score. The stat-rail SPEED card becomes a
   clear countdown (`TIME` + mm:ss + a meter that drains to zero). The run ends at 0:00 with a
   dedicated **TIME UP** results screen; walls/self-collision still end it early. Time is active
   play time (pauses freeze the countdown).
3. **ZEN** — walls wrap: leave one edge, re-enter on the opposite edge. Only your own tail ends
   the run. Tail-vacate semantics are preserved across the wrap (moving into the vacating tail
   cell is legal — unit-tested); a snake wrapping onto a non-tail body cell dies (`self`). No
   timer.

### UI

- **ModePicker.astro** — lightweight 3-tab segmented control above the board, generated from
  `GAME_MODES`, with `aria-pressed` state, per-mode description line, and the active mode's
  rule note on the start screen. Visible when idle and again on the results screen; hidden during
  a run (switching mid-run is rejected).
- **Board mode badge** — small top-center chip (`#mode-badge`, z-index above overlays) showing the
  current mode during gameplay and on every results screen.
- Start-overlay copy now shows the active mode's true rules (Classic walls / Time Attack clock /
  Zen wrap) instead of a Classic-only sentence.

### Analytics

- Every event's `mode` param now reflects the real active mode (`classic | time-attack | zen`).
- New `mode_select` event with `mode` + `previous_mode`.
- Time-expiry runs report `death_reason: time` on `game_over` / `new_high_score`.

### Tests

- `core.test.ts` grew wrap tests (6: right-edge, top-edge, wrap-vs-no-wrap contrast, non-tail
  wrap collision, tail-vacate-across-wrap legality, per-fruit scoring) plus `formatCountdown`.
- New `modes.test.ts` (6): registry shape, classic purity, time-attack limit, zen wrap, guard
  helpers, default mode.
- `npm test` now runs both files: **36/36** (was 22).
- `npx astro check` 0 errors; `npm run build` passes.

### Verified (headless-Chrome CDP harness, 46/46 checks)

Dev server (dev hook): boots clean; classic default; picker visibility lifecycle; zen wrap keeps
the run alive across the wall while classic still dies there; mode persists across reload
(`serpent-pref:mode`); time-attack countdown renders (`TIME`, `1:00`, `TARGET 1:00`); mode locked
during an active run; time-expiry shows **TIME UP** with a single `game_over` `death_reason: time`
(the engine now freezes the run when the timer hits zero, so no phantom wall death follows);
analytics `mode`/`mode_select`/`previous_mode` verified against the real gtag.js dataLayer shape.
Production dist: boots with no fatal error, inline GA runs under CSP (`gtag` defined), dev hook
tree-shaken out, mode switching via real clicks updates badge/note/persistence, countdown card
switches on.

### Files changed (Session 6)

- `src/game/modes.ts` — new: mode configuration model + registry.
- `src/game/modes.test.ts` — new: mode model tests.
- `src/game/core.ts` — `StepOptions` (`wrap`, `pointsPerFruit`), `'time'` death reason,
  `formatCountdown`.
- `src/game/core.test.ts` — updated `step` signature + new rule tests.
- `src/game/game.ts` — active-mode state, `selectMode`, mode picker/badge/note wiring,
  time-up enforcement in `tick`, time-attack HUD countdown, mode-specific bests, `mode` +
  `mode_select` analytics, dev-hook `getMode`/`selectMode`.
- `src/components/ModePicker.astro` — new: segmented mode selector.
- `src/components/GameStage.astro` — `#mode-badge` chip, `#start-mode-note`, overlay copy.
- `src/components/StatRail.astro` — `#speed-label` id (repurposed for the TIME card).
- `src/pages/index.astro` — mounts `<ModePicker />` in the board column.
- `package.json` — test script covers both test files.

## Known remaining issues

- No committed UI/DOM test suite; verified each session via ad-hoc headless-Chrome CDP harnesses
  (Session 4: 32 assertions, Session 6: 46). Core logic stays unit-tested (36 tests).
- `body.is-playing` is added on run start and never removed (pre-existing), so the Hero stays
  hidden after the first run. Deliberately left untouched to avoid layout churn; the mode picker
  manages its own visibility independently.
- `cleared` (full-board) and `self`-collision game-over messaging are logic-verified (core
  `deathReason` tests + code path) but not exercised end-to-end — board-clear needs 342 fruit;
  self-collision is impractical to script deterministically.
- Best length is persisted (mode-specific keys) but not surfaced in the UI yet.
- `frame-ancestors` CSP directive is ignored when delivered via a `<meta>` tag (Chrome warning
  only; the real header isn't served).
- No `@types/node` in devDependencies, so `*.test.ts` files are excluded from `astro check`
  type-checking (they still run and assert at runtime).
- No visual regression checks for the game board / results overlay / mode picker.
- Time Attack and Zen analytics flows were verified via the dev harness; Zen wall-wrap is
  verified live (still-running assertion) and unit-tested for exact cell semantics.
- No daily challenges or backend leaderboards — intentionally out of scope this session.
- Internal `serpent-*` localStorage keys and `[serpent]` console-warn prefixes remain (rename would
  discard saved scores / purely dev-facing); the OG image was verified structurally, not visually
  (regenerable via `scripts/og-image.html`).

## Session 7 (complete) — Daily Challenge + final polish

Deterministic, backend-free Daily Challenge with a seeded PRNG, plus layout polish and a final
verification pass.

- `src/game/daily.ts` — new: `dailyDateKey` (local calendar date `YYYY-MM-DD`), FNV-1a
  `hashString`, `mulberry32` PRNG, `generateDailyChallenge` (60 precomputed fruits), date/share
  helpers (`formatDailyDate`, `buildDailyShareMessage`), `DAILY_CHALLENGE_PARAMS`.
- `src/game/daily.test.ts` — new: determinism/persistence tests (5 required properties) plus
  hash/PRNG/food-position/share-text extras.
- `src/game/core.ts` — `StepOptions.foodSource?: (snake) => Cell | null`; null ⇒ 'cleared'.
  Classic mode unchanged (still `Math.random`).
- `src/game/core.test.ts` — foodSource tests.
- `src/game/modes.ts` / `modes.test.ts` — 4-mode registry incl. `'daily'`; daily assertions.
- `src/game/storage.ts` — `DAILY_KEYS`, `DailyStatus`, read/write helpers, `setStorageBackend`
  test injection (window-guarded).
- `src/game/game.ts` — `ensureDailyForToday`, `dailyFoodSource`, `refreshDailyUI` (date, BEST,
  TODAY), midnight rollover timer, copy/share with date text, daily branch in mode selection /
  reset / run end, dev-hook additions (`__serpent` tree-shaken from prod).
- `src/components/GameStage.astro` — daily overlay elements (`#start-kicker`, `#daily-date`,
  `#daily-best`, copy/share buttons) + responsive CSS (compact ≤480px, landscape).
- `src/components/{Hero,ModePicker,StatRail}.astro`, `src/pages/index.astro` — mobile polish so
  the CTA sits above the fold on ≥360px portrait and the board fits short landscape.
- `package.json` — test script includes `daily.test.ts`.

Design: same local calendar date ⇒ identical challenge for every player; no backend, no global
leaderboards; fruits fixed in advance (player-independent) but can be covered by the snake later
(documented puzzle property).

## Session 8 (complete) — Timing interpolation + Daily rewrite

- `src/game/timing.ts` — new pure helpers (`timing.test.ts`, 7 tests) for smooth interpolation
  (`advanceLastMove`, render-alpha derivation) so the canvas never renders ahead of the simulation
  tick, including after eating (delay change) and after pause/resume.
- `src/game/daily.ts` — reworked from "60 precomputed fruits" to **lazy, snake-aware** placement:
  `dailyFoodFor(dateKey, fruitIndex, snake)` resolves each fruit deterministically on a free cell,
  so covered fruits never stay "lost". `dailyFoodIndex` counts the next fruit to place
  (`firstDailyFood` sets it to 1); progress = `dailyFoodIndex - 1`; the run clears after exactly
  `DAILY_FOOD_COUNT` (60) fruits.
- `src/game/daily.test.ts` — BFS completion simulation proves the seeded daily is always winnable.
- Total **63 unit tests** green; `npx astro check` 0 errors; `npm run build` passes.

## Session 9 (complete) — Playwright end-to-end suite + CI gates

- New Playwright setup (`@playwright/test ^1.62.1`, Chromium): `playwright.config.ts`, `e2e/dev/`
  (in-browser dev hooks) and `e2e/prod/` (built output smoke tests).
- **Root cause found:** Playwright's `webServer` is a **top-level-only** option — a per-project
  `webServer` is silently ignored (`this.webServers` reads only `userConfig.webServer`), so tests ran
  against nothing and got `ERR_CONNECTION_REFUSED`. Fixed by moving `webServer` to the top level as a
  two-entry array (`dev` on 4322, `prod` on 4323, both bound to `127.0.0.1`, `reuseExistingServer:
  !process.env.CI`).
- **Second root cause:** Astro 7.x auto-daemonizes `astro dev`/`astro preview` when it detects an
  agent environment (env-gated by `ASTRO_DEV_BACKGROUND`/`ASTRO_PREVIEW_BACKGROUND`). `scripts/
  e2e-server.mjs` is a foreground wrapper that sets those vars and stays alive as Playwright's
  spawned child.
- `tsconfig.json` now excludes `e2e`, `scripts`, and `playwright.config.ts` from `astro check`
  (node-side code, not browser scope).
- e2e test fixes: `__serpent` hook methods are invoked inside `page.evaluate` (returning the hook
  object loses functions via serialization); the "mode picker locked while running" test now asserts
  the picker is visible → hidden during a run → visible again after game over.
- Full suite green: **22 e2e tests** (16 dev + 6 prod); Playwright-managed servers start and are
  cleaned up after the run.
- `deploy.yml` now runs `npm test`, `npx astro check`, `npx playwright install --with-deps chromium`,
  and `npm run test:e2e` before `npm run build`.

## Session 10 (complete) — Mode-aware info + Daily retention

- **Start-screen mode line** (`#start-mode-info`): Classic "NO TIME LIMIT · WALLS END THE RUN",
  Time Attack `TARGET 01:00 · BEST nnn`, Zen "WALLS WRAP · LEAVE ONE EDGE, APPEAR ON THE OTHER",
  Daily `FRUITS n / 60`.
- **Mode-aware score detail** (`#score-detail`): Time Attack `TARGET 01:00`; Daily
  `CHALLENGE · 60 FRUITS` idle → live `FRUITS n / 60` during a run (from `dailyFoodIndex − 1`);
  Classic `EAT FRUIT TO SCORE` / `LENGTH n`.
- **Results screen** — new wide **BEST LENGTH** row (`#final-record`, spans the 3-col grid)
  surfacing the persisted per-mode best length.
- **Daily history + streak** (`storage.ts`): `DAILY_KEYS.history` (`serpent-daily-history`),
  `readStoredDailyHistory`, `recordDailyResult` (upserts a finished run into history while updating
  today's status), and pure `computeDailyStreak` (consecutive completed days ending today, or ending
  yesterday while today is pending). `daily.ts` gained `previousDayKey` (month/year-safe). Start
  screen shows `STREAK n DAYS` when active.
- `src/components/SeoContent.astro` rewritten: truthful 4-mode explainer + FAQ (no backend /
  leaderboard, offline, local-storage caveats). `README.md` fully rewritten (modes, controls, dev +
  test commands, structure, deployment, CSP note).
- Tests: **67 unit tests** (4 new: history persistence + corrupt history, streak × 2, previousDayKey
  boundaries). 0 astro errors; build passes.

## Session 11 (complete) — Audio mute, a11y, metadata

- **Sound toggle** (`#sound-button` in InfoRail + `M` key): toggles WebAudio tones, persists under
  `serpent-pref:audio`, `aria-pressed` reflects state, announced via the status region. New e2e test
  covers button + keyboard + reload persistence.
- **A11y** — `#gameover-overlay` is now `role="dialog"` with `aria-labelledby`/`aria-describedby`;
  focus already moves to the Play-again button when it appears; mode selection announces the new
  mode + tagline; reduced-motion behavior preserved.
- **Metadata** — `public/sitemap.xml` `lastmod` bumped to 2026-08-20; CSP documented in the README
  (incl. the SHA-256 hash caveat for the inline GA snippets).
- Full suite: **23 e2e tests** green (added the sound-toggle spec).

## PRODUCT READY STATUS

Status: **READY for production deployment.** Astro site builds cleanly and deploys to GitHub Pages.

### Gameplay
- All 4 modes work end-to-end (Classic, Time Attack, Zen, Daily), each with its own best-score and
  best-length persistence; DAILY CHALLENGE is deterministic per local date, auto-flips at local
  midnight, shows live fruit progress and a completion streak, and has copy/share buttons that
  include the date.
- Board-clear ('cleared') and self-collision end states are logic-tested but not scripted
  end-to-end (board-clear needs 342 fruit; self-collision is impractical to script).

### Mobile
- CTA button above the fold on ≥360px-wide portrait phones; board fits fully on-screen in short
  landscape; no horizontal overflow at any tested viewport (375×667, 360×640, 568×320, 740×360,
  667×375, 1280×720, 1440×900). 320×568 is an accepted edge case (CTA needs a small scroll).

### Performance & correctness
- 67 unit tests pass (core, modes, daily, timing). `astro check`: 0 errors / 0 warnings. Production
  build passes; dev-only `__serpent` hook and test IDs verified tree-shaken from the shipped bundle;
  challenge-critical generation never calls `Math.random` (verified in minified output).

### End-to-end
- Playwright suite green: **23 tests** (17 dev + 6 prod) covering start/steer/pause/restart, mode
  locking, wall/zen/time/daily endings, best persistence across reload, share/clipboard, sound
  toggle, status announcements, and desktop/portrait/landscape layout fit. Servers (dev 4322 / prod
  4323) are auto-managed via the top-level `webServer` array.

### Accessibility / UX
- Semantic `<button>` elements with labels, visible focus states, `aria-hidden` decorative layers,
  sufficient contrast, `role="dialog"` results overlay, live status announcements, mode-change
  announcements, reduced-motion support, and an audio mute toggle.

### Analytics, SEO, sharing
- GA4 (`G-KKNVC77HXJ`) wired; `<title>`, meta description, OG/Twitter image, canonical URL
  (`https://yashkharb.github.io/Snake-Game/`), JSON-LD game schema, robots meta all verified present
  in the production HTML. Share text includes the daily date. sitemap `lastmod` current.

### Known gaps (honest)
- No mid-run persistence (leaving the page loses the run); fixed daily fruit can be covered by the
  snake later; no visual regression suite (layout is guarded by Playwright bounding-box tests);
  `frame-ancestors` CSP meta directive ignored by Chrome (the real header isn't served); test files
  excluded from `astro check` typing (no `@types/node`); board-clear/self-collision not scripted
  e2e.

## Future work (ranked by impact)

1. **Mid-run persistence** — snapshot state to `sessionStorage` and restore on reload so a
   backgrounded tab doesn't end the run.
2. **Daily month archive** — extend the per-day history (already stored) into a browsable "this
   month" calendar view.
3. **Real obstacle/wall-blocker system** — new `'obstacles'` mode with deterministic layouts (reuses
   the seeded-PRNG approach from the daily challenge).
4. **PWA offline support** — manifest + service worker for installable/offline play; the site is
   fully static, so this is low-effort and high payoff.
5. **Visual regression suite** — commit Playwright-based screenshots of board/results/mode picker at
   the key viewports to stop layout regressions like the Session 7 CTA-fold fix.
6. **Share image generation** — render a per-score OG-style image (client-side canvas or serverless)
   for richer social shares than the generic card.