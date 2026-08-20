/**
 * Development-only debug hook.
 * Only included in development builds — stripped in production.
 */
import type { GameModeId } from './modes.ts';
import type { DailyChallenge } from './daily.ts';
import type { PlayerProfile } from './progression.ts';
import type { GhostData, GhostSnapshot } from './ghost.ts';
import type { ChallengeData } from './challenge.ts';

/** Development-only debug hook exposed on `window.__serpent`. */
export function installDevHook(
  getGame: () => any,
  getMode: () => GameModeId,
  getDaily: () => DailyChallenge | null,
  getDailyFoodIndex: () => number,
  getTodayKey: () => string,
  getProfile: () => any,
  getRank: () => string,
  getMissions: () => any[],
  getAchievements: () => string[],
  getFoodType: () => string,
  getFoodEffects: () => any,
  forceFoodType: (type: string) => void,
  selectMode: (id: GameModeId) => void,
  getEvents: () => any,
  getEventRules: () => any,
  forceEvent: (id: string) => void,
  getGhost: (profile: any, mode: GameModeId) => any,
  toggleGhostEnabled: (profile: any, mode: GameModeId) => any,
  getGhostSnakeAtTime: (ghost: any, timeMs: number, interp: number) => any,
  getGhostHeadPosition: (ghost: any, timeMs: number) => any,
  createChallengeFromRun: (mode: GameModeId, score: number, challengerName?: string) => any,
  encodeChallenge: (data: any) => string,
): void {
  if (import.meta.env.DEV) {
    (window as unknown as { __serpent?: object }).__serpent = {
      getGame,
      getMode,
      getDaily,
      getDailyFoodIndex,
      getTodayKey,
      getProfile,
      getRank,
      getMissions,
      getAchievements,
      getFoodType,
      getFoodEffects,
      forceFoodType,
      selectMode,
      getEvents,
      getEventRules,
      forceEvent,
      getGhost,
      toggleGhostEnabled,
      getGhostSnakeAtTime,
      getGhostHeadPosition,
      createChallengeFromRun,
      encodeChallenge,
    };
  }
}