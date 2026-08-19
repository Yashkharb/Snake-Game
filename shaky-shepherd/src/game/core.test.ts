import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareMessage,
  CELLS,
  createInitialSnake,
  createInitialState,
  formatCountdown,
  formatDuration,
  getLevel,
  getMoveDelay,
  queueDirection,
  spawnFood,
  startRun,
  step,
  togglePause,
} from './core.ts';
import type { Cell, GameState, Vec } from './core.ts';

function stateWith(overrides: Partial<GameState> & { snake: Cell[]; direction: Vec }): GameState {
  return {
    snake: createInitialSnake(),
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

test('wall collision ends the game', () => {
  const state = stateWith({
    snake: [
      { x: 19, y: 10 },
      { x: 18, y: 10 },
      { x: 17, y: 10 },
      { x: 16, y: 10 },
    ],
    direction: { x: 1, y: 0 },
  });
  const { state: next } = step(state);
  assert.equal(next.status, 'gameover');
});

test('wall collision in the opposite direction also ends the game', () => {
  const state = stateWith({
    snake: [
      { x: 0, y: 10 },
      { x: 1, y: 10 },
      { x: 2, y: 10 },
      { x: 3, y: 10 },
    ],
    direction: { x: -1, y: 0 },
  });
  const { state: next } = step(state);
  assert.equal(next.status, 'gameover');
});

test('moving into a body segment (not the tail) is a collision', () => {
  const snake = [
    { x: 5, y: 5 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
    { x: 3, y: 4 },
    { x: 3, y: 3 },
  ];
  const state = stateWith({ snake, direction: { x: -1, y: 0 } });
  const { state: next } = step(state);
  assert.equal(next.status, 'gameover');
});

test('moving into the cell the tail vacates is legal when not eating', () => {
  const snake = [
    { x: 5, y: 5 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 5, y: 6 },
  ];
  const state = stateWith({ snake, direction: { x: 0, y: 1 }, food: { x: 8, y: 8 } });
  const { state: next } = step(state);
  assert.equal(next.status, 'running');
  assert.deepEqual(next.snake[0], { x: 5, y: 6 });
  assert.equal(next.snake.length, snake.length);
  assert.ok(!next.snake.slice(1).some((p) => p.x === 5 && p.y === 6));
});

test('moving into the tail is a collision when eating keeps the tail in place', () => {
  const snake = [
    { x: 5, y: 5 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 5, y: 6 },
  ];
  const state = stateWith({ snake, direction: { x: 0, y: 1 }, food: { x: 5, y: 6 } });
  const { state: next } = step(state);
  assert.equal(next.status, 'gameover');
});

test('eating food grows the snake, scores points, and respawns food', () => {
  const snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
  ];
  const state = stateWith({ snake, direction: { x: 1, y: 0 }, food: { x: 6, y: 5 } });
  const { state: next, ate } = step(state, { rng: () => 0 });
  assert.equal(ate, true);
  assert.equal(next.score, 10);
  assert.equal(next.status, 'running');
  assert.equal(next.snake.length, 4);
  assert.ok(next.food !== null);
  assert.ok(!next.snake.some((p) => p.x === next.food!.x && p.y === next.food!.y));
});

test('spawnFood never picks a cell occupied by the snake', () => {
  const snake = createInitialSnake();
  for (let i = 0; i < 200; i++) {
    const food = spawnFood(snake, () => i / 200);
    assert.ok(food !== null);
    assert.ok(!snake.some((p) => p.x === food!.x && p.y === food!.y));
    assert.ok(food!.x >= 1 && food!.x < CELLS - 1);
    assert.ok(food!.y >= 1 && food!.y < CELLS - 1);
  }
});

test('spawnFood returns null when the interior is full', () => {
  const snake: Cell[] = [];
  for (let x = 1; x < CELLS - 1; x++) {
    for (let y = 1; y < CELLS - 1; y++) snake.push({ x, y });
  }
  assert.equal(spawnFood(snake), null);
});

test('eating the last fruit clears the board', () => {
  const interior: Cell[] = [];
  for (let y = 1; y < CELLS - 1; y++) {
    for (let x = 1; x < CELLS - 1; x++) interior.push({ x, y });
  }
  const food: Cell = { x: 1, y: 1 };
  const snake = interior.filter((c) => !(c.x === food.x && c.y === food.y));
  const headIndex = snake.findIndex((c) => c.x === 2 && c.y === 1);
  assert.ok(headIndex >= 0);
  const head = snake[headIndex];
  snake[headIndex] = snake[0];
  snake[0] = head;

  const state = stateWith({ snake, direction: { x: -1, y: 0 }, food, score: 3230 });
  const { state: next, ate } = step(state);
  assert.equal(ate, true);
  assert.equal(next.status, 'cleared');
  assert.equal(next.snake.length, 324);
  assert.equal(next.food, null);
});

test('rapid inputs cannot queue an illegal 180-degree turn', () => {
  let state = stateWith({ snake: createInitialSnake(), direction: { x: 1, y: 0 } });
  state = queueDirection(state, { x: 0, y: -1 });
  state = queueDirection(state, { x: -1, y: 0 });
  state = queueDirection(state, { x: 0, y: 1 });
  assert.deepEqual(state.turnQueue, [
    { x: 0, y: -1 },
    { x: -1, y: 0 },
  ]);

  let direct = stateWith({ snake: createInitialSnake(), direction: { x: 1, y: 0 } });
  direct = queueDirection(direct, { x: -1, y: 0 });
  assert.equal(direct.turnQueue.length, 0);
});

test('a 180 relative to a queued turn is rejected', () => {
  let state = stateWith({ snake: createInitialSnake(), direction: { x: 1, y: 0 } });
  state = queueDirection(state, { x: 0, y: -1 });
  state = queueDirection(state, { x: -1, y: 0 });
  const { state: moved } = step(state);
  assert.deepEqual(moved.direction, { x: 0, y: -1 });
  const after = queueDirection(moved, { x: 1, y: 0 });
  assert.deepEqual(after.turnQueue, [{ x: -1, y: 0 }]);
});

test('queued turns are consumed in deterministic FIFO order', () => {
  let state = stateWith({ snake: createInitialSnake(), direction: { x: 1, y: 0 } });
  state = queueDirection(state, { x: 0, y: -1 });
  state = queueDirection(state, { x: -1, y: 0 });
  const first = step(state);
  assert.deepEqual(first.state.direction, { x: 0, y: -1 });
  assert.deepEqual(first.state.turnQueue, [{ x: -1, y: 0 }]);
  const second = step(first.state);
  assert.deepEqual(second.state.direction, { x: -1, y: 0 });
  assert.deepEqual(second.state.turnQueue, []);
});

test('starting a new run fully resets state and bumps the run id', () => {
  const base = stateWith({ snake: createInitialSnake(), direction: { x: 1, y: 0 } });
  const run1 = startRun(base, () => 0);
  assert.equal(run1.runId, base.runId + 1);
  assert.equal(run1.status, 'running');
  assert.equal(run1.score, 0);
  assert.deepEqual(run1.snake, createInitialSnake());
  assert.deepEqual(run1.direction, { x: 1, y: 0 });
  assert.deepEqual(run1.turnQueue, []);

  const over: GameState = { ...run1, status: 'gameover', snake: [{ x: 0, y: 0 }] };
  const run2 = startRun(over, () => 0);
  assert.equal(run2.runId, run1.runId + 1);
  assert.equal(run2.status, 'running');
  assert.deepEqual(run2.snake, createInitialSnake());
  assert.equal(run2.score, 0);
  assert.deepEqual(run2.turnQueue, []);
});

test('pause freezes the simulation and resume keeps it alive', () => {
  let state = stateWith({ snake: createInitialSnake(), direction: { x: 1, y: 0 } });
  state = togglePause(state);
  assert.equal(state.status, 'paused');
  const frozen = step(state);
  assert.equal(frozen.state, state);
  assert.deepEqual(frozen.state.snake, createInitialSnake());
  state = togglePause(state);
  assert.equal(state.status, 'running');
  const moved = step(state);
  assert.notEqual(moved.state.snake[0].x, createInitialSnake()[0].x);
});

test('pause only toggles from running/paused states', () => {
  const over = stateWith({ snake: createInitialSnake(), direction: { x: 1, y: 0 } });
  const overState: GameState = { ...over, status: 'gameover' };
  assert.equal(togglePause(overState), overState);
  const idle = createInitialState();
  assert.equal(togglePause(idle), idle);
});

test('level, move delay and length stay consistent with score', () => {
  assert.equal(getLevel(0), 1);
  assert.equal(getLevel(39), 1);
  assert.equal(getLevel(40), 2);
  assert.equal(getLevel(80), 3);
  assert.equal(getLevel(99999), 12);
  assert.equal(getMoveDelay(0), 105);
  assert.equal(getMoveDelay(440), 50);
  assert.ok(getMoveDelay(0) > getMoveDelay(440));

  const state = stateWith({
    snake: createInitialSnake(),
    direction: { x: 1, y: 0 },
    food: { x: 11, y: 12 },
  });
  const { state: grown } = step(state, { rng: () => 0 });
  assert.equal(grown.score, 10);
  assert.equal(grown.snake.length, createInitialSnake().length + 1);
  assert.equal(getLevel(grown.score), 1);
  assert.equal(getMoveDelay(grown.score), 105);
});

test('wall collision records the wall death reason', () => {
  const state = stateWith({
    snake: [
      { x: 19, y: 10 },
      { x: 18, y: 10 },
      { x: 17, y: 10 },
      { x: 16, y: 10 },
    ],
    direction: { x: 1, y: 0 },
  });
  const { state: next } = step(state);
  assert.equal(next.status, 'gameover');
  assert.equal(next.deathReason, 'wall');
});

test('self collision records the self death reason', () => {
  const snake = [
    { x: 5, y: 5 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
    { x: 3, y: 4 },
    { x: 3, y: 3 },
  ];
  const state = stateWith({ snake, direction: { x: -1, y: 0 } });
  const { state: next } = step(state);
  assert.equal(next.status, 'gameover');
  assert.equal(next.deathReason, 'self');
});

test('clearing the board leaves no death reason', () => {
  const interior: Cell[] = [];
  for (let y = 1; y < CELLS - 1; y++) {
    for (let x = 1; x < CELLS - 1; x++) interior.push({ x, y });
  }
  const food: Cell = { x: 1, y: 1 };
  const snake = interior.filter((c) => !(c.x === food.x && c.y === food.y));
  const headIndex = snake.findIndex((c) => c.x === 2 && c.y === 1);
  assert.ok(headIndex >= 0);
  const head = snake[headIndex];
  snake[headIndex] = snake[0];
  snake[0] = head;
  const state = stateWith({ snake, direction: { x: -1, y: 0 }, food, score: 3230 });
  const { state: next } = step(state);
  assert.equal(next.status, 'cleared');
  assert.equal(next.deathReason, null);
});

test('starting a new run clears the previous death reason', () => {
  const over = stateWith({ snake: [{ x: 0, y: 0 }], direction: { x: 1, y: 0 }, status: 'gameover', deathReason: 'wall' });
  const restarted = startRun(over);
  assert.equal(restarted.deathReason, null);
});

test('formatDuration produces m:ss / h:mm:ss labels', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(999), '0:00');
  assert.equal(formatDuration(47000), '0:47');
  assert.equal(formatDuration(725000), '12:05');
  assert.equal(formatDuration(3723000), '1:02:03');
  assert.equal(formatDuration(-500), '0:00');
});

test('buildShareMessage stays concise and truthful', () => {
  assert.equal(buildShareMessage(120, false), 'I scored 120 in Snake Game. Can you beat me?');
  assert.equal(buildShareMessage(120, true), 'New high score of 120 in Snake Game. Can you beat me?');
});

test('zen wrap: leaving the right edge reappears on the left', () => {
  const state = stateWith({
    snake: [
      { x: 19, y: 5 },
      { x: 18, y: 5 },
      { x: 17, y: 5 },
      { x: 16, y: 5 },
    ],
    direction: { x: 1, y: 0 },
  });
  const { state: next } = step(state, { wrap: true });
  assert.equal(next.status, 'running');
  assert.deepEqual(next.snake[0], { x: 0, y: 5 });
  assert.equal(next.deathReason, null);
});

test('zen wrap: leaving the top edge reappears at the bottom', () => {
  const state = stateWith({
    snake: [
      { x: 5, y: 0 },
      { x: 5, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 0 },
    ],
    direction: { x: 0, y: -1 },
  });
  const { state: next } = step(state, { wrap: true });
  assert.equal(next.status, 'running');
  assert.deepEqual(next.snake[0], { x: 5, y: 19 });
});

test('zen wrap: the same move without wrap dies against the wall', () => {
  const state = stateWith({
    snake: [
      { x: 19, y: 5 },
      { x: 18, y: 5 },
      { x: 17, y: 5 },
      { x: 16, y: 5 },
    ],
    direction: { x: 1, y: 0 },
  });
  const { state: next } = step(state, { wrap: false });
  assert.equal(next.status, 'gameover');
  assert.equal(next.deathReason, 'wall');
});

test('zen wrap: wrapping onto a non-tail body cell is a self collision', () => {
  const snake = [
    { x: 19, y: 5 },
    { x: 18, y: 5 },
    { x: 0, y: 5 },
    { x: 1, y: 5 },
    { x: 2, y: 5 },
    { x: 3, y: 5 },
  ];
  const state = stateWith({ snake, direction: { x: 1, y: 0 } });
  const { state: next } = step(state, { wrap: true });
  assert.equal(next.status, 'gameover');
  assert.equal(next.deathReason, 'self');
});

test('zen wrap: moving into the wrapping tail cell is legal (tail vacates)', () => {
  const snake: Cell[] = [];
  for (let x = 19; x >= 0; x--) snake.push({ x, y: 10 });
  const state = stateWith({ snake, direction: { x: 1, y: 0 } });
  const { state: next } = step(state, { wrap: true });
  assert.equal(next.status, 'running');
  assert.equal(next.snake.length, 20);
  assert.deepEqual(next.snake[0], { x: 0, y: 10 });
  assert.equal(next.deathReason, null);
});

test('step scores using the mode-configured points per fruit', () => {
  const snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
  ];
  const state = stateWith({ snake, direction: { x: 1, y: 0 }, food: { x: 6, y: 5 } });
  const { state: next, ate } = step(state, { pointsPerFruit: 25 });
  assert.equal(ate, true);
  assert.equal(next.score, 25);
  assert.equal(next.snake.length, 4);
});

test('formatCountdown counts down in whole seconds, rounding up', () => {
  assert.equal(formatCountdown(60000), '1:00');
  assert.equal(formatCountdown(59999), '1:00');
  assert.equal(formatCountdown(59400), '1:00');
  assert.equal(formatCountdown(59000), '0:59');
  assert.equal(formatCountdown(1000), '0:01');
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(-500), '0:00');
  assert.equal(formatCountdown(3723000), '1:02:03');
});

test('foodSource supplies the next fruit instead of a random spawn', () => {
  const state = stateWith({
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    direction: { x: 1, y: 0 },
    food: { x: 6, y: 5 },
  });
  const { state: next, ate } = step(state, { foodSource: () => ({ x: 10, y: 10 }) });
  assert.equal(ate, true);
  assert.deepEqual(next.food, { x: 10, y: 10 });
  assert.equal(next.status, 'running');
});

test('foodSource returning null clears the board (end of a fixed sequence)', () => {
  const state = stateWith({
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    direction: { x: 1, y: 0 },
    food: { x: 6, y: 5 },
  });
  const { state: next, ate } = step(state, { foodSource: () => null });
  assert.equal(ate, true);
  assert.equal(next.status, 'cleared');
  assert.equal(next.food, null);
});

test('without foodSource the engine still spawns food from the rng', () => {
  const snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
  ];
  const state = stateWith({ snake, direction: { x: 1, y: 0 }, food: { x: 6, y: 5 } });
  const { state: a } = step(state, { rng: () => 0 });
  const { state: b } = step(state, { rng: () => 0.9 });
  assert.notDeepEqual(a.food, b.food);
});