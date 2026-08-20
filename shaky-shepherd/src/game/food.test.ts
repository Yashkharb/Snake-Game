import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFoodEffect,
  createFoodEffects,
  effectiveMoveDelay,
  getFoodRules,
  pointsForFood,
  resolveEffects,
  rollFoodType,
  rollPlacedFood,
  SPECIAL_FOOD_TYPES,
} from './food.ts';
import type { FoodEffects, FoodRules } from './food.ts';
import { CELLS, createInitialSnake, createInitialState, startRun, step } from './core.ts';
import type { Cell, GameState, Vec } from './core.ts';
import { mulberry32 } from './daily.ts';

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const classic = getFoodRules('classic');
const timeAttack = getFoodRules('time-attack');
const zen = getFoodRules('zen');
const daily = getFoodRules('daily');

test('daily disables special food entirely (determinism preserved)', () => {
  assert.equal(daily.enabled, false);
  assert.equal(daily.specialWeight, 0);
  for (const value of [0, 0.5, 0.99]) {
    assert.equal(rollFoodType(rngSeq([value]), daily), 'normal', 'daily never rolls a special');
  }
});

test('competitive modes enable specials with identical weights', () => {
  for (const rules of [classic, timeAttack, zen]) {
    assert.equal(rules.enabled, true);
    assert.equal(rules.specialWeight, 0.12);
  }
  assert.equal(classic.specs.golden.weight, 2);
  assert.equal(classic.specs.slow.weight, 2);
  assert.equal(classic.specs.multiplier.weight, 2);
  assert.equal(classic.specs.cursed.weight, 1);
});

test('mode weight rules: time only in Time Attack, cursed never in zen', () => {
  assert.equal(classic.specs.time.weight, 0, 'classic has no clock to extend');
  assert.equal(timeAttack.specs.time.weight, 2, 'time attack can roll TIME');
  assert.equal(zen.specs.time.weight, 0, 'zen has no clock');
  assert.equal(zen.specs.cursed.weight, 0, 'zen never gets a pressure mechanic');
  assert.equal(classic.specs.cursed.weight, 1);
  assert.equal(timeAttack.specs.cursed.weight, 1);
});

test('rollFoodType is deterministic for a fixed rng sequence', () => {
  const a = rollFoodType(rngSeq([0, 0]), classic);
  const b = rollFoodType(rngSeq([0, 0]), classic);
  assert.equal(a, b);
  assert.equal(a, 'golden', 'a special roll landing on the first special is golden');
});

test('rollFoodType returns normal when the special roll misses', () => {
  assert.equal(rollFoodType(rngSeq([0.5]), classic), 'normal');
  assert.equal(rollFoodType(rngSeq([0.99]), classic), 'normal');
  assert.equal(rollFoodType(rngSeq([0.12]), classic), 'normal', 'boundary is exclusive');
});

test('normal fruit dominates in the long run (~12% special)', () => {
  const rng = mulberry32(42);
  let normal = 0;
  let specials = 0;
  for (let i = 0; i < 20_000; i++) {
    if (rollFoodType(rng, classic) === 'normal') normal += 1;
    else specials += 1;
  }
  const specialRate = specials / 20_000;
  assert.ok(specialRate > 0.05 && specialRate < 0.2, `special rate ${specialRate.toFixed(3)} should be rare`);
  assert.ok(normal / 20_000 > 0.8, 'normal fruit must remain dominant');
});

test('zen rolls only helpful specials, classic never rolls time, time attack can roll time', () => {
  const rollMany = (rules: FoodRules, n: number, rng: () => number): Set<string> => {
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(rollFoodType(rng, rules));
    return seen;
  };
  const zenSeen = rollMany(zen, 5000, mulberry32(7));
  assert.ok(zenSeen.has('golden'));
  assert.ok(!zenSeen.has('cursed'), 'zen must never roll cursed');
  assert.ok(!zenSeen.has('time'), 'zen must never roll time');

  const classicSeen = rollMany(classic, 5000, mulberry32(8));
  assert.ok(!classicSeen.has('time'), 'classic must never roll time');
  assert.ok(classicSeen.has('cursed'));

  const taSeen = rollMany(timeAttack, 20_000, mulberry32(9));
  assert.ok(taSeen.has('time'), 'time attack rolls time over many draws');
});

test('rollPlacedFood returns a free interior cell with a valid type', () => {
  for (let i = 0; i < 200; i++) {
    const placed = rollPlacedFood(createInitialSnake(), rngSeq([0, 0, i / 200]), classic);
    assert.ok(placed !== null);
    assert.ok(SPECIAL_FOOD_TYPES.includes(placed.type) || placed.type === 'normal');
    assert.ok(placed.cell.x >= 1 && placed.cell.x < CELLS - 1);
    assert.ok(placed.cell.y >= 1 && placed.cell.y < CELLS - 1);
    assert.ok(!createInitialSnake().some((s) => s.x === placed.cell.x && s.y === placed.cell.y));
  }
});

test('rollPlacedFood returns null when the board is full', () => {
  const full: Cell[] = [];
  for (let x = 1; x < CELLS - 1; x++) {
    for (let y = 1; y < CELLS - 1; y++) full.push({ x, y });
  }
  assert.equal(rollPlacedFood(full, rngSeq([0, 0]), classic), null);
});

function stateWithFood(type: string): GameState {
  return {
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    direction: { x: 1, y: 0 },
    turnQueue: [],
    food: { x: 6, y: 5 },
    foodType: type as GameState['foodType'],
    score: 0,
    status: 'running',
    runId: 1,
    deathReason: null,
  };
}

test('step carries the placed food type into the new state (placedFoodSource)', () => {
  const { state: next, ate } = step(stateWithFood('normal'), {
    pointsPerFruit: 30,
    placedFoodSource: () => ({ cell: { x: 10, y: 10 }, type: 'slow' }),
  });
  assert.equal(ate, true);
  assert.deepEqual(next.food, { x: 10, y: 10 });
  assert.equal(next.foodType, 'slow');
  assert.equal(next.score, 30);
});

test('placedFoodSource takes precedence over foodSource', () => {
  const { state: next } = step(stateWithFood('normal'), {
    placedFoodSource: () => ({ cell: { x: 10, y: 10 }, type: 'multiplier' }),
    foodSource: () => ({ x: 1, y: 1 }),
  });
  assert.deepEqual(next.food, { x: 10, y: 10 });
  assert.equal(next.foodType, 'multiplier');
});

test('foodSource fallback places normal food (backwards compatible)', () => {
  const { state: next } = step(stateWithFood('normal'), {
    foodSource: () => ({ x: 10, y: 10 }),
  });
  assert.deepEqual(next.food, { x: 10, y: 10 });
  assert.equal(next.foodType, 'normal');
});

test('startRun places the supplied food and type, or a normal default', () => {
  const placed = startRun(createInitialState(), () => 0.5, { cell: { x: 5, y: 5 }, type: 'cursed' });
  assert.equal(placed.foodType, 'cursed');
  assert.deepEqual(placed.food, { x: 5, y: 5 });
  const defaulted = startRun(createInitialState(), () => 0);
  assert.equal(defaulted.foodType, 'normal');
  assert.ok(defaulted.food !== null);
});

test('applyFoodEffect activates slow with a bounded window', () => {
  const r = applyFoodEffect(createFoodEffects(), 'slow', classic, 1000);
  assert.equal(r.started, 'slow');
  assert.equal(r.effects.speedKind, 'slow');
  assert.equal(r.effects.speedUntil, 1000 + classic.specs.slow.durationMs);
  assert.equal(r.effects.speedUntil, 7000, 'slow duration is 6000ms');
});

test('cursed activates the fast speed effect', () => {
  const r = applyFoodEffect(createFoodEffects(), 'cursed', classic, 1000);
  assert.equal(r.started, 'cursed');
  assert.equal(r.effects.speedKind, 'fast');
  assert.equal(r.effects.speedUntil, 1000 + classic.specs.cursed.durationMs);
  assert.equal(r.effects.speedUntil, 6000, 'cursed duration is 5000ms');
});

test('slow and cursed share one speed slot (no contradictory state)', () => {
  let e = applyFoodEffect(createFoodEffects(), 'cursed', classic, 1000);
  e = applyFoodEffect(e.effects, 'slow', classic, 2000);
  assert.equal(e.effects.speedKind, 'slow', 'slow replaces cursed');
  assert.equal(e.effects.speedUntil, 2000 + classic.specs.slow.durationMs);
  e = applyFoodEffect(e.effects, 'cursed', classic, 3000);
  assert.equal(e.effects.speedKind, 'fast', 'cursed replaces slow');
  assert.equal(e.effects.speedUntil, 3000 + classic.specs.cursed.durationMs);
});

test('multiplier activates and refreshes its window', () => {
  let e = applyFoodEffect(createFoodEffects(), 'multiplier', classic, 1000);
  const firstUntil = e.effects.multiplierUntil;
  assert.equal(firstUntil, 1000 + classic.specs.multiplier.durationMs);
  assert.equal(firstUntil, 9000, 'multiplier duration is 8000ms');
  e = applyFoodEffect(e.effects, 'multiplier', classic, 4000);
  assert.ok(e.effects.multiplierUntil > firstUntil, 'a second multiplier extends the window');
});

test('time fruit accumulates bonus time', () => {
  let e = applyFoodEffect(createFoodEffects(), 'time', timeAttack, 1000);
  assert.equal(e.started, 'time');
  assert.equal(e.effects.timeBonusMs, 5000, 'time bonus is 5s');
  e = applyFoodEffect(e.effects, 'time', timeAttack, 2000);
  assert.equal(e.effects.timeBonusMs, 10000, 'bonus time stacks');
});

test('golden and normal fruit have no lasting effect', () => {
  const golden = applyFoodEffect(createFoodEffects(), 'golden', classic, 1000);
  assert.equal(golden.started, null);
  assert.deepEqual(golden.effects, createFoodEffects());
  const normal = applyFoodEffect(createFoodEffects(), 'normal', classic, 1000);
  assert.equal(normal.started, null);
  assert.deepEqual(normal.effects, createFoodEffects());
});

test('resolveEffects prunes expired windows and reports active values', () => {
  const applied = applyFoodEffect(createFoodEffects(), 'slow', classic, 1000).effects;
  assert.equal(resolveEffects(applied, classic, 1000).activeSpeed, 'slow');
  assert.equal(resolveEffects(applied, classic, 1000 + classic.specs.slow.durationMs).activeSpeed, null);
  assert.equal(resolveEffects(applied, classic, 9999).effects.speedUntil, 0, 'expired window is zeroed');

  const mult = applyFoodEffect(createFoodEffects(), 'multiplier', classic, 1000).effects;
  assert.equal(resolveEffects(mult, classic, 1000).activeMultiplier, 2);
  assert.equal(resolveEffects(mult, classic, 9000).activeMultiplier, 1, 'multiplier ends at its window');
});

test('resolveEffects preserves accumulated time bonus', () => {
  const applied = applyFoodEffect(createFoodEffects(), 'time', timeAttack, 1000).effects;
  const resolved = resolveEffects(applied, timeAttack, 50_000);
  assert.equal(resolved.effects.timeBonusMs, 5000);
});

test('effectiveMoveDelay applies slow (delay x1.6) and clamps cursed at the speed floor', () => {
  const slowOn = applyFoodEffect(createFoodEffects(), 'slow', classic, 1000).effects;
  assert.equal(effectiveMoveDelay(slowOn, classic, 105, 1000), 168, '105 x 1.6');
  assert.equal(effectiveMoveDelay(slowOn, classic, 50, 1000), 80, '50 x 1.6');
  assert.equal(effectiveMoveDelay(createFoodEffects(), classic, 105, 1000), 105, 'no effect -> base delay');

  const cursedOn = applyFoodEffect(createFoodEffects(), 'cursed', classic, 1000).effects;
  assert.equal(effectiveMoveDelay(cursedOn, classic, 105, 1000), 75, '105 / 1.4');
  assert.equal(
    effectiveMoveDelay(cursedOn, classic, 50, 1000),
    50,
    'cursed can never outrun the engine max-speed floor',
  );
});

test('effectiveMoveDelay returns base once the effect window passes', () => {
  const slowOn = applyFoodEffect(createFoodEffects(), 'slow', classic, 1000).effects;
  assert.equal(effectiveMoveDelay(slowOn, classic, 105, 1000 + classic.specs.slow.durationMs), 105);
});

test('pointsForFood uses the type value and the active multiplier', () => {
  assert.equal(pointsForFood(createFoodEffects(), classic, 'normal', 1000), 10);
  assert.equal(pointsForFood(createFoodEffects(), classic, 'golden', 1000), 30);
  assert.equal(pointsForFood(createFoodEffects(), classic, 'cursed', 1000), 40);
  assert.equal(pointsForFood(createFoodEffects(), classic, 'time', 1000), 10);

  const multOn = applyFoodEffect(createFoodEffects(), 'multiplier', classic, 1000).effects;
  assert.equal(pointsForFood(multOn, classic, 'golden', 1000), 60, 'golden x2 while multiplier active');
  assert.equal(
    pointsForFood(multOn, classic, 'golden', 1000 + classic.specs.multiplier.durationMs),
    30,
    'multiplier reverts after its window',
  );
});

test('resolved effects are immutable inputs (resolveEffects never mutates)', () => {
  const applied = applyFoodEffect(createFoodEffects(), 'slow', classic, 1000).effects;
  const before = { ...applied };
  resolveEffects(applied, classic, 9999);
  assert.deepEqual(applied, before);
});