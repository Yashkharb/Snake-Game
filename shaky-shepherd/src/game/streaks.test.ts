/**
 * Unit tests for the streak reward system (Session 9).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAK_REWARDS,
  getStreakReward,
  getUnclaimedStreakRewards,
  claimStreakReward,
  claimAllAvailableStreakRewards,
} from './streaks.ts';
import { createDefaultProfile } from './progression.ts';
import type { PlayerProfile } from './progression.ts';

function createTestProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    ...createDefaultProfile(),
    ...overrides,
  };
}

test('STREAK_REWARDS has the expected schedule', () => {
  const days = STREAK_REWARDS.map((r) => r.day);
  assert.deepEqual(days, [1, 2, 3, 4, 5, 6, 7, 14, 21, 30]);
  for (const r of STREAK_REWARDS) {
    assert.ok(r.day > 0);
    assert.ok(r.label);
    assert.ok(r.xp >= 0);
    assert.ok(typeof r.milestone === 'boolean');
  }
});

test('getStreakReward returns correct reward for valid day', () => {
  const r1 = getStreakReward(1);
  assert.ok(r1);
  assert.equal(r1!.day, 1);
  assert.equal(r1!.xp, 50);
  assert.equal(r1!.label, 'First Steps');

  const r7 = getStreakReward(7);
  assert.ok(r7);
  assert.equal(r7!.day, 7);
  assert.equal(r7!.cosmeticId, 'snake-neon');
});

test('getStreakReward returns undefined for invalid day', () => {
  assert.equal(getStreakReward(0), undefined);
  assert.equal(getStreakReward(99), undefined);
});

test('getUnclaimedStreakRewards returns rewards up to current streak', () => {
  const profile = createTestProfile({ streakRewardsClaimed: [1, 3] });
  const unclaimed = getUnclaimedStreakRewards(profile, 5);
  const days = unclaimed.map((r) => r.day);
  assert.deepEqual(days, [2, 4, 5]);
});

test('getUnclaimedStreakRewards returns empty when all claimed', () => {
  const profile = createTestProfile({ streakRewardsClaimed: [1, 2, 3, 4, 5] });
  const unclaimed = getUnclaimedStreakRewards(profile, 5);
  assert.equal(unclaimed.length, 0);
});

test('getUnclaimedStreakRewards returns empty when streak is 0', () => {
  const profile = createTestProfile();
  const unclaimed = getUnclaimedStreakRewards(profile, 0);
  assert.equal(unclaimed.length, 0);
});

test('claimStreakReward adds XP and cosmetic, marks as claimed', () => {
  const profile = createTestProfile();
  const result = claimStreakReward(profile, 1);
  assert.ok(result.reward);
  assert.equal(result.reward!.day, 1);
  assert.equal(result.profile.xp, 50);
  assert.equal(result.profile.streakRewardsClaimed.length, 1);
  assert.ok(result.profile.streakRewardsClaimed.includes(1));
});

test('claimStreakReward unlocks cosmetic', () => {
  const profile = createTestProfile();
  const result = claimStreakReward(profile, 3);
  assert.ok(result.reward);
  assert.equal(result.reward!.cosmeticId, 'trail-glow');
  assert.ok(result.profile.unlockedCosmetics.includes('trail-glow'));
});

test('claimStreakReward is idempotent', () => {
  const profile = createTestProfile({ streakRewardsClaimed: [1] });
  const result = claimStreakReward(profile, 1);
  assert.equal(result.reward, null);
  assert.equal(result.profile, profile);
});

test('claimStreakReward returns null for invalid day', () => {
  const profile = createTestProfile();
  const result = claimStreakReward(profile, 99);
  assert.equal(result.reward, null);
  assert.equal(result.profile, profile);
});

test('claimAllAvailableStreakRewards claims multiple rewards', () => {
  const profile = createTestProfile();
  const result = claimAllAvailableStreakRewards(profile, 3);
  assert.equal(result.rewards.length, 3);
  const totalXp = result.rewards.reduce((sum, r) => sum + r.xp, 0);
  assert.equal(result.profile.xp, totalXp);
  assert.deepEqual(result.profile.streakRewardsClaimed.sort(), [1, 2, 3]);
  assert.ok(result.profile.unlockedCosmetics.includes('trail-glow'));
});

test('claimAllAvailableStreakRewards is idempotent', () => {
  const profile = createTestProfile();
  const r1 = claimAllAvailableStreakRewards(profile, 3);
  const r2 = claimAllAvailableStreakRewards(r1.profile, 3);
  assert.equal(r2.rewards.length, 0);
  assert.equal(r2.profile, r1.profile);
});

test('STREAK_REWARDS milestone rewards are at expected days', () => {
  const milestones = STREAK_REWARDS.filter((r) => r.milestone).map((r) => r.day);
  assert.deepEqual(milestones, [1, 2, 3, 5, 7, 14, 21, 30]);
});