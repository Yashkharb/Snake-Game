/**
 * Streak reward system (Session 9).
 *
 * Provides positive rewards for consecutive Daily Challenge completions.
 * No punishment for missing days — streak simply resets naturally.
 * Rewards are gameplay-earned (XP, cosmetics) and claimed once per streak milestone.
 */
import type { PlayerProfile } from './progression.ts';
import { getCosmetic } from './cosmetics.ts';

export interface StreakReward {
  /** Day number in the streak (1, 2, 3, etc.) */
  day: number;
  /** Human-readable label for the reward */
  label: string;
  /** XP reward (0 if cosmetic only) */
  xp: number;
  /** Cosmetic ID to unlock (if any) */
  cosmeticId?: string;
  /** Whether this is a "milestone" reward (shown prominently) */
  milestone: boolean;
}

/** Streak reward schedule — positive rewards only, no punishment for missing days. */
export const STREAK_REWARDS: readonly StreakReward[] = [
  { day: 1, label: 'First Steps', xp: 50, milestone: true },
  { day: 2, label: 'Building Momentum', xp: 75, milestone: true },
  { day: 3, label: 'Three in a Row', xp: 100, cosmeticId: 'trail-glow', milestone: true },
  { day: 4, label: 'Staying Sharp', xp: 125, milestone: false },
  { day: 5, label: 'Five-Day Streak', xp: 150, cosmeticId: 'food-crystal', milestone: true },
  { day: 6, label: 'Dedication', xp: 175, milestone: false },
  { day: 7, label: 'Week Warrior', xp: 200, cosmeticId: 'snake-neon', milestone: true },
  { day: 14, label: 'Fortnight', xp: 300, cosmeticId: 'board-arcade', milestone: true },
  { day: 21, label: 'Three Weeks', xp: 400, cosmeticId: 'trail-particles', milestone: true },
  { day: 30, label: 'Monthly Master', xp: 500, cosmeticId: 'snake-cyber', milestone: true },
];

export function getStreakReward(day: number): StreakReward | undefined {
  return STREAK_REWARDS.find((r) => r.day === day);
}

export function getAllStreakRewards(): readonly StreakReward[] {
  return STREAK_REWARDS;
}

/** Check which streak rewards are newly available (not yet claimed). */
export function getUnclaimedStreakRewards(
  profile: PlayerProfile,
  currentStreak: number
): StreakReward[] {
  const claimed = new Set(profile.streakRewardsClaimed ?? []);
  return STREAK_REWARDS.filter(
    (r) => r.day <= currentStreak && !claimed.has(r.day)
  );
}

/** Claim a streak reward — adds XP and/or unlocks cosmetic. Idempotent. */
export function claimStreakReward(
  profile: PlayerProfile,
  day: number
): { profile: PlayerProfile; reward: StreakReward | null } {
  const reward = getStreakReward(day);
  if (!reward) return { profile, reward: null };

  const claimed = new Set(profile.streakRewardsClaimed ?? []);
  if (claimed.has(day)) return { profile, reward: null };

  let nextProfile = { ...profile, streakRewardsClaimed: [...claimed, day] };

  if (reward.xp > 0) {
    nextProfile = { ...nextProfile, xp: nextProfile.xp + reward.xp };
  }

  if (reward.cosmeticId) {
    const cosmetic = getCosmetic(reward.cosmeticId);
    if (cosmetic && !nextProfile.unlockedCosmetics.includes(reward.cosmeticId)) {
      nextProfile = {
        ...nextProfile,
        unlockedCosmetics: [...nextProfile.unlockedCosmetics, reward.cosmeticId],
      };
    }
  }

  return { profile: nextProfile, reward };
}

/** Claim all available streak rewards up to the current streak. */
export function claimAllAvailableStreakRewards(
  profile: PlayerProfile,
  currentStreak: number
): { profile: PlayerProfile; rewards: StreakReward[] } {
  const unclaimed = getUnclaimedStreakRewards(profile, currentStreak);
  if (unclaimed.length === 0) return { profile, rewards: [] };

  let nextProfile = profile;
  const claimedRewards: StreakReward[] = [];

  for (const reward of unclaimed) {
    const result = claimStreakReward(nextProfile, reward.day);
    nextProfile = result.profile;
    if (result.reward) claimedRewards.push(result.reward);
  }

  return { profile: nextProfile, rewards: claimedRewards };
}