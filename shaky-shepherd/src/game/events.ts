/**
 * Dynamic in-run events (Session 6).
 *
 * Rare, temporary events that change a run's flavor for a short window without
 * ever overwhelming normal Snake. Three events ship, each built on an axis the
 * engine already supports so the core simulation stays generic:
 *
 *  - GOLD RUSH: special fruit appears more often and GOLDEN dominates the
 *    special rolls (food frequency — feeds food.ts `FoodRules`).
 *  - BLOOD MOON: all fruit points ×2 and the snake moves mildly faster
 *    (scoring + speed — feeds the points/speed math in the runtime).
 *  - SAFE ZONE: the board wraps, so walls stop killing for a few seconds
 *    (strategic mechanic — feeds the engine's `wrap` option).
 *
 * The trigger model is deliberately conservative (rare + fair):
 *  - one event at a time; a roll happens every `checkIntervalMs` of active
 *    play while running, with `baseChance` probability per roll;
 *  - no event before `minFirstEventMs` of a run, at least `minCooldownMs`
 *    between event starts, and at most `maxEventsPerRun` per run.
 *
 * Mode decision (requirement: events must not break Daily determinism): events
 * are DISABLED in Daily, exactly like combo and special food — the seeded
 * challenge keeps its day-over-day comparable score. They are also OFF in Zen
 * (a deliberately relaxed mode that already excludes combo/risk/cursed);
 * events are an excitement/pressure layer reserved for Classic and Time Attack.
 *
 * Every function takes an explicit `now` (active-play ms, pause-frozen) so the
 * engine is deterministic and unit-testable. The runtime (game.ts) rolls
 * triggers on a throttle, resolves expiry, and applies effects. No DOM, no
 * storage.
 */
import type { Rng } from './core.ts';
import type { GameModeId } from './modes.ts';
import type { FoodRules } from './food.ts';

export type EventId = 'gold-rush' | 'blood-moon' | 'safe-zone';

export const EVENT_IDS: EventId[] = ['gold-rush', 'blood-moon', 'safe-zone'];

export interface EventEffects {
  /** Multiplier on the food specialWeight during the event (1 = unchanged). */
  foodSpecialWeightMultiplier: number;
  /** Extra relative weight given to GOLDEN fruit while the event is active. */
  goldenWeightBoost: number;
  /** Multiplier on every fruit's points (1 = unchanged). */
  scoreMultiplier: number;
  /** Divisor on the move delay (>=1 = faster; 1 = unchanged). */
  speedFactor: number;
  /** When true the board wraps during the event (walls stop killing). */
  wrap: boolean;
}

export interface EventDefinition {
  id: EventId;
  /** Player-facing all-caps label for the board banner. */
  label: string;
  /** One-line effect description for the toast / announce copy. */
  description: string;
  /** Active duration in active-play ms. */
  durationMs: number;
  /** Relative weight when a trigger roll picks which event starts. */
  weight: number;
  effects: EventEffects;
}

export const EVENT_DEFINITIONS: Record<EventId, EventDefinition> = {
  'gold-rush': {
    id: 'gold-rush',
    label: 'GOLD RUSH',
    description: 'Gold rush! More golden fruit appears.',
    durationMs: 20_000,
    weight: 4,
    effects: {
      foodSpecialWeightMultiplier: 3,
      goldenWeightBoost: 6,
      scoreMultiplier: 1,
      speedFactor: 1,
      wrap: false,
    },
  },
  'blood-moon': {
    id: 'blood-moon',
    label: 'BLOOD MOON',
    description: 'Blood moon! Fruit is worth double and the snake moves faster.',
    durationMs: 15_000,
    weight: 3,
    effects: {
      foodSpecialWeightMultiplier: 1,
      goldenWeightBoost: 0,
      scoreMultiplier: 2,
      speedFactor: 1.15,
      wrap: false,
    },
  },
  'safe-zone': {
    id: 'safe-zone',
    label: 'SAFE ZONE',
    description: 'Safe zone! The walls stop killing for a moment.',
    durationMs: 12_000,
    weight: 3,
    effects: {
      foodSpecialWeightMultiplier: 1,
      goldenWeightBoost: 0,
      scoreMultiplier: 1,
      speedFactor: 1,
      wrap: true,
    },
  },
};

const BASE_TRIGGER = {
  /** How often the trigger is rolled (active-play ms). */
  checkIntervalMs: 2000,
  /** Probability of starting an event on each roll. */
  baseChance: 0.05,
  /** No event can start until this much active time has passed. */
  minFirstEventMs: 20_000,
  /** Min active-play ms between event starts. */
  minCooldownMs: 30_000,
  /** Max events per run (rarity cap). */
  maxEventsPerRun: 4,
} as const;

const MODE_EVENT_POOL: Record<GameModeId, EventId[]> = {
  classic: ['gold-rush', 'blood-moon', 'safe-zone'],
  'time-attack': ['gold-rush', 'blood-moon', 'safe-zone'],
  zen: [],
  daily: [],
};

export interface EventRules {
  enabled: boolean;
  /** Events that may trigger in this mode (subset of EVENT_IDS). */
  pool: EventId[];
  /** How often the trigger is rolled (active-play ms). */
  checkIntervalMs: number;
  /** Probability of starting an event on each roll. */
  baseChance: number;
  /** No event can start until this much active time has passed. */
  minFirstEventMs: number;
  /** Min active-play ms between event starts. */
  minCooldownMs: number;
  /** Max events per run (rarity cap). */
  maxEventsPerRun: number;
}

export function getEventRules(mode: GameModeId): EventRules {
  const pool = MODE_EVENT_POOL[mode];
  return { enabled: pool.length > 0, pool, ...BASE_TRIGGER };
}

export interface EventState {
  /** Id of the active event, or null. */
  activeEventId: EventId | null;
  /** Active-play ms when the active event expires (0 = none). */
  eventUntil: number;
  /** Active-play ms of the last started event (0 = never). */
  lastEventAt: number;
  /** Number of events started this run. */
  triggered: number;
}

export function createEventState(): EventState {
  return { activeEventId: null, eventUntil: 0, lastEventAt: 0, triggered: 0 };
}

export interface EventRollResult {
  next: EventState;
  started: EventId | null;
}

function pickEvent(pool: EventId[], rng: Rng): EventId {
  const total = pool.reduce((sum, id) => sum + EVENT_DEFINITIONS[id].weight, 0);
  let roll = rng() * total;
  for (const id of pool) {
    roll -= EVENT_DEFINITIONS[id].weight;
    if (roll < 0) return id;
  }
  return pool[pool.length - 1];
}

export function rollEvent(state: EventState, rules: EventRules, now: number, rng: Rng = Math.random): EventRollResult {
  if (!rules.enabled || rules.pool.length === 0) return { next: state, started: null };
  if (state.activeEventId !== null) return { next: state, started: null };
  if (state.triggered >= rules.maxEventsPerRun) return { next: state, started: null };
  if (now < rules.minFirstEventMs) return { next: state, started: null };
  if (state.lastEventAt > 0 && now - state.lastEventAt < rules.minCooldownMs) return { next: state, started: null };
  if (rng() >= rules.baseChance) return { next: state, started: null };
  const id = pickEvent(rules.pool, rng);
  const def = EVENT_DEFINITIONS[id];
  return {
    next: { activeEventId: id, eventUntil: now + def.durationMs, lastEventAt: now, triggered: state.triggered + 1 },
    started: id,
  };
}

export interface ResolvedEvent {
  state: EventState;
  active: EventId | null;
}

export function resolveEvent(state: EventState, now: number): ResolvedEvent {
  if (state.activeEventId !== null && state.eventUntil > now) {
    return { state, active: state.activeEventId };
  }
  if (state.activeEventId !== null) {
    return { state: { ...state, activeEventId: null, eventUntil: 0 }, active: null };
  }
  return { state, active: null };
}

export function foodRulesDuringEvent(base: FoodRules, event: EventEffects | null): FoodRules {
  if (!event || (event.foodSpecialWeightMultiplier === 1 && event.goldenWeightBoost === 0)) return base;
  const specs = { ...base.specs };
  if (event.goldenWeightBoost !== 0) {
    specs.golden = { ...specs.golden, weight: specs.golden.weight + event.goldenWeightBoost };
  }
  return { ...base, specialWeight: base.specialWeight * event.foodSpecialWeightMultiplier, specs };
}

export function eventScoreMultiplier(event: EventEffects | null): number {
  return event ? event.scoreMultiplier : 1;
}

export function eventMoveDelay(baseDelay: number, event: EventEffects | null, minMoveDelay: number): number {
  if (!event || event.speedFactor <= 1) return baseDelay;
  return Math.max(minMoveDelay, Math.round(baseDelay / event.speedFactor));
}

export function eventWrapOverride(event: EventEffects | null, defaultWrap: boolean): boolean {
  return event && event.wrap ? true : defaultWrap;
}

export function isEventId(value: string): value is EventId {
  return value === 'gold-rush' || value === 'blood-moon' || value === 'safe-zone';
}