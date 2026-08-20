import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile, loadProfile, recordAchievementUnlock, saveProfile } from './progression.ts';
import type { PlayerProfile } from './progression.ts';
import {
  ACHIEVEMENTS,
  computeDailyStats,
  evaluateAchievements,
  isCloseCall,
  isHomecoming,
  isPerfectTurn,
} from './achievements.ts';
import type { DailyStats } from './achievements.ts';
import { setStorageBackend } from './storage.ts';
import type { GameState } from './core.ts';
import type { DailyStatus } from './storage.ts';

type MemBackend = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

function memoryBackend(initial: Record<string, string> = {}): MemBackend {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const NO_DAILY: DailyStats = { completedCount: 0, streak: 0 };

function state(overrides: Partial<GameState>): GameState {
  return {
    snake: [
      { x: 10, y: 12 },
      { x: 9, y: 12 },
      { x: 8, y: 12 },
      { x: 7, y: 12 },
    ],
    direction: { x: 1, y: 0 },
    turnQueue: [],
    food: null,
    score: 0,
    status: 'running',
    runId: 1,
    deathReason: null,
    ...overrides,
  };
}

function dailyStatus(dateKey: string): DailyStatus {
  return { dateKey, score: 10, completed: true, level: 1, durationMs: 1000, length: 4 };
}

beforeEach(() => setStorageBackend(undefined));

test('the pool is data-driven: unique ids, every category and tier, sane targets', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'achievement ids are unique');
  const categories = new Set(ACHIEVEMENTS.map((a) => a.category));
  for (const category of ['beginner', 'skill', 'mode', 'extreme', 'secret']) {
    assert.ok(categories.has(category), `missing ${category} category`);
  }
  const tiers = new Set(ACHIEVEMENTS.map((a) => a.tier));
  for (const tier of ['beginner', 'intermediate', 'advanced', 'master']) {
    assert.ok(tiers.has(tier), `missing ${tier} tier`);
  }
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.title && a.description, `${a.id} needs a title and description`);
    assert.ok(a.rewardXp > 0, `${a.id} needs a positive XP reward`);
    if (a.hidden) assert.ok(a.category === 'secret', `${a.id} hidden flag only on secret category`);
    if (a.condition.kind === 'mode-best') assert.ok(a.condition.mode, `${a.id} needs a mode`);
    const value = a.condition.value ?? 0;
    assert.ok(
      a.condition.kind === 'daily-cleared' || value > 0,
      `${a.id} needs a positive threshold (or a boolean condition)`,
    );
  }
});

test('evaluateAchievements returns satisfied-but-unlocked achievements, never already-unlocked ones', () => {
  const profile = { ...createDefaultProfile(), totalFruit: 5, longestSnake: 12, unlockedAchievements: ['first-bite'] };
  const earned = evaluateAchievements(profile, NO_DAILY).map((a) => a.id);
  assert.ok(!earned.includes('first-bite'), 'already-unlocked achievements are never re-returned');
  assert.ok(earned.includes('getting-long'), 'satisfied conditions are returned');

  const fresh = createDefaultProfile();
  assert.deepEqual(evaluateAchievements(fresh, NO_DAILY), [], 'a brand-new profile unlocks nothing');
});

test('every numeric condition type unlocks at its threshold and not before', () => {
  const at: Record<string, (p: PlayerProfile, d?: DailyStats) => string[]> = {
    'first-bite': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'getting-long': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'warming-up': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'perfect-turn': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'close-call': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'no-fear': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'speed-demon': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'snake-god': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'homecoming': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'marathon': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
    'daily-solver': (p) => evaluateAchievements(p, NO_DAILY).map((a) => a.id),
  };

  assert.ok(at['first-bite']({ ...createDefaultProfile(), totalFruit: 1 }).includes('first-bite'));
  assert.ok(at['getting-long']({ ...createDefaultProfile(), longestSnake: 10 }).includes('getting-long'));
  assert.ok(at['warming-up']({ ...createDefaultProfile(), highestLevel: 3 }).includes('warming-up'));
  assert.ok(at['perfect-turn']({ ...createDefaultProfile(), perfectTurns: 5 }).includes('perfect-turn'));
  assert.ok(at['close-call']({ ...createDefaultProfile(), closeCalls: 3 }).includes('close-call'));
  assert.ok(at['no-fear']({ ...createDefaultProfile(), highestLevel: 8 }).includes('no-fear'));

  const level10 = { ...createDefaultProfile(), highestLevel: 10 };
  assert.ok(!at['speed-demon'](level10).includes('speed-demon'), 'max speed needs level 11');
  assert.ok(!at['snake-god'](level10).includes('snake-god'), 'level 10 is not level 12');
  const level11 = { ...createDefaultProfile(), highestLevel: 11 };
  assert.ok(at['speed-demon'](level11).includes('speed-demon'), 'max speed is reached at level 11');
  assert.ok(!at['snake-god'](level11).includes('snake-god'), 'level 11 is not level 12');
  assert.ok(at['snake-god']({ ...level11, highestLevel: 12 }).includes('snake-god'));

  assert.ok(at['homecoming']({ ...createDefaultProfile(), homecomings: 1 }).includes('homecoming'));
  assert.ok(at['marathon']({ ...createDefaultProfile(), longestRunSeconds: 180 }).includes('marathon'));
  assert.ok(at['daily-solver']({ ...createDefaultProfile(), dailyCleared: true }).includes('daily-solver'));

  assert.ok(
    evaluateAchievements({ ...createDefaultProfile(), closeCalls: 2 }, NO_DAILY).every((a) => a.id !== 'close-call'),
    'below-threshold counters stay locked',
  );
});

test('mode-best achievements read the per-mode profile bests', () => {
  const p = { ...createDefaultProfile(), classicBest: 300 };
  const earned = evaluateAchievements(p, NO_DAILY).map((a) => a.id);
  assert.ok(earned.includes('classic-100'));
  assert.ok(earned.includes('classic-300'));
  assert.ok(!earned.includes('classic-600'), '600 needs a classic best of 600');

  const ta = evaluateAchievements({ ...createDefaultProfile(), timeAttackBest: 100 }, NO_DAILY).map((a) => a.id);
  assert.ok(ta.includes('time-attack-100'));
  assert.ok(!ta.includes('time-attack-200'));

  const zen = evaluateAchievements({ ...createDefaultProfile(), zenBest: 300 }, NO_DAILY).map((a) => a.id);
  assert.ok(zen.includes('zen-100') && zen.includes('zen-300'));
});

test('daily-completed and daily-streak conditions use computed daily stats', () => {
  const history = {
    '2026-08-18': dailyStatus('2026-08-18'),
    '2026-08-19': dailyStatus('2026-08-19'),
    '2026-08-20': dailyStatus('2026-08-20'),
  };
  const stats = computeDailyStats(history, '2026-08-20');
  assert.equal(stats.completedCount, 3);
  assert.equal(stats.streak, 3);
  const earned = evaluateAchievements(createDefaultProfile(), stats).map((a) => a.id);
  assert.ok(earned.includes('daily-first'));
  assert.ok(earned.includes('daily-3'));
  assert.ok(!earned.includes('daily-7'));

  const broken = { ...history, '2026-08-18': { ...dailyStatus('2026-08-18'), completed: false } };
  assert.equal(computeDailyStats(broken, '2026-08-20').streak, 2, 'a missed day breaks the streak');

  const sevenDay: Record<string, DailyStatus> = {};
  for (let i = 20; i >= 14; i--) sevenDay[`2026-08-${i}`] = dailyStatus(`2026-08-${i}`);
  assert.equal(computeDailyStats(sevenDay, '2026-08-20').streak, 7);
  assert.ok(
    evaluateAchievements(createDefaultProfile(), computeDailyStats(sevenDay, '2026-08-20')).some((a) => a.id === 'daily-7'),
  );
});

test('a run that has not completed today still preserves a live streak', () => {
  const history = {
    '2026-08-19': dailyStatus('2026-08-19'),
    '2026-08-18': dailyStatus('2026-08-18'),
  };
  const stats = computeDailyStats(history, '2026-08-20');
  assert.equal(stats.completedCount, 2);
  assert.equal(stats.streak, 2, 'an unplayed today does not kill a live streak');
});

test('recordAchievementUnlock grants XP and logs the id exactly once', () => {
  const profile = createDefaultProfile();
  const first = recordAchievementUnlock(profile, 'first-bite', 20);
  assert.equal(first.xp, 20);
  assert.deepEqual(first.unlockedAchievements, ['first-bite']);
  const repeat = recordAchievementUnlock(first, 'first-bite', 20);
  assert.equal(repeat.xp, 20, 'no double XP for the same achievement');
  assert.deepEqual(repeat.unlockedAchievements, ['first-bite']);
  const other = recordAchievementUnlock(first, 'warming-up', 25);
  assert.equal(other.xp, 45);
});

test('unlocked achievements persist through the profile blob', () => {
  const backend = memoryBackend();
  setStorageBackend(backend);
  let profile = createDefaultProfile();
  profile = recordAchievementUnlock(profile, 'first-bite', 20);
  profile = recordAchievementUnlock(profile, 'getting-long', 20);
  assert.equal(saveProfile(profile), true);
  const reloaded = loadProfile();
  assert.deepEqual(reloaded.unlockedAchievements, ['first-bite', 'getting-long']);
  assert.equal(reloaded.xp, 40);
});

test('old profiles without the new fields load safely with zero defaults', () => {
  setStorageBackend(
    memoryBackend({
      'serpent-profile': JSON.stringify({
        version: 1,
        totalScore: 0,
        totalFruit: 0,
        totalRuns: 0,
        totalPlayTime: 0,
        longestSnake: 0,
        highestLevel: 0,
        classicBest: 0,
        timeAttackBest: 0,
        zenBest: 0,
        dailyBest: 0,
        xp: 0,
        unlockedAchievements: [],
        completedMissions: [],
        unlockedCosmetics: [],
      }),
    }),
  );
  const profile = loadProfile();
  assert.equal(profile.closeCalls, 0);
  assert.equal(profile.perfectTurns, 0);
  assert.equal(profile.homecomings, 0);
  assert.equal(profile.longestRunSeconds, 0);
  assert.equal(profile.dailyCleared, false);
});

test('a seeded legacy classic best unlocks the mode milestones retroactively', () => {
  const p = { ...createDefaultProfile(), classicBest: 300 };
  const earned = evaluateAchievements(p, NO_DAILY).map((a) => a.id);
  assert.ok(earned.includes('classic-300'), 'legacy bests count toward achievements');
});

test('isCloseCall counts a survived turn away from a wall hazard', () => {
  const prev = state({
    snake: [
      { x: 19, y: 10 },
      { x: 18, y: 10 },
      { x: 17, y: 10 },
      { x: 16, y: 10 },
    ],
    direction: { x: 1, y: 0 },
    turnQueue: [{ x: 0, y: -1 }],
  });
  const next = state({
    snake: [
      { x: 19, y: 9 },
      { x: 19, y: 10 },
      { x: 18, y: 10 },
      { x: 17, y: 10 },
    ],
    direction: { x: 0, y: -1 },
    turnQueue: [],
  });
  assert.equal(isCloseCall(prev, next, false), true, 'wall one cell ahead, turned and survived');
});

test('isCloseCall does not count without a turn, after death, or on a wrapped wall', () => {
  const prev = state({
    snake: [
      { x: 19, y: 10 },
      { x: 18, y: 10 },
      { x: 17, y: 10 },
      { x: 16, y: 10 },
    ],
    direction: { x: 1, y: 0 },
    turnQueue: [],
  });
  const next = state({
    snake: [
      { x: 19, y: 9 },
      { x: 19, y: 10 },
      { x: 18, y: 10 },
      { x: 17, y: 10 },
    ],
    direction: { x: 0, y: -1 },
  });
  assert.equal(isCloseCall(prev, next, false), false, 'straight-line danger is not a close call');

  const turned = state({ ...prev, turnQueue: [{ x: 0, y: -1 }] });
  assert.equal(isCloseCall(turned, { ...next, status: 'gameover' }, false), false, 'dying negates the close call');
  assert.equal(isCloseCall(turned, next, true), false, 'wrap mode has no wall hazard');
});

test('isCloseCall detects tail hazards the same way as walls', () => {
  const prev = state({
    snake: [
      { x: 9, y: 10 },
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 12, y: 10 },
    ],
    direction: { x: 1, y: 0 },
    turnQueue: [{ x: 0, y: 1 }],
  });
  const next = state({
    snake: [
      { x: 9, y: 11 },
      { x: 9, y: 10 },
      { x: 10, y: 10 },
      { x: 11, y: 10 },
    ],
    direction: { x: 0, y: 1 },
  });
  assert.equal(isCloseCall(prev, next, false), true, 'own body one cell ahead, turned away');
});

test('isPerfectTurn requires both a turn and an eaten fruit on that move', () => {
  const prev = state({
    snake: [
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ],
    turnQueue: [{ x: 0, y: 1 }],
  });
  const ate = state({
    snake: [
      { x: 9, y: 11 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ],
    direction: { x: 0, y: 1 },
    score: 10,
  });
  assert.equal(isPerfectTurn(prev, ate), true, 'turned and ate');

  const noTurn = state({ ...prev, turnQueue: [] });
  assert.equal(isPerfectTurn(noTurn, ate), false, 'eating without a turn is not a perfect turn');

  const noEat = state({
    ...ate,
    snake: ate.snake.slice(0, -1),
  });
  assert.equal(isPerfectTurn(prev, noEat), false, 'turning without eating is not a perfect turn');

  assert.equal(isPerfectTurn(prev, { ...ate, status: 'gameover' }), false, 'a dying move never counts');
});

test('isHomecoming fires only on a live run with the head back at the start cell', () => {
  const start = { x: 10, y: 12 };
  const home = state({ snake: [{ x: 10, y: 12 }, { x: 11, y: 12 }, { x: 12, y: 12 }, { x: 13, y: 12 }] });
  assert.equal(isHomecoming(home, start), true);
  const elsewhere = state({ snake: [{ x: 11, y: 12 }, { x: 12, y: 12 }, { x: 13, y: 12 }, { x: 14, y: 12 }] });
  assert.equal(isHomecoming(elsewhere, start), false);
  assert.equal(isHomecoming({ ...home, status: 'gameover' }, start), false, 'dying on the loop does not count');
});

test('computeDailyStats tolerates corrupt history entries', () => {
  const history = {
    '2026-08-20': dailyStatus('2026-08-20'),
    '2026-08-19': { not: 'a status' } as unknown as DailyStatus,
  };
  const stats = computeDailyStats(history, '2026-08-20');
  assert.equal(stats.completedCount, 1);
  assert.equal(stats.streak, 1);
});