/**
 * Daily Challenge (Session 7).
 *
 * A challenge is derived purely from the calendar date, so the same date
 * always produces the exact same puzzle for every player:
 *   - same seed
 *   - same starting state (snake + direction)
 *   - same 20×20 board configuration
 *   - same fixed food sequence (60 fruits, played in order)
 *   - same challenge parameters (rules, scoring)
 *
 * Definition of a "day": the player's local calendar date (00:00–23:59 in the
 * player's timezone). The seed is hashed from the YYYY-MM-DD string only, so
 * everyone on the same local date gets the same challenge and the challenge
 * flips automatically at local midnight. It is intentionally *not* UTC: a
 * player's "today" is their own local today.
 *
 * Determinism: no `Math.random` is ever used for challenge-critical
 * generation. A stable FNV-1a hash converts the date key into a 32-bit seed,
 * and a mulberry32 PRNG consumes that seed. The fixed food sequence is then
 * generated from that PRNG, so the sequence is identical for a given date no
 * matter how (or whether) a player plays.
 *
 * Fairness note: food positions are generated to never sit on the starting
 * snake, to stay out of the starting head's immediate neighborhood, and to
 * keep at least one cell between consecutive fruits. Because the sequence is
 * fixed regardless of the player's path, a fruit can still be covered by a
 * snake that happens to grow over it later — that is an accepted property of a
 * shared puzzle, and it is identical for every player on that date.
 */
import { CELLS, createInitialSnake } from './core.ts';
import type { Cell, Rng, Vec } from './core.ts';

/** How many fruits make up one daily challenge. */
export const DAILY_FOOD_COUNT = 60;

/** Fixed challenge parameters — same rules for every date, same for everyone. */
export interface DailyChallengeParams {
  wrap: boolean;
  timeLimitMs: number | null;
  pointsPerFruit: number;
}

export const DAILY_CHALLENGE_PARAMS: DailyChallengeParams = {
  wrap: false,
  timeLimitMs: null,
  pointsPerFruit: 10,
};

export interface DailyChallenge {
  /** Local calendar date in YYYY-MM-DD — the identity of the challenge. */
  dateKey: string;
  /** 32-bit seed derived from the date key (FNV-1a). */
  seed: number;
  startingSnake: Cell[];
  startDirection: Vec;
  /** Fixed, precomputed fruits in the order they appear. */
  foodSequence: Cell[];
}

/** The local calendar date key for a given instant (defaults to now). */
export function dailyDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** FNV-1a 32-bit hash — turns a date key into a stable, collision-resistant seed. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 — a small, fast, deterministic 32-bit PRNG. Returns values in
 * [0, 1). The same seed always yields the same sequence.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate the deterministic challenge for a date key. Pure — no Math.random. */
export function generateDailyChallenge(dateKey: string): DailyChallenge {
  const seed = hashString(dateKey);
  const rng = mulberry32(seed);
  const startingSnake = createInitialSnake().map((cell) => ({ ...cell }));
  return {
    dateKey,
    seed,
    startingSnake,
    startDirection: { x: 1, y: 0 },
    foodSequence: generateFoodSequence(rng, startingSnake),
  };
}

function generateFoodSequence(rng: Rng, startingSnake: Cell[]): Cell[] {
  const interior: Cell[] = [];
  for (let x = 1; x < CELLS - 1; x++) {
    for (let y = 1; y < CELLS - 1; y++) interior.push({ x, y });
  }
  const startCells = new Set(startingSnake.map((cell) => cell.x * CELLS + cell.y));
  const used = new Set<number>();
  const head = startingSnake[0];
  const sequence: Cell[] = [];

  for (let i = 0; i < DAILY_FOOD_COUNT; i++) {
    const prev = sequence[sequence.length - 1];
    // Strict pool: interior, unused, off the starting snake, out of the start
    // head's immediate neighborhood, and at least one cell away from the last fruit.
    const strict = interior.filter((cell) => {
      const key = cell.x * CELLS + cell.y;
      if (startCells.has(key) || used.has(key)) return false;
      if (Math.abs(cell.x - head.x) <= 2 && Math.abs(cell.y - head.y) <= 2) return false;
      if (prev && Math.max(Math.abs(cell.x - prev.x), Math.abs(cell.y - prev.y)) < 2) return false;
      return true;
    });
    const pool =
      strict.length > 0
        ? strict
        : interior.filter((cell) => {
            const key = cell.x * CELLS + cell.y;
            return !used.has(key) && !startCells.has(key);
          });
    if (pool.length === 0) break;
    const cell = pool[Math.floor(rng() * pool.length)];
    sequence.push(cell);
    used.add(cell.x * CELLS + cell.y);
  }
  return sequence;
}

/** "WED · AUG 19 · 2026" — display label for a challenge date key. */
export function formatDailyDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const label = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(date);
  return label.replace(', ', ' · ').toUpperCase();
}

/** Challenge share copy — always includes the date. */
export function buildDailyShareMessage(
  dateKey: string,
  score: number,
  isNewBest: boolean,
  completed: boolean,
): string {
  const challenge = `Daily Challenge ${dateKey}`;
  const body = completed
    ? `${challenge} — completed with ${score} pts`
    : `${challenge} — I scored ${score}`;
  return isNewBest
    ? `${body}, a new daily best! Can you beat me?`
    : `${body}. Can you beat me?`;
}