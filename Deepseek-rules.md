# DEEPSEEK GLOBAL DEVELOPMENT RULES
session 1 is already completed...don't do anything about session 1 and focus on remaining sessions...

This file contains permanent rules for every development session on this project.

These rules apply to ALL future sessions unless explicitly overridden by the user.

The project is an Astro + TypeScript Snake Game deployed as a static site on GitHub Pages.

The goal is to make the game highly replayable through:
- satisfying gameplay
- mastery
- meaningful progression
- challenges
- variety
- personal improvement
- competition
- discovery

Do NOT use manipulative or unhealthy engagement mechanics.

============================================================
1. SESSION WORKFLOW
============================================================

Every development session MUST begin with:

1. Read this file: DEEPSEEK_RULES.md
2. Read PROJECT.md
3. Determine exactly what the current session is supposed to implement.
4. Inspect ONLY the files directly relevant to that session.
5. Implement ONLY the requested session.
6. Test the implementation.
7. Run the relevant build/type checks.
8. Update PROJECT.md.
9. Stop when the session is complete.

This is a continuation workflow, NOT a fresh project-analysis workflow.

IMPORTANT:

Do NOT:
- reread the entire repository every session
- repeatedly inspect unchanged files without a reason
- redo previously completed work
- redesign working systems
- refactor unrelated code
- implement future-session features early
- add speculative features
- perform unnecessary cleanup
- rewrite working code just because another implementation is possible

Every file read must have a concrete reason.

Every code change must have a concrete reason.

TOKEN EFFICIENCY IS A REQUIREMENT.

If PROJECT.md already documents an architecture decision or completed implementation, trust it unless there is evidence that it is outdated or incorrect.

============================================================
2. SESSION SCOPE
============================================================

Each session has a specific objective.

Implement ONLY that objective.

For example:

If the current session is:
"Implement Missions"

DO NOT also implement:
- achievements
- cosmetics
- leaderboards
- new game modes
- dynamic events
- ghost racing
- friend challenges

Those belong to later sessions.

Do not "prepare" future features unless the current feature genuinely requires a small architectural foundation for them.

If future work is noticed, record it in PROJECT.md instead of implementing it.

============================================================
3. PROJECT ARCHITECTURE
============================================================

Preserve the existing project architecture.

The project currently uses an Astro + TypeScript structure.

Important existing areas include:

src/game/core.ts
    Core Snake simulation and game rules.

src/game/game.ts
    Runtime integration, rendering, input, game loop and UI integration.

src/game/modes.ts
    Data-driven game mode definitions.

src/game/daily.ts
    Seeded Daily Challenge logic.

src/game/storage.ts
    Local persistence/localStorage abstraction.

src/game/timing.ts
    Timing and interpolation utilities.

src/components/GameStage.astro
    Main game board and game overlays.

src/components/ModePicker.astro
    Game mode selection.

src/components/StatRail.astro
    Essential game statistics.

src/lib/analytics.ts
    Analytics.

The exact architecture may evolve.

Always inspect PROJECT.md before assuming these files still have the same responsibilities.

============================================================
4. ARCHITECTURAL PRINCIPLE
============================================================

Prefer adding small, focused modules over making existing files enormous.

Especially:

DO NOT turn game.ts into a giant file containing:
- missions
- achievements
- cosmetics
- progression
- Daily systems
- weekly systems
- ghost replay
- challenges
- every UI feature

Use separate modules when a system has meaningful independent responsibility.

The game runtime should primarily orchestrate systems rather than contain every system's complete implementation.

Keep:
- simulation
- persistence
- progression
- missions
- achievements
- cosmetics
- Daily logic
- rendering
- UI
- analytics

reasonably separated.

Reuse existing systems instead of duplicating them.

============================================================
5. HOMEPAGE PRINCIPLE
============================================================

THE HOMEPAGE IS AN ARCADE MACHINE, NOT A DASHBOARD.

The homepage must remain primarily focused on:

- playing Snake
- starting the game
- selecting a mode
- essential current score
- essential best score
- level/speed
- core controls
- minimal contextual game feedback

The homepage is already visually dense.

DO NOT continuously add large sections to the homepage.

Do NOT turn the homepage into a dashboard containing:
- achievement grids
- mission lists
- cosmetic inventories
- detailed statistics
- progression dashboards
- Daily history
- weekly goals
- large player profiles
- large collections of unlockables

just because these systems exist.

If a feature needs substantial UI, use:
1. an existing suitable page, OR
2. a new dedicated route if necessary.

============================================================
6. PAGE SEPARATION
============================================================

Substantial feature collections should live on dedicated pages.

A possible architecture is:

/
    Main Snake game.

 /progress
    Player progression
    XP
    Rank
    Achievements
    Missions
    Lifetime statistics

/daily
    Daily Challenge
    Daily history
    Streak
    Weekly goals

/customize
    Snake skins
    Food skins
    Trails
    Board themes

/about
    Existing About page.

/contact
    Existing Contact page.

/how-to-play
    Instructions if needed.

IMPORTANT:

Do NOT automatically create every page above.

Create a page only when the current feature genuinely requires substantial UI.

Before creating a new page:
- inspect existing routes
- determine whether an appropriate existing page can host the feature
- reuse existing navigation/header/footer
- preserve the existing visual design

Do not duplicate the same information across multiple pages.

============================================================
7. IN-GAME UI PRINCIPLE
============================================================

The game itself should remain clean.

Use small contextual UI for immediate gameplay feedback.

Good examples:

MISSION COMPLETE
+100 XP

ACHIEVEMENT UNLOCKED

COMBO ×4

NEW PERSONAL BEST

+20 XP

DAILY PROGRESS
12 / 60

These should generally be:
- temporary
- contextual
- visually restrained
- non-blocking

Do NOT turn the game board into a permanent information dashboard.

Detailed information belongs on dedicated pages.

============================================================
8. PLAYER PROGRESSION
============================================================

Progression should represent meaningful gameplay mastery.

Possible persistent data includes:

- totalScore
- totalFruit
- totalRuns
- totalPlayTime
- longestSnake
- highestLevel
- per-mode best scores
- XP
- rank
- unlocked achievements
- mission progress
- unlocked cosmetics

Use the existing storage architecture.

Do not break existing localStorage keys.

Storage must:
- fail safely
- tolerate unavailable localStorage
- tolerate corrupted data
- preserve existing saved data
- avoid unnecessary duplication

XP must NOT exist merely because games "need XP".

XP should represent meaningful accomplishments.

Examples:

- eating fruit
- reaching significant levels
- beating personal records
- completing missions
- unlocking achievements
- completing Daily Challenges

Avoid excessive XP inflation.

============================================================
9. RANK SYSTEM
============================================================

Ranks may represent long-term mastery.

Example:

Rank 1 — Hatchling
Rank 2 — Coil
Rank 3 — Fang
Rank 4 — Predator
Rank 5 — Apex

Names may be adjusted to better fit the game's visual identity.

Ranks must NOT provide unfair gameplay advantages.

They are primarily progression/status indicators.

============================================================
10. MISSIONS
============================================================

Missions provide short-term goals.

A player may have approximately 3 active missions.

Mission types should vary.

Examples:

EASY:
- Eat 20 fruits
- Reach Level 3
- Score 100
- Play one run

MEDIUM:
- Reach Level 6
- Reach length 15
- Score 180
- Survive for 45 seconds
- Score 100 in Time Attack

HARD:
- Score 300 in Classic
- Reach Level 8
- Beat your previous score by 20%
- Complete a run without pausing

MASTER:
- difficult but realistically achievable skill challenges

Avoid making every mission a simple score grind.

Use different objective types:
- score
- fruit count
- length
- level
- survival time
- mode-specific objectives
- personal-record improvement
- skill-based conditions

Missions should:
- persist
- track progress
- be clearly communicated
- reward meaningful progression
- never punish the player for failure
- never require unhealthy playtime

The detailed mission collection should NOT become a permanent homepage panel.

============================================================
11. ACHIEVEMENT SYSTEM
============================================================

Achievements are permanent accomplishments.

They must reward:
- skill
- mastery
- consistency
- exploration
- mode variety
- clever gameplay
- personal improvement
- unusual but achievable accomplishments

------------------------------------------------------------
ACHIEVEMENT DIFFICULTY RULE
------------------------------------------------------------

EVERY ACHIEVEMENT MUST BE REALISTICALLY ACHIEVABLE.

"Difficult" is acceptable.

"Practically impossible" is NOT acceptable.

A highly skilled player should be able to deliberately attempt an achievement and realistically accomplish it.

Do NOT create achievements simply because a large number sounds impressive.

BAD:

"Eat 60 fruits"

if the game's normal mechanics make reaching 60 fruits practically impossible.

BAD:

"Score 10,000"

if the game balance makes that effectively unattainable.

BAD:

"Survive for 2 hours"

if the game is not designed for such sessions.

Instead, use challenging but realistic milestones.

------------------------------------------------------------
ACHIEVEMENT TIERS
------------------------------------------------------------

Prefer:

BEGINNER
    achievable by new players

INTERMEDIATE
    requires some practice

ADVANCED
    requires strong skill

MASTER
    difficult but realistically achievable by excellent players

------------------------------------------------------------
EXAMPLE ACHIEVEMENTS
------------------------------------------------------------

BEGINNER:

FIRST BITE
Eat 1 fruit.

GETTING STARTED
Score 30 in one run.

GROWING
Reach length 8.

WARMING UP
Reach Level 3.

INTERMEDIATE:

LONG SNAKE
Reach length 12.

SPEED UP
Reach Level 5.

GOOD RUN
Score 100 in Classic.

TIME IS TICKING
Score 100 in Time Attack.

ZEN MASTER
Score 100 in Zen.

ADVANCED:

SERIOUS SNAKE
Score 200 in Classic.

SPEED DEMON
Reach Level 8.

TIME MACHINE
Score 200 in Time Attack.

NO WALLS
Score 200 in Zen.

DAILY REGULAR
Complete 3 Daily Challenges.

MASTER:

APEX
Reach Level 10.

SNAKE MASTER
Score 300 in Classic.

ONE-MINUTE MONSTER
Score 300 in Time Attack.

ZEN MASTER
Score 300 in Zen.

DAILY MASTER
Complete 7 Daily Challenges.

COMBO MASTER
Reach a high but realistically achievable combo.

RISK TAKER
Perform a defined number of successful close calls.

These numbers are examples, NOT fixed requirements.

Actual thresholds MUST be based on the game's real mechanics and balance.

------------------------------------------------------------
ACHIEVEMENT BALANCING
------------------------------------------------------------

Before finalizing thresholds, consider:

- board size
- movement speed
- score rate
- level progression
- maximum practical snake length
- mode duration
- Daily Challenge length
- combo system
- special food
- dynamic events

If later gameplay changes make an achievement too easy or too difficult, rebalance it.

Do not make achievements impossible just to create "rare" achievements.

Rarity should come from mastery, not absurd requirements.

============================================================
12. SECRET ACHIEVEMENTS
============================================================

Secret achievements are allowed.

Before unlocking:

???
Secret Achievement

After unlocking:

Show the real title and description.

Secret achievements should be:
- discoverable
- skill-based
- fair
- repeatable
- realistically achievable

Do NOT hide impossible requirements behind a "secret" label.

============================================================
13. COMBO / MASTERY SYSTEM
============================================================

The game may use a combo system to reward skilled play.

Example:

Fruit
→ normal score

Quick successive fruit
→ COMBO ×2

Next
→ COMBO ×3

etc.

Combo mechanics must:
- reward skill
- have clear rules
- have a reasonable expiration window
- avoid excessive score inflation
- be testable
- integrate cleanly with game modes

Near-miss/risk mechanics may provide additional mastery scoring.

Example:

CLOSE CALL
+5

But risk rewards must never make reckless play mandatory.

============================================================
14. SPECIAL FOOD / POWER-UPS
============================================================

Special food should create strategic choices.

Possible types:

NORMAL
    standard score

GOLDEN
    higher score

TIME
    time benefit in compatible modes

SLOW
    temporary slowdown

MULTIPLIER
    temporary score multiplier

GHOST/PHASE
    carefully bounded defensive mechanic

CURSED/RISK
    large reward with meaningful temporary difficulty

Do NOT implement every possible power-up just because it was suggested.

Choose a small balanced set.

Rules:

- special food must remain relatively rare
- normal food remains dominant
- effects must be clear
- effects must be testable
- effects must reset correctly
- Daily determinism must be preserved
- power-ups must never trivialize Snake
- avoid unfair deaths

============================================================
15. DYNAMIC EVENTS
============================================================

Rare temporary events may make runs more exciting.

Possible examples:

GOLD RUSH
PANIC MODE
FRUIT STORM
BLOOD MOON
SAFE ZONE
BONUS ROUND

Events must be:
- rare
- fair
- clearly communicated
- deterministic where required
- pausable
- safely terminated on game over
- configurable
- tested

Events must never overwhelm normal Snake gameplay.

============================================================
16. COSMETICS
============================================================

Cosmetics provide long-term rewards without affecting gameplay.

Possible categories:

SNAKE:
- Classic
- Neon
- Cyber
- Inferno
- Ice
- Void
- Gold
- Galaxy
- Glitch
- Toxic

FOOD:
- Apple
- Crystal
- Orb
- Star
- Energy Core

TRAIL:
- None
- Glow
- Particles
- Fire
- Lightning
- Rainbow

BOARD:
- Midnight
- Arcade
- Matrix
- Sunset
- Void
- Grid

Do NOT implement every cosmetic immediately.

Use a data-driven system.

Cosmetics must NEVER provide gameplay advantages.

They may unlock through:
- achievements
- missions
- XP/rank
- score milestones
- Daily milestones

Customization belongs on a dedicated page if it needs substantial UI.

============================================================
17. DAILY CHALLENGE
============================================================

The existing Daily Challenge must NOT be rewritten unnecessarily.

Preserve its core guarantees:

- local calendar date
- deterministic seed
- snake-aware food generation
- daily history
- daily result persistence
- streak calculation

Any new Daily modifier must preserve deterministic behavior.

If modifiers are generated from the date:
- derive them deterministically
- document the rule
- test it

Potential modifiers:

NORMAL
FAST SNAKE
WRAPAROUND
DOUBLE SCORE
FRUIT STORM
etc.

Only use modifiers compatible with the existing game architecture.

Daily Challenge should become a meaningful reason to return, but must not use manipulative pressure.

============================================================
18. STREAKS
============================================================

Daily streaks may be used.

A missed day may naturally reset a consecutive streak.

However:

DO NOT use:
- guilt messaging
- fear-based messaging
- manipulative countdowns
- punishment mechanics
- forced daily play

Streak rewards should be positive.

Examples:
- XP
- cosmetic unlocks
- achievements
- special challenge access

============================================================
19. WEEKLY GOALS
============================================================

Weekly objectives may include:

- Complete 5 Daily Challenges
- Reach 1,000 total points
- Play 3 different modes
- Earn 5 achievements
- Eat 200 fruits
- Beat a personal record

Weekly goals should:
- persist correctly
- handle week boundaries
- be deterministic
- integrate with missions/progression
- avoid duplication

Do not create a separate redundant mission engine if the existing mission infrastructure can be reused.

============================================================
20. PERSONAL GHOST
============================================================

A personal-best ghost is strongly preferred as a long-term mastery mechanic.

The player should be able to race against their own previous best.

Example:

CURRENT
    Score 182

GHOST
    Best 214

Display:

AHEAD +8

or:

BEHIND -12

Rules:

- ghost never affects collision
- ghost data must be persisted safely
- storage size must remain reasonable
- corrupted ghost data must fail safely
- ghost must be deterministic
- ghost should be per relevant mode
- ghost should be visually subtle
- ghost must respect reduced-motion preferences

Do not implement online multiplayer as part of this system.

============================================================
21. FRIEND CHALLENGES
============================================================

The game may support shareable challenge URLs.

The challenge should work entirely on static GitHub Pages.

No backend is required.

A challenge may encode:

- mode
- target score
- relevant rule/version information

The receiving player sees:

YASH CHALLENGED YOU

TARGET:
210

BEAT THE CHALLENGE

Requirements:

- validate all URL data
- do not trust arbitrary parameters
- keep URLs reasonably short
- preserve normal sharing
- do not require accounts
- do not require a server
- add tests

============================================================
22. GAME-OVER EXPERIENCE
============================================================

Game over should communicate meaningful results without overwhelming the player.

Possible information:

SCORE
PERSONAL BEST
LEVEL
LENGTH
FRUIT
TIME
XP EARNED
MISSIONS COMPLETED
ACHIEVEMENTS UNLOCKED
NEXT GOAL

The player should have an obvious:

PLAY AGAIN

action.

But avoid popup overload.

The player should immediately understand:
- what they accomplished
- whether they improved
- what they can chase next

============================================================
23. FEEDBACK AND ANIMATION
============================================================

Important actions should feel satisfying.

Examples:

Fruit:
- score pop
- particle feedback
- sound

Combo:
- escalating feedback

Achievement:
- restrained unlock notification

Personal best:
- clear celebration

Mission:
- progress/completion feedback

Daily completion:
- meaningful result feedback

But:

DO NOT over-animate the game.

Always respect:

prefers-reduced-motion

Performance is more important than visual effects.

============================================================
24. PERFORMANCE
============================================================

The game must remain fast.

Avoid:
- unnecessary DOM updates
- huge arrays
- unbounded particle systems
- large localStorage payloads
- expensive per-frame calculations
- unnecessary React-like state patterns in the hot loop
- repeated serialization every frame

The game is a real-time experience.

Keep the hot path lightweight.

============================================================
25. MOBILE / RESPONSIVENESS
============================================================

Do not sacrifice mobile usability for desktop features.

Preserve:
- touch controls
- responsive board
- fullscreen behavior
- orientation handling
- readable UI
- appropriately sized controls

New feature UI must be responsive.

Do not allow progression/detailed pages to interfere with the actual mobile game board.

============================================================
26. ACCESSIBILITY
============================================================

Preserve and improve accessibility.

Important UI should have:
- accessible labels
- keyboard access
- focus behavior
- appropriate aria attributes
- meaningful announcements where appropriate

Do not rely exclusively on:
- color
- animation
- sound

to communicate important information.

============================================================
27. STATIC-HOSTING CONSTRAINT
============================================================

The game is deployed on GitHub Pages.

Do not introduce backend-dependent functionality unless explicitly requested.

Features should work with:
- static assets
- client-side TypeScript
- localStorage
- URL state

Do not introduce:
- authentication
- databases
- server APIs
- server-side state

unless explicitly requested by the user.

============================================================
28. EXISTING FUNCTIONALITY MUST SURVIVE
============================================================

Every session must preserve existing functionality unless the session explicitly changes it.

Pay particular attention to:

- Classic mode
- Time Attack
- Zen
- Daily Challenge
- scoring
- levels
- speed
- pause
- restart
- keyboard controls
- WASD
- touch controls
- fullscreen
- sound
- sharing
- local persistence
- responsive behavior

Do not break existing modes while adding new systems.

============================================================
29. TESTING RULE
============================================================

Every session must test the code it changes.

Prefer:
- unit tests for pure logic
- integration tests for persistence
- build/type checks
- existing test suite

Do not skip tests simply because the feature appears visually simple.

After changes:

1. Run relevant tests.
2. Run broader tests when appropriate.
3. Run production build/type checks.
4. Fix regressions caused by the session.

Never claim success without verification.

============================================================
30. PROJECT.MD MAINTENANCE
============================================================

PROJECT.md is the persistent memory between AI sessions.

At the end of EVERY session, update PROJECT.md.

Use this structure:

## Current Status

Brief summary of current project state.

## Completed Sessions

- Session 1 — COMPLETE
- Session 2 — COMPLETE
- etc.

## Architecture

Only important architectural information future sessions need.

## Files Changed This Session

- path/file — purpose of change
- path/file — purpose of change

## Persistence / Data Changes

Document:
- storage keys
- schemas
- data models
- migration changes

## Important Decisions

Document important choices and reasons.

## Tests

List:
- tests added
- tests modified
- test command
- result

## Build

Record:
- build/type-check command
- result

## Known Issues

Only real unresolved issues.

## Next Session

Only information the next session needs.

IMPORTANT:

Do NOT:
- paste source code into PROJECT.md
- create a huge diary
- duplicate entire file contents
- describe trivial changes
- write speculative future plans

PROJECT.md must remain concise and useful.

============================================================
31. NO UNNECESSARY REFACTORING
============================================================

Do not refactor code simply because:
- another architecture is theoretically cleaner
- a different naming scheme is possible
- formatting could be changed
- unrelated code could be modernized

Only refactor when:
1. required for the current feature,
2. required to fix a real bug,
3. or required to preserve maintainability of the system being implemented.

Keep changes focused.

============================================================
32. NO FEATURE CREEP
============================================================

The user has intentionally divided development into sessions.

Respect that division.

If you discover an interesting feature during implementation:

DO NOT IMPLEMENT IT.

Instead:
record it in PROJECT.md under Known Issues/Future Considerations if relevant.

Then continue the current session.

============================================================
33. RETENTION PHILOSOPHY
============================================================

The objective is HIGH REPLAYABILITY, not harmful addiction.

The game should make players want to return because:

- gameplay feels good
- they want to improve
- they want to master mechanics
- they have meaningful goals
- they want to unlock things
- they want to beat their personal best
- they want to complete a Daily Challenge
- they want to improve their streak
- they want to beat their ghost
- they want to challenge friends
- they discover new mechanics

Do NOT use:

- fake scarcity
- fake urgency
- manipulative notifications
- forced daily login
- punishment for missing days
- energy systems
- artificial waiting
- pay-to-win
- deliberately frustrating RNG
- excessive popups
- endless reward spam

The game should feel rewarding, not manipulative.

============================================================
34. FEATURE PRIORITY
============================================================

When choosing between multiple implementation options, prioritize:

1. Core gameplay quality
2. Performance
3. Mobile usability
4. Replayability
5. Mastery
6. Meaningful progression
7. Variety
8. Accessibility
9. Visual polish
10. Extra features

Never sacrifice the core Snake experience merely to add another progression mechanic.

============================================================
35. FINAL DECISION RULE
============================================================

When uncertain about an implementation, ask:

1. Does this improve the actual game?
2. Does it belong in this session?
3. Does it belong on the homepage?
4. Would a dedicated page be better?
5. Is it realistically achievable?
6. Does it preserve existing functionality?
7. Does it work on static GitHub Pages?
8. Is it performant?
9. Is it testable?
10. Does it avoid unnecessary complexity?

If the answer to several of these is "no":

DO NOT IMPLEMENT IT.

============================================================
36. SESSION COMPLETION RULE
============================================================

A session is complete only when:

- requested feature is implemented
- unrelated features were not added
- existing functionality still works
- relevant tests pass
- build/type checks pass
- PROJECT.md is updated
- changed files are documented
- important architectural decisions are documented

After that:

STOP.

Do not automatically continue into the next session.

============================================================
END OF GLOBAL RULES
============================================================