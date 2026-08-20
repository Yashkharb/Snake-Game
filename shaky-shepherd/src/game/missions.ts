/**
 * Mission system (Session 2).
 *
 * Pure, data-driven short-term goals. A player holds up to
 * ACTIVE_MISSION_COUNT missions at once; progress advances from game events
 * (fruit eaten, level-ups, finished runs) that the runtime dispatches. Like
 * progression.ts, every mutation is pure so it is unit-testable; the runtime
 * (game.ts) applies events and persists through storage.ts — this module never
 * touches localStorage directly.
 *
 * Mission variety is intentional: score, fruit count, length, level, survival
 * time, mode-specific scores, personal-record improvement, and skill
 * conditions. Missions are never punishing — failing a run simply does not
 * advance progress — and completed missions are replaced silently at run end /
 * load so the player never sees a wall of spam.
 */
import type { Rng } from './core.ts';
import { getMode } from './modes.ts';
import type { GameModeId } from './modes.ts';
import { rankIndexForXp } from './progression.ts';
import type { PlayerProfile } from './progression.ts';
import { readStoredMissions, writeStoredMissions } from './storage.ts';

export const MISSIONS_VERSION = 1;
export const ACTIVE_MISSION_COUNT = 3;
const RECENT_LIMIT = 8;
const GENERATION_TRIES = 12;

export type MissionDifficulty = 'easy' | 'medium' | 'hard' | 'master';

export type MissionType =
  | 'fruit'
  | 'score'
  | 'length'
  | 'level'
  | 'survival'
  | 'run'
  | 'mode'
  | 'record'
  | 'skill';

/** Immutable definition of one possible mission. Lives in a data-driven pool. */
export interface MissionTemplate {
  id: string;
  difficulty: MissionDifficulty;
  type: MissionType;
  title: string;
  /** Description with `{target}` (and `{mode}`) placeholders. */
  description: string;
  target: number;
  rewardXp: number;
  /** Mode-specific missions only (mode objectives and personal records). */
  mode?: GameModeId;
  /** Skill missions only: the qualifying run must reach this score. */
  minScore?: number;
  /** Skill missions only: which skill condition the run must satisfy. */
  skill?: 'no-pause-run';
  /** Record missions: target is computed at generation from the stored best. */
  dynamicTarget?: boolean;
}

/** Persisted state of one active mission. */
export interface MissionState {
  id: string;
  difficulty: MissionDifficulty;
  type: MissionType;
  title: string;
  description: string;
  target: number;
  progress: number;
  rewardXp: number;
  mode?: GameModeId;
  minScore?: number;
  completed: boolean;
  completedAt: number | null;
}

/** A runtime event that advances matching missions. */
export interface MissionEvent {
  type: MissionType;
  amount?: number;
  level?: number;
  score?: number;
  length?: number;
  seconds?: number;
  mode?: GameModeId;
  skill?: 'no-pause-run';
}

/** Persisted mission blob — active missions plus recently shown ids. */
export interface MissionsSaveData {
  version: number;
  active: MissionState[];
  recent: string[];
}

const MODE_BEST_FIELD: Record<GameModeId, 'classicBest' | 'timeAttackBest' | 'zenBest' | 'dailyBest'> = {
  classic: 'classicBest',
  'time-attack': 'timeAttackBest',
  zen: 'zenBest',
  daily: 'dailyBest',
};

/**
 * The template pool. Thresholds are grounded in the real engine: 10 points per
 * fruit, one level every 40 points (MAX_LEVEL 12), a 20×20 board, and a 60s
 * Time Attack. A full board clear is ~3,900 points, so every MASTER target is
 * hard but realistically reachable by a skilled player.
 */
export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  // EASY
  { id: 'eat-20-fruits', difficulty: 'easy', type: 'fruit', title: 'First Harvest', description: 'Eat {target} fruits in total', target: 20, rewardXp: 20 },
  { id: 'reach-level-3', difficulty: 'easy', type: 'level', title: 'Warming Up', description: 'Reach level {target}', target: 3, rewardXp: 20 },
  { id: 'score-100', difficulty: 'easy', type: 'score', title: 'Century', description: 'Score {target} points in one run', target: 100, rewardXp: 20 },
  { id: 'play-1-run', difficulty: 'easy', type: 'run', title: 'First Steps', description: 'Complete {target} run', target: 1, rewardXp: 20 },
  // MEDIUM
  { id: 'reach-level-6', difficulty: 'medium', type: 'level', title: 'Speed Up', description: 'Reach level {target}', target: 6, rewardXp: 35 },
  { id: 'reach-length-15', difficulty: 'medium', type: 'length', title: 'Long Snake', description: 'Reach a length of {target} in one run', target: 15, rewardXp: 35 },
  { id: 'score-180', difficulty: 'medium', type: 'score', title: 'Solid Score', description: 'Score {target} points in one run', target: 180, rewardXp: 35 },
  { id: 'survive-45s', difficulty: 'medium', type: 'survival', title: 'Steady Hands', description: 'Survive for {target} seconds in one run', target: 45, rewardXp: 35 },
  { id: 'score-100-time-attack', difficulty: 'medium', type: 'mode', title: 'Ticking Away', description: 'Score {target} in {mode}', target: 100, mode: 'time-attack', rewardXp: 35 },
  { id: 'score-100-zen', difficulty: 'medium', type: 'mode', title: 'No Walls', description: 'Score {target} in {mode}', target: 100, mode: 'zen', rewardXp: 35 },
  // HARD
  { id: 'score-300-classic', difficulty: 'hard', type: 'mode', title: 'Serious Snake', description: 'Score {target} in {mode}', target: 300, mode: 'classic', rewardXp: 50 },
  { id: 'reach-level-8', difficulty: 'hard', type: 'level', title: 'Speed Demon', description: 'Reach level {target}', target: 8, rewardXp: 50 },
  { id: 'beat-classic-20pct', difficulty: 'hard', type: 'record', title: 'Personal Best', description: 'Beat your previous {mode} best by 20% (target {target})', target: 0, mode: 'classic', rewardXp: 50, dynamicTarget: true },
  { id: 'no-pause-run', difficulty: 'hard', type: 'skill', title: 'No Interruptions', description: 'Complete a run without pausing', target: 1, rewardXp: 50, skill: 'no-pause-run' },
  // MASTER
  { id: 'score-500-classic', difficulty: 'master', type: 'mode', title: 'Board Boss', description: 'Score {target} in {mode}', target: 500, mode: 'classic', rewardXp: 75 },
  { id: 'score-350-time-attack', difficulty: 'master', type: 'mode', title: 'One-Minute Monster', description: 'Score {target} in {mode}', target: 350, mode: 'time-attack', rewardXp: 75 },
  { id: 'reach-level-12', difficulty: 'master', type: 'level', title: 'Apex', description: 'Reach level {target}', target: 12, rewardXp: 75 },
  { id: 'no-pause-score-150', difficulty: 'master', type: 'skill', title: 'Flawless', description: 'Score {target} points in one run without pausing', target: 1, minScore: 150, rewardXp: 75, skill: 'no-pause-run' },
];

/** Difficulty mix per rank index (0 Hatchling → 4 Apex), percentages. */
const DIFFICULTY_WEIGHTS: readonly (readonly [MissionDifficulty, number])[][] = [
  [['easy', 55], ['medium', 35], ['hard', 10], ['master', 0]],
  [['easy', 40], ['medium', 40], ['hard', 20], ['master', 0]],
  [['easy', 25], ['medium', 40], ['hard', 30], ['master', 5]],
  [['easy', 15], ['medium', 35], ['hard', 35], ['master', 15]],
  [['easy', 10], ['medium', 30], ['hard', 35], ['master', 25]],
];

function modeName(id: GameModeId): string {
  return getMode(id).name;
}

function renderDescription(description: string, target: number, mode?: GameModeId): string {
  return description.replace('{target}', String(target)).replace('{mode}', mode ? modeName(mode) : '');
}

function templateTarget(template: MissionTemplate, profile: PlayerProfile): number {
  if (template.dynamicTarget && template.mode) {
    const best = profile[MODE_BEST_FIELD[template.mode]];
    // A record mission only makes sense once the player has a real baseline.
    if (best < 50) return -1;
    return Math.ceil(best * 1.2);
  }
  return template.target;
}

/** Cumulative missions pick up where the player already is (no free instant wins). */
function seededProgress(template: MissionTemplate, profile: PlayerProfile): number {
  if (template.type === 'fruit') return Math.min(profile.totalFruit, template.target);
  return 0;
}

function missionFromTemplate(template: MissionTemplate, target: number, profile: PlayerProfile): MissionState {
  return {
    id: template.id,
    difficulty: template.difficulty,
    type: template.type,
    title: template.title,
    description: renderDescription(template.description, target, template.mode),
    target,
    progress: seededProgress(template, profile),
    rewardXp: template.rewardXp,
    mode: template.mode,
    minScore: template.minScore,
    completed: false,
    completedAt: null,
  };
}

/**
 * Pick one mission that the player has not completed yet and has not seen
 * recently, weighted toward the player's rank. Returns null when no eligible
 * template remains (a completionist who has finished every mission).
 */
export function generateMission(profile: PlayerProfile, recent: string[], activeIds: string[], rng: Rng = Math.random, tries = GENERATION_TRIES): MissionState | null {
  if (tries <= 0) return null;
  const rankIndex = Math.min(DIFFICULTY_WEIGHTS.length - 1, rankIndexForXp(profile.xp));
  const weights = DIFFICULTY_WEIGHTS[rankIndex];
  const roll = rng() * 100;
  let difficulty: MissionDifficulty = 'easy';
  let acc = 0;
  for (const [candidate, weight] of weights) {
    acc += weight;
    if (roll < acc) {
      difficulty = candidate;
      break;
    }
  }
  const eligible = MISSION_TEMPLATES.filter(
    (t) => !profile.completedMissions.includes(t.id) && !recent.includes(t.id) && !activeIds.includes(t.id),
  );
  const pool = eligible.filter((t) => t.difficulty === difficulty);
  const candidates = pool.length > 0 ? pool : eligible;
  if (candidates.length === 0) return null;
  const template = candidates[Math.floor(rng() * candidates.length)];
  const target = templateTarget(template, profile);
  if (target < 0) return generateMission(profile, recent, activeIds, rng, tries - 1);
  return missionFromTemplate(template, target, profile);
}

function typeMatches(mission: MissionState, event: MissionEvent): boolean {
  switch (mission.type) {
    case 'fruit':
      return event.type === 'fruit';
    case 'score':
      return event.type === 'score';
    case 'length':
      return event.type === 'length';
    case 'level':
      return event.type === 'level';
    case 'survival':
      return event.type === 'survival';
    case 'run':
      return event.type === 'run';
    case 'mode':
      return event.type === 'mode' && event.mode === mission.mode;
    case 'record':
      return event.type === 'record' && event.mode === mission.mode;
    case 'skill':
      return (
        event.type === 'skill' &&
        event.skill === 'no-pause-run' &&
        (mission.minScore === undefined || (event.score ?? 0) >= mission.minScore)
      );
  }
}

function advanceProgress(mission: MissionState, event: MissionEvent): number {
  switch (mission.type) {
    case 'fruit':
      return mission.progress + Math.max(0, event.amount ?? 0);
    case 'run':
    case 'skill':
      return mission.progress + 1;
    case 'score':
    case 'mode':
    case 'record':
      return Math.max(mission.progress, event.score ?? 0);
    case 'length':
      return Math.max(mission.progress, event.length ?? 0);
    case 'level':
      return Math.max(mission.progress, event.level ?? 0);
    case 'survival':
      return Math.max(mission.progress, event.seconds ?? 0);
  }
}

/** Apply one event to the active missions. Pure — returns the new state plus any missions that just completed. */
export function applyMissionEvent(active: MissionState[], event: MissionEvent, now: number = Date.now()): { active: MissionState[]; completed: MissionState[] } {
  const completed: MissionState[] = [];
  const next = active.map((mission) => {
    if (mission.completed || !typeMatches(mission, event)) return mission;
    const progress = advanceProgress(mission, event);
    if (progress <= mission.progress) return mission;
    const updated: MissionState = { ...mission, progress };
    if (updated.progress >= mission.target) {
      completed.push({ ...updated, completed: true, completedAt: now });
      return { ...updated, completed: true, completedAt: now };
    }
    return updated;
  });
  return { active: next, completed };
}

/** Apply a batch of events (a finished run) and collect everything completed. */
export function applyMissionEvents(active: MissionState[], events: MissionEvent[], now: number = Date.now()): { active: MissionState[]; completed: MissionState[] } {
  let current = active;
  const completed: MissionState[] = [];
  for (const event of events) {
    const result = applyMissionEvent(current, event, now);
    current = result.active;
    completed.push(...result.completed);
  }
  return { active: current, completed };
}

/**
 * Replace completed missions with fresh ones so the player always has up to
 * ACTIVE_MISSION_COUNT live goals. Silent by design — the runtime already
 * announced each completion when it happened. Pure.
 */
export function replaceCompletedMissions(save: MissionsSaveData, profile: PlayerProfile, rng: Rng = Math.random): MissionsSaveData {
  const active = save.active.filter((m) => !m.completed);
  const justCompleted = save.active.filter((m) => m.completed).map((m) => m.id);
  let recent = save.recent;
  let next = active;
  while (next.length < ACTIVE_MISSION_COUNT) {
    const mission = generateMission(profile, [...recent, ...justCompleted], next.map((m) => m.id), rng);
    if (!mission) break;
    next = [...next, mission];
    recent = [mission.id, ...recent.filter((id) => id !== mission.id)].slice(0, RECENT_LIMIT);
  }
  return { version: MISSIONS_VERSION, active: next, recent };
}

function sanitizeMission(raw: unknown): MissionState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string') return null;
  const template = MISSION_TEMPLATES.find((t) => t.id === m.id);
  if (!template) return null;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    id: m.id,
    difficulty: template.difficulty,
    type: template.type,
    title: typeof m.title === 'string' ? m.title : template.title,
    description: typeof m.description === 'string' ? m.description : renderDescription(template.description, template.target, template.mode),
    target: num(m.target, template.target) || template.target,
    progress: num(m.progress, 0),
    rewardXp: num(m.rewardXp, template.rewardXp) || template.rewardXp,
    mode: template.mode,
    minScore: template.minScore,
    completed: Boolean(m.completed),
    completedAt: typeof m.completedAt === 'number' && Number.isFinite(m.completedAt) ? m.completedAt : null,
  };
}

function sanitizeSave(raw: unknown): MissionsSaveData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (data.version !== MISSIONS_VERSION) return null;
  const active = Array.isArray(data.active) ? data.active.map(sanitizeMission).filter((m): m is MissionState => m !== null) : [];
  const recent = Array.isArray(data.recent)
    ? (data.recent as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  return { version: MISSIONS_VERSION, active, recent };
}

/**
 * Load persisted missions (or start a fresh set), then refill any completed
 * slots so the player always has up to ACTIVE_MISSION_COUNT live goals.
 */
export function loadMissions(profile: PlayerProfile, rng: Rng = Math.random): MissionsSaveData {
  const parsed = sanitizeSave(readStoredMissions());
  return replaceCompletedMissions(parsed ?? { version: MISSIONS_VERSION, active: [], recent: [] }, profile, rng);
}

/** Persist the mission blob. Returns false when storage is unavailable. */
export function saveMissions(save: MissionsSaveData): boolean {
  return writeStoredMissions(save);
}