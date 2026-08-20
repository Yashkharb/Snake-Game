/**
 * Cosmetic unlock system (Session 7).
 *
 * Pure, data-driven cosmetic definitions. Unlock conditions are declarative and
 * evaluated against the player profile + daily stats. All functions are pure so
 * they are unit-testable; the runtime (game.ts) applies unlocks and persists
 * through storage.ts — this module never touches localStorage directly.
 *
 * Cosmetics never provide gameplay advantages. They are visual only.
 */
import type { GameModeId } from './modes.ts';
import type { PlayerProfile } from './progression.ts';
import type { DailyStats } from './achievements.ts';

export type CosmeticCategory = 'snake' | 'food' | 'trail' | 'board';

export interface CosmeticConditionKind {
  /** Lifetime total score across all modes. */
  'score-total': { value: number };
  /** Best score in a specific mode. */
  'mode-best': { mode: GameModeId; value: number };
  /** Player rank index (0 = Hatchling, 4 = Apex). */
  'rank': { value: number };
  /** Specific achievement unlocked. */
  'achievement': { id: string };
  /** Specific mission completed. */
  'mission': { id: string };
  /** Total fruit eaten lifetime. */
  'fruit-total': { value: number };
  /** Highest level reached. */
  'level-best': { value: number };
  /** Longest snake length reached. */
  'length-best': { value: number };
  /** Daily Challenge streak. */
  'daily-streak': { value: number };
  /** Daily Challenges completed total. */
  'daily-completed': { value: number };
  /** Full Daily clear (60 fruits). */
  'daily-cleared': {};
  /** XP total. */
  'xp-total': { value: number };
}

export type CosmeticCondition =
  | { kind: 'score-total'; value: number }
  | { kind: 'mode-best'; mode: GameModeId; value: number }
  | { kind: 'rank'; value: number }
  | { kind: 'achievement'; id: string }
  | { kind: 'mission'; id: string }
  | { kind: 'fruit-total'; value: number }
  | { kind: 'level-best'; value: number }
  | { kind: 'length-best'; value: number }
  | { kind: 'daily-streak'; value: number }
  | { kind: 'daily-completed'; value: number }
  | { kind: 'daily-cleared' }
  | { kind: 'xp-total'; value: number };

export interface CosmeticDefinition {
  id: string;
  category: CosmeticCategory;
  name: string;
  description: string;
  /** CSS/rendering key used by the engine. */
  renderKey: string;
  /** Unlock condition — when satisfied and not already owned, the cosmetic unlocks. */
  condition: CosmeticCondition;
  /** Whether this cosmetic is available by default (no unlock needed). */
  default?: boolean;
  /** Preview metadata for the customize UI. */
  preview?: {
    /** For snake: primary color. For food: color. For trail: color. For board: background hint. */
    color?: string;
    /** Secondary accent color. */
    accent?: string;
    /** Whether the preview should animate (respects reduced-motion). */
    animated?: boolean;
  };
}

/** All cosmetic definitions — the single source of truth. */
export const COSMETICS: readonly CosmeticDefinition[] = [
  // ==================== SNAKE SKINS ====================
  {
    id: 'snake-classic',
    category: 'snake',
    name: 'Classic',
    description: 'The original white snake.',
    renderKey: 'classic',
    condition: { kind: 'score-total', value: 0 },
    default: true,
    preview: { color: '#ffffff', accent: '#ff7a17' },
  },
  {
    id: 'snake-neon',
    category: 'snake',
    name: 'Neon',
    description: 'Electric cyan glow.',
    renderKey: 'neon',
    condition: { kind: 'achievement', id: 'first-bite' },
    preview: { color: '#00ffff', accent: '#ff00ff', animated: true },
  },
  {
    id: 'snake-cyber',
    category: 'snake',
    name: 'Cyber',
    description: 'Circuit-board pattern.',
    renderKey: 'cyber',
    condition: { kind: 'mode-best', mode: 'classic', value: 100 },
    preview: { color: '#00ff88', accent: '#ff0066', animated: true },
  },
  {
    id: 'snake-inferno',
    category: 'snake',
    name: 'Inferno',
    description: 'Burning gradient from ember to flame.',
    renderKey: 'inferno',
    condition: { kind: 'achievement', id: 'no-fear' },
    preview: { color: '#ff4500', accent: '#ffd700', animated: true },
  },
  {
    id: 'snake-ice',
    category: 'snake',
    name: 'Ice',
    description: 'Crystalline blue with frost shimmer.',
    renderKey: 'ice',
    condition: { kind: 'mode-best', mode: 'zen', value: 100 },
    preview: { color: '#7dd3fc', accent: '#e0f2fe', animated: true },
  },
  {
    id: 'snake-void',
    category: 'snake',
    name: 'Void',
    description: 'Deep darkness with subtle starlight.',
    renderKey: 'void',
    condition: { kind: 'achievement', id: 'snake-god' },
    preview: { color: '#1a1a2e', accent: '#c4b5fd', animated: true },
  },
  {
    id: 'snake-gold',
    category: 'snake',
    name: 'Gold',
    description: 'Solid gold prestige.',
    renderKey: 'gold',
    condition: { kind: 'rank', value: 4 },
    preview: { color: '#ffd700', accent: '#fff8dc', animated: false },
  },
  {
    id: 'snake-galaxy',
    category: 'snake',
    name: 'Galaxy',
    description: 'Swirling nebula colors.',
    renderKey: 'galaxy',
    condition: { kind: 'achievement', id: 'daily-7' },
    preview: { color: '#8b5cf6', accent: '#ec4899', animated: true },
  },

  // ==================== FOOD SKINS ====================
  {
    id: 'food-apple',
    category: 'food',
    name: 'Apple',
    description: 'Classic red apple.',
    renderKey: 'apple',
    condition: { kind: 'score-total', value: 0 },
    default: true,
    preview: { color: '#ef4444', accent: '#fecaca' },
  },
  {
    id: 'food-crystal',
    category: 'food',
    name: 'Crystal',
    description: 'Faceted gemstone.',
    renderKey: 'crystal',
    condition: { kind: 'fruit-total', value: 50 },
    preview: { color: '#a5f3fc', accent: '#67e8f9', animated: true },
  },
  {
    id: 'food-orb',
    category: 'food',
    name: 'Orb',
    description: 'Glowing energy sphere.',
    renderKey: 'orb',
    condition: { kind: 'achievement', id: 'perfect-turn' },
    preview: { color: '#c4b5fd', accent: '#e9d5ff', animated: true },
  },
  {
    id: 'food-star',
    category: 'food',
    name: 'Star',
    description: 'Five-pointed stellar fruit.',
    renderKey: 'star',
    condition: { kind: 'mode-best', mode: 'time-attack', value: 100 },
    preview: { color: '#fde047', accent: '#fef08a', animated: true },
  },
  {
    id: 'food-energy-core',
    category: 'food',
    name: 'Energy Core',
    description: 'Pulsing reactor heart.',
    renderKey: 'energy-core',
    condition: { kind: 'daily-cleared' },
    preview: { color: '#fb923c', accent: '#fed7aa', animated: true },
  },

  // ==================== TRAILS ====================
  {
    id: 'trail-none',
    category: 'trail',
    name: 'None',
    description: 'No trail effect.',
    renderKey: 'none',
    condition: { kind: 'score-total', value: 0 },
    default: true,
    preview: { color: 'transparent' },
  },
  {
    id: 'trail-glow',
    category: 'trail',
    name: 'Glow',
    description: 'Soft fading glow behind the snake.',
    renderKey: 'glow',
    condition: { kind: 'xp-total', value: 150 },
    preview: { color: '#ff7a17', accent: '#ffc285', animated: true },
  },
  {
    id: 'trail-particles',
    category: 'trail',
    name: 'Particles',
    description: 'Tiny sparkles in the wake.',
    renderKey: 'particles',
    condition: { kind: 'achievement', id: 'close-call' },
    preview: { color: '#c4b5fd', accent: '#e9d5ff', animated: true },
  },
  {
    id: 'trail-fire',
    category: 'trail',
    name: 'Fire',
    description: 'Ember trail that flickers.',
    renderKey: 'fire',
    condition: { kind: 'mode-best', mode: 'classic', value: 300 },
    preview: { color: '#ef4444', accent: '#fca5a5', animated: true },
  },
  {
    id: 'trail-lightning',
    category: 'trail',
    name: 'Lightning',
    description: 'Arcing electric bolts.',
    renderKey: 'lightning',
    condition: { kind: 'achievement', id: 'speed-demon' },
    preview: { color: '#00ffff', accent: '#7dd3fc', animated: true },
  },
  {
    id: 'trail-rainbow',
    category: 'trail',
    name: 'Rainbow',
    description: 'Prismatic color shift.',
    renderKey: 'rainbow',
    condition: { kind: 'achievement', id: 'daily-solver' },
    preview: { color: '#ec4899', accent: '#8b5cf6', animated: true },
  },

  // ==================== BOARD THEMES ====================
  {
    id: 'board-midnight',
    category: 'board',
    name: 'Midnight',
    description: 'Deep blue-black with subtle grid.',
    renderKey: 'midnight',
    condition: { kind: 'score-total', value: 0 },
    default: true,
    preview: { color: '#0a0a12', accent: '#1a1a2e' },
  },
  {
    id: 'board-arcade',
    category: 'board',
    name: 'Arcade',
    description: 'Retro green phosphor aesthetic.',
    renderKey: 'arcade',
    condition: { kind: 'achievement', id: 'getting-long' },
    preview: { color: '#0d1a0d', accent: '#39ff14' },
  },
  {
    id: 'board-matrix',
    category: 'board',
    name: 'Matrix',
    description: 'Falling code rain background.',
    renderKey: 'matrix',
    condition: { kind: 'mode-best', mode: 'classic', value: 200 },
    preview: { color: '#000000', accent: '#00ff41', animated: true },
  },
  {
    id: 'board-sunset',
    category: 'board',
    name: 'Sunset',
    description: 'Warm dusk gradient horizon.',
    renderKey: 'sunset',
    condition: { kind: 'rank', value: 2 },
    preview: { color: '#1a0a0a', accent: '#ff7a17', animated: true },
  },
  {
    id: 'board-void',
    category: 'board',
    name: 'Void',
    description: 'Pure black with distant stars.',
    renderKey: 'void',
    condition: { kind: 'achievement', id: 'marathon' },
    preview: { color: '#000000', accent: '#ffffff', animated: true },
  },
  {
    id: 'board-grid',
    category: 'board',
    name: 'Grid',
    description: 'Clean technical grid lines.',
    renderKey: 'grid',
    condition: { kind: 'xp-total', value: 400 },
    preview: { color: '#0f0f0f', accent: '#333333', animated: false },
  },
];

export function getCosmetic(id: string): CosmeticDefinition | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export function getCosmeticsByCategory(category: CosmeticCategory): CosmeticDefinition[] {
  return COSMETICS.filter((c) => c.category === category);
}

export function getDefaultCosmetic(category: CosmeticCategory): CosmeticDefinition | undefined {
  return COSMETICS.find((c) => c.category === category && c.default);
}

const MODE_BEST_FIELD: Record<GameModeId, 'classicBest' | 'timeAttackBest' | 'zenBest' | 'dailyBest'> = {
  classic: 'classicBest',
  'time-attack': 'timeAttackBest',
  zen: 'zenBest',
  daily: 'dailyBest',
};

function conditionSatisfied(condition: CosmeticCondition, profile: PlayerProfile, daily: DailyStats): boolean {
  switch (condition.kind) {
    case 'score-total':
      return profile.totalScore >= condition.value;
    case 'mode-best':
      return profile[MODE_BEST_FIELD[condition.mode]] >= condition.value;
    case 'rank':
      // rank index: 0=Hatchling, 1=Coil, 2=Fang, 3=Predator, 4=Apex
      const xp = profile.xp;
      let rankIndex = 0;
      if (xp >= 2000) rankIndex = 4;
      else if (xp >= 900) rankIndex = 3;
      else if (xp >= 400) rankIndex = 2;
      else if (xp >= 150) rankIndex = 1;
      return rankIndex >= condition.value;
    case 'achievement':
      return profile.unlockedAchievements.includes(condition.id);
    case 'mission':
      return profile.completedMissions.includes(condition.id);
    case 'fruit-total':
      return profile.totalFruit >= condition.value;
    case 'level-best':
      return profile.highestLevel >= condition.value;
    case 'length-best':
      return profile.longestSnake >= condition.value;
    case 'daily-streak':
      return daily.streak >= condition.value;
    case 'daily-completed':
      return daily.completedCount >= condition.value;
    case 'daily-cleared':
      return profile.dailyCleared === true;
    case 'xp-total':
      return profile.xp >= condition.value;
  }
}

/**
 * Returns all cosmetics whose condition is satisfied and that are not yet in
 * `profile.unlockedCosmetics`. Already-unlocked ids are never re-returned.
 * Pure.
 */
export function evaluateCosmetics(profile: PlayerProfile, daily: DailyStats): CosmeticDefinition[] {
  return COSMETICS.filter(
    (c) => !profile.unlockedCosmetics.includes(c.id) && conditionSatisfied(c.condition, profile, daily),
  );
}

/** Unlock a cosmetic by adding it to the profile. Idempotent. Pure. */
export function unlockCosmetic(profile: PlayerProfile, cosmeticId: string): PlayerProfile {
  if (profile.unlockedCosmetics.includes(cosmeticId)) return profile;
  const cosmetic = getCosmetic(cosmeticId);
  if (!cosmetic) return profile;
  return {
    ...profile,
    unlockedCosmetics: [...profile.unlockedCosmetics, cosmeticId],
  };
}

/** Unlock all newly-available cosmetics for the current profile. Pure. */
export function unlockAvailableCosmetics(profile: PlayerProfile, daily: DailyStats): PlayerProfile {
  const newlyAvailable = evaluateCosmetics(profile, daily);
  if (newlyAvailable.length === 0) return profile;
  return {
    ...profile,
    unlockedCosmetics: [...profile.unlockedCosmetics, ...newlyAvailable.map((c) => c.id)],
  };
}

export interface EquippedCosmetics {
  snake: string;
  food: string;
  trail: string;
  board: string;
}

export const DEFAULT_EQUIPPED: EquippedCosmetics = {
  snake: 'snake-classic',
  food: 'food-apple',
  trail: 'trail-none',
  board: 'board-midnight',
};

/** Validate and normalize equipped cosmetics (fallback to defaults if missing/invalid). */
export function sanitizeEquipped(raw: unknown, profile: PlayerProfile): EquippedCosmetics {
  const defaults = DEFAULT_EQUIPPED;
  if (typeof raw !== 'object' || raw === null) return defaults;
  const r = raw as Record<string, unknown>;
  const pick = (key: CosmeticCategory, defaultId: string): string => {
    const value = r[key];
    if (typeof value !== 'string') return defaultId;
    const cosmetic = getCosmetic(value);
    if (!cosmetic || cosmetic.category !== key) return defaultId;
    if (!profile.unlockedCosmetics.includes(value)) return defaultId;
    return value;
  };
  return {
    snake: pick('snake', defaults.snake),
    food: pick('food', defaults.food),
    trail: pick('trail', defaults.trail),
    board: pick('board', defaults.board),
  };
}

/** Equip a cosmetic (validates ownership and category). Pure. */
export function equipCosmetic(profile: PlayerProfile, equipped: EquippedCosmetics, cosmeticId: string): EquippedCosmetics {
  const cosmetic = getCosmetic(cosmeticId);
  if (!cosmetic) return equipped;
  if (!profile.unlockedCosmetics.includes(cosmeticId)) return equipped;
  return { ...equipped, [cosmetic.category]: cosmeticId };
}