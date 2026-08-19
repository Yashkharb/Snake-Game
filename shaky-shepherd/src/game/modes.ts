/**
 * Game mode configuration model (Session 6).
 *
 * A mode is pure data: every rule, scoring value, description, and storage
 * key a mode needs lives here, so the simulation (core.ts) stays generic and
 * reusable. The runtime (game.ts) holds exactly one active mode and feeds its
 * flags into the shared engine through `step(state, options)` — mode identity
 * is never branched on inside the simulation hot path.
 */
import { DAILY_KEYS } from './storage.ts';

export type GameModeId = 'classic' | 'time-attack' | 'zen' | 'daily';

export interface GameModeRules {
  /** When true, leaving one edge of the board re-enters on the opposite edge instead of dying. */
  wrap: boolean;
  /** Fixed run duration in milliseconds, or null for an unlimited run. */
  timeLimitMs: number | null;
  /** Reserved for a future obstacle system. All shipped modes are obstacle-free. */
  hasObstacles: false;
}

export interface GameModeScoring {
  /** Points awarded per fruit eaten. */
  pointsPerFruit: number;
}

export interface GameMode {
  id: GameModeId;
  /** Player-facing name (title case). */
  name: string;
  /** Compact label for the board badge / stat rail. */
  shortName: string;
  /** One-line blurb for the mode picker. */
  tagline: string;
  /** How-to-play copy shown on the start screen and mode picker. */
  description: string;
  rules: GameModeRules;
  scoring: GameModeScoring;
  /** localStorage key for this mode's best score (mode-specific records). */
  bestKey: string;
  /** localStorage key for this mode's best snake length. */
  bestLengthKey: string;
}

export const MODE_IDS: GameModeId[] = ['classic', 'time-attack', 'zen', 'daily'];

export const DEFAULT_MODE_ID: GameModeId = 'classic';

export const GAME_MODES: Record<GameModeId, GameMode> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    shortName: 'CLASSIC',
    tagline: 'The original',
    description: "Standard Snake rules: eat fruit, grow, and don't hit the wall or your own tail.",
    rules: { wrap: false, timeLimitMs: null, hasObstacles: false },
    scoring: { pointsPerFruit: 10 },
    bestKey: 'serpent-high-score',
    bestLengthKey: 'serpent-best-length',
  },
  'time-attack': {
    id: 'time-attack',
    name: 'Time Attack',
    shortName: 'TIME ATTACK',
    tagline: 'Beat the clock',
    description:
      'Score as much as you can in 60 seconds. Same rules as Classic, but the clock is your opponent.',
    rules: { wrap: false, timeLimitMs: 60_000, hasObstacles: false },
    scoring: { pointsPerFruit: 10 },
    bestKey: 'serpent-time-attack-best',
    bestLengthKey: 'serpent-time-attack-best-length',
  },
  zen: {
    id: 'zen',
    name: 'Zen',
    shortName: 'ZEN',
    tagline: 'No walls',
    description:
      'Walls wrap around — leave one edge, appear on the other. Only your own tail can end the run.',
    rules: { wrap: true, timeLimitMs: null, hasObstacles: false },
    scoring: { pointsPerFruit: 10 },
    bestKey: 'serpent-zen-best',
    bestLengthKey: 'serpent-zen-best-length',
  },
  daily: {
    id: 'daily',
    name: 'Daily',
    shortName: 'DAILY',
    tagline: 'One puzzle a day',
    description:
      'A fixed, seeded puzzle for today. Eat fruit, grow, and don\u2019t hit the wall or your own tail.',
    rules: { wrap: false, timeLimitMs: null, hasObstacles: false },
    scoring: { pointsPerFruit: 10 },
    bestKey: DAILY_KEYS.best,
    bestLengthKey: DAILY_KEYS.bestLength,
  },
};

export function getMode(id: GameModeId): GameMode {
  return GAME_MODES[id];
}

export function isGameModeId(value: string): value is GameModeId {
  return value === 'classic' || value === 'time-attack' || value === 'zen' || value === 'daily';
}
