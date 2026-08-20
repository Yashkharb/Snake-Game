import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyShareMessage,
  DAILY_CHALLENGE_PARAMS,
  DAILY_FOOD_COUNT,
  dailyDateKey,
  dailyFoodFor,
  formatDailyDate,
  generateDailyChallenge,
  hashString,
  mulberry32,
  previousDayKey,
} from './daily.ts';
import { CELLS, createInitialSnake, createInitialState, spawnFood, startRun, step } from './core.ts';
import type { Cell, GameState, Vec } from './core.ts';
import { GAME_MODES } from './modes.ts';
import {
  DAILY_KEYS,
  readStoredDailyStatus,
  readStoredDailyHistory,
  recordDailyResult,
  computeDailyStreak,
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

// A broad set of dates spanning leap years, year boundaries, and many weekdays.
const DATE_RANGE: string[] = [];
for (let day = 1; day <= 31; day++) DATE_RANGE.push(`2026-08-${String(day).padStart(2, '0')}`);
for (let month = 1; month <= 12; month++) DATE_RANGE.push(`2026-${String(month).padStart(2, '0')}-15`);
for (const year of [2024, 2025, 2026, 2027]) {
  DATE_RANGE.push(`${year}-01-01`, `${year}-02-29`, `${year}-12-31`);
  for (let day = 1; day <= 15; day++) DATE_RANGE.push(`${year}-06-${String(day).padStart(2, '0')}`);
}

function cellKey(c: Cell): string {
  return `${c.x},${c.y}`;
}

test('same date produces an identical challenge (seed, starting state, params)', () => {
  const a = generateDailyChallenge('2026-08-19');
  const b = generateDailyChallenge('2026-08-19');
  assert.deepEqual(a, b);
  assert.equal(a.dateKey, '2026-08-19');
  assert.deepEqual(a.startingSnake, createInitialSnake());
  assert.deepEqual(a.startDirection, { x: 1, y: 0 });
  assert.equal(a.seed, hashString('2026-08-19'));
  assert.equal(DAILY_CHALLENGE_PARAMS.pointsPerFruit, 10);
  assert.equal(DAILY_CHALLENGE_PARAMS.wrap, false);
  assert.equal(DAILY_CHALLENGE_PARAMS.timeLimitMs, null);
});

test('different dates produce different challenges (seed)', () => {
  const a = generateDailyChallenge('2026-08-19');
  const b = generateDailyChallenge('2026-08-20');
  assert.notEqual(a.seed, b.seed);
  assert.notEqual(a.dateKey, b.dateKey);
});

test('dailyDateKey uses the local calendar date', () => {
  assert.equal(dailyDateKey(new Date(2026, 7, 19)), '2026-08-19');
  assert.equal(dailyDateKey(new Date(2026, 7, 19, 23, 59, 59)), '2026-08-19');
  assert.equal(dailyDateKey(new Date(2026, 7, 20, 0, 0, 1)), '2026-08-20');
  assert.equal(dailyDateKey(new Date(2026, 0, 3)), '2026-01-03');
});

test('a local date rollover produces a different challenge and fruit stream', () => {
  const today = generateDailyChallenge('2026-08-19');
  const tomorrow = generateDailyChallenge('2026-08-20');
  assert.notEqual(today.seed, tomorrow.seed);
  const snake = createInitialSnake();
  assert.notDeepEqual(dailyFoodFor(today.dateKey, 0, snake), dailyFoodFor(tomorrow.dateKey, 0, snake));
});

test('challenge state survives reload and corrupt status is tolerated', () => {
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

  const status = readStoredDailyStatus();
  assert.deepEqual(status, {
    dateKey: '2026-08-19',
    score: 120,
    completed: true,
    level: 4,
    durationMs: 61_000,
    length: 16,
  });

  const after = generateDailyChallenge('2026-08-19');
  assert.deepEqual(after, before);

  const backend2 = memoryBackend();
  backend2.setItem(DAILY_KEYS.status, '{not json');
  setStorageBackend(backend2);
  assert.equal(readStoredDailyStatus(), null);
});

test('history records each completed daily run keyed by date, surviving reload', () => {
  setStorageBackend(memoryBackend());

  recordDailyResult({ dateKey: '2026-08-18', score: 90, completed: true, level: 3, durationMs: 40_000, length: 13 });
  recordDailyResult({ dateKey: '2026-08-19', score: 120, completed: true, level: 4, durationMs: 61_000, length: 16 });
  recordDailyResult({ dateKey: '2026-08-19', score: 140, completed: false, level: 4, durationMs: 30_000, length: 16 });

  const history = readStoredDailyHistory();
  assert.equal(Object.keys(history).length, 2);
  assert.equal(history['2026-08-18'].score, 90);
  assert.equal(history['2026-08-19'].score, 140);
  assert.equal(history['2026-08-19'].completed, false);

  const reloaded = readStoredDailyHistory();
  assert.deepEqual(reloaded, history);

  const corrupt = memoryBackend();
  corrupt.setItem(DAILY_KEYS.history, '{broken');
  setStorageBackend(corrupt);
  assert.deepEqual(readStoredDailyHistory(), {});
});

test('streak counts consecutive completed days ending today', () => {
  const completed = (dateKey: string) => ({
    dateKey,
    score: 100,
    completed: true,
    level: 3,
    durationMs: 40_000,
    length: 12,
  });

  const history = {
    '2026-08-18': completed('2026-08-18'),
    '2026-08-19': completed('2026-08-19'),
    '2026-08-20': completed('2026-08-20'),
  };

  assert.equal(computeDailyStreak(history, '2026-08-20'), 3);
  assert.equal(computeDailyStreak(history, '2026-08-21'), 3);
  assert.equal(computeDailyStreak({ ...history, '2026-08-21': { ...completed('2026-08-21'), completed: true } }, '2026-08-21'), 4);
  assert.equal(computeDailyStreak({}, '2026-08-20'), 0);
});

test('streak breaks on a missed day and ignores failed runs', () => {
  const completed = (dateKey: string) => ({
    dateKey,
    score: 100,
    completed: true,
    level: 3,
    durationMs: 40_000,
    length: 12,
  });

  const history = {
    '2026-08-18': completed('2026-08-18'),
    '2026-08-19': completed('2026-08-19'),
    '2026-08-21': completed('2026-08-21'),
  };

  assert.equal(computeDailyStreak(history, '2026-08-22'), 1);
  assert.equal(computeDailyStreak(history, '2026-08-21'), 1);

  const withFailedToday = {
    ...history,
    '2026-08-22': { ...completed('2026-08-22'), completed: false },
  };
  assert.equal(computeDailyStreak(withFailedToday, '2026-08-22'), 1);

  const withCompletedToday = {
    ...withFailedToday,
    '2026-08-22': { ...completed('2026-08-22'), completed: true },
  };
  assert.equal(computeDailyStreak(withCompletedToday, '2026-08-22'), 2);
});

test('previousDayKey crosses month and year boundaries', () => {
  assert.equal(previousDayKey('2026-08-20'), '2026-08-19');
  assert.equal(previousDayKey('2026-03-01'), '2026-02-28');
  assert.equal(previousDayKey('2028-03-01'), '2028-02-29');
  assert.equal(previousDayKey('2026-01-01'), '2025-12-31');
});

test('classic mode remains nondeterministic and does not share daily state', () => {
  assert.notEqual(GAME_MODES.classic.bestKey, GAME_MODES.daily.bestKey);
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
    for (const dateKey of DATE_RANGE.slice(0, 12)) {
      generateDailyChallenge(dateKey);
      dailyFoodFor(dateKey, 0, createInitialSnake());
      dailyFoodFor(dateKey, 30, createInitialSnake());
    }
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

test('dailyFoodFor never returns a snake-occupied cell and stays in the interior', () => {
  for (const dateKey of DATE_RANGE) {
    for (const snake of [createInitialSnake(), [{ x: 5, y: 5 }], fullBelly()]) {
      for (let i = 0; i < DAILY_FOOD_COUNT; i += 7) {
        const food = dailyFoodFor(dateKey, i, snake);
        assert.ok(food !== null, `${dateKey}#${i} must produce food`);
        assert.ok(food.x >= 1 && food.x < CELLS - 1, `food x in interior (got ${food.x})`);
        assert.ok(food.y >= 1 && food.y < CELLS - 1, `food y in interior (got ${food.y})`);
        assert.equal(
          snake.some((s) => s.x === food!.x && s.y === food!.y),
          false,
          `${dateKey}#${i} food must not sit on the snake`,
        );
      }
    }
  }
});

// A long snake shaped like a spiral, used to stress availability checks.
function fullBelly(): Cell[] {
  const cells: Cell[] = [];
  for (let x = 3; x < CELLS - 3; x++) cells.push({ x, y: 4 });
  for (let y = 4; y < CELLS - 4; y++) cells.push({ x: CELLS - 4, y });
  for (let x = CELLS - 4; x > 3; x--) cells.push({ x, y: CELLS - 4 });
  for (let y = CELLS - 4; y > 4; y--) cells.push({ x: 3, y });
  return cells;
}

test('across a broad date range every placed fruit is valid, unique, and free of the snake', () => {
  for (const dateKey of DATE_RANGE.slice(0, 20)) {
    const snake = createInitialSnake();
    const seen = new Set<string>();
    for (let i = 0; i < DAILY_FOOD_COUNT; i++) {
      const food = dailyFoodFor(dateKey, i, snake);
      assert.ok(food !== null, `${dateKey} fruit ${i} must exist`);
      assert.ok(!snake.some((s) => s.x === food!.x && s.y === food!.y), `${dateKey} fruit ${i} off the snake`);
      assert.ok(!seen.has(cellKey(food!)), `${dateKey} fruit ${i} must be unique`);
      seen.add(cellKey(food!));
      // Grow the snake at the fruit so the next placement sees the new body.
      snake.unshift({ ...food! });
    }
  }
});

// --- Engine-level attainability simulation -------------------------------

function bfsPath(snake: Cell[], target: Cell): Cell[] | null {
  const blocked = new Set<string>();
  for (let i = 0; i < snake.length - 1; i++) blocked.add(cellKey(snake[i]));
  const head = snake[0];
  if (cellKey(target) === cellKey(head)) return [];
  const directions: Vec[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const prev = new Map<string, string>();
  const seen = new Set<string>([cellKey(head)]);
  const queue: Cell[] = [head];
  while (queue.length > 0) {
    const current = queue.shift() as Cell;
    for (const d of directions) {
      const nx = current.x + d.x;
      const ny = current.y + d.y;
      if (nx < 0 || nx >= CELLS || ny < 0 || ny >= CELLS) continue;
      const k = cellKey({ x: nx, y: ny });
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      prev.set(k, cellKey(current));
      if (k === cellKey(target)) {
        const path: Cell[] = [];
        let cursor = k;
        while (cursor !== cellKey(head)) {
          const [px, py] = cursor.split(',').map(Number);
          path.unshift({ x: px, y: py });
          cursor = prev.get(cursor) as string;
        }
        return path;
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// Pick the engine direction that makes progress toward the fruit while keeping
// the tail reachable (the standard "stay alive" snake heuristic). Any move that
// keeps the tail reachable beats any that does not; among safe moves the one
// closest to the fruit wins. Eating the final fruit (cleared) is an instant win.
function chooseMove(state: GameState, foodSource: (snake: Cell[]) => Cell | null): Vec | null {
  const head = state.snake[0];
  const candidates: Vec[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const evaluated: { dir: Vec; safe: boolean; distFood: number }[] = [];
  for (const dir of candidates) {
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;
    if (nx < 0 || nx >= CELLS || ny < 0 || ny >= CELLS) continue;
    const result = step({ ...state, direction: dir, turnQueue: [] }, { foodSource });
    if (result.state.status === 'cleared') return dir;
    if (result.state.status !== 'running') continue; // died: wall or self
    const nextSnake = result.state.snake;
    const tail = nextSnake[nextSnake.length - 1];
    const safe = bfsPath(nextSnake, tail) !== null;
    const willEat = state.food !== null && nx === state.food.x && ny === state.food.y;
    const distFood = willEat ? 0 : result.state.food ? (bfsPath(nextSnake, result.state.food)?.length ?? Infinity) : 0;
    evaluated.push({ dir, safe, distFood });
  }
  if (evaluated.length === 0) return null;
  const safe = evaluated.filter((e) => e.safe);
  const pool = safe.length > 0 ? safe : evaluated;
  pool.sort((a, b) => a.distFood - b.distFood);
  return pool[0].dir;
}

// Drive the real engine (core.step) toward each fruit with the tail-safe
// planner. The run is "attainable in engine terms" when it reaches `cleared`,
// i.e. all DAILY_FOOD_COUNT fruits were eaten through the engine.
function simulateDaily(dateKey: string): { cleared: boolean; fruitsEaten: number } {
  const snake = createInitialSnake();
  let state: GameState = {
    ...startRun(createInitialState(), () => 0.5),
    food: dailyFoodFor(dateKey, 0, snake),
  };
  if (!state.food) return { cleared: false, fruitsEaten: 0 };
  // Mirrors game.ts: fruit index 0 is placed first, so the next index to place
  // starts at 1 and the run clears after exactly DAILY_FOOD_COUNT fruits.
  let nextToPlace = 1;
  const foodSource = (currentSnake: Cell[]) =>
    nextToPlace >= DAILY_FOOD_COUNT ? null : dailyFoodFor(dateKey, nextToPlace, currentSnake);
  let steps = 0;
  while (state.status === 'running' && steps < 30_000) {
    const dir = chooseMove(state, foodSource);
    if (!dir) break;
    const result = step({ ...state, direction: dir, turnQueue: [] }, { foodSource });
    if (result.ate) nextToPlace += 1;
    state = result.state;
    steps += 1;
  }
  return { cleared: state.status === 'cleared', fruitsEaten: nextToPlace - 1 };
}

test('a daily run is completable through the engine (all 60 fruits → cleared)', () => {
  const dates = ['2026-08-19', '2026-08-20', '2026-12-25', '2026-01-01', '2026-02-29', '2024-02-29', '2026-06-15', '2025-07-04'];
  for (const dateKey of dates) {
    const result = simulateDaily(dateKey);
    assert.equal(
      result.cleared,
      true,
      `${dateKey} should be completable (fruits eaten ${result.fruitsEaten}/${DAILY_FOOD_COUNT})`,
    );
    assert.equal(result.fruitsEaten, DAILY_FOOD_COUNT);
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