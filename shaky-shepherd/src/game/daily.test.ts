import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyShareMessage,
  DAILY_CHALLENGE_PARAMS,
  DAILY_FOOD_COUNT,
  dailyDateKey,
  formatDailyDate,
  generateDailyChallenge,
  hashString,
  mulberry32,
} from './daily.ts';
import { CELLS, createInitialSnake, spawnFood } from './core.ts';
import { GAME_MODES } from './modes.ts';
import {
  DAILY_KEYS,
  readStoredDailyStatus,
  setStorageBackend,
  writeStoredDailyStatus,
} from './storage.ts';

type MemBackend = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

function memoryBackend(): MemBackend {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

beforeEach(() => setStorageBackend(undefined));

test('same date produces an identical challenge (state, food sequence, params)', () => {
  const a = generateDailyChallenge('2026-08-19');
  const b = generateDailyChallenge('2026-08-19');
  assert.deepEqual(a, b);
  assert.equal(a.dateKey, '2026-08-19');
  assert.deepEqual(a.startingSnake, createInitialSnake());
  assert.deepEqual(a.startDirection, { x: 1, y: 0 });
  assert.equal(a.foodSequence.length, DAILY_FOOD_COUNT);
  assert.equal(DAILY_CHALLENGE_PARAMS.pointsPerFruit, 10);
  assert.equal(DAILY_CHALLENGE_PARAMS.wrap, false);
  assert.equal(DAILY_CHALLENGE_PARAMS.timeLimitMs, null);
  assert.equal(a.seed, hashString('2026-08-19'));
});

test('different dates produce different challenges (seed and food sequence)', () => {
  const a = generateDailyChallenge('2026-08-19');
  const b = generateDailyChallenge('2026-08-20');
  assert.notEqual(a.seed, b.seed);
  assert.notDeepEqual(a.foodSequence, b.foodSequence);
  assert.notEqual(a.dateKey, b.dateKey);
});

test('dailyDateKey uses the local calendar date', () => {
  assert.equal(dailyDateKey(new Date(2026, 7, 19)), '2026-08-19');
  assert.equal(dailyDateKey(new Date(2026, 7, 19, 23, 59, 59)), '2026-08-19');
  assert.equal(dailyDateKey(new Date(2026, 7, 20, 0, 0, 1)), '2026-08-20');
  assert.equal(dailyDateKey(new Date(2026, 0, 3)), '2026-01-03');
});

test('challenge state survives reload: regeneration is stable and persisted status round-trips', () => {
  setStorageBackend(memoryBackend());

  const before = generateDailyChallenge('2026-08-19');
  writeStoredDailyStatus({
    dateKey: '2026-08-19',
    score: 120,
    completed: true,
    level: 4,
    durationMs: 61_000,
    length: 16,
  });

  // Simulated reload: the persisted status is intact…
  const status = readStoredDailyStatus();
  assert.deepEqual(status, {
    dateKey: '2026-08-19',
    score: 120,
    completed: true,
    level: 4,
    durationMs: 61_000,
    length: 16,
  });

  // …and regenerating the challenge for the same date reproduces it exactly.
  const after = generateDailyChallenge('2026-08-19');
  assert.deepEqual(after, before);

  // Corrupt status JSON is tolerated and ignored.
  const backend2 = memoryBackend();
  backend2.setItem(DAILY_KEYS.status, '{not json');
  setStorageBackend(backend2);
  assert.equal(readStoredDailyStatus(), null);
});

test('classic mode remains nondeterministic and does not share daily state', () => {
  // Classic carries no seeded food sequence.
  assert.equal('foodSequence' in GAME_MODES.classic, false);
  assert.notEqual(GAME_MODES.classic.bestKey, GAME_MODES.daily.bestKey);

  // Classic food spawning depends on the rng — different seeds, different fruit.
  const snake = createInitialSnake();
  const foodA = spawnFood(snake, mulberry32(1));
  const foodB = spawnFood(snake, mulberry32(2));
  assert.notDeepEqual(foodA, foodB);
});

test('daily generation never touches Math.random (challenge-critical path is fully seeded)', () => {
  const originalRandom = Math.random;
  let called = false;
  (Math as { random: () => number }).random = () => {
    called = true;
    return 0.5;
  };
  try {
    generateDailyChallenge('2026-08-19');
    generateDailyChallenge('2026-08-20');
    generateDailyChallenge('2026-08-21');
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(called, false);
});

test('daily best is stored separately from every other mode', () => {
  assert.equal(DAILY_KEYS.best, 'serpent-daily-best');
  assert.notEqual(DAILY_KEYS.best, GAME_MODES.classic.bestKey);
  assert.notEqual(DAILY_KEYS.best, GAME_MODES['time-attack'].bestKey);
  assert.notEqual(DAILY_KEYS.best, GAME_MODES.zen.bestKey);
  assert.equal(GAME_MODES.daily.bestKey, DAILY_KEYS.best);
  assert.equal(GAME_MODES.daily.bestLengthKey, DAILY_KEYS.bestLength);
});

test('mulberry32 is deterministic for a given seed and stays in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const va = a();
    assert.equal(va, b());
    assert.ok(va >= 0 && va < 1);
  }
});

test('hashString is stable and distinct across nearby dates', () => {
  assert.equal(hashString('2026-08-19'), hashString('2026-08-19'));
  assert.notEqual(hashString('2026-08-19'), hashString('2026-08-20'));
  assert.notEqual(hashString('2026-08-19'), hashString('2026-09-19'));
});

test('generated food stays in the interior and never lands on the starting snake', () => {
  const challenge = generateDailyChallenge('2026-08-19');
  const startCells = new Set(challenge.startingSnake.map((c) => c.x * CELLS + c.y));
  for (const food of challenge.foodSequence) {
    assert.ok(food.x >= 1 && food.x < CELLS - 1, `food x in interior (got ${food.x})`);
    assert.ok(food.y >= 1 && food.y < CELLS - 1, `food y in interior (got ${food.y})`);
    assert.equal(startCells.has(food.x * CELLS + food.y), false);
  }
});

test('daily share message always includes the date', () => {
  const plain = buildDailyShareMessage('2026-08-19', 120, false, false);
  assert.ok(plain.includes('2026-08-19'));
  assert.ok(plain.includes('120'));
  const newBest = buildDailyShareMessage('2026-08-19', 120, true, false);
  assert.ok(newBest.includes('2026-08-19'));
  assert.ok(newBest.includes('daily best'));
  const completed = buildDailyShareMessage('2026-08-19', 120, true, true);
  assert.ok(completed.includes('2026-08-19'));
  assert.ok(completed.includes('completed'));
});

test('formatDailyDate is a stable, readable label', () => {
  assert.equal(formatDailyDate('2026-08-19'), formatDailyDate('2026-08-19'));
  assert.match(formatDailyDate('2026-08-19'), /2026/);
  assert.match(formatDailyDate('2026-08-19'), /19/);
});