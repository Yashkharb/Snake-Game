/**
 * Unit tests for the ghost system (Session 10).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyGhost,
  getGhost,
  hasValidGhost,
  recordGhostSnapshot,
  createGhostFromRun,
  updateGhostIfNewBest,
  getGhostSnakeAtTime,
  getGhostHeadPosition,
  toggleGhostEnabled,
  sanitizeGhost,
  sanitizeGhosts,
  type GhostData,
  type GhostSnapshot,
} from './ghost.ts';
import { createDefaultProfile } from './progression.ts';
import type { PlayerProfile, GameModeId } from './progression.ts';
import type { Cell, Vec } from './core.ts';

function createTestProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    ...createDefaultProfile(),
    ...overrides,
  };
}

function createTestSnapshot(
  snake: Cell[],
  direction: Vec,
  score: number,
  timeMs: number
): GhostSnapshot {
  return {
    snake: snake.map((s) => ({ ...s })),
    direction: { ...direction },
    score,
    timeMs,
  };
}

test('createEmptyGhost creates a valid empty ghost', () => {
  const modes: GameModeId[] = ['classic', 'time-attack', 'zen', 'daily'];
  for (const mode of modes) {
    const ghost = createEmptyGhost(mode);
    assert.equal(ghost.version, 1);
    assert.equal(ghost.mode, mode);
    assert.equal(ghost.bestScore, 0);
    assert.equal(ghost.finalLength, 0);
    assert.equal(ghost.finalLevel, 0);
    assert.equal(ghost.durationMs, 0);
    assert.equal(ghost.dateKey, '');
    assert.deepEqual(ghost.snapshots, []);
    assert.equal(ghost.enabled, true);
  }
});

test('getGhost returns ghost from profile', () => {
  const profile = createTestProfile();
  const ghost = getGhost(profile, 'classic');
  assert.equal(ghost.mode, 'classic');
  assert.equal(ghost.bestScore, 0);
});

test('hasValidGhost returns false for empty ghost', () => {
  const profile = createTestProfile();
  assert.equal(hasValidGhost(profile, 'classic'), false);
});

test('hasValidGhost returns true for ghost with snapshots and score', () => {
  const profile = createTestProfile({
    ghosts: {
      classic: {
        version: 1,
        mode: 'classic',
        bestScore: 100,
        finalLength: 10,
        finalLevel: 3,
        durationMs: 60000,
        dateKey: '2026-01-01',
        snapshots: [
          {
            snake: [{ x: 10, y: 12 }],
            direction: { x: 1, y: 0 },
            score: 10,
            timeMs: 1000,
          },
        ],
        enabled: true,
      },
      'time-attack': createEmptyGhost('time-attack'),
      zen: createEmptyGhost('zen'),
      daily: createEmptyGhost('daily'),
    },
  });
  assert.equal(hasValidGhost(profile, 'classic'), true);
  assert.equal(hasValidGhost(profile, 'time-attack'), false);
});

test('recordGhostSnapshot adds snapshot and limits size', () => {
  let snapshots: GhostSnapshot[] = [];
  const snake: Cell[] = [{ x: 10, y: 12 }, { x: 9, y: 12 }];
  const direction: Vec = { x: 1, y: 0 };

  for (let i = 0; i < 5; i++) {
    snapshots = recordGhostSnapshot(snapshots, snake, direction, i * 10, i * 1000);
  }
  assert.equal(snapshots.length, 5);
  assert.equal(snapshots[0].score, 0);
  assert.equal(snapshots[4].score, 40);

  // Test MAX_GHOST_SNAPSHOTS limit
  for (let i = 5; i < 610; i++) {
    snapshots = recordGhostSnapshot(snapshots, snake, direction, i * 10, i * 1000);
  }
  assert.equal(snapshots.length, 600); // MAX_GHOST_SNAPSHOTS
});

test('createGhostFromRun creates valid ghost data', () => {
  const snapshots: GhostSnapshot[] = [
    {
      snake: [{ x: 10, y: 12 }],
      direction: { x: 1, y: 0 },
      score: 10,
      timeMs: 1000,
    },
  ];
  const ghost = createGhostFromRun('classic', 100, 10, 3, 60000, '2026-01-01', snapshots);
  assert.equal(ghost.mode, 'classic');
  assert.equal(ghost.bestScore, 100);
  assert.equal(ghost.finalLength, 10);
  assert.equal(ghost.finalLevel, 3);
  assert.equal(ghost.durationMs, 60000);
  assert.equal(ghost.dateKey, '2026-01-01');
  assert.equal(ghost.snapshots.length, 1);
  assert.equal(ghost.enabled, true);
});

test('updateGhostIfNewBest updates profile when score is higher', () => {
  const profile = createTestProfile({
    ghosts: {
      classic: {
        version: 1,
        mode: 'classic',
        bestScore: 50,
        finalLength: 5,
        finalLevel: 2,
        durationMs: 30000,
        dateKey: '2026-01-01',
        snapshots: [],
        enabled: true,
      },
      'time-attack': createEmptyGhost('time-attack'),
      zen: createEmptyGhost('zen'),
      daily: createEmptyGhost('daily'),
    },
  });
  const snapshots: GhostSnapshot[] = [
    {
      snake: [{ x: 10, y: 12 }],
      direction: { x: 1, y: 0 },
      score: 100,
      timeMs: 1000,
    },
  ];
  const newProfile = updateGhostIfNewBest(profile, 'classic', 100, 10, 3, 60000, '2026-01-02', snapshots);
  const ghost = newProfile.ghosts.classic;
  assert.equal(ghost.bestScore, 100);
  assert.equal(ghost.dateKey, '2026-01-02');
  assert.equal(ghost.snapshots.length, 1);
});

test('updateGhostIfNewBest does not update when score is not higher', () => {
  const profile = createTestProfile({
    ghosts: {
      classic: {
        version: 1,
        mode: 'classic',
        bestScore: 200,
        finalLength: 15,
        finalLevel: 5,
        durationMs: 90000,
        dateKey: '2026-01-01',
        snapshots: [],
        enabled: true,
      },
      'time-attack': createEmptyGhost('time-attack'),
      zen: createEmptyGhost('zen'),
      daily: createEmptyGhost('daily'),
    },
  });
  const snapshots: GhostSnapshot[] = [
    {
      snake: [{ x: 10, y: 12 }],
      direction: { x: 1, y: 0 },
      score: 150,
      timeMs: 1000,
    },
  ];
  const newProfile = updateGhostIfNewBest(profile, 'classic', 150, 10, 3, 60000, '2026-01-02', snapshots);
  // Should return same profile (no change)
  assert.equal(newProfile, profile);
});

test('getGhostSnakeAtTime returns correct snake for given time', () => {
  const snapshots: GhostSnapshot[] = [
    { snake: [{ x: 10, y: 12 }], direction: { x: 1, y: 0 }, score: 10, timeMs: 0 },
    { snake: [{ x: 11, y: 12 }], direction: { x: 1, y: 0 }, score: 20, timeMs: 1000 },
    { snake: [{ x: 12, y: 12 }], direction: { x: 1, y: 0 }, score: 30, timeMs: 2000 },
  ];
  const ghost: GhostData = {
    version: 1,
    mode: 'classic',
    bestScore: 100,
    finalLength: 10,
    finalLevel: 3,
    durationMs: 2000,
    dateKey: '2026-01-01',
    snapshots,
    enabled: true,
  };

  // Before first snapshot
  const snake0 = getGhostSnakeAtTime(ghost, -100, 0);
  assert.deepEqual(snake0, [{ x: 10, y: 12 }]);

  // Between snapshots
  const snake1 = getGhostSnakeAtTime(ghost, 500, 0);
  assert.deepEqual(snake1, [{ x: 11, y: 12 }]);

  // After last snapshot
  const snake2 = getGhostSnakeAtTime(ghost, 3000, 0);
  assert.deepEqual(snake2, [{ x: 12, y: 12 }]);
});

test('getGhostHeadPosition returns head position at given time', () => {
  const snapshots: GhostSnapshot[] = [
    { snake: [{ x: 10, y: 12 }], direction: { x: 1, y: 0 }, score: 10, timeMs: 0 },
    { snake: [{ x: 11, y: 12 }], direction: { x: 1, y: 0 }, score: 20, timeMs: 1000 },
  ];
  const ghost: GhostData = {
    version: 1,
    mode: 'classic',
    bestScore: 100,
    finalLength: 10,
    finalLevel: 3,
    durationMs: 2000,
    dateKey: '2026-01-01',
    snapshots,
    enabled: true,
  };

  const head0 = getGhostHeadPosition(ghost, -100);
  assert.deepEqual(head0, { x: 10, y: 12 });

  const head1 = getGhostHeadPosition(ghost, 500);
  assert.deepEqual(head1, { x: 11, y: 12 });
});

test('toggleGhostEnabled toggles enabled state', () => {
  const profile = createTestProfile({
    ghosts: {
      classic: {
        version: 1,
        mode: 'classic',
        bestScore: 100,
        finalLength: 10,
        finalLevel: 3,
        durationMs: 60000,
        dateKey: '2026-01-01',
        snapshots: [
          { snake: [{ x: 10, y: 12 }], direction: { x: 1, y: 0 }, score: 10, timeMs: 0 },
        ],
        enabled: true,
      },
      'time-attack': createEmptyGhost('time-attack'),
      zen: createEmptyGhost('zen'),
      daily: createEmptyGhost('daily'),
    },
  });

  const newProfile = toggleGhostEnabled(profile, 'classic');
  assert.equal(newProfile.ghosts.classic.enabled, false);

  const newProfile2 = toggleGhostEnabled(newProfile, 'classic');
  assert.equal(newProfile2.ghosts.classic.enabled, true);
});

test('toggleGhostEnabled does nothing when no ghost exists', () => {
  const profile = createTestProfile();
  const newProfile = toggleGhostEnabled(profile, 'classic');
  assert.equal(newProfile, profile);
});

test('sanitizeGhost validates and cleans ghost data', () => {
  const raw = {
    version: 1,
    mode: 'classic',
    bestScore: 100,
    finalLength: 10,
    finalLevel: 3,
    durationMs: 60000,
    dateKey: '2026-01-01',
    snapshots: [
      {
        snake: [{ x: 10, y: 12 }],
        direction: { x: 1, y: 0 },
        score: 10,
        timeMs: 1000,
      },
      {
        snake: [{ x: 11, y: 12 }],
        direction: { x: 1, y: 0 },
        score: 20,
        timeMs: 2000,
      },
    ],
    enabled: true,
  };

  const ghost = sanitizeGhost(raw);
  assert.ok(ghost);
  assert.equal(ghost!.bestScore, 100);
  assert.equal(ghost!.snapshots.length, 2);
});

test('sanitizeGhost rejects invalid data', () => {
  assert.equal(sanitizeGhost(null), null);
  assert.equal(sanitizeGhost({}), null);
  assert.equal(sanitizeGhost({ version: 2, mode: 'classic', bestScore: 100, finalLength: 10, finalLevel: 3, durationMs: 60000, dateKey: '2026-01-01', snapshots: [], enabled: true }), null); // wrong version
  assert.equal(sanitizeGhost({ version: 1, mode: 'invalid', bestScore: 100, finalLength: 10, finalLevel: 3, durationMs: 60000, dateKey: '2026-01-01', snapshots: [], enabled: true }), null); // invalid mode
  assert.equal(sanitizeGhost({ version: 1, mode: 'classic', bestScore: 'not a number', finalLength: 10, finalLevel: 3, durationMs: 60000, dateKey: '2026-01-01', snapshots: [], enabled: true }), null);
  assert.equal(sanitizeGhost({ version: 1, mode: 'classic', bestScore: 100, finalLength: 10, finalLevel: 3, durationMs: 60000, dateKey: '2026-01-01', snapshots: 'not an array', enabled: true }), null);
  assert.equal(sanitizeGhost({ version: 1, mode: 'classic', bestScore: 100, finalLength: 10, finalLevel: 3, durationMs: 60000, dateKey: '2026-01-01', snapshots: [{ snake: 'not array' }], enabled: true }), null);
});

test('sanitizeGhosts returns empty ghosts for invalid input', () => {
  const ghosts = sanitizeGhosts(null);
  assert.ok(ghosts);
  assert.equal(ghosts.classic.bestScore, 0);
  assert.equal(ghosts['time-attack'].bestScore, 0);
  assert.equal(ghosts.zen.bestScore, 0);
  assert.equal(ghosts.daily.bestScore, 0);
});

test('sanitizeGhosts cleans each ghost individually', () => {
  const raw = {
    classic: {
      version: 1,
      mode: 'classic',
      bestScore: 100,
      finalLength: 10,
      finalLevel: 3,
      durationMs: 60000,
      dateKey: '2026-01-01',
      snapshots: [{ snake: [{ x: 10, y: 12 }], direction: { x: 1, y: 0 }, score: 10, timeMs: 1000 }],
      enabled: true,
    },
    'time-attack': { invalid: true },
    zen: null,
    daily: { version: 1, mode: 'daily', bestScore: 50, finalLength: 5, finalLevel: 2, durationMs: 30000, dateKey: '2026-01-01', snapshots: [], enabled: false },
  };

  const ghosts = sanitizeGhosts(raw);
  assert.equal(ghosts.classic.bestScore, 100);
  assert.equal(ghosts['time-attack'].bestScore, 0); // sanitized to empty
  assert.equal(ghosts.zen.bestScore, 0); // sanitized to empty
  assert.equal(ghosts.daily.bestScore, 50);
});