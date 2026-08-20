import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultProfile,
  loadProfile,
  nextRankForXp,
  PROFILE_VERSION,
  rankForXp,
  rankIndexForXp,
  rankProgress,
  RANKS,
  recordFruit,
  recordLevelUp,
  recordRunEnd,
  recordScoreBonus,
  saveProfile,
  xpForFruit,
  xpForLevelUp,
  xpForNewBest,
  xpForRun,
  XP,
} from './progression.ts';
import type { PlayerProfile, RunResult } from './progression.ts';
import { PROFILE_KEY, setStorageBackend } from './storage.ts';

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

beforeEach(() => setStorageBackend(undefined));

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    mode: 'classic',
    score: 0,
    fruit: 0,
    durationMs: 0,
    longestSnake: 4,
    level: 1,
    isNewBest: false,
    ...overrides,
  };
}

test('fresh profile is all zeros with empty placeholder collections', () => {
  const profile = createDefaultProfile();
  assert.equal(profile.version, PROFILE_VERSION);
  assert.equal(profile.totalScore, 0);
  assert.equal(profile.totalFruit, 0);
  assert.equal(profile.totalRuns, 0);
  assert.equal(profile.totalPlayTime, 0);
  assert.equal(profile.longestSnake, 0);
  assert.equal(profile.highestLevel, 0);
  assert.equal(profile.classicBest, 0);
  assert.equal(profile.timeAttackBest, 0);
  assert.equal(profile.zenBest, 0);
  assert.equal(profile.dailyBest, 0);
  assert.equal(profile.xp, 0);
  assert.deepEqual(profile.unlockedAchievements, []);
  assert.deepEqual(profile.completedMissions, []);
  assert.deepEqual(profile.unlockedCosmetics, []);
});

test('rank ladder is ordered with the expected five ranks', () => {
  assert.deepEqual(
    RANKS.map((r) => r.name),
    ['Hatchling', 'Coil', 'Fang', 'Predator', 'Apex'],
  );
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(RANKS[i].minXp > RANKS[i - 1].minXp, 'thresholds must ascend');
  }
});

test('rankForXp resolves the correct rank at every threshold', () => {
  const cases: [number, string][] = [
    [0, 'Hatchling'],
    [149, 'Hatchling'],
    [150, 'Coil'],
    [399, 'Coil'],
    [400, 'Fang'],
    [899, 'Fang'],
    [900, 'Predator'],
    [1999, 'Predator'],
    [2000, 'Apex'],
    [100_000, 'Apex'],
    [-50, 'Hatchling'],
  ];
  for (const [xp, name] of cases) {
    assert.equal(rankForXp(xp).name, name, `xp ${xp} should be ${name}`);
  }
});

test('rankProgress exposes index, current and next rank', () => {
  assert.equal(rankProgress(0).index, 0);
  assert.equal(rankProgress(150).index, 1);
  assert.equal(rankProgress(0).next?.name, 'Coil');
  assert.equal(rankProgress(2000).next, null);
  assert.equal(rankIndexForXp(2000), RANKS.length - 1);
  assert.equal(nextRankForXp(2000), null);
  assert.equal(nextRankForXp(0)?.id, 'coil');
});

test('XP formulas match the documented rates', () => {
  assert.equal(XP.fruit, 2);
  assert.equal(XP.run, 10);
  assert.equal(XP.newBest, 25);
  assert.equal(XP.levelUpBase, 5);
  assert.equal(xpForFruit(10), 20);
  assert.equal(xpForFruit(0), 0);
  assert.equal(xpForLevelUp(5), 25);
  assert.equal(xpForLevelUp(12), 60);
  assert.equal(xpForLevelUp(0), 0);
  assert.equal(xpForRun(), 10);
  assert.equal(xpForNewBest(), 25);
});

test('recordFruit credits the score, fruit count and small XP', () => {
  const next = recordFruit(createDefaultProfile(), 10);
  assert.equal(next.totalScore, 10);
  assert.equal(next.totalFruit, 1);
  assert.equal(next.xp, xpForFruit(1));
  const third = recordFruit(recordFruit(next, 10), 10);
  assert.equal(third.totalFruit, 3);
  assert.equal(third.totalScore, 30);
  assert.equal(third.xp, 6);
});

test('recordFruit ignores negative points', () => {
  const next = recordFruit(createDefaultProfile(), -10);
  assert.equal(next.totalScore, 0);
  assert.equal(next.totalFruit, 1);
});

test('recordScoreBonus adds score without fruit or XP side effects', () => {
  const next = recordScoreBonus(createDefaultProfile(), 5);
  assert.equal(next.totalScore, 5);
  assert.equal(next.totalFruit, 0);
  assert.equal(next.xp, 0);
  assert.equal(recordScoreBonus(createDefaultProfile(), -5).totalScore, 0, 'negative bonuses are ignored');
});

test('recordLevelUp raises highestLevel and adds scaled XP', () => {
  const level5 = recordLevelUp(createDefaultProfile(), 5);
  assert.equal(level5.highestLevel, 5);
  assert.equal(level5.xp, xpForLevelUp(5));
  const backDown = recordLevelUp(level5, 3);
  assert.equal(backDown.highestLevel, 5, 'highestLevel never decreases');
  assert.equal(backDown.xp, level5.xp + xpForLevelUp(3));
});

test('recordRunEnd tallies the run without touching per-fruit credits', () => {
  const result = recordRunEnd(createDefaultProfile(), run({ durationMs: 61_000, longestSnake: 16, level: 4 }));
  assert.equal(result.profile.totalRuns, 1);
  assert.equal(result.profile.totalPlayTime, 61_000);
  assert.equal(result.profile.longestSnake, 16);
  assert.equal(result.profile.highestLevel, 4);
  assert.equal(result.profile.xp, xpForRun());
  assert.equal(result.earnedXp, xpForRun());
  assert.equal(result.profile.totalScore, 0, 'fruit score is credited live, not at run end');
  assert.equal(result.rankUp, null);
});

test('recordRunEnd awards a new-best bonus and stores the per-mode best', () => {
  const result = recordRunEnd(createDefaultProfile(), run({ score: 120, isNewBest: true }));
  assert.equal(result.profile.classicBest, 120);
  assert.equal(result.profile.xp, xpForRun() + xpForNewBest());
  assert.equal(result.profile.zenBest, 0, 'other modes untouched');
});

test('recordRunEnd routes the best to the correct mode field', () => {
  const daily = recordRunEnd(createDefaultProfile(), run({ mode: 'daily', score: 90, isNewBest: true }));
  assert.equal(daily.profile.dailyBest, 90);
  assert.equal(daily.profile.classicBest, 0);
  const zen = recordRunEnd(createDefaultProfile(), run({ mode: 'zen', score: 200, isNewBest: true }));
  assert.equal(zen.profile.zenBest, 200);
  const time = recordRunEnd(createDefaultProfile(), run({ mode: 'time-attack', score: 80, isNewBest: true }));
  assert.equal(time.profile.timeAttackBest, 80);
});

test('recordRunEnd never lowers lifetime maxima', () => {
  const seeded: PlayerProfile = {
    ...createDefaultProfile(),
    longestSnake: 30,
    highestLevel: 9,
    classicBest: 500,
  };
  const result = recordRunEnd(seeded, run({ score: 100, longestSnake: 8, level: 3 }));
  assert.equal(result.profile.longestSnake, 30);
  assert.equal(result.profile.highestLevel, 9);
  assert.equal(result.profile.classicBest, 500);
  assert.equal(result.profile.totalRuns, 1);
});

test('recordRunEnd reports a rank-up when the run crosses a threshold', () => {
  const nearCoil = { ...createDefaultProfile(), xp: RANKS[1].minXp - 5 };
  const result = recordRunEnd(nearCoil, run({ isNewBest: true }));
  assert.equal(result.rankUp?.id, 'coil');
  assert.equal(rankForXp(result.profile.xp).id, 'coil');
  const sameRank = recordRunEnd(createDefaultProfile(), run());
  assert.equal(sameRank.rankUp, null);
});

test('profile round-trips through storage, and corruption falls back to defaults', () => {
  const backend = memoryBackend();
  setStorageBackend(backend);
  const profile: PlayerProfile = {
    ...createDefaultProfile(),
    totalRuns: 12,
    xp: 480,
    classicBest: 200,
    unlockedAchievements: ['first-fruit'],
  };
  assert.equal(saveProfile(profile), true);
  const reloaded = loadProfile();
  assert.deepEqual(reloaded, { ...profile, version: PROFILE_VERSION });

  const corrupt = memoryBackend({ [PROFILE_KEY]: '{not json' });
  setStorageBackend(corrupt);
  assert.deepEqual(loadProfile(), createDefaultProfile());
});

test('a future profile version resets to defaults instead of misreading', () => {
  const backend = memoryBackend({ [PROFILE_KEY]: JSON.stringify({ ...createDefaultProfile(), version: 99, totalRuns: 50 }) });
  setStorageBackend(backend);
  assert.deepEqual(loadProfile(), createDefaultProfile());
});

test('garbage profile fields are sanitized to safe defaults', () => {
  const backend = memoryBackend({
    [PROFILE_KEY]: JSON.stringify({
      version: PROFILE_VERSION,
      totalRuns: 'many',
      xp: -100,
      unlockedAchievements: ['ok', 42, null, 'two'],
      completedMissions: 'not-an-array',
    }),
  });
  setStorageBackend(backend);
  const loaded = loadProfile();
  assert.equal(loaded.totalRuns, 0);
  assert.equal(loaded.xp, 0);
  assert.deepEqual(loaded.unlockedAchievements, ['ok', 'two']);
  assert.deepEqual(loaded.completedMissions, []);
});

test('fresh profiles seed lifetime bests from existing per-mode records', () => {
  const backend = memoryBackend({
    'serpent-high-score': '50',
    'serpent-zen-best': '120',
    'serpent-daily-best': '70',
    'serpent-time-attack-best': 'not-a-number',
  });
  setStorageBackend(backend);
  const loaded = loadProfile();
  assert.equal(loaded.classicBest, 50);
  assert.equal(loaded.zenBest, 120);
  assert.equal(loaded.dailyBest, 70);
  assert.equal(loaded.timeAttackBest, 0);
  assert.equal(loaded.totalRuns, 0);
  assert.equal(loaded.xp, 0);
});

test('loadProfile without any storage falls back to a fresh profile safely', () => {
  setStorageBackend(null);
  const loaded = loadProfile();
  assert.deepEqual(loaded, createDefaultProfile());
});
