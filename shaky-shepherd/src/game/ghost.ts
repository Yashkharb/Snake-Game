/**
 * Personal Ghost System (Session 10).
 *
 * Allows players to race against their own previous best run.
 * Ghost data is stored per mode and persists across sessions.
 * Ghost playback is deterministic and never affects collision.
 */
import type { GameModeId } from './modes.ts';
import type { PlayerProfile } from './progression.ts';
import { CELLS } from './core.ts';
import type { Cell, Vec } from './core.ts';

/** Maximum number of ghost snapshots to store (keeps storage size reasonable). */
export const MAX_GHOST_SNAPSHOTS = 600; // ~10 minutes at 1 move/sec

/** Version of the ghost data format for future migrations. */
export const GHOST_VERSION = 1;

/** A single snapshot of the ghost snake at a specific point in time. */
export interface GhostSnapshot {
  /** The snake segments at this point in the run. */
  snake: Cell[];
  /** The direction the snake was moving. */
  direction: Vec;
  /** The score at this point. */
  score: number;
  /** The active play time in milliseconds at this point. */
  timeMs: number;
}

/** Ghost data for a specific game mode. */
export interface GhostData {
  /** Schema version. */
  version: number;
  /** The mode this ghost belongs to. */
  mode: GameModeId;
  /** The score of the ghost run (the personal best). */
  bestScore: number;
  /** The length of the snake at the end of the ghost run. */
  finalLength: number;
  /** The level reached in the ghost run. */
  finalLevel: number;
  /** Total active play time of the ghost run in milliseconds. */
  durationMs: number;
  /** The date key when this ghost was recorded. */
  dateKey: string;
  /** The sequence of snake positions for replay. */
  snapshots: GhostSnapshot[];
  /** Whether the ghost is enabled for display. */
  enabled: boolean;
}

/** Empty ghost data for a mode. */
export function createEmptyGhost(mode: GameModeId): GhostData {
  return {
    version: GHOST_VERSION,
    mode,
    bestScore: 0,
    finalLength: 0,
    finalLevel: 0,
    durationMs: 0,
    dateKey: '',
    snapshots: [],
    enabled: true,
  };
}

/** Get the ghost data for a specific mode from the profile. */
export function getGhost(profile: PlayerProfile, mode: GameModeId): GhostData {
  return profile.ghosts?.[mode] ?? createEmptyGhost(mode);
}

/** Check if a ghost exists and is valid for a mode. */
export function hasValidGhost(profile: PlayerProfile, mode: GameModeId): boolean {
  const ghost = getGhost(profile, mode);
  return ghost.snapshots.length > 0 && ghost.bestScore > 0;
}

/** Record a snapshot of the current game state for ghost recording. */
export function recordGhostSnapshot(
  snapshots: GhostSnapshot[],
  snake: Cell[],
  direction: Vec,
  score: number,
  timeMs: number
): GhostSnapshot[] {
  const snapshot: GhostSnapshot = {
    snake: snake.map((s) => ({ ...s })),
    direction: { ...direction },
    score,
    timeMs,
  };
  const next = [...snapshots, snapshot];
  // Keep only the most recent snapshots to limit storage size
  if (next.length > MAX_GHOST_SNAPSHOTS) {
    return next.slice(-MAX_GHOST_SNAPSHOTS);
  }
  return next;
}

/** Create a new ghost data from a completed run. */
export function createGhostFromRun(
  mode: GameModeId,
  score: number,
  finalLength: number,
  finalLevel: number,
  durationMs: number,
  dateKey: string,
  snapshots: GhostSnapshot[]
): GhostData {
  return {
    version: GHOST_VERSION,
    mode,
    bestScore: score,
    finalLength,
    finalLevel,
    durationMs,
    dateKey,
    snapshots: snapshots.slice(-MAX_GHOST_SNAPSHOTS),
    enabled: true,
  };
}

/** Update the profile with a new ghost if the score beats the previous best. */
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
    return profile; // No new best, keep existing ghost
  }

  const newGhost = createGhostFromRun(mode, score, finalLength, finalLevel, durationMs, dateKey, snapshots);
  const ghosts = { ...profile.ghosts, [mode]: newGhost };
  return { ...profile, ghosts };
}

/** Get the ghost snake position at a specific time for rendering. */
export function getGhostSnakeAtTime(
  ghost: GhostData,
  currentTimeMs: number
): Cell[] | null {
  if (!ghost || ghost.snapshots.length === 0) return null;

  // Find the snapshot closest to the current time
  let snapshotIndex = ghost.snapshots.findIndex((s) => s.timeMs >= currentTimeMs);
  if (snapshotIndex === -1) {
    // Past the end of the ghost run, show the final position
    snapshotIndex = ghost.snapshots.length - 1;
  }
  if (snapshotIndex === 0) {
    return ghost.snapshots[0].snake;
  }

  // Interpolate between snapshots for smooth movement
  const prev = ghost.snapshots[snapshotIndex - 1];
  const next = ghost.snapshots[snapshotIndex];

  // If we only have one snapshot or same time, return the next
  if (prev.timeMs === next.timeMs) {
    return next.snake;
  }

  // For simplicity, return the next snapshot's snake
  // The interpolation is handled by the renderer using interpolationAlpha
  return next.snake;
}

/** Get the ghost head position for AHEAD/BEHIND comparison. */
export function getGhostHeadPosition(ghost: GhostData, currentTimeMs: number): Cell | null {
  if (!ghost || ghost.snapshots.length === 0) return null;

  let snapshotIndex = ghost.snapshots.findIndex((s) => s.timeMs >= currentTimeMs);
  if (snapshotIndex === -1) snapshotIndex = ghost.snapshots.length - 1;
  if (snapshotIndex < 0) return null;

  return ghost.snapshots[snapshotIndex].snake[0] ?? null;
}

/** Toggle ghost enabled state for a mode. */
export function toggleGhostEnabled(profile: PlayerProfile, mode: GameModeId): PlayerProfile {
  const ghost = getGhost(profile, mode);
  if (ghost.snapshots.length === 0) return profile; // No ghost to toggle

  const updatedGhost = { ...ghost, enabled: !ghost.enabled };
  const ghosts = { ...profile.ghosts, [mode]: updatedGhost };
  return { ...profile, ghosts };
}

/** Sanitize ghost data from storage, ensuring validity. */
export function sanitizeGhost(raw: unknown): GhostData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;

  if (typeof g.version !== 'number' || g.version !== GHOST_VERSION) return null;
  if (typeof g.mode !== 'string') return null;
  if (typeof g.bestScore !== 'number') return null;
  if (typeof g.finalLength !== 'number') return null;
  if (typeof g.finalLevel !== 'number') return null;
  if (typeof g.durationMs !== 'number') return null;
  if (typeof g.dateKey !== 'string') return null;
  if (!Array.isArray(g.snapshots)) return null;

  const snapshots: GhostSnapshot[] = g.snapshots
    .filter((s): s is GhostSnapshot => {
      if (typeof s !== 'object' || s === null) return false;
      const snap = s as Record<string, unknown>;
      if (!Array.isArray(snap.snake)) return false;
      if (typeof snap.direction !== 'object' || snap.direction === null) return false;
      const dir = snap.direction as Record<string, unknown>;
      if (typeof dir.x !== 'number' || typeof dir.y !== 'number') return false;
      if (typeof snap.score !== 'number') return false;
      if (typeof snap.timeMs !== 'number') return false;
      // Validate snake cells
      for (const cell of snap.snake) {
        if (typeof cell !== 'object' || cell === null) return false;
        const c = cell as Record<string, unknown>;
        if (typeof c.x !== 'number' || typeof c.y !== 'number') return false;
        if (c.x < 0 || c.x >= CELLS || c.y < 0 || c.y >= CELLS) return false;
      }
      return true;
    })
    .slice(-MAX_GHOST_SNAPSHOTS);

  return {
    version: GHOST_VERSION,
    mode: g.mode as GameModeId,
    bestScore: g.bestScore,
    finalLength: g.finalLength,
    finalLevel: g.finalLevel,
    durationMs: g.durationMs,
    dateKey: g.dateKey,
    snapshots,
    enabled: g.enabled === true,
  };
}

/** Sanitize all ghosts from the profile. */
export function sanitizeGhosts(raw: unknown): Record<GameModeId, GhostData> {
  if (typeof raw !== 'object' || raw === null) {
    return {
      classic: createEmptyGhost('classic'),
      'time-attack': createEmptyGhost('time-attack'),
      zen: createEmptyGhost('zen'),
      daily: createEmptyGhost('daily'),
    };
  }

  const g = raw as Record<string, unknown>;
  const ghosts: Record<GameModeId, GhostData> = {
    classic: createEmptyGhost('classic'),
    'time-attack': createEmptyGhost('time-attack'),
    zen: createEmptyGhost('zen'),
    daily: createEmptyGhost('daily'),
  };

  for (const mode of ['classic', 'time-attack', 'zen', 'daily'] as GameModeId[]) {
    const ghost = sanitizeGhost(g[mode]);
    if (ghost) ghosts[mode] = ghost;
  }

  return ghosts;
}