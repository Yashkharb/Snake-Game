/**
 * Unit tests for the weekly goals system (Session 9).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKLY_GOAL_TEMPLATES,
  getWeekKey,
  previousWeekKey,
  generateWeeklyGoals,
  applyWeeklyGoalEvent,
  applyWeeklyGoalEvents,
  loadWeeklyGoals,
  replaceCompletedWeeklyGoals,
  type WeeklyGoalEvent,
} from './weekly.ts';
import { createDefaultProfile } from './progression.ts';
import type { PlayerProfile } from './progression.ts';

function createTestProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    ...createDefaultProfile(),
    ...overrides,
  };
}

test('WEEKLY_GOAL_TEMPLATES has expected set of goals', () => {
  const ids = WEEKLY_GOAL_TEMPLATES.map((t) => t.id).sort();
  assert.deepEqual(ids, [
    'weekly-achievements-5',
    'weekly-daily-3',
    'weekly-daily-5',
    'weekly-fruit-200',
    'weekly-modes-3',
    'weekly-record',
    'weekly-score-1000',
    'weekly-score-500',
  ]);
  for (const t of WEEKLY_GOAL_TEMPLATES) {
    assert.ok(t.id);
    assert.ok(t.type);
    assert.ok(t.title);
    assert.ok(t.description);
    assert.ok(t.target > 0);
    assert.ok(t.rewardXp > 0);
  }
});

test('getWeekKey returns deterministic week key for a date', () => {
  // Monday Jan 5, 2026 (week 1 of 2026)
  const monday = new Date(2026, 0, 5);
  const key = getWeekKey(monday);
  assert.match(key, /^2026-W\d{2}$/);

  // Same week should give same key
  const wednesday = new Date(2026, 0, 7);
  assert.equal(getWeekKey(wednesday), key);

  // Next Monday should give next week
  const nextMonday = new Date(2026, 0, 12);
  assert.notEqual(getWeekKey(nextMonday), key);
});

test('previousWeekKey correctly handles year boundaries', () => {
  // First week of 2026 goes to first week of 2025
  assert.equal(previousWeekKey('2026-W01'), '2025-W01');
  // Middle of year
  assert.equal(previousWeekKey('2026-W20'), '2026-W19');
});

test('generateWeeklyGoals returns up to ACTIVE_WEEKLY_GOALS_COUNT unique goals', () => {
  const profile = createTestProfile();
  const goals = generateWeeklyGoals(profile, [], [], Math.random);
  assert.ok(goals.length > 0);
  assert.ok(goals.length <= 3);
  const ids = goals.map((g) => g.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length);
});

test('generateWeeklyGoals respects recent and active lists', () => {
  const profile = createTestProfile();
  const recent = ['weekly-daily-5'];
  const active = ['weekly-score-500'];
  const goals = generateWeeklyGoals(profile, recent, active, Math.random);
  const ids = goals.map((g) => g.id);
  assert.ok(!ids.includes('weekly-daily-5'));
  assert.ok(!ids.includes('weekly-score-500'));
});

test('applyWeeklyGoalEvent advances progress for daily-completed', () => {
  const goal = {
    id: 'weekly-daily-5',
    type: 'daily-completed',
    title: 'Daily Regular',
    description: 'Complete 5 Daily Challenges this week',
    target: 5,
    progress: 0,
    rewardXp: 100,
    completed: false,
    completedAt: null,
  };
  const event = { type: 'daily-completed' } as const;
  const result = applyWeeklyGoalEvent([goal], event, createDefaultProfile(), '2026-W01');
  assert.equal(result.active[0].progress, 1);
  assert.equal(result.completed.length, 0);
});

test('applyWeeklyGoalEvent completes goal when target reached', () => {
  const goal = {
    id: 'weekly-daily-3',
    type: 'daily-completed',
    title: 'Daily Habit',
    description: 'Complete 3 Daily Challenges this week',
    target: 3,
    progress: 2,
    rewardXp: 60,
    completed: false,
    completedAt: null,
  };
  const event = { type: 'daily-completed' } as const;
  const result = applyWeeklyGoalEvent([goal], event, createDefaultProfile(), '2026-W01');
  assert.equal(result.active[0].progress, 3);
  assert.ok(result.active[0].completed);
  assert.equal(result.completed.length, 1);
  assert.equal(result.completed[0].id, 'weekly-daily-3');
});

test('applyWeeklyGoalEvent advances progress for total-score', () => {
  const goal = {
    id: 'weekly-score-500',
    type: 'total-score',
    title: 'Score Hunter',
    description: 'Earn 500 total points across all modes this week',
    target: 500,
    progress: 200,
    rewardXp: 50,
    completed: false,
    completedAt: null,
  };
  const event: typeof import('./weekly.ts').WeeklyGoalEvent = { type: 'total-score', score: 350 };
  const result = applyWeeklyGoalEvent([goal], event, createDefaultProfile(), '2026-W01');
  assert.equal(result.active[0].progress, 350);
});

test('applyWeeklyGoalEvent advances progress for fruit-eaten', () => {
  const goal = {
    id: 'weekly-fruit-200',
    type: 'fruit-eaten',
    title: 'Fruit Feast',
    description: 'Eat 200 fruits this week',
    target: 200,
    progress: 50,
    rewardXp: 90,
    completed: false,
    completedAt: null,
  };
  // fruit-eaten event with amount
  const event1 = { type: 'fruit-eaten', fruitEaten: 10 };
  const result1 = applyWeeklyGoalEvent(
    [{ ...goal }],
    event1,
    createDefaultProfile(),
    '2026-W01'
  );
  assert.equal(result1.active[0].progress, 60);

  // fruit-eaten event with fruitEaten property
  const event2 = { type: 'fruit-eaten', fruitEaten: 5 };
  const result2 = applyWeeklyGoalEvent(
    [{ ...goal, progress: 60 }],
    event2,
    createDefaultProfile(),
    '2026-W01'
  );
  assert.equal(result2.active[0].progress, 65);
});

test('applyWeeklyGoalEvent completes personal-record when record beaten', () => {
  const goal = {
    id: 'weekly-record',
    type: 'personal-record',
    title: 'Record Breaker',
    description: 'Beat a personal best in any mode this week',
    target: 1,
    progress: 0,
    rewardXp: 100,
    completed: false,
    completedAt: null,
  };
  const event = { type: 'personal-record', recordBeaten: true } as const;
  const result = applyWeeklyGoalEvent([goal], event, createDefaultProfile(), '2026-W01');
  assert.ok(result.active[0].completed);
  assert.equal(result.completed.length, 1);
});

test('applyWeeklyGoalEvent does not advance progress for non-matching event', () => {
  const goal = {
    id: 'weekly-daily-5',
    type: 'daily-completed',
    title: 'Daily Regular',
    description: 'Complete 5 Daily Challenges this week',
    target: 5,
    progress: 0,
    rewardXp: 100,
    completed: false,
    completedAt: null,
  };
  const event = { type: 'total-score', score: 100 };
  const result = applyWeeklyGoalEvent([goal], event, createDefaultProfile(), '2026-W01');
  assert.equal(result.active[0].progress, 0);
});

test('loadWeeklyGoals creates fresh goals for new week', () => {
  const profile = createTestProfile();
  const save = loadWeeklyGoals(profile);
  assert.ok(save.active.length > 0);
  assert.ok(save.active.length <= 3);
  assert.equal(save.weekKey, getWeekKey());
  assert.deepEqual(save.completedThisWeek, []);
});

test('replaceCompletedWeeklyGoals refills completed goals', () => {
  const profile = createTestProfile();
  const save = {
    version: 1,
    weekKey: getWeekKey(),
    active: [
      { id: 'weekly-daily-3', type: 'daily-completed', title: 'Daily Habit', description: 'Complete 3 Daily Challenges this week', target: 3, progress: 3, rewardXp: 60, completed: true, completedAt: Date.now() },
      { id: 'weekly-score-500', type: 'total-score', title: 'Score Hunter', description: 'Earn 500 total points across all modes this week', target: 500, progress: 500, rewardXp: 50, completed: true, completedAt: Date.now() },
    ],
    completedThisWeek: [],
  };
  const result = replaceCompletedWeeklyGoals(save, createTestProfile());
  assert.equal(result.active.length, 3); // refilled to 3
  assert.ok(result.active.every((g) => !g.completed));
});