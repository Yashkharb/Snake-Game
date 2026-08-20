/**
 * Weekly goals system (Session 9).
 *
 * Reuses the mission infrastructure for data-driven weekly objectives.
 * Weekly period is deterministic (Monday-Sunday, local calendar).
 * Progress persists across sessions, resets on week boundary.
 * Rewards integrate with existing XP/cosmetic systems.
 */
import type { Rng } from './core.ts';
import type { GameModeId } from './modes.ts';
import type { PlayerProfile } from './progression.ts';

export const WEEKLY_GOALS_VERSION = 1;
export const ACTIVE_WEEKLY_GOALS_COUNT = 3;

/** Week key format: YYYY-WW (ISO week) — but using local calendar Monday-Sunday */
export type WeekKey = string; // e.g., "2026-W33"

export type WeeklyGoalType =
  | 'daily-completed'
  | 'total-score'
  | 'modes-played'
  | 'achievements-earned'
  | 'fruit-eaten'
  | 'personal-record';

export interface WeeklyGoalTemplate {
  id: string;
  type: WeeklyGoalType;
  title: string;
  description: string;
  target: number;
  rewardXp: number;
  /** For mode-played: how many different modes */
  minModes?: number;
  /** For daily-completed: streak threshold */
  streakThreshold?: number;
}

export interface WeeklyGoalState {
  id: string;
  type: WeeklyGoalType;
  title: string;
  description: string;
  target: number;
  progress: number;
  rewardXp: number;
  completed: boolean;
  completedAt: number | null;
}

export interface WeeklyGoalsSaveData {
  version: number;
  weekKey: WeekKey;
  active: WeeklyGoalState[];
  completedThisWeek: string[]; // goal IDs completed this week
}

/** Get the local calendar week key (Monday-Sunday). */
export function getWeekKey(date: Date = new Date()): WeekKey {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday of this week
  const monday = new Date(d.setDate(diff));
  const year = monday.getFullYear();
  const week = getWeekNumber(monday);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function getWeekNumber(date: Date): number {
  // ISO week number but with Monday as start
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Get the previous week key. */
export function previousWeekKey(weekKey: WeekKey): WeekKey {
  const [yearStr, weekStr] = weekKey.split('-W');
  let year = parseInt(yearStr, 10);
  let week = parseInt(weekStr, 10);
  week -= 1;
  if (week === 0) {
    year -= 1;
    week = getWeekNumber(new Date(year, 11, 31)); // last week of previous year
  }
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Weekly goal template pool — data-driven, balanced for real gameplay. */
export const WEEKLY_GOAL_TEMPLATES: readonly WeeklyGoalTemplate[] = [
  {
    id: 'weekly-daily-5',
    type: 'daily-completed',
    title: 'Daily Regular',
    description: 'Complete {target} Daily Challenges this week',
    target: 5,
    rewardXp: 100,
  },
  {
    id: 'weekly-daily-3',
    type: 'daily-completed',
    title: 'Daily Habit',
    description: 'Complete {target} Daily Challenges this week',
    target: 3,
    rewardXp: 60,
  },
  {
    id: 'weekly-score-1000',
    type: 'total-score',
    title: 'Point Collector',
    description: 'Earn {target} total points across all modes this week',
    target: 1000,
    rewardXp: 80,
  },
  {
    id: 'weekly-score-500',
    type: 'total-score',
    title: 'Score Hunter',
    description: 'Earn {target} total points across all modes this week',
    target: 500,
    rewardXp: 50,
  },
  {
    id: 'weekly-modes-3',
    type: 'modes-played',
    title: 'Mode Explorer',
    description: 'Play {target} different game modes this week',
    target: 3,
    rewardXp: 70,
    minModes: 3,
  },
  {
    id: 'weekly-achievements-5',
    type: 'achievements-earned',
    title: 'Achievement Hunter',
    description: 'Earn {target} achievements this week',
    target: 5,
    rewardXp: 120,
  },
  {
    id: 'weekly-fruit-200',
    type: 'fruit-eaten',
    title: 'Fruit Feast',
    description: 'Eat {target} fruits this week',
    target: 200,
    rewardXp: 90,
  },
  {
    id: 'weekly-record',
    type: 'personal-record',
    title: 'Record Breaker',
    description: 'Beat a personal best in any mode this week',
    target: 1,
    rewardXp: 100,
  },
];

const RECENT_LIMIT = 12;
const GENERATION_TRIES = 10;

function renderDescription(description: string, target: number): string {
  return description.replace('{target}', String(target));
}

function goalFromTemplate(template: WeeklyGoalTemplate, target: number): WeeklyGoalState {
  return {
    id: template.id,
    type: template.type,
    title: template.title,
    description: renderDescription(template.description, target),
    target,
    progress: 0,
    rewardXp: template.rewardXp,
    completed: false,
    completedAt: null,
  };
}

function templateTarget(template: WeeklyGoalTemplate, _profile: PlayerProfile): number {
  return template.target;
}

/** Pick weekly goals weighted toward variety, avoiding recently seen. */
export function generateWeeklyGoals(
  profile: PlayerProfile,
  recent: string[],
  activeIds: string[],
  rng: Rng = Math.random,
  tries = GENERATION_TRIES
): WeeklyGoalState[] {
  if (tries <= 0) return [];

  const eligible = WEEKLY_GOAL_TEMPLATES.filter(
    (t) => !recent.includes(t.id) && !activeIds.includes(t.id),
  );
  if (eligible.length === 0) return [];

  const goals: WeeklyGoalState[] = [];
  const shuffled = [...eligible].sort(() => rng() - 0.5);

  for (const template of shuffled) {
    if (goals.length >= ACTIVE_WEEKLY_GOALS_COUNT) break;
    const target = templateTarget(template, profile);
    goals.push(goalFromTemplate(template, target));
  }

  return goals;
}

/** Weekly goal progress events — mirrors MissionEvent but for weekly scope. */
export interface WeeklyGoalEvent {
  type: WeeklyGoalType;
  amount?: number;
  score?: number;
  mode?: GameModeId;
  modesPlayed?: GameModeId[];
  achievementsEarned?: number;
  fruitEaten?: number;
  recordBeaten?: boolean;
}

/** Check if a weekly goal matches an event type. */
function typeMatches(goal: WeeklyGoalState, event: WeeklyGoalEvent): boolean {
  return goal.type === event.type;
}

/** Advance progress for a weekly goal based on an event. */
function advanceProgress(goal: WeeklyGoalState, event: WeeklyGoalEvent, _profile: PlayerProfile, _weekKey: WeekKey): number {
  switch (goal.type) {
    case 'daily-completed':
      // Count completed dailies in this week
      if (event.type === 'daily-completed') {
        return goal.progress + 1;
      }
      // Also allow checking from history at load time
      return goal.progress;

    case 'total-score':
      if (event.type === 'total-score') {
        return Math.max(goal.progress, event.score ?? 0);
      }
      return goal.progress;

    case 'modes-played':
      if (event.type === 'modes-played' && event.modesPlayed) {
        const uniqueModes = new Set(event.modesPlayed);
        return Math.max(goal.progress, uniqueModes.size);
      }
      return goal.progress;

    case 'achievements-earned':
      if (event.type === 'achievements-earned') {
        return Math.max(goal.progress, event.achievementsEarned ?? 0);
      }
      return goal.progress;

    case 'fruit-eaten':
      if (event.type === 'fruit-eaten') {
        return goal.progress + (event.fruitEaten ?? 0);
      }
      return goal.progress;

    case 'personal-record':
      if (event.type === 'personal-record' && event.recordBeaten) {
        return 1;
      }
      return goal.progress;

    default:
      return goal.progress;
  }
}

/** Apply one event to active weekly goals. Pure. */
export function applyWeeklyGoalEvent(
  active: WeeklyGoalState[],
  event: WeeklyGoalEvent,
  profile: PlayerProfile,
  weekKey: WeekKey,
  now: number = Date.now()
): { active: WeeklyGoalState[]; completed: WeeklyGoalState[] } {
  const completed: WeeklyGoalState[] = [];
  const next = active.map((goal) => {
    if (goal.completed || !typeMatches(goal, event)) return goal;
    const progress = advanceProgress(goal, event, profile, weekKey);
    if (progress <= goal.progress) return goal;
    const updated: WeeklyGoalState = { ...goal, progress };
    if (updated.progress >= goal.target) {
      completed.push({ ...updated, completed: true, completedAt: now });
      return { ...updated, completed: true, completedAt: now };
    }
    return updated;
  });
  return { active: next, completed };
}

/** Apply a batch of events (e.g., at run end). Pure. */
export function applyWeeklyGoalEvents(
  active: WeeklyGoalState[],
  events: WeeklyGoalEvent[],
  profile: PlayerProfile,
  weekKey: WeekKey,
  now: number = Date.now()
): { active: WeeklyGoalState[]; completed: WeeklyGoalState[] } {
  let current = active;
  const completed: WeeklyGoalState[] = [];
  for (const event of events) {
    const result = applyWeeklyGoalEvent(current, event, profile, weekKey, now);
    current = result.active;
    completed.push(...result.completed);
  }
  return { active: current, completed };
}

/** Load or initialize weekly goals for the current week. */
export function loadWeeklyGoals(
  profile: PlayerProfile,
  rng: Rng = Math.random
): WeeklyGoalsSaveData {
  const currentWeekKey = getWeekKey();
  const raw = readStoredWeeklyGoals();

  if (raw && raw.version === WEEKLY_GOALS_VERSION && raw.weekKey === currentWeekKey) {
    // Same week — return existing (sanitized)
    const sanitized = sanitizeWeeklyGoals(raw, profile);
    return sanitized;
  }

  // New week — generate fresh goals
  const recent = (raw && raw.weekKey !== currentWeekKey) ? raw.active.map((g) => g.id) : (raw?.active.map((g) => g.id) ?? []);
  const active = generateWeeklyGoals(profile, recent, [], rng);
  const save: WeeklyGoalsSaveData = {
    version: WEEKLY_GOALS_VERSION,
    weekKey: currentWeekKey,
    active,
    completedThisWeek: [],
  };
  writeStoredWeeklyGoals(save);
  return save;
}

/** Replace completed weekly goals with fresh ones (silent refill). */
export function replaceCompletedWeeklyGoals(
  save: WeeklyGoalsSaveData,
  profile: PlayerProfile,
  rng: Rng = Math.random
): WeeklyGoalsSaveData {
  const active = save.active.filter((g) => !g.completed);
  const justCompleted = save.active.filter((g) => g.completed).map((g) => g.id);
  const completedThisWeek = [...save.completedThisWeek, ...justCompleted];
  let recent = [...completedThisWeek, ...active.map((g) => g.id)].slice(0, RECENT_LIMIT);
  let next = active;
  while (next.length < ACTIVE_WEEKLY_GOALS_COUNT) {
    const goals = generateWeeklyGoals(profile, recent, next.map((g) => g.id), rng);
    if (goals.length === 0) break;
    next = [...next, ...goals];
    recent = [...goals.map((g) => g.id), ...recent].slice(0, RECENT_LIMIT);
  }
  return {
    version: WEEKLY_GOALS_VERSION,
    weekKey: save.weekKey,
    active: next,
    completedThisWeek,
  };
}

/** Persist weekly goals. Returns false when storage is unavailable. */
export function saveWeeklyGoals(save: WeeklyGoalsSaveData): boolean {
  return writeStoredWeeklyGoals(save);
}

/** Read stored weekly goals blob. */
function readStoredWeeklyGoals(): WeeklyGoalsSaveData | null {
  const raw = safeGetItemWeeklyGoals();
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as WeeklyGoalsSaveData;
  } catch {
    return null;
  }
}

/** Write stored weekly goals blob. */
function writeStoredWeeklyGoals(save: WeeklyGoalsSaveData): boolean {
  return safeSetItemWeeklyGoals(JSON.stringify(save));
}

/** Storage key for weekly goals. */
const WEEKLY_GOALS_KEY = 'serpent-weekly-goals';

function safeGetItemWeeklyGoals(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(WEEKLY_GOALS_KEY);
    }
  } catch {
    return null;
  }
  return null;
}

function safeSetItemWeeklyGoals(value: string): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WEEKLY_GOALS_KEY, value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function sanitizeWeeklyGoals(raw: unknown, profile: PlayerProfile): WeeklyGoalsSaveData {
  if (typeof raw !== 'object' || raw === null) return createEmptyWeeklyGoals(profile);
  const data = raw as Record<string, unknown>;
  if (data.version !== WEEKLY_GOALS_VERSION) return createEmptyWeeklyGoals(profile);

  const currentWeekKey = getWeekKey();
  if (data.weekKey !== currentWeekKey) return createEmptyWeeklyGoals(profile);

  const active = Array.isArray(data.active) ? data.active.map(sanitizeGoal).filter((g): g is WeeklyGoalState => g !== null) : [];
  const completedThisWeek = Array.isArray(data.completedThisWeek)
    ? (data.completedThisWeek as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];

  return { version: WEEKLY_GOALS_VERSION, weekKey: currentWeekKey, active, completedThisWeek };
}

function sanitizeGoal(raw: unknown): WeeklyGoalState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.id !== 'string') return null;
  const template = WEEKLY_GOAL_TEMPLATES.find((t) => t.id === g.id);
  if (!template) return null;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    id: g.id,
    type: template.type,
    title: typeof g.title === 'string' ? g.title : template.title,
    description: typeof g.description === 'string' ? g.description : renderDescription(template.description, template.target),
    target: num(g.target, template.target) || template.target,
    progress: num(g.progress, 0),
    rewardXp: num(g.rewardXp, template.rewardXp) || template.rewardXp,
    completed: Boolean(g.completed),
    completedAt: typeof g.completedAt === 'number' && Number.isFinite(g.completedAt) ? g.completedAt : null,
  };
}

function createEmptyWeeklyGoals(profile: PlayerProfile): WeeklyGoalsSaveData {
  const currentWeekKey = getWeekKey();
  const active = generateWeeklyGoals(profile, [], [], Math.random);
  return { version: WEEKLY_GOALS_VERSION, weekKey: currentWeekKey, active, completedThisWeek: [] };
}