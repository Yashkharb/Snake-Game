import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODE_ID,
  GAME_MODES,
  MODE_IDS,
  getMode,
  isGameModeId,
} from './modes.ts';

test('mode registry contains exactly the four supported modes', () => {
  assert.deepEqual(MODE_IDS, ['classic', 'time-attack', 'zen', 'daily']);
  assert.equal(Object.keys(GAME_MODES).length, 4);
});

test('classic mode keeps the standard, unmodified rules', () => {
  const mode = GAME_MODES.classic;
  assert.equal(mode.id, 'classic');
  assert.equal(mode.name, 'Classic');
  assert.equal(mode.rules.wrap, false);
  assert.equal(mode.rules.timeLimitMs, null);
  assert.equal(mode.rules.hasObstacles, false);
  assert.equal(mode.scoring.pointsPerFruit, 10);
  assert.equal(mode.bestKey, 'serpent-high-score');
  assert.equal(mode.bestLengthKey, 'serpent-best-length');
});

test('time attack has a fixed time limit and classic wrap behavior', () => {
  const mode = GAME_MODES['time-attack'];
  assert.equal(mode.rules.wrap, false);
  assert.equal(mode.rules.timeLimitMs, 60000);
  assert.equal(mode.scoring.pointsPerFruit, 10);
  assert.notEqual(mode.bestKey, GAME_MODES.classic.bestKey);
  assert.notEqual(mode.bestLengthKey, GAME_MODES.classic.bestLengthKey);
});

test('zen wraps at walls and has no time limit', () => {
  const mode = GAME_MODES.zen;
  assert.equal(mode.rules.wrap, true);
  assert.equal(mode.rules.timeLimitMs, null);
  assert.equal(mode.rules.hasObstacles, false);
});

test('daily is its own mode with separate storage and classic-style rules', () => {
  const mode = GAME_MODES.daily;
  assert.equal(mode.id, 'daily');
  assert.equal(mode.name, 'Daily');
  assert.equal(mode.shortName, 'DAILY');
  assert.equal(mode.rules.wrap, false);
  assert.equal(mode.rules.timeLimitMs, null);
  assert.equal(mode.rules.hasObstacles, false);
  assert.equal(mode.scoring.pointsPerFruit, 10);
  assert.equal(mode.bestKey, 'serpent-daily-best');
  assert.equal(mode.bestLengthKey, 'serpent-daily-best-length');
  assert.notEqual(mode.bestKey, GAME_MODES.classic.bestKey);
  assert.notEqual(mode.bestKey, GAME_MODES['time-attack'].bestKey);
  assert.notEqual(mode.bestKey, GAME_MODES.zen.bestKey);
});

test('getMode and isGameModeId resolve and guard ids', () => {
  assert.equal(getMode('classic').id, 'classic');
  assert.equal(getMode('time-attack').name, 'Time Attack');
  assert.equal(getMode('zen').name, 'Zen');
  assert.equal(getMode('daily').name, 'Daily');
  assert.equal(isGameModeId('classic'), true);
  assert.equal(isGameModeId('time-attack'), true);
  assert.equal(isGameModeId('zen'), true);
  assert.equal(isGameModeId('daily'), true);
  assert.equal(isGameModeId('battle-royale'), false);
  assert.equal(isGameModeId(''), false);
});

test('default mode is classic', () => {
  assert.equal(DEFAULT_MODE_ID, 'classic');
});

test('each mode carries a human description, tagline, and short name', () => {
  for (const id of MODE_IDS) {
    const mode = GAME_MODES[id];
    assert.ok(mode.description.length > 0);
    assert.ok(mode.tagline.length > 0);
    assert.ok(mode.shortName.length > 0);
    assert.equal(mode.bestKey.length > 0, true);
  }
});
