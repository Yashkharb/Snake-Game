import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createComboState,
  expireCombo,
  getComboConfig,
  scoreCloseCall,
  scoreFruit,
} from './combo.ts';
import type { ComboConfig } from './combo.ts';

function config(overrides: Partial<ComboConfig> = {}): ComboConfig {
  return {
    enabled: true,
    pointsPerFruit: 10,
    comboWindowMs: 3500,
    maxComboMultiplier: 4,
    closeCallPoints: 5,
    riskWindowMs: 6000,
    maxRiskMultiplier: 3,
    ...overrides,
  };
}

test('first fruit of a run is a plain +10 with no combo', () => {
  const r = scoreFruit(createComboState(), config(), 1000);
  assert.equal(r.multiplier, 1);
  assert.equal(r.points, 10);
  assert.equal(r.bonus, 0);
  assert.equal(r.state.chain, 1);
  assert.equal(r.state.bestChain, 1);
});

test('fruit combos escalate x2, x3, x4 and cap at the maximum', () => {
  let state = createComboState();
  let r = scoreFruit(state, config(), 1000);
  assert.equal(r.multiplier, 1);
  state = r.state;
  r = scoreFruit(state, config(), 3000);
  assert.equal(r.multiplier, 2);
  assert.equal(r.points, 20);
  assert.equal(r.bonus, 10);
  state = r.state;
  r = scoreFruit(state, config(), 5000);
  assert.equal(r.multiplier, 3);
  assert.equal(r.points, 30);
  state = r.state;
  r = scoreFruit(state, config(), 7000);
  assert.equal(r.multiplier, 4);
  assert.equal(r.points, 40);
  state = r.state;
  r = scoreFruit(state, config(), 9000);
  assert.equal(r.multiplier, 4, 'chain is capped at maxComboMultiplier');
  assert.equal(r.points, 40);
});

test('a fruit eaten after the window resets the chain to 1', () => {
  const first = scoreFruit(createComboState(), config(), 1000);
  const late = scoreFruit(first.state, config(), 1000 + 3500 + 1);
  assert.equal(late.multiplier, 1);
  assert.equal(late.points, 10);
  assert.equal(late.state.chain, 1, 'chain restarts rather than continuing');
  assert.equal(late.state.bestChain, 1, 'the reset chain is not a new best');
});

test('the combo window boundary is inclusive', () => {
  const first = scoreFruit(createComboState(), config(), 1000);
  const at = scoreFruit(first.state, config(), 1000 + 3500);
  assert.equal(at.multiplier, 2, 'exactly at the window boundary still chains');
  const past = scoreFruit(first.state, config(), 1000 + 3500 + 1);
  assert.equal(past.multiplier, 1, 'one millisecond past the window resets');
});

test('expireCombo only fires when an x2+ chain times out, exactly once', () => {
  assert.equal(expireCombo(createComboState(), config(), 5000).expired, false, 'no chain to lose');
  const lone = scoreFruit(createComboState(), config(), 1000);
  assert.equal(expireCombo(lone.state, config(), 10_000).expired, false, 'a lone fruit is not a combo');

  const chained = scoreFruit(scoreFruit(createComboState(), config(), 1000).state, config(), 2000);
  assert.equal(chained.state.chain, 2);
  assert.equal(expireCombo(chained.state, config(), 2000 + 3500).expired, false, 'still inside the window');
  const timedOut = expireCombo(chained.state, config(), 2000 + 3500 + 1);
  assert.equal(timedOut.expired, true, 'chain x2+ timed out');
  assert.equal(timedOut.state.chain, 0, 'the chain resets to 0');
  assert.equal(expireCombo(timedOut.state, config(), 10_000).expired, false, 'does not re-fire after reset');
});

test('close calls award +5 and consecutive ones escalate RISK x2, x3 with a cap', () => {
  let state = createComboState();
  let c = scoreCloseCall(state, config(), 1000);
  assert.equal(c.multiplier, 1);
  assert.equal(c.points, 5);
  state = c.state;
  c = scoreCloseCall(state, config(), 4000);
  assert.equal(c.multiplier, 2);
  assert.equal(c.points, 10);
  state = c.state;
  c = scoreCloseCall(state, config(), 7000);
  assert.equal(c.multiplier, 3);
  assert.equal(c.points, 15);
  state = c.state;
  c = scoreCloseCall(state, config(), 10_000);
  assert.equal(c.multiplier, 3, 'risk streak capped at maxRiskMultiplier');
  assert.equal(c.points, 15);
});

test('a close call after the risk window resets the streak', () => {
  const first = scoreCloseCall(createComboState(), config(), 1000);
  const late = scoreCloseCall(first.state, config(), 1000 + 6000 + 1);
  assert.equal(late.multiplier, 1);
  assert.equal(late.points, 5);
  assert.equal(late.state.riskStreak, 1);
});

test('combo and risk windows are independent states', () => {
  let state = createComboState();
  state = scoreFruit(state, config(), 1000).state;
  state = scoreFruit(state, config(), 2000).state;
  state = scoreCloseCall(state, config(), 3000).state;
  state = scoreCloseCall(state, config(), 4000).state;
  assert.equal(state.chain, 2, 'fruit chain survives close calls');
  assert.equal(state.riskStreak, 2, 'risk streak survives fruit eats');
});

test('bonus accounting splits combo and risk and keeps a running total', () => {
  let state = createComboState();
  state = scoreFruit(state, config(), 1000).state;
  state = scoreFruit(state, config(), 2000).state;
  state = scoreCloseCall(state, config(), 3000).state;
  state = scoreCloseCall(state, config(), 4000).state;
  state = scoreFruit(state, config(), 5000).state;
  assert.equal(state.comboBonusPoints, 30, '10 + 20 bonus');
  assert.equal(state.riskBonusPoints, 15, '5 + 10 close-call points');
  assert.equal(state.bonusPoints, 45, 'bonusPoints is the sum of both');
  assert.equal(state.bestChain, 3);
  assert.equal(state.bestRiskStreak, 2);
});

test('disabled modes keep plain scoring and never track chains or streaks', () => {
  const off = config({ enabled: false });
  const base = createComboState();
  const f = scoreFruit(base, off, 1000);
  assert.equal(f.points, 10);
  assert.equal(f.multiplier, 1);
  assert.equal(f.bonus, 0);
  assert.equal(f.state.chain, 0, 'no chain tracking when disabled');

  const c = scoreCloseCall(base, off, 1000);
  assert.equal(c.points, 0);
  assert.equal(c.state.riskStreak, 0, 'no risk tracking when disabled');

  const artificial = { ...base, chain: 3, lastFruitAt: 0 };
  assert.equal(expireCombo(artificial, off, 10_000).expired, false, 'never expires when disabled');
});

test('scoreFruit honours a custom base score (mode scoring)', () => {
  const c25 = config({ pointsPerFruit: 25 });
  const first = scoreFruit(createComboState(), c25, 1000);
  assert.equal(first.points, 25);
  const second = scoreFruit(first.state, c25, 2000);
  assert.equal(second.points, 50);
  assert.equal(second.bonus, 25);
});

test('getComboConfig enables combo for competitive modes only', () => {
  const classic = getComboConfig('classic', 10);
  assert.equal(classic.enabled, true);
  assert.equal(classic.pointsPerFruit, 10);
  assert.ok(classic.comboWindowMs > 0, 'combo window is positive');
  assert.ok(classic.maxComboMultiplier >= 2, 'there is room to build a combo');
  assert.ok(classic.riskWindowMs >= classic.comboWindowMs, 'risk window is not tighter than combo');
  assert.ok(classic.maxRiskMultiplier >= 2, 'risk can escalate');
  assert.equal(classic.closeCallPoints, 5);

  assert.equal(getComboConfig('time-attack', 10).enabled, true);
  assert.equal(getComboConfig('zen', 10).enabled, false, 'zen stays relaxed');
  assert.equal(getComboConfig('daily', 10).enabled, false, 'daily stays deterministic');
});