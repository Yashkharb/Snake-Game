import { previousDayKey } from './daily.ts';

const PREF_PREFIX = 'serpent-pref:';

type StorageBackend = Pick<Storage, 'getItem' | 'setItem'>;

/** Undefined = auto-detect (window.localStorage); null = explicitly none. */
let injectedBackend: StorageBackend | null | undefined;

export const STORAGE_KEYS = {
  highScore: 'serpent-high-score',
  bestLength: 'serpent-best-length',
} as const;

/** Daily Challenge keys — deliberately separate from every other mode's records. */
export const DAILY_KEYS = {
  best: 'serpent-daily-best',
  bestLength: 'serpent-daily-best-length',
  status: 'serpent-daily-status',
  history: 'serpent-daily-history',
} as const;

export interface DailyStatus {
  dateKey: string;
  score: number;
  completed: boolean;
  level: number;
  durationMs: number;
  length: number;
}

/** Inject a storage backend (used by tests). Pass undefined to restore auto-detect. */
export function setStorageBackend(backend: StorageBackend | null): void {
  injectedBackend = backend;
}

function getBackend(): StorageBackend | null {
  if (injectedBackend !== undefined) return injectedBackend;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }
  return null;
}

function safeGetItem(key: string): string | null {
  const backend = getBackend();
  if (!backend) return null;
  try {
    return backend.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  const backend = getBackend();
  if (!backend) return false;
  try {
    backend.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Read a stored number, returning `fallback` when absent, invalid, or blocked. */
export function readStoredNumber(key: string, fallback = 0): number {
  const raw = safeGetItem(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Persist a number; returns false when storage is unavailable/blocked. */
export function writeStoredNumber(key: string, value: number): boolean {
  return safeSetItem(key, String(value));
}

/** Read a string preference (e.g. audio on/off, theme). Never throws. */
export function readPreference(key: string, fallback: string): string {
  const raw = safeGetItem(PREF_PREFIX + key);
  return raw === null ? fallback : raw;
}

/** Persist a string preference; returns false when storage is unavailable. */
export function writePreference(key: string, value: string): boolean {
  return safeSetItem(PREF_PREFIX + key, value);
}

/** Read the last saved Daily Challenge status, or null when absent/corrupt. */
export function readStoredDailyStatus(): DailyStatus | null {
  const raw = safeGetItem(DAILY_KEYS.status);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DailyStatus>;
    if (typeof parsed.dateKey !== 'string' || typeof parsed.score !== 'number') return null;
    return {
      dateKey: parsed.dateKey,
      score: parsed.score,
      completed: Boolean(parsed.completed),
      level: typeof parsed.level === 'number' ? parsed.level : 1,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
      length: typeof parsed.length === 'number' ? parsed.length : 0,
    };
  } catch {
    return null;
  }
}

/** Persist today's Daily Challenge status. Returns false when storage is unavailable. */
export function writeStoredDailyStatus(status: DailyStatus): boolean {
  return safeSetItem(DAILY_KEYS.status, JSON.stringify(status));
}

/** Read the full local history of Daily Challenge results, keyed by dateKey. */
export function readStoredDailyHistory(): Record<string, DailyStatus> {
  const raw = safeGetItem(DAILY_KEYS.history);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<DailyStatus>>;
    const history: Record<string, DailyStatus> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value.dateKey !== 'string' || typeof value.score !== 'number') continue;
      history[key] = {
        dateKey: value.dateKey,
        score: value.score,
        completed: Boolean(value.completed),
        level: typeof value.level === 'number' ? value.level : 1,
        durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0,
        length: typeof value.length === 'number' ? value.length : 0,
      };
    }
    return history;
  } catch {
    return {};
  }
}

/**
 * Record a finished Daily Challenge run: refreshes today's status and upserts
 * the result into the local history. Returns false when storage is blocked.
 */
export function recordDailyResult(status: DailyStatus): boolean {
  const history = readStoredDailyHistory();
  history[status.dateKey] = status;
  const okStatus = writeStoredDailyStatus(status);
  const okHistory = safeSetItem(DAILY_KEYS.history, JSON.stringify(history));
  return okStatus && okHistory;
}

/**
 * Consecutive completed days ending at `todayKey` — or, when today has not been
 * completed yet, ending at the previous day (a streak that is still alive and
 * simply does not count today). A missed day breaks the streak.
 */
export function computeDailyStreak(history: Record<string, DailyStatus>, todayKey: string): number {
  let streak = 0;
  let cursor = todayKey;
  while (history[cursor]?.completed) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }
  if (streak === 0 && history[previousDayKey(todayKey)]?.completed) {
    let day = previousDayKey(todayKey);
    while (history[day]?.completed) {
      streak += 1;
      day = previousDayKey(day);
    }
  }
  return streak;
}