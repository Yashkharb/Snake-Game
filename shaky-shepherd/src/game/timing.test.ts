import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceLastMove, interpolationAlpha, isMoveDue } from './timing.ts';

const DELAY = 105;

test('a move tick is due exactly after moveDelay has elapsed', () => {
  assert.equal(isMoveDue(1000, 1000, DELAY), false);
  assert.equal(isMoveDue(1104, 1000, DELAY), false);
  assert.equal(isMoveDue(1105, 1000, DELAY), true);
  assert.equal(isMoveDue(1200, 1000, DELAY), true);
});

test('advanceLastMove lands on the next tick boundary', () => {
  assert.equal(advanceLastMove(1105, 1000, DELAY), 1105);
  assert.equal(advanceLastMove(1108, 1000, DELAY), 1105);
});

test('advanceLastMove drops slow-frame drift instead of catching up', () => {
  // 500ms stall: one move is due, but we do not spiral into a burst of moves.
  assert.equal(advanceLastMove(1500, 1000, DELAY), 1500);
});

test('render alpha is 0 immediately after a movement tick (no forward jump)', () => {
  const lastMove = 1000;
  const now = 1105;
  const nextLastMove = advanceLastMove(now, lastMove, DELAY);
  assert.equal(nextLastMove, now);
  assert.equal(interpolationAlpha(now, nextLastMove, DELAY, true), 0);
});

test('render alpha advances monotonically toward 1 between ticks', () => {
  const lastMove = 1000;
  const samples = [1000, 1010, 1050, 1100, 1105, 1200];
  let previous = 0;
  for (const now of samples) {
    const alpha = interpolationAlpha(now, lastMove, DELAY, true);
    assert.ok(alpha >= previous, `alpha must not decrease (${previous} -> ${alpha})`);
    assert.ok(alpha <= 1, `alpha must be capped at 1 (got ${alpha})`);
    previous = alpha;
  }
  assert.equal(previous, 1);
});

test('paused gameplay renders at alpha 0 and resume restarts from 0', () => {
  const lastMove = 1000;
  assert.equal(interpolationAlpha(1500, lastMove, DELAY, false), 0);

  // Resume sets lastMove = now; the first rendered frame is exactly the
  // paused position, then interpolation advances again.
  const resumeNow = 2000;
  assert.equal(interpolationAlpha(resumeNow, resumeNow, DELAY, true), 0);
  assert.equal(interpolationAlpha(resumeNow + DELAY / 2, resumeNow, DELAY, true), 0.5);
});

test('a delay change from eating still starts the next segment at alpha 0', () => {
  const oldDelay = 105;
  const now = 1000 + oldDelay;
  const nextLastMove = advanceLastMove(now, 1000, oldDelay);
  const newDelay = 99; // eating a fruit reduced the move delay
  assert.equal(interpolationAlpha(now, nextLastMove, newDelay, true), 0);
  assert.equal(interpolationAlpha(now + 33, nextLastMove, newDelay, true), 33 / 99);
  assert.equal(interpolationAlpha(now + 99, nextLastMove, newDelay, true), 1);
});

test('an idle (non-running) board never renders ahead of its tick', () => {
  assert.equal(interpolationAlpha(5000, 0, DELAY, false), 0);
  assert.equal(interpolationAlpha(5000, 0, 0, true), 0);
});