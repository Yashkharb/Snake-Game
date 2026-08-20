import type { FoodType, PlacedFood } from './food.ts';

export interface Cell {
  x: number;
  y: number;
}

export interface Vec {
  x: number;
  y: number;
}

export type GameStatus = 'idle' | 'running' | 'paused' | 'gameover' | 'cleared';

export type DeathReason = 'wall' | 'self' | 'time' | null;

export interface GameState {
  snake: Cell[];
  direction: Vec;
  turnQueue: Vec[];
  food: Cell | null;
  /** The type of the fruit currently on the board (Session 5 special food). */
  foodType: FoodType;
  score: number;
  status: GameStatus;
  runId: number;
  deathReason: DeathReason;
}

export type Rng = () => number;

export const CELLS = 20;
export const MAX_TURN_QUEUE = 2;
export const MAX_LEVEL = 12;
const SCORE_PER_FRUIT = 10;
const SCORE_PER_LEVEL = 40;

export function createInitialSnake(): Cell[] {
  return [
    { x: 10, y: 12 },
    { x: 9, y: 12 },
    { x: 8, y: 12 },
    { x: 7, y: 12 },
  ];
}

export function createInitialState(): GameState {
  return {
    snake: createInitialSnake(),
    direction: { x: 1, y: 0 },
    turnQueue: [],
    food: null,
    foodType: 'normal',
    score: 0,
    status: 'idle',
    runId: 0,
    deathReason: null,
  };
}

export function startRun(state: GameState, rng: Rng = Math.random, placedFood?: PlacedFood): GameState {
  const snake = createInitialSnake();
  const placed = placedFood ?? (() => {
    const cell = spawnFood(snake, rng);
    return cell ? { cell, type: 'normal' as FoodType } : null;
  })();
  return {
    snake,
    direction: { x: 1, y: 0 },
    turnQueue: [],
    food: placed?.cell ?? null,
    foodType: placed?.type ?? 'normal',
    score: 0,
    status: 'running',
    runId: state.runId + 1,
    deathReason: null,
  };
}

export function spawnFood(snake: Cell[], rng: Rng = Math.random): Cell | null {
  const openCells: Cell[] = [];
  for (let x = 1; x < CELLS - 1; x++) {
    for (let y = 1; y < CELLS - 1; y++) {
      if (!snake.some((s) => s.x === x && s.y === y)) openCells.push({ x, y });
    }
  }
  if (openCells.length === 0) return null;
  return openCells[Math.floor(rng() * openCells.length)];
}

export function getLevel(score: number): number {
  return Math.min(MAX_LEVEL, 1 + Math.floor(score / SCORE_PER_LEVEL));
}

export function getMoveDelay(score: number): number {
  return Math.max(50, 105 - (getLevel(score) - 1) * 6);
}

export function isOpposite(a: Vec, b: Vec): boolean {
  return a.x === -b.x && a.y === -b.y;
}

export function isSameDirection(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

export function queueDirection(state: GameState, next: Vec): GameState {
  if (state.status !== 'running') return state;
  const lastPlanned = state.turnQueue[state.turnQueue.length - 1] || state.direction;
  if (isSameDirection(next, lastPlanned) || isOpposite(next, lastPlanned)) return state;
  if (state.turnQueue.length >= MAX_TURN_QUEUE) return state;
  return { ...state, turnQueue: [...state.turnQueue, { ...next }] };
}

export interface StepResult {
  state: GameState;
  ate: boolean;
}

export interface StepOptions {
  rng?: Rng;
  /** When true, edges wrap around instead of killing the snake. */
  wrap?: boolean;
  /** Points awarded for eating a fruit (mode scoring). Defaults to 10. */
  pointsPerFruit?: number;
  /**
   * Custom provider for the next fruit. When set, it replaces random spawning
   * on every eat — used by the Daily Challenge to play a fixed, precomputed
   * food sequence. Returning null ends the run with the board "cleared".
   */
  foodSource?: (snake: Cell[]) => Cell | null;
  /**
   * Custom provider for the next fruit *with its special-food type* (Session 5).
   * When set it takes precedence over `foodSource` and random spawning, so the
   * runtime can roll both the cell and the type. Returning null clears the board.
   */
  placedFoodSource?: (snake: Cell[]) => PlacedFood | null;
}

export function step(state: GameState, options: StepOptions = {}): StepResult {
  if (state.status !== 'running') {
    return { state, ate: false };
  }
  const rng = options.rng ?? Math.random;
  const wrap = options.wrap ?? false;
  const pointsPerFruit = options.pointsPerFruit ?? SCORE_PER_FRUIT;
  const direction = state.turnQueue[0] ? { ...state.turnQueue[0] } : state.direction;
  const turnQueue = state.turnQueue.slice(1);
  let head: Cell = { x: state.snake[0].x + direction.x, y: state.snake[0].y + direction.y };
  let hitWall = false;
  if (wrap) {
    head = { x: (head.x + CELLS) % CELLS, y: (head.y + CELLS) % CELLS };
  } else {
    hitWall = head.x < 0 || head.x >= CELLS || head.y < 0 || head.y >= CELLS;
  }
  const willEat = state.food !== null && head.x === state.food.x && head.y === state.food.y;
  const bodyCheck = willEat ? state.snake : state.snake.slice(0, -1);
  if (hitWall || bodyCheck.some((part) => part.x === head.x && part.y === head.y)) {
    return {
      state: { ...state, direction, turnQueue, status: 'gameover', deathReason: hitWall ? 'wall' : 'self' },
      ate: false,
    };
  }
  const snake = [head, ...state.snake];
  if (willEat) {
    const score = state.score + pointsPerFruit;
    const placed = options.placedFoodSource
      ? options.placedFoodSource(snake)
      : options.foodSource
        ? (() => {
            const cell = options.foodSource!(snake);
            return cell ? { cell, type: 'normal' as FoodType } : null;
          })()
        : (() => {
            const cell = spawnFood(snake, rng);
            return cell ? { cell, type: 'normal' as FoodType } : null;
          })();
    const status: GameStatus = placed ? 'running' : 'cleared';
    return {
      state: {
        snake,
        direction,
        turnQueue,
        food: placed?.cell ?? null,
        foodType: placed?.type ?? 'normal',
        score,
        status,
        runId: state.runId,
        deathReason: null,
      },
      ate: true,
    };
  }
  snake.pop();
  return { state: { ...state, snake, direction, turnQueue }, ate: false };
}

export function togglePause(state: GameState): GameState {
  if (state.status === 'running') return { ...state, status: 'paused' };
  if (state.status === 'paused') return { ...state, status: 'running' };
  return state;
}

/** "0:47", "12:05", "1:02:03" — clamps negatives to zero. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** "1:00", "0:47" — countdown-style label, rounds up to the next whole second. */
export function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Concise, truthful share copy for a finished run. */
export function buildShareMessage(score: number, isNewBest: boolean): string {
  return isNewBest
    ? `New high score of ${score} in Snake Game. Can you beat me?`
    : `I scored ${score} in Snake Game. Can you beat me?`;
}