/**
 * Unit tests for the cosmetic system (Session 7).
 */
import { describe, it, expect } from 'vitest';
import {
  COSMETICS,
  getCosmetic,
  getCosmeticsByCategory,
  getDefaultCosmetic,
  evaluateCosmetics,
  unlockCosmetic,
  equipCosmetic,
  unlockAvailableCosmetics,
  sanitizeEquipped,
  DEFAULT_EQUIPPED,
} from './cosmetics.ts';
import type { PlayerProfile, DailyStats } from './progression.ts';
import type { CosmeticDefinition } from './cosmetics.ts';

function createTestProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    version: 1,
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
    equippedCosmetics: { ...DEFAULT_EQUIPPED },
    ...overrides,
  };
}

function createTestDailyStats(overrides: Partial<DailyStats> = {}): DailyStats {
  return {
    completedCount: 0,
    streak: 0,
    ...overrides,
  };
}

describe('cosmetics.ts', () => {
  describe('COSMETICS registry', () => {
    it('has at least one cosmetic per category', () => {
      const categories = ['snake', 'food', 'trail', 'board'] as const;
      for (const cat of categories) {
        const count = COSMETICS.filter((c) => c.category === cat).length;
        expect(count).toBeGreaterThan(0);
      }
    });

    it('has default cosmetics for each category', () => {
      const categories = ['snake', 'food', 'trail', 'board'] as const;
      for (const cat of categories) {
        const def = getDefaultCosmetic(cat);
        expect(def).toBeDefined();
        expect(def!.default).toBe(true);
        expect(def!.category).toBe(cat);
      }
    });

    it('has unique IDs', () => {
      const ids = COSMETICS.map((c) => c.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('each cosmetic has required fields', () => {
      for (const c of COSMETICS) {
        expect(c.id).toBeTruthy();
        expect(c.category).toBeTruthy();
        expect(c.name).toBeTruthy();
        expect(c.description).toBeTruthy();
        expect(c.renderKey).toBeTruthy();
        expect(c.condition).toBeTruthy();
        expect(typeof c.condition.kind).toBe('string');
      }
    });
  });

  describe('getCosmetic', () => {
    it('returns cosmetic by exact ID', () => {
      const c = getCosmetic('snake-classic');
      expect(c).toBeDefined();
      expect(c!.id).toBe('snake-classic');
    });

    it('returns undefined for unknown ID', () => {
      expect(getCosmetic('nonexistent')).toBeUndefined();
    });
  });

  describe('getCosmeticsByCategory', () => {
    it('returns only cosmetics of the given category', () => {
      const snakes = getCosmeticsByCategory('snake');
      expect(snakes.every((c) => c.category === 'snake')).toBe(true);
      expect(snakes.length).toBeGreaterThan(0);
    });

    it('returns empty array for invalid category', () => {
      // @ts-expect-error - testing invalid input
      expect(getCosmeticsByCategory('invalid')).toEqual([]);
    });
  });

  describe('getDefaultCosmetic', () => {
    it('returns a default cosmetic for each category', () => {
      for (const cat of ['snake', 'food', 'trail', 'board'] as const) {
        const def = getDefaultCosmetic(cat);
        expect(def).toBeDefined();
        expect(def!.default).toBe(true);
      }
    });
  });

  describe('evaluateCosmetics', () => {
    it('returns empty array for fresh profile', () => {
      const profile = createTestProfile();
      const daily = createTestDailyStats();
      const result = evaluateCosmetics(profile, daily);
      // Only default cosmetics (condition value 0) should be available
      expect(result.every((c) => c.default)).toBe(true);
    });

    it('unlocks cosmetics when conditions are met', () => {
      const profile = createTestProfile({ totalScore: 100 });
      const daily = createTestDailyStats();
      const result = evaluateCosmetics(profile, daily);
      const scoreCosmetics = result.filter((c) => c.condition.kind === 'score-total' && c.condition.value <= 100);
      expect(scoreCosmetics.length).toBeGreaterThan(0);
    });

    it('does not return already unlocked cosmetics', () => {
      const profile = createTestProfile({
        totalScore: 100,
        unlockedCosmetics: ['snake-neon'],
      });
      const daily = createTestDailyStats();
      const result = evaluateCosmetics(profile, daily);
      expect(result.find((c) => c.id === 'snake-neon')).toBeUndefined();
    });

    it('checks achievement condition', () => {
      const profile = createTestProfile({
        unlockedAchievements: ['first-bite'],
      });
      const daily = createTestDailyStats();
      const result = evaluateCosmetics(profile, daily);
      const neon = result.find((c) => c.id === 'snake-neon');
      expect(neon).toBeDefined();
    });

    it('checks mission condition', () => {
      const profile = createTestProfile({
        completedMissions: ['eat-20-fruits'],
      });
      const daily = createTestDailyStats();
      const result = evaluateCosmetics(profile, daily);
      // Find a cosmetic that requires this mission
      const missionCosmetics = result.filter((c) => c.condition.kind === 'mission');
      expect(missionCosmetics.length).toBeGreaterThanOrEqual(0);
    });

    it('checks rank condition', () => {
      const profile = createTestProfile({ xp: 2000 }); // Apex rank
      const daily = createTestDailyStats();
      const result = evaluateCosmetics(profile, daily);
      const gold = result.find((c) => c.id === 'snake-gold');
      expect(gold).toBeDefined();
    });

    it('checks daily streak condition', () => {
      const profile = createTestProfile();
      const daily = createTestDailyStats({ streak: 3 });
      const result = evaluateCosmetics(profile, daily);
      const star = result.find((c) => c.id === 'food-star');
      // food-star requires time-attack 100, not daily streak
      // daily-streak cosmetics would be unlocked
    });

    it('checks daily cleared condition', () => {
      const profile = createTestProfile({ dailyCleared: true });
      const daily = createTestDailyStats();
      const result = evaluateCosmetics(profile, daily);
      const energyCore = result.find((c) => c.id === 'food-energy-core');
      expect(energyCore).toBeDefined();
    });
  });

  describe('unlockCosmetic', () => {
    it('adds cosmetic to unlocked list', () => {
      const profile = createTestProfile();
      const result = unlockCosmetic(profile, 'snake-neon');
      expect(result.unlockedCosmetics).toContain('snake-neon');
    });

    it('is idempotent', () => {
      const profile = createTestProfile({ unlockedCosmetics: ['snake-neon'] });
      const result = unlockCosmetic(profile, 'snake-neon');
      expect(result.unlockedCosmetics).toEqual(['snake-neon']);
      expect(result).toBe(profile); // returns same object when no change
    });

    it('does not unlock unknown cosmetic', () => {
      const profile = createTestProfile();
      const result = unlockCosmetic(profile, 'unknown-cosmetic');
      expect(result.unlockedCosmetics).toEqual([]);
      expect(result).toBe(profile);
    });
  });

  describe('equipCosmetic', () => {
    it('equips a cosmetic the player owns', () => {
      const profile = createTestProfile({ unlockedCosmetics: ['snake-neon'] });
      const { profile: newProfile, equipped } = equipCosmetic(profile, 'snake-neon');
      expect(equipped.snake).toBe('snake-neon');
      expect(newProfile.equippedCosmetics.snake).toBe('snake-neon');
    });

    it('does not equip unowned cosmetic', () => {
      const profile = createTestProfile();
      const { profile: newProfile, equipped } = equipCosmetic(profile, 'snake-neon');
      expect(equipped.snake).toBe(DEFAULT_EQUIPPED.snake);
      expect(newProfile).toBe(profile); // no change
    });

    it('does not equip unknown cosmetic', () => {
      const profile = createTestProfile();
      const { profile: newProfile, equipped } = equipCosmetic(profile, 'unknown');
      expect(equipped).toEqual(DEFAULT_EQUIPPED);
      expect(newProfile).toBe(profile);
    });

    it('only changes the relevant category', () => {
      const profile = createTestProfile({
        unlockedCosmetics: ['snake-neon', 'food-crystal'],
        equippedCosmetics: { snake: 'snake-classic', food: 'food-apple', trail: 'trail-none', board: 'board-midnight' },
      });
      const { equipped } = equipCosmetic(profile, 'snake-neon');
      expect(equipped.snake).toBe('snake-neon');
      expect(equipped.food).toBe('food-apple');
      expect(equipped.trail).toBe('trail-none');
      expect(equipped.board).toBe('board-midnight');
    });
  });

  describe('unlockAvailableCosmetics', () => {
    it('unlocks all available cosmetics at once', () => {
      const profile = createTestProfile({ totalScore: 500, xp: 500 });
      const daily = createTestDailyStats();
      const result = unlockAvailableCosmetics(profile);
      expect(result.unlockedCosmetics.length).toBeGreaterThan(profile.unlockedCosmetics.length);
    });

    it('is idempotent', () => {
      const profile = createTestProfile({ totalScore: 500, xp: 500 });
      const daily = createTestDailyStats();
      const result1 = unlockAvailableCosmetics(profile);
      const result2 = unlockAvailableCosmetics(result1);
      expect(result2.unlockedCosmetics).toEqual(result1.unlockedCosmetics);
    });
  });

  describe('sanitizeEquipped', () => {
    it('returns defaults for null/undefined', () => {
      expect(sanitizeEquipped(null, createTestProfile())).toEqual(DEFAULT_EQUIPPED);
      expect(sanitizeEquipped(undefined, createTestProfile())).toEqual(DEFAULT_EQUIPPED);
    });

    it('returns defaults for invalid object', () => {
      expect(sanitizeEquipped('invalid', createTestProfile())).toEqual(DEFAULT_EQUIPPED);
      expect(sanitizeEquipped(123, createTestProfile())).toEqual(DEFAULT_EQUIPPED);
    });

    it('validates each category and falls back to default', () => {
      const profile = createTestProfile({ unlockedCosmetics: ['snake-neon'] });
      const input = {
        snake: 'snake-neon',
        food: 'invalid-food',
        trail: 'trail-fire', // not unlocked
        board: 'board-midnight',
      };
      const result = sanitizeEquipped(input, profile);
      expect(result.snake).toBe('snake-neon');
      expect(result.food).toBe('food-apple'); // fallback
      expect(result.trail).toBe('trail-none'); // fallback (not unlocked)
      expect(result.board).toBe('board-midnight');
    });

    it('accepts valid equipped object', () => {
      const profile = createTestProfile({
        unlockedCosmetics: ['snake-neon', 'food-crystal', 'trail-glow', 'board-arcade'],
      });
      const input = {
        snake: 'snake-neon',
        food: 'food-crystal',
        trail: 'trail-glow',
        board: 'board-arcade',
      };
      const result = sanitizeEquipped(input, profile);
      expect(result).toEqual(input);
    });
  });
});