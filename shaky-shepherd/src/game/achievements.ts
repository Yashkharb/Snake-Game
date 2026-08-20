/**
 * Achievement system (Session 3).
 *
 * Permanent, data-driven accomplishments that reward mastery, mode variety
 * and unusual-but-fair feats. Every achievement is a pure definition
 * (`AchievementDefinition`) whose unlock is a declarative `AchievementCondition`
 * evaluated against the Session 1 player profile plus Daily statistics — so the
 * whole engine is unit-testable and the runtime (game.ts) only applies events
 * and persists through progression/storage. This module never touches
 * localStorage directly.
 *
 * Skill-feel detectors (`isCloseCall`, `isPerfectTurn`, `isHomecoming`) are
 * pure GameState predicates used by the runtime to count mastery moments that
 * the profile cannot derive on its own.
 *
 * Balance notes (grounded in core.ts): 10 pts/fruit, one level every 40 pts,
 * MAX_LEVEL 12, speed caps at Level 11 (getMoveDelay floors at 50 ms), 20×20
 * board (~3,900 pts to clear), 60s Time Attack, 60-fruit Daily Challenge.
 * Every target here is deliberately achievable by a skilled player — nothing
 * is a vanity number.
 */
import { CELLS } from './core.ts';
import type { Cell, GameState } from './core.ts';
import type { GameModeId } from './modes.ts';
import type { PlayerProfile } from './progression.ts';
import { computeDailyStreak } from './storage.ts';
import type { DailyStatus } from './storage.ts';

export type AchievementCategory = 'beginner' | 'skill' | 'mode' | 'extreme' | 'secret';

/** Rarity/difficulty tier — shown as a tag on the achievements page. */
export type AchievementTier = 'beginner' | 'intermediate' | 'advanced' | 'master';

export type AchievementConditionKind =
  | 'fruit-total'
  | 'length-best'
  | 'level-best'
  | 'mode-best'
  | 'close-calls'
  | 'perfect-turns'
  | 'homecomings'
  | 'daily-completed'
  | 'daily-streak'
  | 'daily-cleared'
  | 'survival-seconds';

export interface AchievementCondition {
  /** Which profile/daily fact the achievement watches. */
  kind: AchievementConditionKind;
  /** Threshold for numeric conditions. */
  value?: number;
  /** Mode for `mode-best` conditions only. */
  mode?: GameModeId;
}

/** Immutable definition of one permanent achievement. */
export interface AchievementDefinition {
  id: string;
  title: string;
  /** Condition text shown on the page (masked for locked hidden achievements). */
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** Hidden achievements show "???" until unlocked. */
  hidden: boolean;
  /** XP granted on first unlock (through the profile). */
  rewardXp: number;
  condition: AchievementCondition;
}

const MODE_BEST_FIELD: Record<GameModeId, 'classicBest' | 'timeAttackBest' | 'zenBest' | 'dailyBest'> = {
  classic: 'classicBest',
  'time-attack': 'timeAttackBest',
  zen: 'zenBest',
  daily: 'dailyBest',
};

/**
 * The full achievement pool. Categories mirror the session brief:
 * BEGINNER (reachable immediately), SKILL (mastery moments), MODE (score +
 * daily milestones), EXTREME (elite), SECRET (hidden until earned). Thresholds
 * are grounded in the engine values above — Level 8 = 280 pts, max speed at
 * Level 11 = 400 pts, max level 12 = 440 pts, and the Daily Challenge is
 * designed to be winnable at 60 fruits.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  // BEGINNER
  {
    id: 'first-bite',
    title: 'First Bite',
    description: 'Eat your first fruit.',
    category: 'beginner',
    tier: 'beginner',
    hidden: false,
    rewardXp: 20,
    condition: { kind: 'fruit-total', value: 1 },
  },
  {
    id: 'getting-long',
    title: 'Getting Long',
    description: 'Reach a length of 10 in one run.',
    category: 'beginner',
    tier: 'beginner',
    hidden: false,
    rewardXp: 20,
    condition: { kind: 'length-best', value: 10 },
  },
  {
    id: 'warming-up',
    title: 'Warming Up',
    description: 'Reach Level 3.',
    category: 'beginner',
    tier: 'beginner',
    hidden: false,
    rewardXp: 25,
    condition: { kind: 'level-best', value: 3 },
  },
  // SKILL
  {
    id: 'perfect-turn',
    title: 'Perfect Turn',
    description: 'Turn straight into a fruit — eat 5 fruits on the move right after turning.',
    category: 'skill',
    tier: 'intermediate',
    hidden: false,
    rewardXp: 40,
    condition: { kind: 'perfect-turns', value: 5 },
  },
  {
    id: 'close-call',
    title: 'Close Call',
    description: 'Thread the needle — sit one cell from a wall or your tail and turn away, 3 times.',
    category: 'skill',
    tier: 'advanced',
    hidden: false,
    rewardXp: 50,
    condition: { kind: 'close-calls', value: 3 },
  },
  {
    id: 'no-fear',
    title: 'No Fear',
    description: 'Reach Level 8.',
    category: 'skill',
    tier: 'advanced',
    hidden: false,
    rewardXp: 50,
    condition: { kind: 'level-best', value: 8 },
  },
  {
    id: 'speed-demon',
    title: 'Speed Demon',
    description: 'Reach maximum speed — Level 11.',
    category: 'skill',
    tier: 'advanced',
    hidden: false,
    rewardXp: 60,
    condition: { kind: 'level-best', value: 11 },
  },
  // MODE
  {
    id: 'classic-100',
    title: 'Centurion',
    description: 'Score 100 in Classic.',
    category: 'mode',
    tier: 'intermediate',
    hidden: false,
    rewardXp: 30,
    condition: { kind: 'mode-best', mode: 'classic', value: 100 },
  },
  {
    id: 'classic-300',
    title: 'Triple Century',
    description: 'Score 300 in Classic.',
    category: 'mode',
    tier: 'advanced',
    hidden: false,
    rewardXp: 45,
    condition: { kind: 'mode-best', mode: 'classic', value: 300 },
  },
  {
    id: 'classic-600',
    title: 'Board Bully',
    description: 'Score 600 in Classic.',
    category: 'mode',
    tier: 'master',
    hidden: false,
    rewardXp: 75,
    condition: { kind: 'mode-best', mode: 'classic', value: 600 },
  },
  {
    id: 'time-attack-100',
    title: 'Beat the Clock',
    description: 'Score 100 in Time Attack.',
    category: 'mode',
    tier: 'intermediate',
    hidden: false,
    rewardXp: 35,
    condition: { kind: 'mode-best', mode: 'time-attack', value: 100 },
  },
  {
    id: 'time-attack-200',
    title: 'Time Machine',
    description: 'Score 200 in Time Attack.',
    category: 'mode',
    tier: 'advanced',
    hidden: false,
    rewardXp: 55,
    condition: { kind: 'mode-best', mode: 'time-attack', value: 200 },
  },
  {
    id: 'zen-100',
    title: 'Calm Waters',
    description: 'Score 100 in Zen.',
    category: 'mode',
    tier: 'intermediate',
    hidden: false,
    rewardXp: 35,
    condition: { kind: 'mode-best', mode: 'zen', value: 100 },
  },
  {
    id: 'zen-300',
    title: 'Deep Zen',
    description: 'Score 300 in Zen.',
    category: 'mode',
    tier: 'advanced',
    hidden: false,
    rewardXp: 55,
    condition: { kind: 'mode-best', mode: 'zen', value: 300 },
  },
  {
    id: 'daily-first',
    title: 'First Daily',
    description: 'Complete today\'s Daily Challenge.',
    category: 'mode',
    tier: 'intermediate',
    hidden: false,
    rewardXp: 30,
    condition: { kind: 'daily-completed', value: 1 },
  },
  {
    id: 'daily-3',
    title: 'Three in a Row',
    description: 'Complete the Daily Challenge 3 days in a row.',
    category: 'mode',
    tier: 'advanced',
    hidden: false,
    rewardXp: 50,
    condition: { kind: 'daily-streak', value: 3 },
  },
  {
    id: 'daily-7',
    title: 'Daily Master',
    description: 'Complete the Daily Challenge 7 days in a row.',
    category: 'mode',
    tier: 'master',
    hidden: false,
    rewardXp: 80,
    condition: { kind: 'daily-streak', value: 7 },
  },
  // EXTREME
  {
    id: 'snake-god',
    title: 'Snake God',
    description: 'Reach the highest level — Level 12.',
    category: 'extreme',
    tier: 'master',
    hidden: false,
    rewardXp: 100,
    condition: { kind: 'level-best', value: 12 },
  },
  // SECRET — shown as "???" until earned.
  {
    id: 'homecoming',
    title: 'Homecoming',
    description: 'Come full circle — return your head to the cell where the run started.',
    category: 'secret',
    tier: 'intermediate',
    hidden: true,
    rewardXp: 40,
    condition: { kind: 'homecomings', value: 1 },
  },
  {
    id: 'marathon',
    title: 'Marathon',
    description: 'Survive 3 minutes in a single run.',
    category: 'secret',
    tier: 'advanced',
    hidden: true,
    rewardXp: 60,
    condition: { kind: 'survival-seconds', value: 180 },
  },
  {
    id: 'daily-solver',
    title: 'Daily Solver',
    description: 'Eat all 60 fruits of a single Daily Challenge.',
    category: 'secret',
    tier: 'master',
    hidden: true,
    rewardXp: 100,
    condition: { kind: 'daily-cleared' },
  },
];

export function getAchievement(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Daily-derived facts used by the daily conditions. Pure. */
export interface DailyStats {
  /** Lifetime completed Daily Challenges. */
  completedCount: number;
  /** Current consecutive-day streak (today counts when completed). */
  streak: number;
}

export function computeDailyStats(history: Record<string, DailyStatus>, todayKey: string): DailyStats {
  let completedCount = 0;
  for (const status of Object.values(history)) {
    if (status && status.completed) completedCount += 1;
  }
  return { completedCount, streak: computeDailyStreak(history, todayKey) };
}

function conditionSatisfied(condition: AchievementCondition, profile: PlayerProfile, daily: DailyStats): boolean {
  const value = condition.value ?? 0;
  switch (condition.kind) {
    case 'fruit-total':
      return profile.totalFruit >= value;
    case 'length-best':
      return profile.longestSnake >= value;
    case 'level-best':
      return profile.highestLevel >= value;
    case 'mode-best':
      return profile[MODE_BEST_FIELD[condition.mode ?? 'classic']] >= value;
    case 'close-calls':
      return profile.closeCalls >= value;
    case 'perfect-turns':
      return profile.perfectTurns >= value;
    case 'homecomings':
      return profile.homecomings >= value;
    case 'daily-completed':
      return daily.completedCount >= value;
    case 'daily-streak':
      return daily.streak >= value;
    case 'daily-cleared':
      return profile.dailyCleared === true;
    case 'survival-seconds':
      return profile.longestRunSeconds >= value;
  }
}

/**
 * Every achievement whose condition is satisfied and that is not yet in
 * `profile.unlockedAchievements`. Already-unlocked ids are never re-returned,
 * so a granted achievement can never re-trigger. Pure.
 */
export function evaluateAchievements(profile: PlayerProfile, daily: DailyStats): AchievementDefinition[] {
  return ACHIEVEMENTS.filter(
    (a) => !profile.unlockedAchievements.includes(a.id) && conditionSatisfied(a.condition, profile, daily),
  );
}

/**
 * Close Call — the move just executed was a turn, and before it the head sat
 * one cell from a hazard (a wall in non-wrap modes, or its own body) directly
 * in its heading. If the player had not turned, the next cell would have been
 * fatal; because the run survived (`next.status`), this near-miss counts.
 * Pure.
 */
export function isCloseCall(prev: GameState, next: GameState, wrap: boolean): boolean {
  if (next.status !== 'running' && next.status !== 'cleared') return false;
  if (prev.turnQueue.length === 0) return false;
  const head = prev.snake[0];
  const ahead = { x: head.x + prev.direction.x, y: head.y + prev.direction.y };
  if (!wrap && (ahead.x < 0 || ahead.x >= CELLS || ahead.y < 0 || ahead.y >= CELLS)) return true;
  // The tail vacates on a non-eating move, so it is never a hazard.
  const body = prev.snake.slice(0, -1);
  return body.some((part) => part.x === ahead.x && part.y === ahead.y);
}

/**
 * Perfect Turn — the move just executed a turn (turnQueue was non-empty) and
 * the snake ate: the fruit sat directly in the new direction, so the turn paid
 * off immediately. `next.snake` grew by exactly one when a fruit was eaten.
 * Pure.
 */
export function isPerfectTurn(prev: GameState, next: GameState): boolean {
  if (next.status !== 'running' && next.status !== 'cleared') return false;
  if (prev.turnQueue.length === 0) return false;
  return next.snake.length === prev.snake.length + 1;
}

/**
 * Homecoming — the head has returned to the cell the run started from,
 * completing a full loop. Only counts while the run is still alive. Pure.
 */
export function isHomecoming(next: GameState, startHead: Cell): boolean {
  if (next.status !== 'running' && next.status !== 'cleared') return false;
  const head = next.snake[0];
  return head.x === startHead.x && head.y === startHead.y;
}