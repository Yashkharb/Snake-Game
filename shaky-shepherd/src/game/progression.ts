/**
 * Persistent player progression (Session 1).
 *
 * Pure model + XP/rank rules for lifetime statistics. All functions are pure
 * (they take a profile and return a new profile) so they are unit-testable;
 * the runtime (game.ts) applies events and persists via storage.ts — this
 * module never touches localStorage directly. The achievements / missions /
 * cosmetics systems arrive in later sessions; their storage slots already
 * exist as empty string arrays on the profile.
 */
import { getMode, MODE_IDS } from './modes.ts';
import type { GameModeId } from './modes.ts';
import { readStoredNumber, readStoredProfile, writeStoredProfile } from './storage.ts';
import {
  getCosmetic,
  evaluateCosmetics,
} from './cosmetics.ts';
import { computeDailyStats } from './achievements.ts';
import { readStoredDailyHistory } from './storage.ts';
import { dailyDateKey } from './daily.ts';
import {
  getUnclaimedStreakRewards,
  claimStreakReward,
  claimAllAvailableStreakRewards,
  type StreakReward,
} from './streaks.ts';
import {
  sanitizeGhosts,
  createEmptyGhost,
  type GhostData,
  type GhostSnapshot,
  getGhost,
} from './ghost.ts';

export const PROFILE_VERSION = 1;

export interface Rank {
  id: string;
  name: string;
  minXp: number;
}

/**
 * Rank ladder, oldest snake to apex predator. Thresholds are tuned to the XP
 * rates below: roughly 2 full board clears or ~30 decent runs reach Apex.
 */
export const RANKS: readonly Rank[] = [
  { id: 'hatchling', name: 'Hatchling', minXp: 0 },
  { id: 'coil', name: 'Coil', minXp: 150 },
  { id: 'fang', name: 'Fang', minXp: 400 },
  { id: 'predator', name: 'Predator', minXp: 900 },
  { id: 'apex', name: 'Apex', minXp: 2000 },
];

export interface EquippedCosmetics {
  snake: string;
  food: string;
  trail: string;
  board: string;
}

export interface PlayerProfile {
  /** Schema version — a stored blob with a different version resets to defaults. */
  version: number;
  /** Lifetime score across every run and mode. */
  totalScore: number;
  /** Lifetime fruit eaten across every run and mode. */
  totalFruit: number;
  /** Lifetime completed runs. */
  totalRuns: number;
  /** Lifetime active play time in milliseconds (pauses excluded). */
  totalPlayTime: number;
  /** Longest snake ever reached (persisted best length). */
  longestSnake: number;
  /** Highest level ever reached. */
  highestLevel: number;
  classicBest: number;
  timeAttackBest: number;
  zenBest: number;
  dailyBest: number;
  /** Lifetime XP — gameplay-earned only (fruit, bests, levels, runs). */
  xp: number;
  /** Achievement ids granted (Session 3) — permanent, never re-triggered. */
  unlockedAchievements: string[];
  /** Lifetime near-misses survived (Session 3 skill counters). */
  closeCalls: number;
  /** Lifetime turns that immediately ate a fruit (Session 3). */
  perfectTurns: number;
  /** Lifetime full loops back to a run's starting cell (Session 3). */
  homecomings: number;
  /** Longest single-run active time in seconds (Session 3). */
  longestRunSeconds: number;
  /** Whether a full 60-fruit Daily Challenge has ever been cleared (Session 3). */
  dailyCleared: boolean;
  /** Mission ids completed (Session 2) — permanent, never re-triggered. */
  completedMissions: string[];
  /** Cosmetic ids unlocked (Session 7) — permanent. */
  unlockedCosmetics: string[];
  /** Currently equipped cosmetic ids per category (Session 7). */
  equippedCosmetics: {
    snake: string;
    food: string;
    trail: string;
    board: string;
  };
  /** Streak reward day numbers already claimed (Session 9). */
  streakRewardsClaimed: number[];
  /** Ghost replay data per mode (Session 10). */
  ghosts: Record<GameModeId, GhostData>;
}

/** XP awards. All are tied to gameplay progress — never to logins or arbitrary time. */
export const XP = {
  /** Small reward per fruit eaten. */
  fruit: 2,
  /** Participation reward for finishing a run in any mode. */
  run: 10,
  /** Meaningful reward for setting a new mode best. */
  newBest: 25,
  /** Level-up reward, scaled by the level reached (level 5 → 25 XP). */
  levelUpBase: 5,
} as const;

export function createDefaultProfile(): PlayerProfile {
  return {
    version: PROFILE_VERSION,
    totalScore: 0,
    totalFruit: 0,
    totalRuns: 0,
    totalPlayTime: 0,
    longestSnake: 0,
    highestLevel: 0,
    classicBest: 0,
    timeAttackBest: 0,
    zenBest: 0,
    dailyBest: 0,
    xp: 0,
    unlockedAchievements: [],
    closeCalls: 0,
    perfectTurns: 0,
    homecomings: 0,
    longestRunSeconds: 0,
    dailyCleared: false,
    completedMissions: [],
    unlockedCosmetics: [],
    equippedCosmetics: {
      snake: 'snake-classic',
      food: 'food-apple',
      trail: 'trail-none',
      board: 'board-midnight',
    },
    streakRewardsClaimed: [],
    ghosts: {
      classic: createEmptyGhost('classic'),
      'time-attack': createEmptyGhost('time-attack'),
      zen: createEmptyGhost('zen'),
      daily: createEmptyGhost('daily'),
    },
  };
}

export function rankForXp(xp: number): Rank {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (xp >= rank.minXp) current = rank;
  }
  return current;
}

export function rankIndexForXp(xp: number): number {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].minXp) index = i;
  }
  return index;
}

export function nextRankForXp(xp: number): Rank | null {
  return RANKS[rankIndexForXp(xp) + 1] ?? null;
}

export function xpForFruit(count: number): number {
  return count * XP.fruit;
}

export function xpForLevelUp(level: number): number {
  return Math.max(0, level) * XP.levelUpBase;
}

export function xpForRun(): number {
  return XP.run;
}

export function xpForNewBest(): number {
  return XP.newBest;
}

/** Award a completed mission: XP reward + a permanent entry in the mission log. */
export function recordMissionComplete(profile: PlayerProfile, missionId: string, rewardXp: number): PlayerProfile {
  if (profile.completedMissions.includes(missionId)) return profile;
  return {
    ...profile,
    completedMissions: [...profile.completedMissions, missionId],
    xp: profile.xp + Math.max(0, rewardXp),
  };
}

/** Award an achievement: XP reward + a permanent entry in the achievement log. Idempotent. */
export function recordAchievementUnlock(profile: PlayerProfile, achievementId: string, rewardXp: number): PlayerProfile {
  if (profile.unlockedAchievements.includes(achievementId)) return profile;
  return {
    ...profile,
    unlockedAchievements: [...profile.unlockedAchievements, achievementId],
    xp: profile.xp + Math.max(0, rewardXp),
  };
}

/** Award one eaten fruit: lifetime score/fruit counters + small XP. */
export function recordFruit(profile: PlayerProfile, points: number): PlayerProfile {
  return {
    ...profile,
    totalScore: profile.totalScore + Math.max(0, points),
    totalFruit: profile.totalFruit + 1,
    xp: profile.xp + xpForFruit(1),
  };
}

/** Award non-fruit score (e.g. close-call bonuses) without fruit/XP side effects. */
export function recordScoreBonus(profile: PlayerProfile, points: number): PlayerProfile {
  return {
    ...profile,
    totalScore: profile.totalScore + Math.max(0, points),
  };
}

/** Award a level-up: lifetime highest level + scaled XP. */
export function recordLevelUp(profile: PlayerProfile, level: number): PlayerProfile {
  return {
    ...profile,
    highestLevel: Math.max(profile.highestLevel, level),
    xp: profile.xp + xpForLevelUp(level),
  };
}

type BestField = 'classicBest' | 'timeAttackBest' | 'zenBest' | 'dailyBest';

const MODE_BEST_FIELD: Record<GameModeId, BestField> = {
  classic: 'classicBest',
  'time-attack': 'timeAttackBest',
  zen: 'zenBest',
  daily: 'dailyBest',
};

export interface RunResult {
  mode: GameModeId;
  score: number;
  /** Fruit eaten this run (already credited per-fruit via recordFruit). */
  fruit: number;
  /** Active play time in milliseconds (pauses excluded). */
  durationMs: number;
  longestSnake: number;
  level: number;
  /** True when this run set a new best in its mode. */
  isNewBest: boolean;
}

export interface RunEndResult {
  profile: PlayerProfile;
  /** XP earned by finishing the run (run + new-best bonuses; fruit already credited live). */
  earnedXp: number;
  /** The rank this run promoted the player into, or null. */
  rankUp: Rank | null;
}

/** Apply a finished run to the profile. Pure — returns the new profile. */
export function recordRunEnd(profile: PlayerProfile, run: RunResult): RunEndResult {
  const earnedXp = xpForRun() + (run.isNewBest ? xpForNewBest() : 0);
  const next: PlayerProfile = {
    ...profile,
    totalRuns: profile.totalRuns + 1,
    totalPlayTime: profile.totalPlayTime + Math.max(0, run.durationMs),
    longestSnake: Math.max(profile.longestSnake, run.longestSnake),
    highestLevel: Math.max(profile.highestLevel, run.level),
    xp: profile.xp + earnedXp,
  };
  if (run.isNewBest) {
    const field = MODE_BEST_FIELD[run.mode];
    next[field] = Math.max(next[field], run.score);
  }
  const before = rankIndexForXp(profile.xp);
  const after = rankIndexForXp(next.xp);
  return { profile: next, earnedXp, rankUp: after > before ? RANKS[after] : null };
}

export interface RankProgress {
  rank: Rank;
  index: number;
  next: Rank | null;
}

/** Rank ladder position for a given XP total (UI + tests). */
export function rankProgress(xp: number): RankProgress {
  const index = rankIndexForXp(xp);
  return { rank: RANKS[index], index, next: RANKS[index + 1] ?? null };
}

function sanitizeProfile(raw: unknown): PlayerProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.version === 'number' && p.version !== PROFILE_VERSION) return null;
  const num = (key: string): number => {
    const value = p[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const strArray = (key: string): string[] =>
    Array.isArray(p[key]) ? (p[key] as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  const equipped = (key: string): { snake: string; food: string; trail: string; board: string } => {
    const value = p[key];
    if (typeof value !== 'object' || value === null) {
      return { snake: 'snake-classic', food: 'food-apple', trail: 'trail-none', board: 'board-midnight' };
    }
    const e = value as Record<string, unknown>;
    return {
      snake: typeof e.snake === 'string' ? e.snake : 'snake-classic',
      food: typeof e.food === 'string' ? e.food : 'food-apple',
      trail: typeof e.trail === 'string' ? e.trail : 'trail-none',
      board: typeof e.board === 'string' ? e.board : 'board-midnight',
    };
  };
  return {
    version: PROFILE_VERSION,
    totalScore: num('totalScore'),
    totalFruit: num('totalFruit'),
    totalRuns: num('totalRuns'),
    totalPlayTime: num('totalPlayTime'),
    longestSnake: num('longestSnake'),
    highestLevel: num('highestLevel'),
    classicBest: num('classicBest'),
    timeAttackBest: num('timeAttackBest'),
    zenBest: num('zenBest'),
    dailyBest: num('dailyBest'),
    xp: num('xp'),
    unlockedAchievements: strArray('unlockedAchievements'),
    closeCalls: num('closeCalls'),
    perfectTurns: num('perfectTurns'),
    homecomings: num('homecomings'),
    longestRunSeconds: num('longestRunSeconds'),
    dailyCleared: p['dailyCleared'] === true,
    completedMissions: strArray('completedMissions'),
    unlockedCosmetics: strArray('unlockedCosmetics'),
    equippedCosmetics: equipped('equippedCosmetics'),
    streakRewardsClaimed: (Array.isArray(p.streakRewardsClaimed) ? (p.streakRewardsClaimed as unknown[]).map((v) => typeof v === 'number' ? v : Number(v)).filter((v): v is number => Number.isFinite(v)) : []) as number[],
    ghosts: sanitizeGhosts(p.ghosts),
  };
}

/**
 * Load the stored profile, or create a fresh one. On first load the lifetime
 * per-mode bests are seeded from the existing `serpent-*-best` records so the
 * progression system starts with the player's earned history intact.
 */
export function loadProfile(): PlayerProfile {
  const parsed = sanitizeProfile(readStoredProfile());
  if (parsed) return parsed;
  const fresh = createDefaultProfile();
  for (const id of MODE_IDS) {
    const field = MODE_BEST_FIELD[id];
    fresh[field] = Math.max(fresh[field], readStoredNumber(getMode(id).bestKey));
  }
  return fresh;
}

/** Persist the profile. Returns false when storage is unavailable. */
export function saveProfile(profile: PlayerProfile): boolean {
  return writeStoredProfile(profile);
}

/** Unlock a cosmetic by adding it to the profile. Idempotent. Pure. */
export function unlockCosmetic(profile: PlayerProfile, cosmeticId: string): PlayerProfile {
  if (profile.unlockedCosmetics.includes(cosmeticId)) return profile;
  return {
    ...profile,
    unlockedCosmetics: [...profile.unlockedCosmetics, cosmeticId],
  };
}

/** Equip a cosmetic (validates ownership and category). Pure. */
export function equipCosmetic(
  profile: PlayerProfile,
  cosmeticId: string,
): { profile: PlayerProfile; equipped: PlayerProfile['equippedCosmetics'] } {
  const cosmetic = getCosmetic(cosmeticId);
  if (!cosmetic) return { profile, equipped: profile.equippedCosmetics };
  if (!profile.unlockedCosmetics.includes(cosmeticId)) return { profile, equipped: profile.equippedCosmetics };
  return {
    profile: { ...profile, equippedCosmetics: { ...profile.equippedCosmetics, [cosmetic.category]: cosmeticId } },
    equipped: { ...profile.equippedCosmetics, [cosmetic.category]: cosmeticId },
  };
}

/** Unlock all newly-available cosmetics for the current profile. Pure. */
export function unlockAvailableCosmetics(profile: PlayerProfile): PlayerProfile {
  const daily = computeDailyStats(readStoredDailyHistory(), dailyDateKey());
  const newlyAvailable = evaluateCosmetics(profile, daily);
  if (newlyAvailable.length === 0) return profile;
  return {
    ...profile,
    unlockedCosmetics: [...profile.unlockedCosmetics, ...newlyAvailable.map((c) => c.id)],
  };
}

/** Update ghost if this run is a new best. Pure. */
export function updateGhostIfNewBest(
  profile: PlayerProfile,
  mode: GameModeId,
  score: number,
  finalLength: number,
  finalLevel: number,
  durationMs: number,
  dateKey: string,
  snapshots: GhostSnapshot[]
): PlayerProfile {
  const currentGhost = getGhost(profile, mode);
  if (score <= currentGhost.bestScore) {
    return profile;
  }
  return {
    ...profile,
    ghosts: {
      ...profile.ghosts,
      [mode]: {
        version: 1,
        mode,
        bestScore: score,
        finalLength,
        finalLevel,
        durationMs,
        dateKey,
        snapshots: snapshots.slice(-600),
        enabled: true,
      },
    },
  };
}

/** Get unclaimed streak rewards for the current streak. Pure. */
export function getUnclaimedStreakRewardsForProfile(
  profile: PlayerProfile,
  currentStreak: number
): StreakReward[] {
  return getUnclaimedStreakRewards(profile, currentStreak);
}

/** Claim a streak reward for the profile. Pure. */
export function claimStreakRewardForProfile(
  profile: PlayerProfile,
  day: number
): { profile: PlayerProfile; reward: StreakReward | null } {
  return claimStreakReward(profile, day);
}

/** Claim all available streak rewards up to current streak. Pure. */
export function claimAllAvailableStreakRewardsForProfile(
  profile: PlayerProfile,
  currentStreak: number
): { profile: PlayerProfile; rewards: StreakReward[] } {
  return claimAllAvailableStreakRewards(profile, currentStreak);
}
