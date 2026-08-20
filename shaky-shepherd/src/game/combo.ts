/**
 * Combo & mastery scoring (Session 4).
 *
 * A pure, DOM-free scoring layer that rewards skilled play on top of the
 * existing per-fruit base score. Two independent mechanics live here:
 *
 *  - Combo: eating a fruit within `comboWindowMs` of the previous fruit grows
 *    a chain whose multiplier (x2, x3, …) is capped at `maxComboMultiplier`.
 *    The fruit's base points are multiplied by the current chain. A chain that
 *    expires is reported by `expireCombo` so the runtime can show COMBO LOST.
 *
 *  - Risk: a survived near-miss (close call) awards `closeCallPoints`, and
 *    consecutive close calls within `riskWindowMs` raise a risk multiplier
 *    (RISK x2, x3, …) capped at `maxRiskMultiplier`.
 *
 * Every function takes an explicit `now` (active-play milliseconds) so the
 * whole engine is deterministic and unit-testable; the runtime (game.ts) only
 * feeds events and renders feedback. This module never touches localStorage
 * or the DOM.
 *
 * Mode decision: combos reward speed and pressure, so they are enabled only in
 * Classic and Time Attack. Zen (a deliberately relaxed mode) and Daily (a
 * seeded, deterministic puzzle whose day-over-day scores must stay comparable)
 * keep plain +10 scoring — preserving their existing balance and stored bests.
 */
import type { GameModeId } from './modes.ts';

export interface ComboConfig {
  /** When false, both combo and risk bonuses are disabled for the mode. */
  enabled: boolean;
  /** Base points per fruit (mirrors the mode's scoring). */
  pointsPerFruit: number;
  /** Max active-play ms between fruit eats that continues a chain. */
  comboWindowMs: number;
  /** Highest combo multiplier a chain can reach. */
  maxComboMultiplier: number;
  /** Points for a survived near-miss before any risk multiplier. */
  closeCallPoints: number;
  /** Max active-play ms between close calls that continues a risk streak. */
  riskWindowMs: number;
  /** Highest risk multiplier a streak can reach. */
  maxRiskMultiplier: number;
}

interface ModeComboRules {
  enabled: boolean;
  comboWindowMs: number;
  maxComboMultiplier: number;
  closeCallPoints: number;
  riskWindowMs: number;
  maxRiskMultiplier: number;
}

/**
 * Per-mode combo rules. Windows are generous enough to avoid frustration but
 * short enough that chaining requires deliberate, efficient pathing; caps keep
 * score inflation bounded so existing high scores stay meaningful.
 */
const MODE_COMBO_RULES: Record<GameModeId, ModeComboRules> = {
  classic: {
    enabled: true,
    comboWindowMs: 3500,
    maxComboMultiplier: 4,
    closeCallPoints: 5,
    riskWindowMs: 6000,
    maxRiskMultiplier: 3,
  },
  'time-attack': {
    enabled: true,
    comboWindowMs: 3500,
    maxComboMultiplier: 4,
    closeCallPoints: 5,
    riskWindowMs: 6000,
    maxRiskMultiplier: 3,
  },
  zen: {
    enabled: false,
    comboWindowMs: 3500,
    maxComboMultiplier: 4,
    closeCallPoints: 5,
    riskWindowMs: 6000,
    maxRiskMultiplier: 3,
  },
  daily: {
    enabled: false,
    comboWindowMs: 3500,
    maxComboMultiplier: 4,
    closeCallPoints: 5,
    riskWindowMs: 6000,
    maxRiskMultiplier: 3,
  },
};

export function getComboConfig(mode: GameModeId, pointsPerFruit: number): ComboConfig {
  return { ...MODE_COMBO_RULES[mode], pointsPerFruit };
}

export interface ComboState {
  /** Current combo chain length (0 = no active chain). */
  chain: number;
  /** Active-play timestamp (ms) of the last fruit eaten. */
  lastFruitAt: number;
  /** Current risk streak (0 = none). */
  riskStreak: number;
  /** Active-play timestamp (ms) of the last close call. */
  lastCloseCallAt: number;
  /** Highest chain reached this run. */
  bestChain: number;
  /** Highest risk streak reached this run. */
  bestRiskStreak: number;
  /** Total bonus points earned this run (combo + risk). */
  bonusPoints: number;
  /** Combo bonus points earned this run. */
  comboBonusPoints: number;
  /** Close-call points earned this run. */
  riskBonusPoints: number;
}

export function createComboState(): ComboState {
  return {
    chain: 0,
    lastFruitAt: 0,
    riskStreak: 0,
    lastCloseCallAt: 0,
    bestChain: 0,
    bestRiskStreak: 0,
    bonusPoints: 0,
    comboBonusPoints: 0,
    riskBonusPoints: 0,
  };
}

export interface FruitScoreResult {
  state: ComboState;
  /** Total points awarded for this fruit (base × multiplier). */
  points: number;
  /** Bonus points above the base fruit value. */
  bonus: number;
  /** The combo multiplier applied (1 = no combo). */
  multiplier: number;
}

/**
 * Score one eaten fruit. A fruit eaten within the combo window of the previous
 * one advances the chain (capped); otherwise the chain restarts at 1. When the
 * mode disables combos, the base score is returned and no chain is tracked.
 */
export function scoreFruit(state: ComboState, config: ComboConfig, now: number): FruitScoreResult {
  if (!config.enabled) {
    return { state, points: config.pointsPerFruit, bonus: 0, multiplier: 1 };
  }
  const chain =
    state.chain > 0 && now - state.lastFruitAt <= config.comboWindowMs
      ? Math.min(state.chain + 1, config.maxComboMultiplier)
      : 1;
  const points = config.pointsPerFruit * chain;
  const bonus = points - config.pointsPerFruit;
  return {
    state: {
      ...state,
      chain,
      lastFruitAt: now,
      bestChain: Math.max(state.bestChain, chain),
      bonusPoints: state.bonusPoints + bonus,
      comboBonusPoints: state.comboBonusPoints + bonus,
    },
    points,
    bonus,
    multiplier: chain,
  };
}

export interface CloseCallResult {
  state: ComboState;
  /** Points awarded for this close call (base × risk multiplier). */
  points: number;
  /** The risk multiplier applied (1 = plain close call). */
  multiplier: number;
}

/**
 * Score one survived near-miss. Consecutive close calls within the risk window
 * raise the risk multiplier (capped); otherwise the streak restarts at 1. When
 * the mode disables risk scoring, 0 points are returned and nothing is tracked.
 */
export function scoreCloseCall(state: ComboState, config: ComboConfig, now: number): CloseCallResult {
  if (!config.enabled) {
    return { state, points: 0, multiplier: 1 };
  }
  const riskStreak =
    state.riskStreak > 0 && now - state.lastCloseCallAt <= config.riskWindowMs
      ? Math.min(state.riskStreak + 1, config.maxRiskMultiplier)
      : 1;
  const points = config.closeCallPoints * riskStreak;
  return {
    state: {
      ...state,
      riskStreak,
      lastCloseCallAt: now,
      bestRiskStreak: Math.max(state.bestRiskStreak, riskStreak),
      bonusPoints: state.bonusPoints + points,
      riskBonusPoints: state.riskBonusPoints + points,
    },
    points,
    multiplier: riskStreak,
  };
}

export interface ExpireResult {
  state: ComboState;
  /** True exactly once, when an active chain (x2+) has just timed out. */
  expired: boolean;
}

/**
 * Detect a combo timeout. Only a chain of x2 or higher can be "lost" — a lone
 * fruit is not a combo. The runtime polls this while running to show the
 * COMBO LOST feedback; scoring itself resets lazily in `scoreFruit`.
 */
export function expireCombo(state: ComboState, config: ComboConfig, now: number): ExpireResult {
  if (!config.enabled || state.chain < 2 || now - state.lastFruitAt <= config.comboWindowMs) {
    return { state, expired: false };
  }
  return { state: { ...state, chain: 0 }, expired: true };
}
