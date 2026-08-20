import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEventState,
  EVENT_DEFINITIONS,
  EVENT_IDS,
  eventMoveDelay,
  eventScoreMultiplier,
  eventWrapOverride,
  foodRulesDuringEvent,
  getEventRules,
  isEventId,
  resolveEvent,
  rollEvent,
} from './events.ts';
import type { EventEffects, EventRules, EventState, EventId } from './events.ts';
import { getFoodRules } from './food.ts';
import type { FoodRules } from './food.ts';
import { CELLS, createInitialState, step } from './core.ts';
import type { Cell, GameState } from './core.ts';

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const classicRules = getEventRules('classic');
const timeAttackRules = getEventRules('time-attack');
const zenRules = getEventRules('zen');
const dailyRules = getEventRules('daily');

test('daily disables events entirely (determinism preserved)', () => {
  assert.equal(dailyRules.enabled, false);
  assert.equal(dailyRules.pool.length, 0);
  const state = createEventState();
  for (const value of [0, 0.5, 0.99]) {
    const roll = rollEvent(state, dailyRules, 50000, rngSeq([value]));
    assert.equal(roll.started, null, 'daily never rolls an event');
  }
});

test('zen disables events (relaxed mode)', () => {
  assert.equal(zenRules.enabled, false);
  assert.equal(zenRules.pool.length, 0);
});

test('classic and time-attack enable all three events', () => {
  for (const rules of [classicRules, timeAttackRules]) {
    assert.equal(rules.enabled, true);
    assert.deepEqual(rules.pool, ['gold-rush', 'blood-moon', 'safe-zone']);
  }
});

test('event definitions have correct effects', () => {
  const gr = EVENT_DEFINITIONS['gold-rush'];
  assert.equal(gr.effects.foodSpecialWeightMultiplier, 3);
  assert.equal(gr.effects.goldenWeightBoost, 6);
  assert.equal(gr.effects.scoreMultiplier, 1);
  assert.equal(gr.effects.speedFactor, 1);
  assert.equal(gr.effects.wrap, false);

  const bm = EVENT_DEFINITIONS['blood-moon'];
  assert.equal(bm.effects.scoreMultiplier, 2);
  assert.equal(bm.effects.speedFactor, 1.15);
  assert.equal(bm.effects.wrap, false);

  const sz = EVENT_DEFINITIONS['safe-zone'];
  assert.equal(sz.effects.wrap, true);
  assert.equal(sz.effects.scoreMultiplier, 1);
  assert.equal(sz.effects.speedFactor, 1);
});

test('rollEvent is deterministic for a fixed rng sequence', () => {
  const state = createEventState();
  const a = rollEvent(state, classicRules, 25000, rngSeq([0, 0]));
  const b = rollEvent(state, classicRules, 25000, rngSeq([0, 0]));
  assert.equal(a.started, b.started);
  assert.equal(a.started, 'gold-rush', 'first weighted event is gold-rush');
});

test('rollEvent returns nothing before minFirstEventMs', () => {
  const state = createEventState();
  const before = rollEvent(state, classicRules, classicRules.minFirstEventMs - 1, rngSeq([0, 0]));
  assert.equal(before.started, null);
  const at = rollEvent(state, classicRules, classicRules.minFirstEventMs, rngSeq([0, 0]));
  assert.notEqual(at.started, null, 'can start at minFirstEventMs');
});

test('rollEvent respects minCooldownMs', () => {
  let state = createEventState();
  const first = rollEvent(state, classicRules, 25000, rngSeq([0.01, 0]));
  assert.notEqual(first.started, null);
  state = first.next;
  // Simulate runtime: resolveEvent before rollEvent
  state = resolveEvent(state, 25000 + classicRules.minCooldownMs - 1).state;
  const duringCooldown = rollEvent(state, classicRules, 25000 + classicRules.minCooldownMs - 1, rngSeq([0.01, 0]));
  assert.equal(duringCooldown.started, null, 'blocked during cooldown');
  state = resolveEvent(state, 25000 + classicRules.minCooldownMs).state;
  const afterCooldown = rollEvent(state, classicRules, 25000 + classicRules.minCooldownMs, rngSeq([0.01, 0]));
  assert.notEqual(afterCooldown.started, null, 'allowed after cooldown');
});

test('rollEvent respects maxEventsPerRun', () => {
  let state = createEventState();
  for (let i = 0; i < classicRules.maxEventsPerRun; i++) {
    state = resolveEvent(state, 25000 + i * 40000).state;
    const roll = rollEvent(state, classicRules, 25000 + i * 40000, rngSeq([0.01, 0]));
    assert.notEqual(roll.started, null);
    state = roll.next;
  }
  state = resolveEvent(state, 25000 + 200000).state;
  const capped = rollEvent(state, classicRules, 25000 + 200000, rngSeq([0.01, 0]));
  assert.equal(capped.started, null, 'capped at maxEventsPerRun');
});

test('only one event active at a time', () => {
  let state = createEventState();
  const first = rollEvent(state, classicRules, 25000, rngSeq([0, 0]));
  assert.notEqual(first.started, null);
  state = first.next;
  const second = rollEvent(state, classicRules, 25000, rngSeq([0, 0]));
  assert.equal(second.started, null, 'cannot start another while one is active');
});

test('resolveEvent returns active before expiry and null after', () => {
  const state: EventState = { activeEventId: 'gold-rush', eventUntil: 10000, lastEventAt: 0, triggered: 1 };
  const before = resolveEvent(state, 5000);
  assert.equal(before.active, 'gold-rush');
  const after = resolveEvent(state, 15000);
  assert.equal(after.active, null);
  assert.equal(after.state.activeEventId, null);
  assert.equal(after.state.eventUntil, 0);
});

test('resolveEvent does not mutate input state', () => {
  const state: EventState = { activeEventId: 'gold-rush', eventUntil: 10000, lastEventAt: 0, triggered: 1 };
  const before = { ...state };
  resolveEvent(state, 15000);
  assert.deepEqual(state, before);
});

test('lifecycle: start -> active -> end -> can start again after cooldown', () => {
  let state = createEventState();
  // Start first event
  const r1 = rollEvent(state, classicRules, 25000, rngSeq([0, 0]));
  assert.notEqual(r1.started, null);
  state = r1.next;
  // Resolve during event
  const during = resolveEvent(state, 25000 + 5000);
  assert.equal(during.active, 'gold-rush');
  state = during.state;
  // Resolve after event ends
  const after = resolveEvent(state, 25000 + 25000);
  assert.equal(after.active, null);
  state = after.state;
  // After cooldown, can start another
  const r2 = rollEvent(state, classicRules, 25000 + 25000 + classicRules.minCooldownMs, rngSeq([0, 0]));
  assert.notEqual(r2.started, null);
});

test('foodRulesDuringEvent boosts specialWeight and golden weight for gold rush', () => {
  const base = getFoodRules('classic');
  const goldRushEffects = EVENT_DEFINITIONS['gold-rush'].effects;
  const boosted = foodRulesDuringEvent(base, goldRushEffects);
  assert.equal(boosted.specialWeight, base.specialWeight * 3);
  assert.equal(boosted.specs.golden.weight, base.specs.golden.weight + 6);
  // Other specs unchanged
  assert.equal(boosted.specs.slow.weight, base.specs.slow.weight);
});

test('foodRulesDuringEvent returns base unchanged when no event or no food effects', () => {
  const base = getFoodRules('classic');
  assert.equal(foodRulesDuringEvent(base, null), base);
  const bm = EVENT_DEFINITIONS['blood-moon'].effects;
  const noFoodChange = foodRulesDuringEvent(base, bm);
  assert.equal(noFoodChange, base, 'blood moon has no food effects');
});

test('eventScoreMultiplier returns 2 for blood moon, 1 otherwise', () => {
  assert.equal(eventScoreMultiplier(EVENT_DEFINITIONS['blood-moon'].effects), 2);
  assert.equal(eventScoreMultiplier(EVENT_DEFINITIONS['gold-rush'].effects), 1);
  assert.equal(eventScoreMultiplier(null), 1);
});

test('eventMoveDelay divides by speedFactor and floors at minMoveDelay', () => {
  const bm = EVENT_DEFINITIONS['blood-moon'].effects;
  assert.equal(eventMoveDelay(105, bm, 50), 91, '105 / 1.15 = 91');
  assert.equal(eventMoveDelay(50, bm, 50), 50, 'floored at minMoveDelay');
  assert.equal(eventMoveDelay(105, null, 50), 105);
  assert.equal(eventMoveDelay(105, EVENT_DEFINITIONS['gold-rush'].effects, 50), 105);
});

test('eventWrapOverride forces wrap for safe zone', () => {
  const sz = EVENT_DEFINITIONS['safe-zone'].effects;
  assert.equal(eventWrapOverride(sz, false), true);
  assert.equal(eventWrapOverride(sz, true), true);
  assert.equal(eventWrapOverride(EVENT_DEFINITIONS['gold-rush'].effects, false), false);
  assert.equal(eventWrapOverride(null, false), false);
});

test('safe-zone override keeps run alive at wall via core step', () => {
  // Build a state at right edge moving right
  const state: GameState = {
    snake: [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }, { x: 16, y: 10 }],
    direction: { x: 1, y: 0 },
    turnQueue: [],
    food: { x: 5, y: 5 },
    foodType: 'normal',
    score: 0,
    status: 'running',
    runId: 1,
    deathReason: null,
  };
  const szEffects = EVENT_DEFINITIONS['safe-zone'].effects;
  const wrap = eventWrapOverride(szEffects, false);
  const { state: next, ate } = step(state, {
    wrap,
    pointsPerFruit: 10,
    placedFoodSource: () => ({ cell: { x: 5, y: 5 }, type: 'normal' }),
  });
  assert.equal(ate, false);
  assert.equal(next.status, 'running');
  assert.equal(next.snake[0].x, 0, 'wraps to left edge');
});

test('blood moon scoring: normal fruit points doubled', () => {
  const base = getFoodRules('classic');
  const bm = EVENT_DEFINITIONS['blood-moon'].effects;
  const mult = eventScoreMultiplier(bm);
  const points = 10 * mult;
  assert.equal(points, 20);
});

test('isEventId validates event ids', () => {
  assert.equal(isEventId('gold-rush'), true);
  assert.equal(isEventId('blood-moon'), true);
  assert.equal(isEventId('safe-zone'), true);
  assert.equal(isEventId('invalid'), false);
});

test('events freeze while paused (same now yields no progress)', () => {
  const state: EventState = { activeEventId: 'gold-rush', eventUntil: 45000, lastEventAt: 25000, triggered: 1 };
  // Simulate pause: now doesn't advance between resolve calls
  const a = resolveEvent(state, 35000);
  assert.equal(a.active, 'gold-rush');
  const b = resolveEvent(a.state, 35000);
  assert.equal(b.active, 'gold-rush');
  // Roll at same frozen now also doesn't re-trigger
  const roll = rollEvent(a.state, classicRules, 35000, rngSeq([0, 0]));
  assert.equal(roll.started, null);
});