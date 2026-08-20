/**
 * Special Food (Session 5).
 *
 * A pure, DOM-free module that adds rare special fruits on top of the existing
 * normal fruit. Normal fruit stays dominant; specials are rolled with a small
 * probability and weighted per type. Every rule, value, weight and duration
 * lives here as data, so the simulation (core.ts) stays generic — it only
 * carries a `foodType` on the GameState and places whatever the runtime asks
 * for. The runtime (game.ts) feeds eat events and renders feedback.
 *
 * Effects have explicit, bounded durations measured in *active-play*
 * milliseconds (pauses frozen), exactly like combo/risk (Session 4), so they
 * are deterministic and unit-testable:
 *
 *  - GOLDEN    instant: +30 points (no lasting effect)
 *  - SLOW      +6s: move delay x1.6 (snake visibly slower)
 *  - MULTIPLIER +8s: all fruit points x2
 *  - CURSED    +40 points, then +5s of move delay /1.4 (snake faster = risk)
 *  - TIME      instant: +5s added to the Time Attack clock
 *  - NORMAL    +10 points (dominant)
 *
 * Mode decision (requirement: special food must not break Daily determinism):
 * special food is DISABLED in Daily — every Daily fruit is normal, the seeded
 * challenge keeps its day-over-day comparable score, exactly mirroring the
 * Session 4 combo decision. Zen keeps only the helpful specials (golden, slow,
 * multiplier) so the relaxed mode never gains a pressure mechanic (cursed).
 *
 * Impossible states are prevented: slow and cursed share one speed-effect slot
 * (the "speed effect"), so they can never be active simultaneously — eating
 * one replaces the other. The cursed speed-up is also floored at the engine's
 * max-speed delay (`minMoveDelay`), so it can never exceed the game's designed
 * top speed.
 */
import { spawnFood } from './core.ts';
import type { Cell, Rng } from './core.ts';
import type { GameModeId } from './modes.ts';

export type FoodType = 'normal' | 'golden' | 'slow' | 'multiplier' | 'cursed' | 'time';

/** The special (non-normal) food types in rollout order. */
export const SPECIAL_FOOD_TYPES: FoodType[] = ['golden', 'slow', 'multiplier', 'cursed', 'time'];

/** A food on the board: its cell plus the type that drives scoring + effects. */
export interface PlacedFood {
  cell: Cell;
  type: FoodType;
}

export interface FoodTypeSpec {
  /** Relative weight when rolling a special (0 = never in this mode). */
  weight: number;
  /** Base points this fruit type scores (before combo / multiplier effects). */
  points: number;
  /** Effect duration in active-play ms (0 = instant, no lasting effect). */
  durationMs: number;
}

export interface FoodRules {
  /** When false the mode never rolls specials (Daily). */
  enabled: boolean;
  /** Overall probability (0..1) that a placed fruit is special rather than normal. */
  specialWeight: number;
  /** Per-type specs (normal dominance comes from specialWeight). */
  specs: Record<FoodType, FoodTypeSpec>;
  /** SLOW effect: move delay is multiplied by this while active. */
  slowFactor: number;
  /** CURSED effect: move delay is divided by this while active. */
  speedFactor: number;
  /** MULTIPLIER effect: fruit points are multiplied by this while active. */
  multiplierFactor: number;
  /** TIME effect: bonus ms added to the mode's time limit. */
  timeBonusMs: number;
  /** Lower bound for the effective move delay (the engine's max-speed floor). */
  minMoveDelay: number;
}

/** Effect durations are shared across modes; per-mode differences are weights. */
const BASE_SPECS: Record<FoodType, FoodTypeSpec> = {
  normal: { weight: 0, points: 10, durationMs: 0 },
  golden: { weight: 2, points: 30, durationMs: 0 },
  slow: { weight: 2, points: 10, durationMs: 6000 },
  multiplier: { weight: 2, points: 10, durationMs: 8000 },
  cursed: { weight: 1, points: 40, durationMs: 5000 },
  time: { weight: 0, points: 10, durationMs: 0 },
};

/**
 * Per-mode weight overrides. Classic and Time Attack offer the full set;
 * Time Attack alone can roll TIME (it is the only mode with a clock); Zen
 * never rolls CURSED (pressure mechanics stay out of the relaxed mode).
 */
const MODE_WEIGHTS: Record<GameModeId, Partial<Record<FoodType, number>>> = {
  classic: { cursed: 1, time: 0 },
  'time-attack': { cursed: 1, time: 2 },
  zen: { cursed: 0, time: 0 },
  daily: {},
};

const MODE_FOOD_FLAGS: Record<GameModeId, { enabled: boolean; specialWeight: number }> = {
  classic: { enabled: true, specialWeight: 0.12 },
  'time-attack': { enabled: true, specialWeight: 0.12 },
  zen: { enabled: true, specialWeight: 0.12 },
  daily: { enabled: false, specialWeight: 0 },
};

export function getFoodRules(mode: GameModeId): FoodRules {
  const flags = MODE_FOOD_FLAGS[mode];
  const overrides = MODE_WEIGHTS[mode];
  const specs = { ...BASE_SPECS } as Record<FoodType, FoodTypeSpec>;
  for (const type of Object.keys(overrides) as FoodType[]) {
    specs[type] = { ...specs[type], weight: overrides[type] as number };
  }
  return {
    enabled: flags.enabled,
    specialWeight: flags.specialWeight,
    specs,
    slowFactor: 1.6,
    speedFactor: 1.4,
    multiplierFactor: 2,
    timeBonusMs: 5000,
    minMoveDelay: 50,
  };
}

/**
 * Roll the next food type for a placement. Returns `normal` when the mode
 * disables specials or when the special roll misses. Deterministic for a given
 * rng sequence — the first draw decides special-vs-normal, the second picks a
 * weighted special among those allowed in the mode.
 */
export function rollFoodType(rng: Rng, rules: FoodRules): FoodType {
  if (!rules.enabled) return 'normal';
  if (rng() >= rules.specialWeight) return 'normal';
  const specials = SPECIAL_FOOD_TYPES.filter((type) => rules.specs[type].weight > 0);
  const total = specials.reduce((sum, type) => sum + rules.specs[type].weight, 0);
  if (total <= 0) return 'normal';
  let roll = rng() * total;
  for (const type of specials) {
    roll -= rules.specs[type].weight;
    if (roll < 0) return type;
  }
  return specials[specials.length - 1];
}

/**
 * Roll both the type and the cell of the next fruit (reusing the engine's
 * snake-aware `spawnFood`). Returns null only when the board is full.
 */
export function rollPlacedFood(snake: Cell[], rng: Rng, rules: FoodRules): PlacedFood | null {
  const type = rollFoodType(rng, rules);
  const cell = spawnFood(snake, rng);
  return cell ? { cell, type } : null;
}

/**
 * Active effect state for the current run. Durations are active-play ms so
 * they freeze while paused and reset at run start. `timeBonusMs` is the only
 * permanent-this-run accumulator (Time Attack).
 */
export interface FoodEffects {
  /** Active-play ms when the speed effect expires (0 = none active). */
  speedUntil: number;
  /** Which speed effect is running: slow (easier) or fast (cursed, harder). */
  speedKind: 'slow' | 'fast' | null;
  /** Active-play ms when the score multiplier expires (0 = none active). */
  multiplierUntil: number;
  /** Bonus ms added to the run's time limit this run (Time Attack). */
  timeBonusMs: number;
}

export function createFoodEffects(): FoodEffects {
  return { speedUntil: 0, speedKind: null, multiplierUntil: 0, timeBonusMs: 0 };
}

export interface FoodEffectResult {
  effects: FoodEffects;
  /** The effect-granting special just eaten, or null for instant/normal fruit. */
  started: 'slow' | 'multiplier' | 'cursed' | 'time' | null;
}

/**
 * Apply the effect of an eaten fruit at active-play time `now`. Slow and cursed
 * share one speed slot, so eating one replaces the other — they can never be
 * active at the same time (no contradictory slow-but-fast state). A multiplier
 * eaten while active refreshes its window.
 */
export function applyFoodEffect(
  effects: FoodEffects,
  type: FoodType,
  rules: FoodRules,
  now: number,
): FoodEffectResult {
  switch (type) {
    case 'slow':
      return {
        effects: { ...effects, speedUntil: now + rules.specs.slow.durationMs, speedKind: 'slow' },
        started: 'slow',
      };
    case 'cursed':
      return {
        effects: { ...effects, speedUntil: now + rules.specs.cursed.durationMs, speedKind: 'fast' },
        started: 'cursed',
      };
    case 'multiplier':
      return {
        effects: { ...effects, multiplierUntil: now + rules.specs.multiplier.durationMs },
        started: 'multiplier',
      };
    case 'time':
      return { effects: { ...effects, timeBonusMs: effects.timeBonusMs + rules.timeBonusMs }, started: 'time' };
    default:
      return { effects, started: null };
  }
}

export interface ResolvedFoodEffects {
  /** Pruned effects (expired timers zeroed). */
  effects: FoodEffects;
  /** The speed effect active right now, if any. */
  activeSpeed: 'slow' | 'fast' | null;
  /** The fruit-points multiplier active right now (1 = none). */
  activeMultiplier: number;
}

/** Drop any effect whose window has passed and report what is active now. */
export function resolveEffects(effects: FoodEffects, rules: FoodRules, now: number): ResolvedFoodEffects {
  const speedActive = effects.speedUntil > now;
  const multiplierActive = effects.multiplierUntil > now;
  return {
    effects: {
      speedUntil: speedActive ? effects.speedUntil : 0,
      speedKind: speedActive ? effects.speedKind : null,
      multiplierUntil: multiplierActive ? effects.multiplierUntil : 0,
      timeBonusMs: effects.timeBonusMs,
    },
    activeSpeed: speedActive ? effects.speedKind : null,
    activeMultiplier: multiplierActive ? rules.multiplierFactor : 1,
  };
}

/**
 * The move delay the engine should use right now, applying the active speed
 * effect. Floored at `minMoveDelay` so a cursed speed-up can never outrun the
 * game's designed top speed (matching the engine's `getMoveDelay` floor).
 */
export function effectiveMoveDelay(
  effects: FoodEffects,
  rules: FoodRules,
  baseDelay: number,
  now: number,
): number {
  if (effects.speedUntil <= now) return baseDelay;
  const delay =
    effects.speedKind === 'slow' ? baseDelay * rules.slowFactor : baseDelay / rules.speedFactor;
  return Math.max(rules.minMoveDelay, Math.round(delay));
}

/** The points this fruit type is worth right now (base x active multiplier). */
export function pointsForFood(
  effects: FoodEffects,
  rules: FoodRules,
  type: FoodType,
  now: number,
): number {
  const multiplier = effects.multiplierUntil > now ? rules.multiplierFactor : 1;
  return rules.specs[type].points * multiplier;
}