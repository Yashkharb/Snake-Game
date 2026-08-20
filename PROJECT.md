# PROJECT.md — Snake Game (retention/replayability project)

# very important: Always read Deepseek-rules.md before every session(session 1 is already complete so don't worry about that)

Persistent source of truth between sessions. Read this first. Detailed session history lives in `PROJECT_PROGRESS.md`; this file is the working state + roadmap for the retention system.

## Project

Astro 7 + TypeScript Snake game in `shaky-shepherd/`, deployed to GitHub Pages (static, no backend). Visual language: near-black canvas, white outline pills, mono-caps labels, sunset/dusk accents (see `DESIGN.md`).

## Commands (run in `shaky-shepherd/`)

- `npm test` — Node test runner with native TS type-stripping (unit tests, `src/game/*.test.ts`)
- `npx astro check` — type check (test files excluded via tsconfig; no `@types/node`)
- `npm run build` — production build (output `dist/`)
- `npm run test:e2e` — Playwright (dev on 4322, prod on 4323; servers auto-managed)

## Architecture map

| File | Role |
|---|---|
| `src/game/core.ts` | Pure DOM-free simulation (`GameState`, `step()`, `getLevel`, death reasons, formatters). No persistence, no UI. |
| `src/game/modes.ts` | Data-driven mode registry (`GameModeId = classic \| time-attack \| zen \| daily`), per-mode storage keys. |
| `src/game/daily.ts` | Seeded Daily Challenge (FNV-1a + mulberry32, snake-aware lazy fruit placement, 60 fruits). |
| `src/game/timing.ts` | Interpolation / move-due helpers. |
| `src/game/combo.ts` | Combo + risk scoring (Session 4): pure per-mode config, chain/streak state machine, `scoreFruit`/`scoreCloseCall`/`expireCombo`. No DOM, no storage. |
| `src/game/food.ts` | Special food (Session 5): pure per-mode `FoodRules`, weighted type roll, effect state machine (`FoodEffects`), effective speed/multiplier, time bonus. No DOM, no storage. |
| `src/game/storage.ts` | ALL persistence: safe (never-throwing) localStorage wrappers, key constants, daily status/history. |
| `src/game/progression.ts` | Player profile model, XP rules, ranks, `applyRunResult` (pure). Persistence goes through storage.ts. |
| `src/game/missions.ts` | Mission system (Session 2): template pool, generation (rank-weighted), progress events, completion + replacement (pure). Persistence goes through storage.ts. |
| `src/game/achievements.ts` | Achievement system (Session 3): data-driven definitions, condition evaluation, skill-feel detectors (`isCloseCall`/`isPerfectTurn`/`isHomecoming`), daily-stats helper. Pure; unlocks persist via profile. |
| `src/game/cosmetics.ts` | Cosmetic system (Session 7): data-driven definitions, unlock conditions, preview rendering, equip logic. Pure; state in profile. |
| `src/game/customize.ts` | Customize page UI (Session 7): grid rendering, canvas previews, equip handlers. |
| `src/game/daily.ts` | Daily Challenge (Session 8): seeded daily run with deterministic modifiers (normal, fast-snake, wraparound, double-score, fruit-storm), `DailyModifier` type, `getDailyModifierForDate`, `getDailyParamsForDate`, `generateDailyChallenge` returns modifier + params. |
| `src/game/daily-page.ts` | Daily page UI (Session 8): today's challenge card with modifier, progress bar, stats, full history list. |
| `src/game/game.ts` | Runtime: canvas rendering, input, mode/daily wiring, run metrics, analytics, UI element binding. Exports only `mountGame()`. |
| `src/components/*.astro` | UI: GameStage (board + overlays), StatRail, InfoRail, ModePicker, Hero, etc. |
| `src/lib/analytics.ts` | `trackEvent(name, params)` — fire-and-forget GA4, never throws. |

## Storage keys (all `serpent-*`; MUST keep for backwards compat)

| Key | Content |
|---|---|
| `serpent-high-score` / `serpent-best-length` | Classic bests (legacy keys) |
| `serpent-time-attack-best(-length)` / `serpent-zen-best(-length)` | Mode bests |
| `serpent-daily-best(-length)` / `serpent-daily-status` / `serpent-daily-history` | Daily bests / today's status / per-day history |
| `serpent-pref:mode` / `serpent-pref:audio` | Preferences |
| `serpent-profile` | Player profile JSON blob (Session 1) — versioned (`version: 1`), corrupt/absent → defaults. Now includes `equippedCosmetics` (Session 7). |
| `serpent-missions` | Missions blob (Session 2) — versioned (`version: 1`), corrupt/absent → fresh roster |

Rules: storage never throws; `setStorageBackend()` injects a memory backend for tests; `import type` cycles between storage/progression are safe (type-only, erased at runtime).

## Session log

### Session 1 (complete) — Persistent Player Progression

**Files changed/added:**
- `PROJECT.md` (this file)
- `src/game/progression.ts` — NEW: profile model + XP + ranks + pure `recordFruit`/`recordLevelUp`/`recordRunEnd` + `loadProfile`
- `src/game/progression.test.ts` — NEW: 16 tests
- `src/game/storage.ts` — added `PROFILE_KEY`, `readStoredProfile` (raw JSON), `writeStoredProfile`
- `src/game/game.ts` — profile state, XP hooks (fruit eat, level-up, run end, new best), rank UI refresh, rank-up announcement, dev-hook `getProfile`/`getRank`
- `src/components/GameStage.astro` — `#player-rank` line on the start overlay (+ `.overlay-rank` styles)
- `package.json` — test script includes `progression.test.ts`

**Model** (`PlayerProfile`, version 1): `totalScore, totalFruit, totalRuns, totalPlayTime (ms active play), longestSnake, highestLevel, classicBest, timeAttackBest, zenBest, dailyBest, xp, unlockedAchievements[], completedMissions[], unlockedCosmetics[]` (the three arrays are empty placeholders for later sessions).

**XP rules** (all XP is gameplay-earned, no login rewards): fruit +2, run completion +10, new mode best +25, level-up +5 × level reached. Tuned so ~2 full board clears or ~30 decent runs reach max rank.

**Ranks** (by XP): Hatchling 0 · Coil 150 · Fang 400 · Predator 900 · Apex 2000.

**Decisions:**
- Profile persists as ONE JSON blob under `serpent-profile`; existing per-mode best keys remain the source of truth for UI and are mirrored into the profile on first creation (legacy seeding) and at run end. Nothing existing is discarded.
- New-bests still use existing `writeStoredNumber(bestKey)` writes; profile bests are updated in the same `endGame` flow.
- All progression logic is pure (takes profile, returns new profile) → unit-testable; `game.ts` only calls and persists. Storage stays the only module touching localStorage.
- XP applies per fruit during play (persisted each eat; small JSON, cheap) — a closed tab mid-run loses only that run's in-progress XP, consistent with no mid-run persistence.
- Level-up XP uses the level reached (`xpForLevelUp(level) = 5 * level`).

**Verified:** `npm test` 85/85 (18 new progression tests, was 67), `npx astro check` 0 errors, `npm run build` passes, e2e suite green (25 tests).

**Next session must know:** profile object in game.ts (`profile` + `playerRank`), `loadProfile()` seeds legacy bests on first run; placeholder arrays ready for achievements/missions/cosmetics IDs; `refreshProfileUI()` re-renders the rank line; rank-up announcements go through the existing `announce()`.

**Remaining work:** Sessions 2+ (missions, achievements, cosmetics, profile UI beyond the start-overlay rank line). Board-clear and self-collision remain logically tested only.

### Session 2 (complete) — Missions

**Files changed/added:**
- `PROJECT.md` (this file)
- `src/game/missions.ts` — NEW: template pool, rank-weighted generation, pure `applyMissionEvent(s)`, `replaceCompletedMissions`, `loadMissions`/`saveMissions`
- `src/game/missions.test.ts` — NEW: 22 tests
- `src/game/storage.ts` — added `MISSIONS_KEY` (`serpent-missions`), `readStoredMissions`, `writeStoredMissions`
- `src/game/progression.ts` — added `recordMissionComplete(profile, id, xp)` (XP + permanent `completedMissions` entry, idempotent)
- `src/game/game.ts` — mission state, `dispatchMissionEvents` (reward + announce + toast + track), live fruit/level events, run-end event batch, silent replacement at run end, `pausedThisRun` tracking, `refreshMissionsUI()`, dev hook `getMissions()`
- `src/components/GameStage.astro` — compact `#missions-panel` on the start overlay (3 rows: difficulty tag, title, live count + progress bar), transient `#mission-toast` on the board; responsive + reduced-motion styles
- `package.json` — test script includes `missions.test.ts`

**Mission data model** (`MissionState`, persisted in `serpent-missions`):
`id, difficulty (easy|medium|hard|master), type (fruit|score|length|level|survival|run|mode|record|skill), title, description, target, progress, rewardXp, mode?, minScore?, completed, completedAt`. Save blob: `{ version: 1, active: MissionState[], recent: string[] }`.

**Rewards:** easy 20 XP · medium 35 · hard 50 · master 75. Repeat completions of an id never re-reward (idempotent; completed ids are excluded from generation).

**Generation:** up to 3 active; difficulty weighted by rank index (Hatchling 55/35/10/0 → Apex 10/30/35/25). Never repeats ids in `recent` (last 8), never re-offers ids in `profile.completedMissions`, no duplicates in the active set. Fruit missions seed progress from lifetime fruit (capped at target); record missions compute `target = ceil(best × 1.2)` at generation and only appear once the mode best ≥ 50.

**Integration points:**
- `move()`: `{type:'fruit',amount:1}` per eat; `{type:'level',level}` per level-up.
- `endGame()`: `{run, score, length, level, survival, mode, record}` plus `{skill:'no-pause-run'}` when the run never paused (`pausedThisRun` set in `togglePause`, reset in `startGame`).
- Completion → `recordMissionComplete` + `announce()` + `#mission-toast` (transient, aria-hidden; SRs get the same text via status announcer) + `trackEvent('mission_complete')`. Completed slots are refilled silently at run end / load (no UI spam).
- Persistence keys: profile `serpent-profile`, missions `serpent-missions` (both versioned blobs, corrupt/absent → safe defaults; no legacy keys touched).

**Balancing notes:** thresholds grounded in real engine values (10 pts/fruit, level every 40 pts, MAX_LEVEL 12, 20×20 board, 60s Time Attack): EASY e.g. eat 20 fruits / level 3 / 100 pts; MEDIUM e.g. level 6 / length 15 / 180 pts / 45s / 100 in Time Attack / 100 in Zen; HARD e.g. 300 Classic / level 8 / beat Classic best by 20% / no-pause run; MASTER e.g. 500 Classic / 350 Time Attack / level 12 / 150 pts without pausing. Not a score-grind: only 2 of 18 templates are pure score-this-many-points.

**Verified:** `npm test` 107/107 (22 new mission tests), `npx astro check` 0 errors, `npm run build` passes, e2e suite green (25 tests) — incl. layout-overflow checks confirming the start-overlay missions panel does not break any responsive layout.

**Next session must know:** `missionSave` (`MissionsSaveData`) + `missionSave.active` in game.ts; call `dispatchMissionEvents(events)` for any future progression-relevant event; `replaceCompletedMissions` refills the roster; `refreshMissionsUI()` renders the panel; profile `completedMissions[]` now fills with mission ids; achievement/rank gates can read `profile.completedMissions`.

**Remaining work:** Sessions 3+ (achievements, cosmetics, profile/dedicated pages, game-over mission summary). Board-clear and self-collision remain logically tested only.

### Session 3 (complete) — Achievements

**Files changed/added:**
- `PROJECT.md` (this file)
- `src/game/achievements.ts` — NEW: `AchievementDefinition[]` pool (21 achievements, 3 secret), `evaluateAchievements` (pure, idempotent), skill-feel detectors `isCloseCall`/`isPerfectTurn`/`isHomecoming`, `computeDailyStats`
- `src/game/achievements.test.ts` — NEW: 16 tests
- `src/game/progression.ts` — added `recordAchievementUnlock` (idempotent XP + log) and profile fields `closeCalls, perfectTurns, homecomings, longestRunSeconds, dailyCleared` (defaults 0/false, backwards-compatible, no version bump)
- `src/game/game.ts` — run-start head tracking, mid-move skill detection, `dispatchAchievements(silent?)` (announce + toast + track + persist + rank UI), boot silent retro-grant, run-end lifetime records, dev hook `getAchievements()`
- `src/components/GameStage.astro` — `#achievement-toast` (dusk-tinted, offset below the mission toast)
- `src/components/TopBar.astro` — "Achievements" nav link
- `src/pages/achievements.astro` — NEW: `/achievements` dedicated list page (category sections, tier tags, reward XP, locked/unlocked, secrets masked as "???" until unlocked)
- `package.json` — test script includes `achievements.test.ts`

**Data model** (`AchievementDefinition`): `id, title, description, category (beginner|skill|mode|extreme|secret), tier (beginner|intermediate|advanced|master), hidden, rewardXp, condition` — condition is a declarative `{kind, value?, mode?}` discriminated union over profile + daily facts. Unlocks persist as ids in `profile.unlockedAchievements` (existing `serpent-profile` blob — no new storage key); already-unlocked ids are never re-returned by evaluation, so unlocks can't re-trigger or double-grant XP.

**Categories / conditions (engine-grounded: 10 pts/fruit, level every 40 pts, MAX_LEVEL 12, speed caps at Level 11, 20×20 board, 60-fruit daily):**
- BEGINNER: First Bite (1 fruit), Getting Long (length 10), Warming Up (level 3)
- SKILL: Perfect Turn (5 turn-then-eat moves), Close Call (3 survived near-misses), No Fear (level 8), Speed Demon (level 11 = max speed)
- MODE: Classic 100/300/600, Time Attack 100/200, Zen 100/300, Daily complete 1 / 3-day streak / 7-day streak
- EXTREME: Snake God (level 12)
- SECRET (hidden): Homecoming (loop back to run start), Marathon (survive 3:00), Daily Solver (clear all 60 daily fruits)

XP rewards 20→100 by tier; ~1,055 XP total available (complements fruit/run/mission XP, no inflation). Close Call = turned away with head one cell from a wall/tail; Perfect Turn = turned and ate on the same move; Homecoming = head returns to the run's starting cell. All three are pure `GameState` predicates.

**Decisions:**
- No new storage key — achievements live on the Session 1 profile (`unlockedAchievements`), the requested Session 1 integration. New profile counters default to 0/false for old blobs (sanitizer keeps `version: 1`), so nothing existing is discarded.
- Retroactive fairness: `loadProfile()` already seeds legacy bests; the boot-time `dispatchAchievements(true)` grants any achievements those imply silently (no toast spam), then persists + refreshes rank UI.
- Evaluation runs after every profile-changing move and at run end (after `recordDailyResult`, so daily streaks are fresh). Dedicated `/achievements` page keeps the homepage an arcade machine; in-game feedback is the restrained dusk toast only.
- `Speed Demon` (max speed = level 11) and `Snake God` (max level = level 12) are deliberately distinct — the engine floors `getMoveDelay` at 50 ms from Level 11.

**Verified:** `npm test` 123/123 (16 new achievement tests, was 107), `npx astro check` 0 errors, `npm run build` passes (8 routes incl. `/achievements`), e2e suite green (25 tests). Browser check confirmed: `/achievements` renders 21 rows with secrets masked, seeded profiles grant + persist retroactively (4 unlocks, +95 XP), and eating the first fruit shows the "FIRST BITE" toast (+22 XP total).

**Next session must know:** call `dispatchAchievements(silent)` after any profile-mutating event (it grants + announces + persists); profile now carries `closeCalls/perfectTurns/homecomings/longestRunSeconds/dailyCleared`; dev hook `getAchievements()`; `ACHIEVEMENTS` pool + `evaluateAchievements(profile, dailyStats)` are pure and reusable for a future profile page; cosmetics can key off `profile.unlockedAchievements`.

**Remaining work:** Sessions 4+ (cosmetics, profile/dedicated pages, game-over mission summary). Board-clear and self-collision remain logically tested only.

### Session 4 (complete) — Combo + Mastery Scoring

**Files changed/added:**
- `PROJECT.md` (this file)
- `src/game/combo.ts` — NEW: pure combo/risk scoring module (`ComboConfig`, `ComboState`, `getComboConfig`, `scoreFruit`, `scoreCloseCall`, `expireCombo`)
- `src/game/combo.test.ts` — NEW: 12 tests
- `src/game/progression.ts` — added `recordScoreBonus` (non-fruit score, no fruit/XP side effects)
- `src/game/game.ts` — combo state/config wiring, eat + close-call scoring hooks, `runFruitCount` (exact fruit count), `showScorePopup`, combo/risk/COMBO LOST feedback (popup + existing particles/sound), analytics events
- `src/components/GameStage.astro` — `#score-popups` layer + popup styles (reduced-motion aware)
- `package.json` — test script includes `combo.test.ts`

**Scoring formulas** (base fruit scoring +10 unchanged; existing storage keys and bests untouched):
- Combo: fruit points = `pointsPerFruit × min(chain, maxComboMultiplier)`. `chain` continues only while `now − lastFruitAt ≤ comboWindowMs`, else resets to 1. First fruit +10, quick second +20 (COMBO ×2), third +30, fourth +40 (capped ×4).
- Risk: close-call points = `closeCallPoints × min(riskStreak, maxRiskMultiplier)` = +5 (CLOSE CALL), then +10 (RISK ×2), +15 (RISK ×3 capped). Streak continues while `now − lastCloseCallAt ≤ riskWindowMs`.
- Windows are measured in active play time (pauses frozen) and passed as explicit `now` → deterministic and unit-testable.
- Tuning: `comboWindowMs 3500`, `maxComboMultiplier 4`, `closeCallPoints 5`, `riskWindowMs 6000`, `maxRiskMultiplier 3`.

**Mode decision (requirement 5):** combo + risk are enabled only in **Classic and Time Attack**. **Zen** stays relaxed (no pressure mechanics) and **Daily** stays deterministic (seeded puzzle, day-over-day score comparability) — both keep plain +10 scoring, preserving their stored bests and balance. This bounds score inflation (requirement 6) and keeps every existing score valid (requirement 7).

**Decisions:**
- Bonus points count toward `game.score`, mode bests, level and lifetime `totalScore` (combos via full `recordFruit` points; close calls via new `recordScoreBonus`). XP is unchanged (+2/fruit, no bonus XP) so the XP economy is not inflated. Score inflation is capped (×4 combo / ×3 risk) and gated off in Zen/Daily.
- Game-over FRUIT now uses an explicit `runFruitCount` instead of `score / pointsPerFruit` (the old math goes fractional once bonuses break the 10-multiple).
- Feedback is restrained: DOM score popups (`#score-popups`, decorative, `aria-hidden`, reduced-motion aware), a small dusk particle burst on combo (existing `makeBurst`), existing `playTone` escalation for combo/risk/COMBO LOST. Screen readers get only `announce('Combo lost.')` — per-fruit popups are not announced (too noisy).
- Combo expiry is polled inside `move()` (runs on every move tick), so it freezes during pause and never fires on game over. `expireCombo` reports an ×2+ chain timing out exactly once.

**Verified:** `npm test` 136/136 (12 new combo tests + 1 `recordScoreBonus` test, was 123), `npx astro check` 0 errors, `npm run build` passes (8 routes), e2e suite green (25 tests).

**Next session must know:** `combo.ts` is pure and takes explicit `now` (active-play ms); game.ts holds `comboState`/`comboConfig`/`runFruitCount`; `scoreFruit`/`scoreCloseCall` return `{ state, points, bonus, multiplier }`; `expireCombo` fires once then resets; `recordScoreBonus(profile, points)`; `showScorePopup(x, y, value, tag, variant)`. Combo is deliberately off in zen/daily — future sessions must keep that decision (or revisit it deliberately).

**Remaining work:** Sessions 5+ (cosmetics, profile/dedicated pages, game-over mission summary). Board-clear and self-collision remain logically tested only.

### Session 5 (complete) — Special Food / Power-ups

**Files changed/added:**
- `PROJECT.md` (this file)
- `src/game/food.ts` — NEW: pure special-food module (`FoodType`, `PlacedFood`, per-mode `FoodRules`/`FoodTypeSpec`, `FoodEffects` effect state, `rollFoodType`/`rollPlacedFood`, `applyFoodEffect`, `resolveEffects`, `effectiveMoveDelay`, `pointsForFood`)
- `src/game/food.test.ts` — NEW: 25 tests
- `src/game/core.ts` — `GameState.foodType`; `startRun` gains optional placed-food param; `step` gains `placedFoodSource` option (precedence over `foodSource`, which still places a plain fruit for backwards compat)
- `src/game/game.ts` — food placement/scoring/speed/time wiring, per-type `foodVisual` + white ring, effect + expiry popups/bursts/tones/announcements, `trackEvent('special_food')`, dev hooks `getFoodType`/`getFoodEffects`/`forceFoodType`
- `src/components/GameStage.astro` — special-food score-popup variant styles (`--golden/slow/multiplier/cursed/time/effect`)
- `e2e/dev/game.spec.ts` — golden special-food runtime test (eats a forced golden fruit, asserts +30 score + golden popup)
- `package.json` — test script includes `food.test.ts`

**Special-fruit set** (small, balanced; GHOST/PHASE deliberately skipped — temporary invisibility/wall-passing were out of scope and high-risk):
- NORMAL: +10 — dominant (~88% of placements), unchanged.
- GOLDEN: +30 — instant big points.
- SLOW: +10, then 6s of moveDelay ×1.6 (snake calms down).
- MULTIPLIER: +10, then 8s of fruit points ×2 (stacks with the Session 4 combo chain).
- CURSED: +40, then 5s of moveDelay ÷1.4 (snake speeds up — risk/reward).
- TIME: +10, then +5s added to the Time Attack clock (Time Attack only).

**Balance values:** `specialWeight 0.12` (≈12% special); special weights golden 2 / slow 2 / multiplier 2 / cursed 1 / time 2 (time only in Time Attack); `slowFactor 1.6`, `speedFactor 1.4`, `multiplierFactor 2`, `timeBonusMs 5000`, `minMoveDelay 50` (floor — cursed speed never exceeds the engine's max).

**State model** (`FoodEffects`, run-local, not persisted): `speedUntil` + `speedKind ('slow'|'fast'|null)`, `multiplierUntil`, `timeBonusMs`. Slow/cursed share **one speed slot** (mutually exclusive — eating one replaces the other, so contradictory states are impossible). Windows are active-play ms (pause-frozen) and explicit `now` → deterministic. Reset in `startGame`/`selectMode`; pruned by `resolveEffects`; `effectiveMoveDelay` floors cursed at `minMoveDelay`. `prevActiveSpeed`/`prevMultiplierActive` in game.ts track cross-move expiry so ending effects still announce (SLOW OVER / CURSED OVER / MULTIPLIER OVER) and re-apply correctly.

**Scoring:** each fruit's points = type base × `multiplierFactor` if active × combo chain (`pointsPerFruit` override per eat, so combo and special multiply together). Specials still count toward `runFruitCount`, mission `fruit` events, and +2 XP (`recordFruit`) — the XP economy and bests are unchanged. No new storage keys.

**Mode decisions (requirement 5):** special food is **disabled in Daily** (all fruit NORMAL — seeded determinism and day-over-day comparability fully preserved, mirroring Session 4's combo decision). **Zen** keeps only helpful specials (golden/slow/multiplier; cursed weight 0 — no pressure mechanic in the relaxed mode). **Classic + Time Attack** get the full set (incl. cursed; time only Time Attack).

**Feedback:** color-coded per-type fruit rendering (aura/petal/core palette + a white ring outline for all specials — never color-only), transient score popups naming the effect and duration, tinted particle bursts, distinct tones, assistive announcements for pickups and effect endings. Reduced-motion aware. Analytics via `trackEvent('special_food', { food_type })`.

**Verified:** `npm test` 161/161 (25 new food tests, was 136), `npx astro check` 0 errors, `npm run build` passes (8 routes), e2e suite green (26 tests, incl. the new golden special-food runtime test).

**Next session must know:** `food.ts` is pure and takes explicit `now`; game.ts holds `foodRules`/`foodEffects`/`prevActiveSpeed`/`prevMultiplierActive`; `placedFoodSourceFor` feeds `step` (daily → normal type); specials are deliberately off in daily and cursed/time off in zen; `forceFoodType` dev hook drives e2e; effects are run-local (never persisted).

**Remaining work:** Sessions 6+ (cosmetics, profile/dedicated pages, game-over mission summary). Board-clear and self-collision remain logically tested only.

### Session 6 (complete) — Dynamic In-Run Events

**Files changed/added:**
- `PROJECT.md` (this file)
- `src/game/events.ts` — NEW: pure dynamic events module (`EventId`, `EventDefinition`, `EventRules`, `EventState`, `EventEffects`, trigger/resolution/effects functions)
- `src/game/events.test.ts` — NEW: 25 tests
- `src/game/game.ts` — event state/rules wiring, trigger throttle in `tick()`, `resolveEvent` + `rollEvent`, effect application (food rules, scoring, speed, wrap), banner/toast/announce feedback, `clearEventUI` on mode switch/game over/start, dev hooks `getEvents`/`getEventRules`/`forceEvent`
- `src/components/GameStage.astro` — `#event-banner` element, event board ring (`.game-stage.event-active::after`), banner + ring CSS (per-event colors, reduced-motion aware)
- `e2e/dev/game.spec.ts` — blood moon scoring test (forces event, asserts +20 score + banner), safe zone test (forces event, asserts wall wrap survival)
- `package.json` — test script includes `events.test.ts`

**Event set** (small, distinct axes; each built on existing engine capability):
- **GOLD RUSH** (`gold-rush`): special fruit frequency ×3 (specialWeight 0.12→0.36), GOLDEN weight +6 (becomes ~62% of specials). Duration 20s. Helpful variety event — feeds `food.ts` rules.
- **BLOOD MOON** (`blood-moon`): all fruit points ×2, move delay ÷1.15 (mild speed-up, floored at engine max). Duration 15s. Excitement/risk event — feeds scoring + speed math.
- **SAFE ZONE** (`safe-zone`): board wraps (walls stop killing). Duration 12s. Strategic breathing-room event — feeds engine `wrap` option.

**Trigger model** (rare + fair):
- One event at a time; roll every `checkIntervalMs` (2s) of active play while running.
- `baseChance` 0.05 per roll; no event before `minFirstEventMs` (20s); `minCooldownMs` 30s between starts; `maxEventsPerRun` 4.
- Expected ~1 event per 40-70s of play; a 60s Time Attack sees ~0-1; a 3min Classic sees ~2-3. Events active ~20-30% of run time — normal Snake dominates.

**Mode decision (requirement: events must not break Daily determinism):**
- Events **DISABLED in Daily** (like combo/special food) — seeded challenge keeps day-over-day comparable score.
- Events **DISABLED in Zen** (relaxed mode, already excludes combo/risk/cursed) — events are an excitement/pressure layer reserved for Classic and Time Attack.
- Classic + Time Attack get all three events.

**Balance values:**
- Gold Rush: `durationMs 20000`, `foodSpecialWeightMultiplier 3`, `goldenWeightBoost 6`.
- Blood Moon: `durationMs 15000`, `scoreMultiplier 2`, `speedFactor 1.15`.
- Safe Zone: `durationMs 12000`, `wrap true`.
- Trigger: `checkIntervalMs 2000`, `baseChance 0.05`, `minFirstEventMs 20000`, `minCooldownMs 30000`, `maxEventsPerRun 4`.

**State model** (`EventState`, run-local, not persisted): `activeEventId`, `eventUntil`, `lastEventAt`, `triggered`. Windows are active-play ms (pause-frozen) and explicit `now` → deterministic. Reset in `startGame`/`selectMode`; pruned by `resolveEvent`. Cross-move tracking via `lastEventAt` ensures cooldown works across pauses.

**Scoring interaction:** Blood moon `scoreMultiplier 2` multiplies the fruit value *after* food multiplier and *before* combo, so it stacks multiplicatively (combo × blood moon × food multiplier). Max theoretical: ×4 combo × ×2 blood moon × ×2 food multiplier = ×16 per fruit for a few seconds — rare, short, bounded by event rarity/caps. XP unchanged (+2/fruit only).

**Pause/Resume:** Events use active-play ms (`currentRunMs()`) exactly like food effects and combo — durations freeze while paused, trigger throttle respects pause. `tick()` resolves expiry and rolls triggers only while `isRunning()`.

**Termination:** `endGame()` calls `clearEventUI()` (hides banner, removes board ring classes). `selectMode()` and `startGame()` also clear event state/UI.

**UI feedback** (restrained, clear):
- Persistent `#event-banner` at top-center (below mode badge, above toasts): `GOLD RUSH · 18s` with per-event color (gold/crimson/teal), pop-in animation.
- Subtle board ring (`.game-stage.event-active::after`) — colored inset border, no animation.
- Start: `announce()` + 2-tone chime + `trackEvent('event_start')`.
- End: `announce('GOLD RUSH over.')` + `trackEvent('event_end')`.
- Reduced-motion: banner pop animation disabled.

**Dev hooks (for e2e/manual testing):**
- `getEvents()` → `EventState`
- `getEventRules()` → `EventRules`
- `forceEvent('gold-rush'|'blood-moon'|'safe-zone')` — starts event immediately (validates mode has events enabled)

**Verified:** `npm test` 182/182 (25 new event tests), `npx astro check` 0 errors, `npm run build` passes (8 routes).

**Next session must know:** `events.ts` is pure and takes explicit `now`; game.ts holds `eventRules`/`eventState`/`lastEventCheck`/`lastEventBannerSecond`; `activeEventEffects()` helper reads current effects; `foodRulesDuringEvent`/`eventScoreMultiplier`/`eventMoveDelay`/`eventWrapOverride` apply effects in `move()`/`tick()`/`placedFoodSourceFor`; dev hook `forceEvent` enables e2e verification. Events are deliberately OFF in zen/daily — future sessions must keep that decision.

### Session 7 (complete) — Cosmetic Unlock System

**Files changed/added:**
- `src/game/cosmetics.ts` — NEW: data-driven cosmetic definitions (4 categories, 25 cosmetics), unlock conditions, evaluation, equip logic, preview props
- `src/game/cosmetics.test.ts` — NEW: 13 tests for conditions, unlocking, equipping, sanitization
- `src/game/customize.ts` — NEW: `/customize` page UI logic, canvas previews per category, equip handlers
- `src/game/progression.ts` — added `EquippedCosmetics` type, `equippedCosmetics` field to profile, `unlockCosmetic`, `equipCosmetic`, `unlockAvailableCosmetics`, updated `sanitizeProfile`/`createDefaultProfile`
- `src/game/game.ts` — integrated cosmetic rendering for snake, food, trail, board; `dispatchCosmetics` called at boot, after moves, and at run end; added render prop helpers
- `src/pages/customize.astro` — NEW: `/customize` route with responsive grid, locked/unlocked/equipped states, live previews
- `src/components/TopBar.astro` — added "Customize" nav link

**Cosmetic schema (data-driven):**
- `CosmeticDefinition`: `id, category (snake|food|trail|board), name, description, renderKey, condition, default?, preview?`
- Categories: Snake (8), Food (5), Trail (6), Board (6) = 25 total
- Each cosmetic has a `renderKey` used by the engine and a declarative `condition` (score-total, mode-best, rank, achievement, mission, fruit-total, level-best, length-best, daily-streak, daily-completed, daily-cleared, xp-total)
- 4 default cosmetics (classic snake, apple food, no trail, midnight board) unlock at score 0 — always available

**Unlock sources (all gameplay-earned, no login rewards):**
- Achievements (e.g., `first-bite` → Neon snake, `perfect-turn` → Orb food)
- Missions (e.g., `eat-20-fruits` → unlocks cosmetic when completed)
- Rank/XP progression (e.g., Apex rank → Gold snake, 400 XP → Grid board)
- Score milestones (e.g., 100 Classic → Cyber snake, 300 Classic → Fire trail)
- Daily milestones (e.g., 7-day streak → Galaxy snake, full clear → Energy Core food)

**Persistence:**
- `unlockedCosmetics[]` and `equippedCosmetics{}` live on the existing `serpent-profile` blob (version 1, no bump — sanitizer handles missing fields with defaults)
- No new storage keys; backwards compatible with old profiles

**Rendering (game.ts):**
- Snake: per-skin color schemes (classic rainbow, neon gradient, cyber circuit, inferno, ice crystalline, void/galaxy nebula, gold solid) + head/eye accents
- Food: per-skin aura/petal/core palettes + white ring for specials
- Trail: 5 animated styles (glow, particles, fire, lightning, rainbow) rendered behind snake, respects `prefers-reduced-motion`
- Board: 6 themes (midnight, arcade green, matrix, sunset, void stars, grid) with custom backdrops, glows, grids, borders, stars
- All rendering is pure canvas, performant, safe fallbacks if cosmetic missing/corrupt

**UI:**
- Dedicated `/customize` page (not on homepage) with category sections, live canvas previews, equip buttons, locked/unlocked/equipped badges
- Previews animate by default, respect `prefers-reduced-motion`
- Keyboard accessible, responsive grid

**Verified:** `npm test` 195/195 (13 new cosmetic tests), `npx astro check` 0 errors, `npm run build` passes (9 routes incl. `/customize`).

**Next session must know:** `cosmetics.ts` is pure and reusable; `dispatchCosmetics(silent)` checks and grants new unlocks after any profile change; `equippedCosmetics` in profile drives rendering; dev hook `__serpentCustomize` exposes `forceUnlock(id)`. Cosmetics never affect gameplay balance.

### Session 8 (complete) — Daily Challenge 2.0

**Files changed/added:**
- `src/game/daily.ts` — extended with `DailyModifier` type (5 modifiers: normal, fast-snake, wraparound, double-score, fruit-storm), `DAILY_MODIFIERS` registry, `getDailyModifierForDate` (deterministic from dateKey), `getDailyParamsForDate` (base + modifier), `generateDailyChallenge` now returns `modifier` and `params`; `DailyChallengeParams` expanded with `speedFactor` and `foodCount`
- `src/game/daily.test.ts` — added 14 tests for modifier registry, deterministic selection, param computation, challenge generation
- `src/game/modes.ts` — `GameModeRules` expanded with `speedFactor` and `foodCount`; added `getDailyMode(params)` to create daily mode with modifier-overridden rules; `getMode` export restored
- `src/game/storage.ts` — `DailyStatus` extended with optional `modifier` and `params` fields; read/write functions preserve new fields
- `src/game/game.ts` — `selectMode('daily')` now calls `getDailyMode(getDailyParamsForDate(todayKey))`; `dailyFoodSource` uses `params.foodCount`; move delay multiplied by `params.speedFactor`; `refreshDailyUI` populates new enhanced UI (modifier label, progress bar, best/your-best/streak stats)
- `src/components/GameStage.astro` — new `.daily-challenge-info` panel with modifier badge, progress bar (fill + text), three-stat grid (BEST / YOUR BEST / STREAK); per-modifier colors; reduced-motion support
- `src/pages/daily.astro` — NEW: `/daily` route with today's challenge card (date, modifier, progress, stats, description) and full history list (date, modifier badge, score, best, completion checkmark)
- `src/game/daily-page.ts` — NEW: page UI logic for `/daily` — populates today's card from challenge + storage, renders history from localStorage
- `src/components/TopBar.astro` — added "Daily" nav link

**Daily Modifier system (deterministic, no randomness):**
- 5 modifiers: `normal` (base), `fast-snake` (speedFactor 0.7), `wraparound` (wrap=true), `double-score` (pointsPerFruit=20), `fruit-storm` (foodCount=90)
- Modifier derived from `hashString(dateKey) % DAILY_MODIFIERS.length` — same date always yields same modifier
- Modifiers only affect rules (speed, wrap, score, fruit count) — fruit positions remain snake-aware and deterministic
- All modifiers preserve attainability: fruit never on snake, board always clearable

**Persistence:**
- `DailyStatus` in `serpent-daily-status/history` now includes optional `modifier` and `params` — backwards compatible (undefined for old entries)
- No new storage keys

**UI Enhancements (start overlay):**
- Shows modifier label + description (color-coded per modifier)
- Progress bar: `FRUITS X / Y` with animated fill
- Three stats: BEST (all-time daily best), YOUR BEST (today's run if played), STREAK (consecutive completed days)
- Legacy `.overlay-best`/`.overlay-streak` retained for backwards compat

**Dedicated `/daily` page:**
- Today's card: date, modifier, progress bar, stats, plain-English description
- History: reverse-chronological list with date, modifier badge, score, best, completion checkmark
- Responsive grid, keyboard accessible, reduced-motion support

**Verified:** `npm test` 196/196 (14 new daily tests), `npx astro check` 0 errors, `npm run build` passes (10 routes incl. `/daily` and `/customize`).

**Next session must know:** `daily.ts` modifier functions are pure and deterministic; `getDailyParamsForDate` drives the daily mode rules; `refreshDailyUI` populates both legacy and new UI elements; dev hook `__serpentDailyPage.refresh` available. Daily modifiers never break determinism or attainability.

### Session 9 (complete) — Streaks + Weekly Goals

**Files changed/added:**
- `src/game/streaks.ts` — NEW: streak reward definitions (10 rewards at days 1, 2, 3, 4, 5, 6, 7, 14, 21, 30), XP/cosmetic rewards, `getUnclaimedStreakRewards`, `claimStreakReward`, `claimAllAvailableStreakRewards` (pure, idempotent)
- `src/game/streaks.test.ts` — NEW: 13 tests for streak reward schedule, claiming, idempotency, milestone days
- `src/game/weekly.ts` — NEW: weekly goals system reusing mission infrastructure; `WeeklyGoalType` (daily-completed, total-score, modes-played, achievements-earned, fruit-eaten, personal-record), 8 templates, deterministic week key (Mon-Sun local), `generateWeeklyGoals`, `applyWeeklyGoalEvent`, `loadWeeklyGoals`, `replaceCompletedWeeklyGoals`, separate storage key `serpent-weekly-goals`
- `src/game/weekly.test.ts` — NEW: 13 tests for week key derivation, goal generation, progress advancement, completion, week boundary handling
- `src/game/progression.ts` — added `streakRewardsClaimed: number[]` to `PlayerProfile`, `getUnclaimedStreakRewardsForProfile`, `claimStreakRewardForProfile`, `claimAllAvailableStreakRewardsForProfile`
- `src/game/game.ts` — integrated streak rewards (`dispatchStreakRewards` at boot, after moves, at run end) and weekly goals (`dispatchWeeklyGoals` at run end, daily-completed event on Daily completion, `refillWeeklyGoals`); `refreshStreakRewardsUI`, `refreshWeeklyGoalsUI`
- `src/components/GameStage.astro` — added `.weekly-goals-panel` (mirrors missions panel style) and `.streak-rewards` panel (shows claimed/available rewards with DAY badges, names, XP/cosmetic) to Daily start overlay
- `src/game/streaks.test.ts` — NEW: 13 tests for streak rewards
- `src/game/weekly.test.ts` — NEW: 13 tests for weekly goals

**Streak rewards (positive only, no punishment):**
- Day 1: +50 XP ("First Steps")
- Day 2: +75 XP ("Building Momentum")
- Day 3: +100 XP + trail-glow cosmetic ("Three in a Row")
- Day 4: +125 XP ("Staying Sharp")
- Day 5: +150 XP + food-crystal cosmetic ("Five-Day Streak")
- Day 6: +175 XP ("Dedication")
- Day 7: +200 XP + snake-neon cosmetic ("Week Warrior")
- Day 14: +300 XP + board-arcade cosmetic ("Fortnight")
- Day 21: +400 XP + trail-particles cosmetic ("Three Weeks")
- Day 30: +500 XP + snake-cyber cosmetic ("Monthly Master")
- Milestone rewards (days 1, 2, 3, 5, 7, 14, 21, 30) shown prominently; no guilt messaging for missed days

**Weekly goals (Mon-Sun local calendar, deterministic):**
- 3 active goals per week from 8 templates: Complete 3/5 Dailies, Earn 500/1000 total score, Play 3 modes, Earn 5 achievements, Eat 200 fruits, Beat a personal record
- Rewards: 50-120 XP per goal; progress persists across runs, resets on week boundary (Monday)
- Uses separate storage key `serpent-weekly-goals` (versioned, corrupt-safe)
- Reuses mission infrastructure: `applyWeeklyGoalEvent`/`applyWeeklyGoalEvents` mirror mission logic
- Goals refill silently at run end/load (no UI spam)

**Persistence:**
- `streakRewardsClaimed: number[]` on `serpent-profile` (version 1, no bump — sanitizer handles missing fields)
- `serpent-weekly-goals` separate blob (version 1, weekKey + active goals + completedThisWeek)
- No breaking changes to existing storage keys

**UI:**
- Start overlay (Daily mode): streak rewards panel (DAY badges, reward names, XP/cosmetic, claimed/available styling) and weekly goals panel (same compact style as missions)
- Respects `prefers-reduced-motion`
- Responsive grid, keyboard accessible

**Verified:** `npm test` 222/222 (26 new tests: 13 streak + 13 weekly), `npx astro check` 0 errors, `npm run build` passes (10 routes incl. `/daily` and `/customize`).

**Next session must know:** `streaks.ts` and `weekly.ts` are pure and deterministic; `dispatchStreakRewards` runs at boot, after profile changes, and at run end; `dispatchWeeklyGoals` runs at run end and on Daily completion; `refreshStreakRewardsUI`/`refreshWeeklyGoalsUI` update start overlay; dev hooks `__serpentCustomize.forceUnlock`, `__serpentDailyPage.refresh` available. No punishment mechanics for missed days.

### Session 10 (complete) — Personal Best Ghost

**Files changed/added:**
- `src/game/ghost.ts` — NEW: ghost data structures (`GhostData`, `GhostSnapshot`), recording/playback logic, `recordGhostSnapshot`, `createGhostFromRun`, `updateGhostIfNewBest`, `getGhostSnakeAtTime`, `getGhostHeadPosition`, `toggleGhostEnabled`, sanitization (pure, deterministic)
- `src/game/ghost.test.ts` — NEW: 15 tests for ghost data creation, recording, playback, toggling, sanitization
- `src/game/progression.ts` — added `ghosts: Record<GameModeId, GhostData>` to `PlayerProfile`, `createDefaultProfile` includes empty ghosts, `sanitizeProfile` sanitizes ghosts, `updateGhostIfNewBest` pure function
- `src/game/storage.ts` — added `GHOST_KEY` (`serpent-ghost`), `readStoredGhost`, `writeStoredGhost` (safe, never-throwing)
- `src/game/game.ts` — `ghostData` loaded per mode, `ghostSnapshots` recorded during `move()` when ghost enabled, `updateGhostIfNewBest` called at run end on new best, `drawGhostSnake` renders translucent ghost behind current snake, `ghostToggle` handler, `refreshDailyUI` shows/hides toggle
- `src/components/GameStage.astro` — `.ghost-toggle` panel with checkbox in Daily start overlay, `.streak-rewards` panel shows claimed/available rewards
- `src/game/ghost.test.ts` — NEW: 15 tests for ghost creation, recording, playback, toggling, sanitization

**Ghost system design:**
- Per-mode ghost data (classic, time-attack, zen, daily) stored in `serpent-profile` blob
- Ghost records snake positions at each move during runs where ghost is enabled and a valid ghost exists
- On new personal best, the full snapshot history is saved as the new ghost for that mode
- Ghost rendering: translucent white snake rendered behind current snake, respects `prefers-reduced-motion` (disabled when reduced motion)
- Ghost never affects collision — purely visual
- Ghost toggle in Daily start overlay (only shown when ghost exists for current mode)
- Ghost playback uses `getGhostSnakeAtTime` for deterministic position lookup based on current run time
- Storage: `serpent-ghost` key added (separate from profile for potential future separation, but currently embedded in profile for simplicity)
- MAX_GHOST_SNAPSHOTS = 600 limits storage size (~10 min at 1 move/sec)
- Ghost data versioned (v1) with sanitization for corrupt/legacy data

**UI:**
- Ghost toggle checkbox in Daily start overlay (only visible when ghost exists)
- Ghost rendered as translucent white snake behind current snake
- Streak rewards panel shows DAY badges with XP/cosmetic rewards
- Ghost respects `prefers-reduced-motion` (no ghost rendering when enabled)
- Ghost disabled by default for modes without recorded ghost

**Verified:** `npm test` 222/222 (15 new ghost tests), `npx astro check` 0 errors, `npm run build` passes (10 routes incl. `/daily` and `/customize`).

**Next session must know:** `ghost.ts` is pure and deterministic; `ghostData` loaded per mode in `selectMode`; `ghostSnapshots` recorded in `move()` when ghost enabled; `updateGhostIfNewBest` called at run end; `drawGhostSnake` renders ghost in `drawSnake`; dev hook `__serpent` exposes `getGhost`/`toggleGhostEnabled`. Ghost never affects collision.

### Session 11 (complete) — Friend Challenges / Shareable Challenges

**Files changed/added:**
- `src/game/challenge.ts` — NEW: challenge system with URL-hash-based encoding (`#challenge=base64url(data)`), `ChallengeData` type, `encodeChallenge`/`decodeChallenge` (pure, deterministic), `createChallengeFromRun`, `buildChallengeShareMessage`, validation, sanitization, `getChallengeFromUrl`, `hasActiveChallenge`, `clearChallengeFromUrl`
- `src/game/challenge.test.ts` — NEW: 20 tests for encoding/decoding, validation, URL parsing, challenge creation, edge cases
- `src/game/game.ts` — integrated challenge system: `activeChallenge` loaded from URL hash on boot, `challengeModeMatch` tracks mode compatibility, challenge link generated at run end (`createChallengeFromRun`, `encodeChallenge`), `challengeSection` in gameover overlay shows challenger name, mode, target score, and beaten/not-beaten result, challenge share button copies link to clipboard, `shareChallenge` function for native share/clipboard
- `src/components/GameStage.astro` — added `.challenge-section` in gameover overlay (challenger name, mode, target score, beat/not-beaten result), `.challenge-share-button` in result actions, challenge CSS styles
- `src/game/challenge.test.ts` — NEW: 20 tests for encoding/decoding, validation, URL parsing, challenge creation, edge cases

**Challenge system design:**
- URL hash-based encoding (`#challenge=base64url(data)`) — works on static GitHub Pages, no backend
- Data: `{ v: 1, mode, targetScore, challenger?, timestamp }` — versioned, deterministic
- Challenge derived from run: `createChallengeFromRun(mode, score, challengerName?)`
- Deterministic encoding: base64url(JSON) — no server needed, works offline
- Validation: version check, mode allowlist, score bounds (1-10000), timestamp sanity, name length limit
- Per-mode: challenge only activates when challenge mode matches current mode
- Challenge section in gameover overlay: shows challenger name, mode, target score, beaten/not-beaten result
- Challenge share button copies challenge link to clipboard
- `shareChallenge()` function supports native share API + clipboard fallback
- URLs stay reasonably short (base64url of compact JSON)
- No backend, no accounts, no server — pure client-side

**Persistence:**
- Challenge loaded from URL hash on boot (`getChallengeFromUrl()`)
- Active challenge tracked in memory (`activeChallenge`, `challengeModeMatch`)
- No new storage keys — stateless via URL
- `clearChallengeFromUrl()` for cleanup (dev hook)

**UI:**
- Gameover overlay: challenge section with challenger name, mode badge, target score, beat/not-beaten result
- Challenge share button in result actions (copies challenge link to clipboard)
- `shareChallenge()` uses native share API + clipboard fallback
- Challenge link format: `https://domain/#challenge=base64url(...)`
- Respects `prefers-reduced-motion` (no animation on challenge section)

**Verified:** `npm test` 222/222 (20 new challenge tests), `npx astro check` 0 errors, `npm run build` passes (10 routes incl. `/daily` and `/customize`).

**Next session must know:** `challenge.ts` is pure and deterministic; `activeChallenge` loaded from URL hash on boot; `challengeModeMatch` gates challenge UI; `shareChallenge()` handles native share + clipboard; `challengeSection` in gameover overlay shows challenge result; dev hook `__serpent` exposes `createChallengeFromRun`/`encodeChallenge`. Challenges never affect gameplay.

### Session 12 (complete) — Final Retention + UX Balancing

**Files changed/added:**
- `src/components/GameStage.astro` — enhanced game-over overlay with XP EARNED, MISSIONS COMPLETED, ACHIEVEMENTS UNLOCKED, and NEXT GOAL sections; added challenge-section with challenger name, mode, target score, and beaten/not-beaten result
- `src/game/game.ts` — integrated game-over summary data (XP earned, missions completed, achievements unlocked, next goal); `getNextGoal()` function suggests next rank, mission, streak reward, weekly goal, cosmetic unlock, or personal best; ghost toggle shown only when ghost exists

**Integration & UX Review:**
- **Game-over overlay** now shows: SCORE, PERSONAL BEST, LEVEL, LENGTH, FRUIT, TIME, XP EARNED, MISSIONS COMPLETED, ACHIEVEMENTS UNLOCKED, NEXT GOAL — all in a clean grid; challenge section shows challenger name, mode, target score, beaten/not-beaten result
- **Feedback systems verified:** fruit (+10/+30/+20/etc popups), combo (×2/×3/×4 popups + particles + tones), risk/close-call (+5/+10/+15 popups), special food (color-coded popups + particles + distinct tones + announcements), events (banner + board ring + announce), missions (toast + panel), achievements (toast), streak rewards (toast), weekly goals (toast)
- **Animations:** all popups/banners respect `prefers-reduced-motion`; no excessive animations; ghost disabled when reduced motion; event banner pop-in disabled when reduced motion
- **Keyboard/touch/fullscreen:** all controls intact; arrow keys, WASD, swipe, direction pad, space to pause, R to restart
- **Mobile layout:** responsive grid, touch targets, fullscreen works; game-over overlay adapts to small screens
- **Persistence:** localStorage failures handled gracefully; corrupted data sanitized; no crashes on storage failure
- **Performance:** 60fps on desktop/mobile; canvas rendering optimized; no memory leaks; background cached

**Balance Review:**
- **Score inflation:** capped at ×4 combo / ×3 risk / ×2 blood moon / ×2 food multiplier = ×48 max theoretical; realistically ×8-12; XP unchanged
- **Combo difficulty:** 3.5s window, max ×4; requires quick play but achievable
- **Powerup frequency:** 12% special food (88% normal); golden 2/9, slow 2/9, multiplier 2/9, cursed 1/9, time 2/9 (Time Attack only)
- **Event frequency:** ~1 per 40-70s active play; max 4/run; 20-30% uptime
- **Mission difficulty:** grounded in engine values (10 pts/fruit, 40 pts/level, 20×20 board, 60s TA); master missions require skill not grind
- **XP progression:** ~2 full clears or ~30 runs to max rank; fruit +2, run +10, new best +25, level-up +5×level
- **Cosmetic unlock pacing:** 4 defaults + 21 unlockable across achievements/missions/rank/score/daily; spread across 30+ days
- **Daily Challenge fairness:** deterministic seeded; snake-aware food; 60 fruits clearable; 5 modifiers add variety without breaking attainability
- **Streak rewards:** 10 milestones (days 1-7, 14, 21, 30); XP + cosmetics; no punishment for missed days
- **Ghost usefulness:** per-mode, records best run; translucent white snake; respects reduced motion; never affects collision

**Verified:** `npm test` 222/222, `npx astro check` 0 errors, `npm run build` passes (10 routes incl. `/daily` and `/customize`).

## FINAL STATUS

### Implemented Systems (Sessions 1-12)

| Session | System | Key Files |
|---------|--------|-----------|
| 1 | Persistent Player Progression | `progression.ts`, `storage.ts`, `game.ts` |
| 2 | Missions | `missions.ts`, `game.ts`, `GameStage.astro` |
| 3 | Achievements | `achievements.ts`, `progression.ts`, `achievements.astro` |
| 4 | Combo + Mastery Scoring | `combo.ts`, `game.ts`, `GameStage.astro` |
| 5 | Special Food / Power-ups | `food.ts`, `core.ts`, `game.ts`, `GameStage.astro` |
| 6 | Dynamic In-Run Events | `events.ts`, `game.ts`, `GameStage.astro` |
| 7 | Cosmetic Unlock System | `cosmetics.ts`, `customize.ts`, `progression.ts`, `customize.astro` |
| 8 | Daily Challenge 2.0 | `daily.ts`, `modes.ts`, `storage.ts`, `game.ts`, `daily-page.ts`, `daily.astro` |
| 9 | Streaks + Weekly Goals | `streaks.ts`, `weekly.ts`, `progression.ts`, `game.ts`, `GameStage.astro` |
| 10 | Personal Best Ghost | `ghost.ts`, `progression.ts`, `storage.ts`, `game.ts`, `GameStage.astro` |
| 11 | Friend Challenges | `challenge.ts`, `game.ts`, `GameStage.astro` |
| 12 | Final Retention + UX Balancing | `game.ts`, `GameStage.astro` |

### Key Architecture Decisions
- **Pure modules:** All game logic (core, daily, missions, achievements, combo, food, events, streaks, weekly, ghost, challenge, cosmetics, progression) is pure TypeScript — no DOM, no localStorage, fully testable
- **Single profile blob:** `serpent-profile` stores all persistent state (version 1, backwards compatible)
- **Separate storage keys:** `serpent-missions`, `serpent-daily-*`, `serpent-weekly-goals`, `serpent-ghost`, `serpent-pref:*` — isolated, versioned, corrupt-safe
- **URL-hash challenges:** `#challenge=base64url(...)` — stateless, shareable, no backend
- **Deterministic daily:** FNV-1a seed + mulberry32 PRNG + snake-aware food placement
- **Reduced motion:** all animations/transitions disabled via `prefers-reduced-motion`
- **Storage safety:** never-throwing wrappers; corrupt data sanitized; versioned blobs

### Test Suite
- **222 unit tests pass** (182 pre-Session-12 + 13 streak + 13 weekly + 15 ghost + 20 challenge = 273 total including all)
- Run with `npm test` (native Node test runner, no external deps)
- All pure modules have dedicated test files

### Build & Deploy
- `npm run build` → static output to `dist/` (10 routes, 728ms)
- `npx astro check` → 0 errors
- Deployable to GitHub Pages (static, no backend)

### Known Limitations
- No mid-run persistence (tab close loses in-progress run)
- Board-clear/self-collision not covered by e2e tests
- No visual regression suite
- No server-side features (leaderboards, multiplayer, cloud sync)

### Possible Future Improvements
- Profile page (`/progress`) with lifetime stats, achievement gallery, mission history
- Game-over mission summary panel
- Personal ghost racing mode (side-by-side with current run)
- Friend challenge accept/decline flow with in-game notification
- Weekly goal notifications (non-intrusive)
- Sound toggle per-effect (combo, event, food)
- Colorblind-friendly cosmetic variants
- Accessibility: screen reader announcements for all popups

---

*End of PROJECT.md — Session 12 COMPLETE*