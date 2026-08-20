/**
 * Daily Challenge (Session 7, reworked Session 8).
 *
 * An availability-safe, seeded daily run. The challenge for a day is derived
 * purely from the player's *local* calendar date: the YYYY-MM-DD key hashes
 * into a 32-bit seed, and every fruit is then chosen deterministically for
 * that date and fruit index — but only from cells the current snake does not
 * occupy. The same date always produces the same *starting* board and the same
 * fruit given the same path; players who take different paths face different
 * fruit positions. This is therefore a "seeded Daily Run", not a shared fixed
 * coordinate sequence, and it is explicitly *your local daily challenge* —
 * there is no UTC-normalized "same challenge for everyone" contract.
 *
 * Guarantees:
 *  - Never places food on the supplied snake.
 *  - Deterministic per (date key, fruit index) — no `Math.random` on the
 *    challenge-critical path.
 *  - Attainable in engine terms: because food is always on a free cell it can
 *    always be reached and eaten, so the full 60-fruit run can clear the board.
 *
 * Definition of a "day": the player's local calendar date (00:00–23:59 in the
 * player's timezone), so the challenge flips automatically at local midnight.
 */
import { CELLS, createInitialSnake } from './core.ts';
import type { Cell, Rng, Vec } from './core.ts';

/** How many fruits make up one daily challenge. */
export const DAILY_FOOD_COUNT = 60;

/** Fixed challenge parameters — same rules for every date. */
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
}

/** The local calendar date key for a given instant (defaults to now). */
export function dailyDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The local calendar date key one day before a given key (handles month/year edges). */
export function previousDayKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return dailyDateKey(new Date(year, month - 1, day - 1));
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

/**
 * Generate the deterministic challenge descriptor for a date key. Pure — no
 * Math.random. Fruit positions are *not* precomputed here: they are resolved
 * lazily and snake-aware via `dailyFoodFor`.
 */
export function generateDailyChallenge(dateKey: string): DailyChallenge {
  const seed = hashString(dateKey);
  const startingSnake = createInitialSnake().map((cell) => ({ ...cell }));
  return {
    dateKey,
    seed,
    startingSnake,
    startDirection: { x: 1, y: 0 },
  };
}

/**
 * Deterministic fruit placement for a (date, fruit index) pair, restricted to
 * cells the supplied snake does not occupy. Returns null only when no free
 * cell remains (an effectively impossible edge case on a 20×20 board).
 */
export function dailyFoodFor(dateKey: string, fruitIndex: number, snake: Cell[]): Cell | null {
  const rng = mulberry32(hashString(`${dateKey}:${fruitIndex}`));
  const open: Cell[] = [];
  for (let x = 1; x < CELLS - 1; x++) {
    for (let y = 1; y < CELLS - 1; y++) {
      if (!snake.some((s) => s.x === x && s.y === y)) open.push({ x, y });
    }
  }
  if (open.length === 0) return null;
  return open[Math.floor(rng() * open.length)];
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