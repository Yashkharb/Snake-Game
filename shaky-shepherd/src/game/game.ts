import {
  buildShareMessage,
  CELLS,
  createInitialSnake,
  createInitialState,
  formatCountdown,
  formatDuration,
  getLevel,
  getMoveDelay,
  queueDirection,
  startRun,
  step as stepGame,
  togglePause as togglePauseGame,
} from './core.ts';
import type { GameState, Vec, Cell, DeathReason } from './core.ts';
import { DEFAULT_MODE_ID, getMode, getDailyMode, isGameModeId } from './modes.ts';
import type { GameMode, GameModeId } from './modes.ts';
import {
  buildDailyShareMessage,
  dailyDateKey,
  dailyFoodFor,
  DAILY_FOOD_COUNT,
  formatDailyDate,
  generateDailyChallenge,
  getDailyParamsForDate,
} from './daily.ts';
import type { DailyChallenge } from './daily.ts';
import { advanceLastMove, interpolationAlpha, isMoveDue } from './timing.ts';
import { trackEvent } from '../lib/analytics.ts';
import type { AnalyticsParams } from '../lib/analytics.ts';
import {
  readPreference,
  readStoredDailyStatus,
  recordDailyResult,
  readStoredDailyHistory,
  computeDailyStreak,
  readStoredNumber,
  writePreference,
  writeStoredNumber,
} from './storage.ts';
import {
  loadProfile,
  rankProgress,
  recordAchievementUnlock,
  recordFruit,
  recordLevelUp,
  recordMissionComplete,
  recordRunEnd,
  recordScoreBonus,
  saveProfile,
  unlockCosmetic,
  updateGhostIfNewBest,
} from './progression.ts';
import type { PlayerProfile, RankProgress, EquippedCosmetics } from './progression.ts';
import {
  getCosmetic,
  evaluateCosmetics,
} from './cosmetics.ts';
import {
  loadWeeklyGoals,
  applyWeeklyGoalEvents,
  replaceCompletedWeeklyGoals,
  saveWeeklyGoals,
  type WeeklyGoalEvent,
  type WeeklyGoalsSaveData,
} from './weekly.ts';
import { STREAK_REWARDS, claimAllAvailableStreakRewards } from './streaks.ts';
import {
  recordGhostSnapshot,
  getGhost,
  hasValidGhost,
  getGhostSnakeAtTime,
  toggleGhostEnabled,
  type GhostData,
  type GhostSnapshot,
} from './ghost.ts';
import {
  encodeChallenge,
  decodeChallenge,
  createChallengeFromRun,
  buildChallengeShareMessage,
  getChallengeFromUrl,
  hasActiveChallenge,
  clearChallengeFromUrl,
  getChallengeModeName,
  getChallengerName,
  type ChallengeData,
} from './challenge.ts';
import {
  createComboState,
  expireCombo,
  getComboConfig,
  scoreCloseCall,
  scoreFruit,
} from './combo.ts';
import type { CloseCallResult, ComboConfig, ComboState, FruitScoreResult } from './combo.ts';
import {
  applyFoodEffect,
  createFoodEffects,
  effectiveMoveDelay,
  getFoodRules,
  pointsForFood,
  resolveEffects,
  rollPlacedFood,
} from './food.ts';
import type { FoodEffects, FoodRules, FoodType, PlacedFood } from './food.ts';
import {
  createEventState,
  EVENT_DEFINITIONS,
  eventMoveDelay,
  eventScoreMultiplier,
  eventWrapOverride,
  foodRulesDuringEvent,
  getEventRules,
  isEventId,
  resolveEvent,
  rollEvent,
} from './events.ts';
import type { EventEffects, EventRules, EventState, EventId } from './events.ts';
import {
  applyMissionEvents,
  loadMissions,
  replaceCompletedMissions,
  saveMissions,
} from './missions.ts';
import type { MissionEvent, MissionState, MissionsSaveData } from './missions.ts';
import {
  computeDailyStats,
  evaluateAchievements,
  isCloseCall,
  isHomecoming,
  isPerfectTurn,
} from './achievements.ts';

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  tone: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
  hue: number;
}

const SIZE = 800;
const CELL = SIZE / CELLS;

const MAX_PARTICLES = 120;
const MAX_RIPPLES = 8;

const DIRECTIONS: Record<string, Vec> = {
  ArrowUp: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  W: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  S: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
  A: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
  D: { x: 1, y: 0 },
};

const TOUCH_DIRECTIONS: Record<string, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const SPEED_LABELS = ['FLOW', 'PULSE', 'SURGE', 'HYPER', 'NOVA', 'LUDICROUS'];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing required element #${id}`);
  return el as T;
}

function reportFatalError(error: unknown) {
  console.error('[serpent]', error);
  const banner = document.querySelector('.fatal-error') || document.createElement('p');
  banner.className = 'fatal-error';
  banner.setAttribute('role', 'alert');
  banner.textContent = `Snake Game could not run: ${error instanceof Error ? error.message : String(error)}`;
  document.body.append(banner);
}

const canvas = requireElement<HTMLCanvasElement>('game-board');
const context = canvas.getContext('2d');
if (!context) throw new Error('this browser did not provide a 2D canvas context');
const ctx: CanvasRenderingContext2D = context;

const scoreEl = requireElement('score');
const highScoreEl = requireElement('high-score');
const levelEl = requireElement('level');
const speedNameEl = requireElement('speed-name');
const speedMeter = requireElement<HTMLElement>('speed-meter');
const scoreDetail = requireElement('score-detail');
const speedLabelEl = requireElement('speed-label');
const startOverlay = requireElement('start-overlay');
const pauseOverlay = requireElement('pause-overlay');
const gameoverOverlay = requireElement('gameover-overlay');
const gameoverKicker = requireElement('gameover-kicker');
const gameoverTitle = requireElement('gameover-title');
const finalScoreEl = requireElement('final-score');
const finalBestEl = requireElement('final-best');
const finalLevelEl = requireElement('final-level');
const finalLengthEl = requireElement('final-length');
const finalLongestEl = requireElement('final-longest');
const finalRecordEl = requireElement('final-record');
const finalFruitEl = requireElement('final-fruit');
const finalDurationEl = requireElement('final-duration');
const newBestBadge = requireElement('new-best-badge');
const shareButton = requireElement<HTMLButtonElement>('share-button');
const pauseButton = requireElement<HTMLButtonElement>('pause-button');
const soundButton = requireElement<HTMLButtonElement>('sound-button');
const soundButtonLabel = requireElement('sound-button-label');
const statusAnnouncer = requireElement('status-announcer');
const resumeButton = requireElement<HTMLButtonElement>('resume-button');
const modePicker = requireElement('mode-picker');
const modeBadge = requireElement('mode-badge');
const startModeNote = requireElement('start-mode-note');
const startKicker = requireElement('start-kicker');
const startTitle = requireElement('start-title');
const startButtonLabel = requireElement('start-button-label');
const startModeInfo = requireElement('start-mode-info');
const playerRankEl = requireElement('player-rank');
const missionsPanel = requireElement('missions-panel');
const missionsList = requireElement('missions-list');
const missionToast = requireElement('mission-toast');
const achievementToast = requireElement('achievement-toast');
const scorePopups = requireElement('score-popups');
const eventBanner = requireElement('event-banner');
const gameStage = requireElement('game-stage');
const dailyDateEl = requireElement('daily-date');
const dailyBestEl = requireElement('daily-best');
const dailyStreakEl = requireElement('daily-streak');
const dailyChallengeInfo = requireElement('daily-challenge-info');
const dailyModifierEl = requireElement('daily-modifier');
const dailyProgressFill = requireElement('daily-progress-fill');
const dailyProgressText = requireElement('daily-progress-text');
const dailyBestValue = requireElement('daily-best-value');
const dailyYourBest = requireElement('daily-your-best');
const dailyStreakValue = requireElement('daily-streak-value');
const streakRewardsList = requireElement('streak-rewards-list');
const weeklyGoalsList = requireElement('weekly-goals-list');
const streakRewardsEl = requireElement('streak-rewards');
const ghostToggleEl = requireElement('ghost-toggle');
const ghostToggleInput = requireElement<HTMLInputElement>('ghost-toggle-input');
const challengeSection = requireElement('challenge-section');
const challengeTitle = requireElement('challenge-title');
const challengeTarget = requireElement('challenge-target');
const challengeResult = requireElement('challenge-result');
const challengeShareButton = requireElement<HTMLButtonElement>('challenge-share-button');
const copyButton = requireElement<HTMLButtonElement>('copy-button');
const finalXpEarned = requireElement('final-xp-earned');
const finalMissionsCompleted = requireElement('final-missions-completed');
const finalAchievementsUnlocked = requireElement('final-achievements-unlocked');
const nextGoal = requireElement('next-goal');
const nextGoalText = requireElement('next-goal-text');
const copyButtonLabel = requireElement('copy-button-label');
const shareButtonLabel = requireElement('share-button-label');
const fullscreenButton = requireElement<HTMLButtonElement>('fullscreen-button');
const fullscreenButtonLabel = requireElement('fullscreen-button-label');
const startFullscreenButton = requireElement<HTMLButtonElement>('start-fullscreen-button');
const fsPauseButton = requireElement<HTMLButtonElement>('fs-pause');
const fsPauseLabel = requireElement('fs-pause-label');
const fsSoundButton = requireElement<HTMLButtonElement>('fs-sound');
const fsSoundLabel = requireElement('fs-sound-label');
const fsExitButton = requireElement<HTMLButtonElement>('fs-exit');

// Crisp rendering on high-density displays while keeping 800×800 logical units.
const dpr = /Mobi|Android/i.test(navigator.userAgent) ? 1 : Math.min(window.devicePixelRatio || 1, 2);
canvas.width = Math.round(SIZE * dpr);
canvas.height = Math.round(SIZE * dpr);
ctx.scale(dpr, dpr);

let game: GameState;
let prevSnake: Cell[] = [];
let lastMove = 0;
let animationFrame = 0;
let particles: Particle[] = [];
let ripples: Ripple[] = [];
let stars: Star[] = [];
let highScore = 0;
let bestLength = 0;
let audioCtx: AudioContext | null = null;
let audioDisabled = false;
let muted = readPreference('audio', 'on') === 'off';

function setMuted(next: boolean) {
  muted = next;
  writePreference('audio', muted ? 'off' : 'on');
  soundButton.setAttribute('aria-pressed', String(muted));
  soundButtonLabel.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  fsSoundButton.setAttribute('aria-pressed', String(muted));
  fsSoundLabel.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  announce(muted ? 'Sound muted' : 'Sound on');
}

function toggleSound() {
  setMuted(!muted);
}

// Fullscreen / immersive play. Where the Fullscreen API exists (desktop,
// Android Chrome, Safari on macOS) the whole document goes truly fullscreen.
// On platforms without it (iOS Safari does not let arbitrary elements go
// fullscreen) we still toggle body.is-fullscreen, which the global stylesheet
// turns into a full-viewport immersive layout — the game gets maximum priority
// either way. One code path, two mechanisms.
function isFullscreenActive() {
  return document.body.classList.contains('is-fullscreen');
}

function applyFullscreenUI(active: boolean) {
  document.body.classList.toggle('is-fullscreen', active);
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButtonLabel.textContent = active ? 'EXIT' : 'FULLSCREEN';
  fsSoundButton.setAttribute('aria-pressed', String(muted));
}

function enterFullscreen() {
  applyFullscreenUI(true);
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (request) {
    try {
      const result = request.call(el);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          // The API rejected; the immersive CSS class already covers the user.
        });
      }
    } catch {
      // Immersive class is already applied as the fallback.
    }
  }
}

function exitFullscreen() {
  applyFullscreenUI(false);
  const doc = document as Document & { webkitExitFullscreen?: () => void };
  const request = document.exitFullscreen ?? doc.webkitExitFullscreen;
  if (request) {
    try {
      request.call(document);
    } catch {
      // Immersive class is already removed.
    }
  }
}

function toggleFullscreen() {
  if (isFullscreenActive()) exitFullscreen();
  else enterFullscreen();
}

function wireFullscreen() {
  const syncFromEvent = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    applyFullscreenUI(Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement));
  };
  document.addEventListener('fullscreenchange', syncFromEvent);
  document.addEventListener('webkitfullscreenchange', syncFromEvent);
  fullscreenButton.addEventListener('click', toggleFullscreen);
  startFullscreenButton.addEventListener('click', toggleFullscreen);
  fsExitButton.addEventListener('click', exitFullscreen);
  fsPauseButton.addEventListener('click', togglePause);
  fsSoundButton.addEventListener('click', toggleSound);
}
let backgroundCache: OffscreenCanvas | null = null;
let levelUpFlash = 0;
let runStart = 0;
let activeRunMs = 0;
let maxLength = 0;
let isNewBest = false;
let lastRunMs = 0;
let activeMode: GameMode = getMode(readStoredModeId());
let dailyChallenge: DailyChallenge | null = null;
let dailyFoodIndex = 0;
let todayKey = dailyDateKey();
let lastShareText = '';

// Combo & mastery scoring (Session 4). Pure state + config; the runtime only
// feeds eat/close-call events and renders the resulting feedback.
let comboConfig: ComboConfig = getComboConfig(activeMode.id, activeMode.scoring.pointsPerFruit);
let comboState: ComboState = createComboState();
let runFruitCount = 0;

// Special food (Session 5). Pure rules + effect state; the runtime only rolls
// placements, feeds eat events, and reads the resolved effects for scoring,
// speed and the Time Attack clock.
let foodRules: FoodRules = getFoodRules(activeMode.id);
let foodEffects: FoodEffects = createFoodEffects();
// Cross-move effect tracking: which speed effect / multiplier was active at the
// last poll, so an effect that expires *between* moves is still reported.
let prevActiveSpeed: 'slow' | 'fast' | null = null;
let prevMultiplierActive = false;

// Dynamic in-run events (Session 6). Pure rules + state; the runtime rolls
// triggers on a throttle, resolves expiry, and applies effects to food, speed,
// scoring and wrap. Events are disabled in Zen (relaxed) and Daily (deterministic).
let eventRules: EventRules = getEventRules(activeMode.id);
let eventState: EventState = createEventState();
let lastEventCheck = 0;
let lastEventBannerSecond = -1;

// Persistent player progression (Session 1). Loaded once at boot; every XP
// event updates it in place and persists through storage.ts.
let profile: PlayerProfile = loadProfile();
let rankProgressUI: RankProgress = rankProgress(profile.xp);

// Equipped cosmetics (Session 7) — loaded from profile, applied to rendering.
let equippedCosmetics: EquippedCosmetics = profile.equippedCosmetics;

// Persistent missions (Session 2). Loaded once at boot; any missions completed
// in a previous session are silently replaced so the player always has ~3.
let missionSave: MissionsSaveData = loadMissions(profile);

// Weekly goals (Session 9) — loaded once at boot, refreshed on week boundary.
let weeklyGoalsSave: WeeklyGoalsSaveData = loadWeeklyGoals(profile);

// Personal ghost (Session 10) — loaded from profile, used for rendering.
let ghostData: GhostData = getGhost(profile, activeMode.id);
let ghostSnapshots: GhostSnapshot[] = ghostData.snapshots ?? [];

// Friend challenges (Session 11) — loaded from URL hash on boot.
let activeChallenge: ChallengeData | null = getChallengeFromUrl();
let challengeModeMatch: boolean = activeChallenge ? activeChallenge.mode === activeMode.id : false;

let pausedThisRun = false;
let missionToastTimer = 0;
let achievementToastTimer = 0;
/** The cell the current run started from — homecoming target (Session 3). */
let runStartHead: Cell = { x: 10, y: 12 };

const DIFF_LABELS: Record<MissionState['difficulty'], string> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
  master: 'MASTER',
};

highScore = readStoredNumber(activeMode.bestKey, 0);
bestLength = readStoredNumber(activeMode.bestLengthKey, 0);
highScoreEl.textContent = String(highScore).padStart(3, '0');

function readStoredModeId(): GameModeId {
  const stored = readPreference('mode', DEFAULT_MODE_ID);
  return isGameModeId(stored) ? stored : DEFAULT_MODE_ID;
}

function isRunning() {
  return game.status === 'running';
}

function isPaused() {
  return game.status === 'paused';
}

function isOver() {
  return game.status === 'gameover' || game.status === 'cleared';
}

function isActive() {
  return game.status === 'running' || game.status === 'paused';
}

// Announce discrete state changes for assistive tech without live-updating the
// score on every tick (which would be noisy). Re-clearing forces a re-read when
// the same state recurs (e.g. pause → pause).
function announce(message: string) {
  statusAnnouncer.textContent = '';
  window.setTimeout(() => {
    statusAnnouncer.textContent = message;
  }, 0);
}

// Active play time for the current run, excluding pauses (frozen while paused).
function currentRunMs(): number {
  return activeRunMs + (runStart ? performance.now() - runStart : 0);
}

// Mode-selection UI + persistent mode indicator. The board badge and the start
// overlay note are always kept in sync with the active mode.
function refreshModeUI() {
  modeBadge.textContent = activeMode.shortName;
  startModeNote.textContent = activeMode.description;
  refreshDailyUI();
  updatePickerState();
  refreshModeInfo();
  refreshProfileUI();
}

// Player progression line on the start screen: current rank, XP total, and the
// next rank's threshold when one exists.
function refreshProfileUI() {
  rankProgressUI = rankProgress(profile.xp);
  const xpLine =
    rankProgressUI.next === null
      ? `${profile.xp} XP`
      : `${profile.xp} / ${rankProgressUI.next.minXp} XP`;
  playerRankEl.textContent = `RANK ${String(rankProgressUI.index + 1).padStart(2, '0')} · ${rankProgressUI.rank.name.toUpperCase()} · ${xpLine}`;
}

// Compact mission list on the start screen: difficulty tag, title, live
// progress and a bar that fills toward the target. Completed rows show DONE.
function refreshMissionsUI() {
  missionsList.textContent = '';
  missionsPanel.hidden = missionSave.active.length === 0;
  for (const mission of missionSave.active) {
    const row = document.createElement('div');
    row.className = `mission-row${mission.completed ? ' is-complete' : ''}`;
    row.setAttribute('role', 'listitem');
    const pct = mission.target > 0 ? Math.min(100, Math.round((mission.progress / mission.target) * 100)) : 0;
    const label = mission.completed
      ? 'DONE'
      : `${mission.progress}/${mission.target}`;
    row.innerHTML = `
      <span class="mission-tag diff-${mission.difficulty}">${DIFF_LABELS[mission.difficulty]}</span>
      <span class="mission-title">${mission.title}</span>
      <span class="mission-count">${label}</span>
      <span class="mission-bar"><span class="mission-bar-fill" style="width:${pct}%"></span></span>
    `;
    missionsList.append(row);
  }
}

// Weekly goals UI on the start screen: compact list with progress bars.
function refreshWeeklyGoalsUI() {
  const container = document.getElementById('weekly-goals-list');
  if (!container) return;
  container.textContent = '';
  const weeklyPanel = document.getElementById('weekly-goals-panel');
  if (weeklyPanel) {
    weeklyPanel.hidden = weeklyGoalsSave.active.length === 0;
  }
  for (const goal of weeklyGoalsSave.active) {
    const row = document.createElement('div');
    row.className = `mission-row${goal.completed ? ' is-complete' : ''}`;
    row.setAttribute('role', 'listitem');
    const pct = goal.target > 0 ? Math.min(100, Math.round((goal.progress / goal.target) * 100)) : 0;
    const label = goal.completed
      ? 'DONE'
      : `${goal.progress}/${goal.target}`;
    row.innerHTML = `
      <span class="mission-tag weekly-tag">${goal.type.toUpperCase()}</span>
      <span class="mission-title">${goal.title}</span>
      <span class="mission-count">${label}</span>
      <span class="mission-bar"><span class="mission-bar-fill" style="width:${pct}%"></span></span>
    `;
    container.append(row);
  }
}

// Transient, non-blocking visual confirmation of a mission completion on the
// board. Screen readers get the same message through the status announcer.
function showMissionToast(text: string) {
  missionToast.textContent = text;
  missionToast.hidden = false;
  window.setTimeout(() => missionToast.classList.add('is-visible'), 0);
  window.clearTimeout(missionToastTimer);
  missionToastTimer = window.setTimeout(() => {
    missionToast.classList.remove('is-visible');
    window.setTimeout(() => {
      missionToast.hidden = true;
    }, 300);
  }, reducedMotion ? 1400 : 2800);
}

// A second transient toast for achievement unlocks, offset from the mission
// toast so the two never collide when a run finishes several goals at once.
// Equally restrained and non-blocking; screen readers get the announce() text.
function showAchievementToast(text: string) {
  achievementToast.textContent = text;
  achievementToast.hidden = false;
  window.setTimeout(() => achievementToast.classList.add('is-visible'), 0);
  window.clearTimeout(achievementToastTimer);
  achievementToastTimer = window.setTimeout(() => {
    achievementToast.classList.remove('is-visible');
    window.setTimeout(() => {
      achievementToast.hidden = true;
    }, 300);
  }, reducedMotion ? 1800 : 3200);
}

// Dynamic in-run events (Session 6): banner management, start/end feedback.
function updateEventBanner() {
  if (eventState.activeEventId && !isOver()) {
    refreshEventBannerText();
  } else {
    hideEventBanner();
  }
}

function refreshEventBannerText(force = false) {
  const id = eventState.activeEventId;
  if (!id || isOver()) return;
  const second = Math.max(0, Math.ceil((eventState.eventUntil - currentRunMs()) / 1000));
  if (!force && second === lastEventBannerSecond) return;
  lastEventBannerSecond = second;
  eventBanner.textContent = `${EVENT_DEFINITIONS[id].label} \u00B7 ${second}s`;
}

function showEventBanner(id: EventId) {
  eventBanner.hidden = false;
  eventBanner.classList.add('is-visible');
  eventBanner.classList.add(`event-${id}`);
  refreshEventBannerText(true);
}

function hideEventBanner() {
  eventBanner.hidden = true;
  eventBanner.classList.remove('is-visible', 'event-gold-rush', 'event-blood-moon', 'event-safe-zone');
  lastEventBannerSecond = -1;
}

function clearEventUI() {
  hideEventBanner();
  gameStage.classList.remove('event-active', 'event-gold-rush', 'event-blood-moon', 'event-safe-zone');
}

function startEvent(id: EventId) {
  const def = EVENT_DEFINITIONS[id];
  showEventBanner(id);
  gameStage.classList.add('event-active', `event-${id}`);
  const seconds = Math.round(def.durationMs / 1000);
  announce(`${def.description} for ${seconds} seconds.`);
  switch (id) {
    case 'gold-rush':
      playTone(660, 0.08, 'triangle');
      window.setTimeout(() => playTone(880, 0.1, 'triangle'), 90);
      break;
    case 'blood-moon':
      playTone(150, 0.12, 'sawtooth');
      window.setTimeout(() => playTone(110, 0.16, 'sawtooth'), 110);
      break;
    case 'safe-zone':
      playTone(520, 0.08, 'sine');
      window.setTimeout(() => playTone(660, 0.1, 'sine'), 90);
      break;
  }
  trackEvent('event_start', eventParams({ event: id, event_duration_ms: def.durationMs }));
}

function endEvent(id: EventId) {
  hideEventBanner();
  gameStage.classList.remove('event-active', `event-${id}`);
  const label = EVENT_DEFINITIONS[id].label;
  announce(`${label} over.`);
  trackEvent('event_end', eventParams({ event: id }));
}

function activeEventEffects(): EventEffects | null {
  const id = eventState.activeEventId;
  return id ? EVENT_DEFINITIONS[id].effects : null;
}

// Floating score feedback over the board (Session 4): a small, transient,
// non-blocking popup anchored to a board cell. Purely decorative — the score
// itself lives in the HUD; screen readers are not spammed per fruit.
function showScorePopup(
  cellX: number,
  cellY: number,
  value: string,
  tag: string | undefined,
  variant:
    | 'fruit'
    | 'combo'
    | 'risk'
    | 'lost'
    | 'golden'
    | 'slow'
    | 'multiplier'
    | 'cursed'
    | 'time'
    | 'effect',
) {
  const popup = document.createElement('span');
  popup.className = `score-popup score-popup--${variant}`;
  popup.style.left = `${((cellX + 0.5) / CELLS) * 100}%`;
  popup.style.top = `${((cellY + 0.5) / CELLS) * 100}%`;
  const valueEl = document.createElement('span');
  valueEl.className = 'score-popup-value';
  valueEl.textContent = value;
  popup.append(valueEl);
  if (tag) {
    const tagEl = document.createElement('span');
    tagEl.className = 'score-popup-tag';
    tagEl.textContent = tag;
    popup.append(tagEl);
  }
  scorePopups.append(popup);
  window.setTimeout(() => popup.remove(), reducedMotion ? 900 : 1100);
}

// Restrained, color-coded feedback for eating a special fruit: a transient
// popup naming the type and its value (combo already included), a tinted
// particle burst, a distinct tone, and an assistive announcement. Analytics
// record the type. All animations respect the global reduced-motion flag.
function specialFoodFeedback(type: FoodType, points: number, head: Cell) {
  const cx = (head.x + 0.5) * CELL;
  const cy = (head.y + 0.5) * CELL;
  switch (type) {
    case 'golden': {
      showScorePopup(head.x, head.y, `+${points}`, 'GOLDEN', 'golden');
      makeBurst(cx, cy, '#ffd700', 24);
      playTone(540, 0.08, 'triangle');
      announce('Golden fruit! Big points.');
      break;
    }
    case 'slow': {
      const seconds = Math.round(foodRules.specs.slow.durationMs / 1000);
      showScorePopup(head.x, head.y, `+${points}`, `SLOW ${seconds}s`, 'slow');
      makeBurst(cx, cy, '#7dd3fc', 16);
      playTone(300, 0.1, 'sine');
      announce(`Slow fruit. The snake slows down for ${seconds} seconds.`);
      break;
    }
    case 'multiplier': {
      const seconds = Math.round(foodRules.specs.multiplier.durationMs / 1000);
      showScorePopup(head.x, head.y, `+${points}`, `×${foodRules.multiplierFactor} · ${seconds}s`, 'multiplier');
      makeBurst(cx, cy, '#c4b5fd', 16);
      playTone(480, 0.09, 'sine');
      announce(`Multiplier fruit. Fruit points are doubled for ${seconds} seconds.`);
      break;
    }
    case 'cursed': {
      const seconds = Math.round(foodRules.specs.cursed.durationMs / 1000);
      showScorePopup(head.x, head.y, `+${points}`, 'CURSED · FAST', 'cursed');
      makeBurst(cx, cy, '#f87171', 20);
      playTone(180, 0.12, 'sawtooth');
      announce(`Cursed fruit. Big points, but the snake speeds up for ${seconds} seconds.`);
      break;
    }
    case 'time': {
      const seconds = Math.round(foodRules.timeBonusMs / 1000);
      showScorePopup(head.x, head.y, `+${points}`, `+${seconds}s`, 'time');
      makeBurst(cx, cy, '#5eead4', 16);
      playTone(520, 0.08, 'triangle');
      announce(`Time fruit. Plus ${seconds} seconds on the clock.`);
      break;
    }
    default:
      return;
  }
  trackEvent('special_food', eventParams({ food_type: type }));
}

// Grant every achievement whose condition the current profile now satisfies.
// Already-unlocked achievements are never re-evaluated (evaluateAchievements
// filters them), so each grants XP + a notification exactly once. `silent`
// suppresses the toast/announce for retroactive unlocks granted at boot.
function dispatchAchievements(silent = false) {
  const daily = computeDailyStats(readStoredDailyHistory(), dailyDateKey());
  const unlockedNow = evaluateAchievements(profile, daily);
  if (unlockedNow.length === 0) return;
  for (const achievement of unlockedNow) {
    profile = recordAchievementUnlock(profile, achievement.id, achievement.rewardXp);
    if (!silent) {
      announce(`Achievement unlocked: ${achievement.title}. +${achievement.rewardXp} XP.`);
      showAchievementToast(`ACHIEVEMENT UNLOCKED · ${achievement.title.toUpperCase()} · +${achievement.rewardXp} XP`);
      trackEvent('achievement_unlock', {
        achievement: achievement.id,
        category: achievement.category,
        tier: achievement.tier,
        reward_xp: achievement.rewardXp,
      });
    }
  }
  saveProfile(profile);
  refreshProfileUI();
}

// Feed game events into the mission engine. Missions that just completed are
// rewarded (XP + permanent log entry) and communicated exactly once; the
// completed slot itself is refilled later at run end / load, silently.
function dispatchMissionEvents(events: MissionEvent[]) {
  const { active, completed } = applyMissionEvents(missionSave.active, events);
  if (completed.length > 0) {
    for (const mission of completed) {
      profile = recordMissionComplete(profile, mission.id, mission.rewardXp);
      announce(`Mission complete: ${mission.title}. +${mission.rewardXp} XP.`);
      showMissionToast(`MISSION COMPLETE · ${mission.title.toUpperCase()} · +${mission.rewardXp} XP`);
      trackEvent('mission_complete', { mission: mission.id, difficulty: mission.difficulty, reward_xp: mission.rewardXp });
    }
    saveProfile(profile);
    refreshProfileUI();
  }
  missionSave = { ...missionSave, active };
  saveMissions(missionSave);
  refreshMissionsUI();
}

// Check for newly available cosmetics after any profile change. Pure evaluation,
// persists newly unlocked cosmetics, shows toast for each. `silent` suppresses
// toast/announce for retroactive unlocks at boot.
function dispatchCosmetics(silent = false) {
  const daily = computeDailyStats(readStoredDailyHistory(), dailyDateKey());
  const newlyAvailable = evaluateCosmetics(profile, daily);
  if (newlyAvailable.length === 0) return;
  for (const cosmetic of newlyAvailable) {
    profile = unlockCosmetic(profile, cosmetic.id);
    if (!silent) {
      announce(`Cosmetic unlocked: ${cosmetic.name}.`);
      showAchievementToast(`COSMETIC UNLOCKED · ${cosmetic.name.toUpperCase()}`);
      trackEvent('cosmetic_unlock', { cosmetic: cosmetic.id, category: cosmetic.category });
    }
  }
  saveProfile(profile);
  refreshProfileUI();
}

// Claim streak rewards for the current streak. Pure evaluation, persists rewards.
// `silent` suppresses toast/announce for retroactive claims at boot.
function dispatchStreakRewards(silent = false) {
  const history = readStoredDailyHistory();
  const streak = computeDailyStreak(history, dailyDateKey());
  const result = claimAllAvailableStreakRewards(profile, streak);
  if (result.rewards.length === 0) return;
  profile = result.profile;
  for (const reward of result.rewards) {
    if (!silent) {
      const parts: string[] = [];
      if (reward.xp > 0) parts.push(`+${reward.xp} XP`);
      if (reward.cosmeticId) {
        const cosmetic = getCosmetic(reward.cosmeticId);
        parts.push(cosmetic?.name ?? reward.cosmeticId);
      }
      announce(`Streak reward day ${reward.day}: ${parts.join(', ')}.`);
      showAchievementToast(`STREAK REWARD DAY ${reward.day} · ${parts.join(' · ')}`);
      trackEvent('streak_reward', { day: reward.day, xp: reward.xp, cosmetic: reward.cosmeticId ?? 'none' });
    }
  }
  saveProfile(profile);
  refreshProfileUI();
  refreshStreakRewardsUI();
}

// Weekly goals: apply events and handle completions.
function dispatchWeeklyGoals(events: WeeklyGoalEvent[]) {
  const { active, completed } = applyWeeklyGoalEvents(
    weeklyGoalsSave.active,
    events,
    profile,
    weeklyGoalsSave.weekKey
  );
  if (completed.length > 0) {
    for (const goal of completed) {
      profile = { ...profile, xp: profile.xp + goal.rewardXp };
      announce(`Weekly goal complete: ${goal.title}. +${goal.rewardXp} XP.`);
      showMissionToast(`WEEKLY GOAL · ${goal.title.toUpperCase()} · +${goal.rewardXp} XP`);
      trackEvent('weekly_goal_complete', { goal: goal.id, type: goal.type, reward_xp: goal.rewardXp });
    }
    saveProfile(profile);
    refreshProfileUI();
  }
  weeklyGoalsSave = { ...weeklyGoalsSave, active };
  saveWeeklyGoals(weeklyGoalsSave);
  refreshWeeklyGoalsUI();
}

// Replace completed weekly goals with fresh ones (silent refill).
function refillWeeklyGoals() {
  weeklyGoalsSave = replaceCompletedWeeklyGoals(weeklyGoalsSave, profile);
  saveWeeklyGoals(weeklyGoalsSave);
  refreshWeeklyGoalsUI();
}

// Streak rewards UI: shows claimed and available rewards for current streak.
function refreshStreakRewardsUI() {
  const history = readStoredDailyHistory();
  const streak = computeDailyStreak(history, dailyDateKey());
  const claimed = new Set(profile.streakRewardsClaimed ?? []);
  const rewards = STREAK_REWARDS.filter((r) => r.day <= streak + 3); // show current + next few
  streakRewardsList.textContent = '';
  const hasRewards = rewards.length > 0;
  streakRewardsEl.hidden = !hasRewards;
  for (const reward of rewards) {
    const isClaimed = claimed.has(reward.day);
    const isAvailable = reward.day <= streak && !isClaimed;
    const row = document.createElement('div');
    row.className = `streak-reward-row${isClaimed ? ' claimed' : ''}`;
    row.innerHTML = `
      <span class="streak-reward-day">DAY ${reward.day}</span>
      <span class="streak-reward-name">${reward.label}${reward.cosmeticId ? ` · ${getCosmetic(reward.cosmeticId)?.name ?? reward.cosmeticId}` : ''}</span>
      <span class="streak-reward-xp">${reward.xp > 0 ? `+${reward.xp} XP` : ''}${reward.cosmeticId ? (reward.xp > 0 ? ' · ' : '') : ''}${reward.cosmeticId ? 'COSMETIC' : ''}</span>
    `;
    if (isAvailable) {
      row.style.borderColor = 'rgba(253, 224, 71, 0.5)';
      row.style.background = 'rgba(253, 224, 71, 0.05)';
    }
    streakRewardsList.append(row);
  }
  streakRewardsEl.hidden = !hasRewards;
}

// A compact mode-specific stat line under the rules note on the start screen:
// the 60s target and mode best for Time Attack, the wrap rule for Zen, and the
// fruits-eaten progress for the Daily challenge.
function refreshModeInfo() {
  switch (activeMode.id) {
    case 'time-attack': {
      const timeLimit = activeMode.rules.timeLimitMs ?? 0;
      startModeInfo.textContent = `TARGET ${formatCountdown(timeLimit)} · BEST ${String(highScore).padStart(3, '0')}`;
      break;
    }
    case 'zen':
      startModeInfo.textContent = 'WALLS WRAP · LEAVE ONE EDGE, APPEAR ON THE OTHER';
      break;
    case 'daily': {
      const foodCount = activeMode.rules.foodCount ?? DAILY_FOOD_COUNT;
      startModeInfo.textContent = `FRUITS ${dailyProgress()} / ${foodCount}`;
      break;
    }
    default:
      startModeInfo.textContent = 'NO TIME LIMIT · WALLS END THE RUN';
  }
}

// Daily Challenge helpers. The challenge is derived purely from the local
// calendar date; if the date has changed (including a live midnight rollover),
// the challenge is regenerated so "today" is always the current day.
function ensureDailyForToday() {
  const key = dailyDateKey();
  todayKey = key;
  if (dailyChallenge && dailyChallenge.dateKey === key) return;
  dailyChallenge = generateDailyChallenge(key);
  dailyFoodIndex = 0;
}

// Fruits eaten so far in the current daily run (0 before the first fruit).
// `dailyFoodIndex` counts the next fruit to place, so the first fruit placed
// (index 0) starts at 1 and progress trails it by exactly one.
function dailyProgress(): number {
  const foodCount = dailyChallenge?.params?.foodCount ?? DAILY_FOOD_COUNT;
  return Math.max(0, Math.min(foodCount, dailyFoodIndex - 1));
}

function refreshDailyUI() {
  const isDaily = activeMode.id === 'daily';
  startKicker.textContent = isDaily ? 'DAILY CHALLENGE' : 'GET READY';
  startTitle.textContent = isDaily ? "Today's challenge" : 'Ready to play?';
  startButtonLabel.textContent = isDaily ? 'Play challenge' : 'Start run';
  startOverlay.classList.toggle('is-daily', isDaily);
  dailyDateEl.hidden = !isDaily;
  dailyBestEl.hidden = !isDaily;
  dailyStreakEl.hidden = !isDaily;
  if (isDaily) {
    ensureDailyForToday();
    dailyDateEl.textContent = dailyChallenge ? formatDailyDate(dailyChallenge.dateKey) : '';

    // Show/hide the new daily challenge info panel
    dailyChallengeInfo.hidden = false;

    // Modifier display
    if (dailyChallenge?.modifier) {
      dailyModifierEl.textContent = `${dailyChallenge.modifier.label} — ${dailyChallenge.modifier.description}`;
      dailyModifierEl.className = `daily-modifier modifier-${dailyChallenge.modifier.id}`;
    } else {
      dailyModifierEl.textContent = '';
    }

    // Progress bar
    const foodCount = dailyChallenge?.params?.foodCount ?? DAILY_FOOD_COUNT;
    const progress = dailyProgress();
    const pct = foodCount > 0 ? Math.min(100, Math.round((progress / foodCount) * 100)) : 0;
    dailyProgressFill.style.width = `${pct}%`;
    (dailyProgressFill.parentElement as HTMLElement).setAttribute('aria-valuenow', String(pct));
    dailyProgressText.textContent = `${progress} / ${foodCount}`;

    // Best score (all-time)
    dailyBestValue.textContent = String(highScore).padStart(3, '0');

    // Your best today (if played)
    const status = readStoredDailyStatus();
    const today =
      status && dailyChallenge && status.dateKey === dailyChallenge.dateKey
        ? status.score
        : null;
    dailyYourBest.textContent = today !== null ? String(today).padStart(3, '0') : '—';

    // Streak
    const streak = computeDailyStreak(readStoredDailyHistory(), dailyChallenge?.dateKey ?? '');
    dailyStreakValue.textContent = streak > 0 ? `${streak} ${streak === 1 ? 'DAY' : 'DAYS'}` : '0 DAYS';
    dailyStreakEl.textContent = streak > 0 ? `STREAK ${streak}${streak === 1 ? ' DAY' : ' DAYS'}` : '';
    dailyStreakEl.hidden = streak === 0;

    // Ghost toggle (show if ghost exists for current mode)
    const hasGhost = hasValidGhost(profile, activeMode.id);
    ghostToggleEl.hidden = !hasGhost;
    if (hasGhost) {
      ghostToggleInput.checked = ghostData.enabled;
    }

    // Legacy elements (for backwards compat)
    const todayCompleted = status?.completed ?? false;
    dailyBestEl.textContent = `BEST ${String(highScore).padStart(3, '0')}${today ? ` · TODAY ${String(today).padStart(3, '0')}${todayCompleted ? ' · COMPLETED' : ''}` : ''}`;
  } else {
    dailyChallengeInfo.hidden = true;
  }
  refreshStreakRewardsUI();
  refreshModeInfo();
}

// Feeds the engine the next fruit from today's challenge. Fruit placement is
// deterministic for the (date, fruit index) pair but snake-aware: it is always
// chosen from cells the current snake does not occupy, so food can never
// appear inside the snake. `dailyFoodIndex` is the index of the next fruit to
// place; returning null after the last fruit ends the run with the board
// "cleared".
function dailyFoodSource(snake: Cell[]): Cell | null {
  if (!dailyChallenge) return null;
  const foodCount = dailyChallenge.params?.foodCount ?? DAILY_FOOD_COUNT;
  if (dailyFoodIndex >= foodCount) return null;
  return dailyFoodFor(dailyChallenge.dateKey, dailyFoodIndex, snake);
}

// Places fruit index 0 for a fresh daily run and records that one fruit is on
// the board (`dailyFoodIndex` becomes the next index to place).
function firstDailyFood(snake: Cell[]): Cell | null {
  dailyFoodIndex = 1;
  return dailyChallenge ? dailyFoodFor(dailyChallenge.dateKey, 0, snake) : null;
}

// Session 5 special food: the engine's next-fruit provider carries both the
// cell and its type. Daily stays fully deterministic — every daily fruit is
// normal (special food is disabled there); every other mode rolls the type and
// the cell together so a run's specials follow the same rng sequence.
function placedFoodSourceFor(snake: Cell[]): PlacedFood | null {
  if (activeMode.id === 'daily') {
    const cell = dailyFoodSource(snake);
    return cell ? { cell, type: 'normal' } : null;
  }
  const rules = foodRulesDuringEvent(foodRules, activeEventEffects());
  return rollPlacedFood(snake, Math.random, rules);
}

function updatePickerState() {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === activeMode.id));
  });
  const description = document.getElementById('mode-description');
  if (description) description.textContent = activeMode.description;
}

function setModePickerVisible(visible: boolean) {
  modePicker.classList.toggle('hidden', !visible);
}

function selectMode(id: GameModeId) {
  if (isActive() || id === activeMode.id) return;
  const previous = activeMode.id;

  if (id === 'daily') {
    ensureDailyForToday();
    const params = getDailyParamsForDate(todayKey);
    activeMode = getDailyMode(params);
  } else {
    activeMode = getMode(id);
  }

  writePreference('mode', id);
  highScore = readStoredNumber(activeMode.bestKey, 0);
  bestLength = readStoredNumber(activeMode.bestLengthKey, 0);
  highScoreEl.textContent = String(highScore).padStart(3, '0');
  comboConfig = getComboConfig(id, activeMode.scoring.pointsPerFruit);
  foodRules = getFoodRules(id);
  foodEffects = createFoodEffects();
  prevActiveSpeed = null;
  prevMultiplierActive = false;
  eventRules = getEventRules(id);
  eventState = createEventState();
  lastEventCheck = 0;
  clearEventUI();
  const fresh = createInitialState();
  if (id === 'daily') {
    game = {
      ...fresh,
      food: firstDailyFood(fresh.snake),
      foodType: 'normal',
    };
  } else {
    const placed = rollPlacedFood(fresh.snake, Math.random, foodRules);
    game = { ...fresh, food: placed?.cell ?? null, foodType: placed?.type ?? 'normal' };
  }
  prevSnake = game.snake.map((s) => ({ ...s }));
  lastMove = 0;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  particles = [];
  ripples = [];
  pauseOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  startOverlay.classList.remove('hidden');
  pauseButton.disabled = true;

  // Load ghost data for the new mode
  ghostData = getGhost(profile, id);
  ghostSnapshots = ghostData.snapshots ?? [];

  refreshModeUI();
  updateHud();
  drawBackground(0);
  drawFood(0);
  drawSnake(0);
  announce(`${activeMode.name} mode selected. ${activeMode.tagline}`);
  trackEvent('mode_select', { mode: activeMode.id, previous_mode: previous });
}

// Shared GA event params. `duration` is active play time (excludes pauses),
// measured from the run clock; callers can override via `extra`.
function eventParams(extra: AnalyticsParams = {}): AnalyticsParams {
  return {
    score: game.score,
    level: getLevel(game.score),
    snake_length: game.snake.length,
    duration: Math.round(currentRunMs() / 1000),
    mode: activeMode.id,
    ...extra,
  };
}

function createStars() {
  const count = reducedMotion ? 40 : 100;
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * SIZE,
    y: Math.random() * SIZE,
    r: Math.random() * 1.5 + 0.2,
    phase: Math.random() * Math.PI * 2,
    tone: Math.random() > 0.7 ? '196, 181, 253' : '255, 255, 255',
  }));
}

function resetGame() {
  prevSnake = game.snake.map(s => ({ ...s }));
  if (activeMode.id === 'daily') {
    ensureDailyForToday();
    const base = startRun(game);
    game = {
      ...base,
      food: firstDailyFood(base.snake),
      foodType: 'normal',
    };
  } else {
    const placed = rollPlacedFood(createInitialSnake(), Math.random, foodRules);
    game = startRun(game, Math.random, placed ?? undefined);
  }
  particles = [];
  ripples = [];
  levelUpFlash = 0;
  updateHud();
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  if (activeMode.id === 'daily') refreshDailyUI();
  resetGame();
  comboState = createComboState();
  foodEffects = createFoodEffects();
  prevActiveSpeed = null;
  prevMultiplierActive = false;
  eventState = createEventState();
  lastEventCheck = 0;
  clearEventUI();
  runFruitCount = 0;
  runStartHead = game.snake[0] ? { ...game.snake[0] } : { x: 10, y: 12 };
  activeRunMs = 0;
  maxLength = game.snake.length;
  pausedThisRun = false;
  runStart = performance.now();
  document.body.classList.add('is-playing');
  // Interpolation starts at alpha 0 (lastMove = now): the snake renders at its
  // start position and takes its first step one full moveDelay later, so
  // startup never renders ahead of the simulation.
  lastMove = performance.now();
  setModePickerVisible(false);
  startOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  pauseButton.disabled = false;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  animate(performance.now());
  announce(`Game started. Score ${game.score}, level ${String(getLevel(game.score)).padStart(2, '0')}.`);
  playTone(220, 0.035, 'sine');
  trackEvent('game_start', eventParams());
}

function togglePause() {
  const next = togglePauseGame(game);
  if (next === game) return;
  game = next;
  const pausedNow = isPaused();
  if (pausedNow) {
    pausedThisRun = true;
    activeRunMs += performance.now() - runStart;
    runStart = 0;
  } else {
    runStart = performance.now();
  }
  pauseOverlay.classList.toggle('hidden', !pausedNow);
  pauseButton.innerHTML = pausedNow
    ? '<span class="pause-icon" aria-hidden="true">▶</span><span>RESUME</span><kbd class="keycap" translate="no">P</kbd>'
    : '<span class="pause-icon" aria-hidden="true">Ⅱ</span><span>PAUSE</span><kbd class="keycap" translate="no">P</kbd>';
  fsPauseLabel.textContent = pausedNow ? 'RESUME' : 'PAUSE';
  if (pausedNow) {
    announce('Game paused.');
    resumeButton.focus();
    trackEvent('pause', eventParams());
  } else {
    announce('Game resumed.');
    lastMove = performance.now();
    prevSnake = game.snake.map(s => ({ ...s }));
    pauseButton.focus();
    updateHud();
    trackEvent('resume', eventParams());
  }
}

function setDirection(next: Vec) {
  game = queueDirection(game, next);
}

function move() {
  prevSnake = game.snake.map(s => ({ ...s }));
  const prevGame = game;
  const prevLevel = getLevel(game.score);
  let fruitResult: FruitScoreResult | null = null;
  let riskResult: CloseCallResult | null = null;
  // Special-food effects (Session 5): prune expired windows first so scoring
  // and speed only reflect effects still active at this move, then report any
  // effect that has ended since the last poll (tracked across moves so an
  // expiry that happens between ticks is still announced).
  const now = currentRunMs();
  const eventEffects = activeEventEffects();
  const resolvedEffects = resolveEffects(foodEffects, foodRules, now);
  foodEffects = resolvedEffects.effects;
  if (prevActiveSpeed !== null && resolvedEffects.activeSpeed !== prevActiveSpeed) {
    const head = game.snake[0];
    showScorePopup(
      head.x,
      head.y,
      prevActiveSpeed === 'slow' ? 'SLOW OVER' : 'CURSED OVER',
      undefined,
      'effect',
    );
    playTone(prevActiveSpeed === 'slow' ? 240 : 200, 0.05, prevActiveSpeed === 'slow' ? 'sine' : 'sawtooth');
  }
  if (prevMultiplierActive && resolvedEffects.activeMultiplier === 1) {
    const head = game.snake[0];
    showScorePopup(head.x, head.y, 'MULTIPLIER OVER', undefined, 'effect');
    playTone(300, 0.05, 'sine');
  }
  prevActiveSpeed = resolvedEffects.activeSpeed;
  prevMultiplierActive = resolvedEffects.activeMultiplier > 1;
  const eatenType = prevGame.foodType ?? 'normal';
  const foodValue = prevGame.food
    ? pointsForFood(resolvedEffects.effects, foodRules, eatenType, now) * eventScoreMultiplier(eventEffects)
    : activeMode.scoring.pointsPerFruit;
  const { state: next, ate } = stepGame(game, {
    rng: Math.random,
    wrap: eventWrapOverride(eventEffects, activeMode.rules.wrap),
    pointsPerFruit: foodValue,
    placedFoodSource: placedFoodSourceFor,
  });
  game = next;
  // Skill-feel counters (Session 3) + mastery scoring (Session 4).
  let profileChanged = false;
  if (next.status === 'running' || next.status === 'cleared') {
    if (isCloseCall(prevGame, next, activeMode.rules.wrap)) {
      profile = { ...profile, closeCalls: profile.closeCalls + 1 };
      profileChanged = true;
      riskResult = scoreCloseCall(comboState, comboConfig, currentRunMs());
      comboState = riskResult.state;
      if (riskResult.points > 0) {
        game = { ...game, score: game.score + riskResult.points };
        profile = recordScoreBonus(profile, riskResult.points);
      }
    }
    if (ate && isPerfectTurn(prevGame, next)) {
      profile = { ...profile, perfectTurns: profile.perfectTurns + 1 };
      profileChanged = true;
    }
    if (isHomecoming(next, runStartHead)) {
      profile = { ...profile, homecomings: profile.homecomings + 1 };
      profileChanged = true;
    }
  }
  if (ate) {
    dailyFoodIndex += 1;
    runFruitCount += 1;
    // Apply the eaten fruit's effect (slow/multiplier/cursed/time) and score it
    // through the combo chain with its type value as the base, so combos work
    // identically on every fruit while the temporary multiplier scales the value.
    const effectResult = applyFoodEffect(resolvedEffects.effects, eatenType, foodRules, now);
    foodEffects = effectResult.effects;
    // Keep the cross-move tracking in sync so a speed replacement (e.g. eating
    // cursed while slow is active) is not reported as a lost effect later.
    if (effectResult.started === 'slow' || effectResult.started === 'cursed') {
      prevActiveSpeed = effectResult.started === 'slow' ? 'slow' : 'fast';
    } else if (effectResult.started === 'multiplier') {
      prevMultiplierActive = true;
    }
    fruitResult = scoreFruit(comboState, { ...comboConfig, pointsPerFruit: foodValue }, now);
    comboState = fruitResult.state;
    game = { ...game, score: game.score + fruitResult.bonus };
    profile = recordFruit(profile, fruitResult.points);
    profileChanged = true;
    dispatchMissionEvents([{ type: 'fruit', amount: 1 }]);
  }
  maxLength = Math.max(maxLength, game.snake.length);
  const newLevel = getLevel(game.score);
  if (newLevel > prevLevel) {
    profile = recordLevelUp(profile, newLevel);
    profileChanged = true;
    dispatchMissionEvents([{ type: 'level', level: newLevel }]);
    levelUpFlash = 1.0;
    playTone(440, 0.12, 'sine');
    window.setTimeout(() => playTone(554, 0.12, 'sine'), 80);
    window.setTimeout(() => playTone(659, 0.18, 'sine'), 160);
    trackEvent('level_up', eventParams({ level: newLevel }));
  }
  if (next.status === 'gameover') {
    endGame(next.deathReason || 'wall');
    updateHud();
    return;
  }
  if (next.status === 'cleared') {
    endGame('cleared');
    updateHud();
    return;
  }
  if (profileChanged) {
    saveProfile(profile);
    dispatchAchievements();
    dispatchCosmetics();
    dispatchStreakRewards();
  }

  // Record ghost snapshot for personal best ghost (Session 10)
  // Only record if ghost is enabled for this mode and we have a valid ghost
  if (ghostData.enabled && hasValidGhost(profile, activeMode.id)) {
    ghostSnapshots = recordGhostSnapshot(ghostSnapshots, game.snake, game.direction, game.score, currentRunMs());
  }
  if (riskResult && riskResult.points > 0) {
    const head = next.snake[0];
    showScorePopup(head.x, head.y, `+${riskResult.points}`, riskResult.multiplier > 1 ? `RISK ×${riskResult.multiplier}` : 'CLOSE CALL', 'risk');
    playTone(540 + riskResult.multiplier * 60, 0.05, 'sine');
    trackEvent('close_call', eventParams({ risk_multiplier: riskResult.multiplier }));
  }
  if (ate) {
    const head = next.snake[0];
    makeBurst((head.x + 0.5) * CELL, (head.y + 0.5) * CELL, '#ffc285', 22);
    ripples.push({ x: (head.x + 0.5) * CELL, y: (head.y + 0.5) * CELL, age: 0, hue: 28 });
    playTone(380 + next.score * 1.5, 0.055, 'triangle');
    if (eatenType !== 'normal') {
      // Special food feedback takes precedence over the combo popup; the value
      // shown already includes any active combo / multiplier.
      specialFoodFeedback(eatenType, fruitResult ? fruitResult.points : foodValue, head);
    } else if (fruitResult && fruitResult.multiplier > 1) {
      makeBurst((head.x + 0.5) * CELL, (head.y + 0.5) * CELL, '#c4b5fd', 14);
      playTone(620 + fruitResult.multiplier * 80, 0.06, 'sine');
      showScorePopup(head.x, head.y, `+${fruitResult.points}`, `COMBO ×${fruitResult.multiplier}`, 'combo');
      trackEvent('combo', eventParams({ combo_multiplier: fruitResult.multiplier }));
    } else {
      showScorePopup(head.x, head.y, `+${fruitResult ? fruitResult.points : foodValue}`, undefined, 'fruit');
    }
  }
  // Check combo expiry only when the run is still alive after the move.
  // While paused, tick() does not advance the combo window (running is false).
  if (isRunning()) {
    const expired = expireCombo(comboState, comboConfig, currentRunMs());
    if (expired.expired) {
      comboState = expired.state;
      const head = game.snake[0];
      showScorePopup(head.x, head.y, 'COMBO LOST', undefined, 'lost');
      playTone(220, 0.06, 'sine');
      announce('Combo lost.');
      trackEvent('combo_lost', eventParams());
    }
  }
  updateHud();
}

function setShareButtonText(text: string) {
  shareButtonLabel.textContent = text;
}

function setCopyButtonText(text: string) {
  copyButtonLabel.textContent = text;
}

async function shareScore() {
  const text = lastShareText;
  const base = eventParams({ is_new_best: isNewBest, duration: Math.round(lastRunMs / 1000) });
  let method: 'web-share' | 'clipboard' | 'unsupported' = 'unsupported';
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Snake Game', text, url: window.location.href });
      method = 'web-share';
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      method = 'clipboard';
      setShareButtonText('Copied!');
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        method = 'clipboard';
        setShareButtonText('Copied!');
      } catch {
        method = 'unsupported';
      }
    } else {
      method = 'unsupported';
    }
  }
  if (method === 'clipboard') {
    window.setTimeout(() => setShareButtonText(activeMode.id === 'daily' ? 'Share result' : 'Share score'), 1600);
  }
  trackEvent('share_score', { ...base, share_method: method });
}

async function shareChallenge() {
  // Generate a challenge from the current run
  const challenge = createChallengeFromRun(activeMode.id, game.score);
  const challengeText = buildChallengeShareMessage(challenge);
  const challengeLink = (window as any).__serpentChallengeLink;

  const base = eventParams({ is_new_best: isNewBest, duration: Math.round(lastRunMs / 1000) });
  let method: 'web-share' | 'clipboard' | 'unsupported' = 'unsupported';
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Snake Game Challenge', text: challengeText, url: challengeLink });
      method = 'web-share';
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(challengeLink);
      method = 'clipboard';
      setShareButtonText('Challenge copied!');
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(challengeLink);
        method = 'clipboard';
        setShareButtonText('Challenge copied!');
      } catch {
        method = 'unsupported';
      }
    } else {
      method = 'unsupported';
    }
  }
  if (method === 'clipboard') {
    window.setTimeout(() => setShareButtonText(activeMode.id === 'daily' ? 'Share result' : 'Share score'), 1600);
  }
  trackEvent('share_challenge', { ...base, share_method: method, target_score: game.score });
}

async function copyResult() {
  if (!navigator.clipboard || !navigator.clipboard.writeText || !lastShareText) return;
  try {
    await navigator.clipboard.writeText(lastShareText);
    setCopyButtonText('Copied!');
    window.setTimeout(() => setCopyButtonText('Copy result'), 1600);
    trackEvent('share_score', { ...eventParams({ is_new_best: isNewBest, duration: Math.round(lastRunMs / 1000) }), share_method: 'copy_result' });
  } catch (error) {
    console.warn('[serpent] copy failed:', error);
  }
}

function endGame(reason: DeathReason | 'cleared' = 'wall') {
  pauseButton.disabled = true;
  clearEventUI();
  makeBurst((game.snake[0].x + 0.5) * CELL, (game.snake[0].y + 0.5) * CELL, '#c4b5fd', 55);
  const endedRun = game.runId;

  const durationMs = activeRunMs + (runStart ? performance.now() - runStart : 0);
  activeRunMs = 0;
  runStart = 0;
  lastRunMs = durationMs;

  const fruitCount = runFruitCount;
  const length = game.snake.length;
  isNewBest = game.score > highScore;

  if (isNewBest) {
    highScore = game.score;
    highScoreEl.textContent = String(highScore).padStart(3, '0');
    writeStoredNumber(activeMode.bestKey, highScore);
  }
  if (maxLength > bestLength) {
    bestLength = maxLength;
    writeStoredNumber(activeMode.bestLengthKey, bestLength);
  }

  // Lifetime progression: tally the finished run (run + new-best XP). Fruit
  // and level-up XP were already credited live during the run.
  const runEnd = recordRunEnd(profile, {
    mode: activeMode.id,
    score: game.score,
    fruit: fruitCount,
    durationMs,
    longestSnake: maxLength,
    level: getLevel(game.score),
    isNewBest,
  });
  profile = runEnd.profile;

  // Update personal ghost if this is a new best (Session 10)
  if (isNewBest) {
    profile = updateGhostIfNewBest(
      profile,
      activeMode.id,
      game.score,
      maxLength,
      getLevel(game.score),
      durationMs,
      todayKey,
      ghostSnapshots
    );
    ghostData = getGhost(profile, activeMode.id);
    ghostSnapshots = ghostData.snapshots ?? [];
  }

  saveProfile(profile);
  refreshProfileUI();
  if (runEnd.rankUp) {
    announce(`Rank up! You are now a ${runEnd.rankUp.name}.`);
  }

  // Missions: a finished run feeds every goal type. Missions completed mid-run
  // (fruit, level) already announced; any that finish now are rewarded here,
  // then completed slots are refilled silently so the player always has ~3.
  const missionEvents: MissionEvent[] = [
    { type: 'run' },
    { type: 'score', score: game.score },
    { type: 'length', length: maxLength },
    { type: 'level', level: getLevel(game.score) },
    { type: 'survival', seconds: Math.floor(durationMs / 1000) },
    { type: 'mode', mode: activeMode.id, score: game.score },
    { type: 'record', mode: activeMode.id, score: game.score },
  ];
  if (!pausedThisRun) {
    missionEvents.push({ type: 'skill', skill: 'no-pause-run', score: game.score });
  }
  dispatchMissionEvents(missionEvents);
  missionSave = replaceCompletedMissions(missionSave, profile);
  saveMissions(missionSave);
  refreshMissionsUI();

  finalScoreEl.textContent = String(game.score).padStart(3, '0');
  finalBestEl.textContent = String(highScore).padStart(3, '0');
  finalLevelEl.textContent = String(getLevel(game.score)).padStart(2, '0');
  finalLengthEl.textContent = String(length);
  finalLongestEl.textContent = String(maxLength);
  finalRecordEl.textContent = String(bestLength);
  finalFruitEl.textContent = String(fruitCount);
  finalDurationEl.textContent = formatDuration(durationMs);
  newBestBadge.classList.toggle('is-new-best', isNewBest);

  // XP earned this run (run completion + new best bonus; fruit/level XP already credited live)
  const xpEarnedThisRun = runEnd.earnedXp;
  finalXpEarned.textContent = String(xpEarnedThisRun);

  // Missions completed this run
  const missionsCompletedThisRun = missionEvents.filter(e => e.type === 'run' || e.type === 'score' || e.type === 'length' || e.type === 'level' || e.type === 'survival' || e.type === 'mode' || e.type === 'record' || e.type === 'skill').length;
  // Actually, we need to check which missions were completed in dispatchMissionEvents
  // For now, use a simple heuristic: count completed missions from the mission save
  const missionsCompletedCount = missionSave.active.filter(m => m.completed).length;
  finalMissionsCompleted.textContent = String(missionsCompletedCount);

  // Achievements unlocked this run (approximate - would need to track precisely)
  const achievementsUnlockedCount = profile.unlockedAchievements.length;
  finalAchievementsUnlocked.textContent = String(achievementsUnlockedCount);

  const cleared = reason === 'cleared';
  const isDaily = activeMode.id === 'daily';
  const completed = cleared && isDaily;

  // Session 3 lifetime records: the longest single-run survival and a full
  // 60-fruit Daily clear. Saved here alongside the run-end tally above.
  profile = {
    ...profile,
    longestRunSeconds: Math.max(profile.longestRunSeconds, Math.floor(durationMs / 1000)),
    dailyCleared: profile.dailyCleared || (cleared && isDaily),
  };
  saveProfile(profile);
  gameoverKicker.textContent = cleared
    ? isDaily
      ? 'CHALLENGE COMPLETE'
      : 'BOARD CLEARED'
    : isDaily
      ? 'DAILY CHALLENGE'
      : reason === 'time'
        ? 'TIME UP'
        : 'RUN OVER';
  gameoverTitle.textContent =
    cleared
      ? isDaily
        ? "You cleared today's challenge!"
        : 'You cleared the whole board!'
      : reason === 'time'
        ? "Time's up — great run!"
        : reason === 'self'
          ? 'You ran into yourself.'
          : 'You hit the wall.';

  if (isDaily) {
    recordDailyResult({
      dateKey: todayKey,
      score: game.score,
      completed,
      level: getLevel(game.score),
      durationMs,
      length,
    });
    if (completed) {
      dispatchWeeklyGoals([{ type: 'daily-completed' }]);
    }
  }

  const shareSupported = Boolean(navigator.share || (navigator.clipboard && navigator.clipboard.writeText));
  const canCopy = Boolean(navigator.clipboard && navigator.clipboard.writeText);

  // Check if there's an active challenge for this mode
  const hasChallenge = activeChallenge && challengeModeMatch;

  lastShareText = isDaily && dailyChallenge
    ? buildDailyShareMessage(dailyChallenge.dateKey, game.score, isNewBest, completed)
    : buildShareMessage(game.score, isNewBest);

  shareButton.hidden = !shareSupported;
  copyButton.hidden = !isDaily || !canCopy;
  setShareButtonText(isDaily ? 'Share result' : 'Share score');
  setCopyButtonText('Copy result');

  // Challenge section in gameover overlay
  if (hasChallenge) {
    challengeSection.hidden = false;
    challengeSection.classList.remove('hidden');

    const challengerName = getChallengerName(activeChallenge);
    const modeName = getChallengeModeName(activeChallenge);
    const targetScore = activeChallenge.targetScore;
    const playerScore = game.score;
    const beaten = playerScore >= targetScore;

    challengeTitle.textContent = `${challengerName} CHALLENGED YOU`;
    challengeTarget.textContent = `TARGET ${targetScore}`;
    challengeResult.textContent = beaten ? 'BEAT THE CHALLENGE' : 'TRY AGAIN';
    challengeResult.className = `challenge-result ${beaten ? 'beaten' : 'not-beaten'}`;

    // Show challenge share button
    challengeShareButton.hidden = false;
    challengeShareButton.classList.remove('hidden');
  } else {
    challengeSection.hidden = true;
    challengeSection.classList.add('hidden');
    challengeShareButton.hidden = true;
    challengeShareButton.classList.add('hidden');
  }

  // Next goal: show what the player should aim for next
  const nextGoalInfo = getNextGoal(profile, activeMode.id);
  if (nextGoalInfo) {
    nextGoalText.textContent = nextGoalInfo.text;
    nextGoal.hidden = false;
    nextGoal.classList.remove('hidden');
  } else {
    nextGoal.hidden = true;
    nextGoal.classList.add('hidden');
  }

  shareButton.hidden = !shareSupported;
  copyButton.hidden = !isDaily || !canCopy;
  setShareButtonText(isDaily ? 'Share result' : 'Share score');
  setCopyButtonText('Copy result');

  window.setTimeout(() => {
    if (endedRun === game.runId && isOver()) {
      gameoverOverlay.classList.remove('hidden');
      document.getElementById('restart-button')?.focus();
    }
  }, 390);

  const reasonText =
    cleared
      ? 'You cleared the whole board.'
      : reason === 'time'
        ? "Time's up."
        : reason === 'self'
          ? 'You ran into yourself.'
          : 'You hit the wall.';
  announce(
    `Game over. ${reasonText} Score ${game.score}, best ${highScore}, level ${String(getLevel(game.score)).padStart(2, '0')}, length ${length}, time ${formatDuration(durationMs)}.`,
  );

  const deathReason = cleared ? 'cleared' : (reason ?? 'wall');
  trackEvent('game_over', eventParams({ is_new_best: isNewBest, death_reason: deathReason, duration: Math.round(durationMs / 1000) }));
  if (isNewBest) {
    trackEvent('new_high_score', eventParams({ is_new_best: true, death_reason: deathReason, duration: Math.round(durationMs / 1000) }));
  }
  playTone(110, 0.18, 'sawtooth');
  window.setTimeout(() => playTone(73, 0.25, 'sawtooth'), 100);
  setModePickerVisible(true);

  // Final achievement sweep after the daily history (and streak) is recorded,
  // so daily-streak / daily-completed / mode-best conditions see fresh data.
  dispatchAchievements();
  dispatchCosmetics();
  dispatchStreakRewards();
  // Weekly goals: feed run-end events.
  const weeklyEvents: WeeklyGoalEvent[] = [
    { type: 'total-score', score: game.score },
    { type: 'fruit-eaten', amount: runFruitCount },
    { type: 'modes-played', modesPlayed: [activeMode.id] },
    { type: 'achievements-earned', achievementsEarned: evaluateAchievements(profile, computeDailyStats(readStoredDailyHistory(), dailyDateKey())).length },
    { type: 'personal-record', recordBeaten: isNewBest },
  ];
  dispatchWeeklyGoals(weeklyEvents);
  refillWeeklyGoals();
}

function updateHud() {
  scoreEl.textContent = String(game.score).padStart(3, '0');
  const timeLimit = activeMode.rules.timeLimitMs;
  if (timeLimit != null) {
    // Time Attack: the speed card becomes a clear, always-visible countdown.
    // TIME fruit adds a permanent-this-run bonus (Session 5).
    const total = timeLimit + foodEffects.timeBonusMs;
    const remaining = Math.max(0, total - currentRunMs());
    speedLabelEl.textContent = 'TIME';
    levelEl.textContent = formatCountdown(remaining);
    speedNameEl.hidden = true;
    speedMeter.style.width = `${Math.min(100, (remaining / total) * 100)}%`;
    scoreDetail.textContent = `TARGET ${formatCountdown(total)}`;
  } else {
    const level = getLevel(game.score);
    speedLabelEl.textContent = 'SPEED';
    levelEl.textContent = String(level).padStart(2, '0');
    speedNameEl.hidden = false;
    speedNameEl.textContent = SPEED_LABELS[Math.min(SPEED_LABELS.length - 1, Math.floor((level - 1) / 2))];
    speedMeter.style.width = `${Math.min(100, 12 + (level - 1) * 8)}%`;
    if (activeMode.id === 'daily') {
      scoreDetail.textContent = game.score
        ? `FRUITS ${dailyProgress()} / ${DAILY_FOOD_COUNT}`
        : `CHALLENGE · ${DAILY_FOOD_COUNT} FRUITS`;
    } else {
      scoreDetail.textContent = game.score ? `LENGTH ${game.snake.length}` : 'EAT FRUIT TO SCORE';
    }
  }
}

function createBackgroundCache() {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const offscreen = new OffscreenCanvas(SIZE, SIZE);
  const octx = offscreen.getContext('2d');
  if (!octx) return null;

  const backdrop = octx.createRadialGradient(SIZE * 0.5, SIZE * 0.45, 0, SIZE * 0.5, SIZE * 0.47, SIZE * 0.75);
  backdrop.addColorStop(0, '#171717');
  backdrop.addColorStop(0.56, '#0e0e0e');
  backdrop.addColorStop(1, '#0a0a0a');
  octx.fillStyle = backdrop;
  octx.fillRect(0, 0, SIZE, SIZE);

  const warm = octx.createRadialGradient(-40, -40, 0, -40, -40, SIZE * 0.55);
  warm.addColorStop(0, 'rgba(255, 122, 23, 0.05)');
  warm.addColorStop(1, 'rgba(255, 122, 23, 0)');
  octx.fillStyle = warm;
  octx.fillRect(0, 0, SIZE, SIZE);

  const cool = octx.createRadialGradient(SIZE + 40, SIZE + 40, 0, SIZE + 40, SIZE + 40, SIZE * 0.6);
  cool.addColorStop(0, 'rgba(124, 58, 237, 0.05)');
  cool.addColorStop(1, 'rgba(124, 58, 237, 0)');
  octx.fillStyle = cool;
  octx.fillRect(0, 0, SIZE, SIZE);

  for (const star of stars) {
    octx.fillStyle = `rgba(${star.tone}, 0.45)`;
    octx.beginPath();
    octx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    octx.fill();
  }

  octx.lineWidth = 1;
  for (let i = 0; i <= CELLS; i++) {
    const pos = i * CELL;
    octx.strokeStyle = i % 5 === 0 ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.04)';
    octx.beginPath();
    octx.moveTo(pos, 0);
    octx.lineTo(pos, SIZE);
    octx.stroke();
    octx.beginPath();
    octx.moveTo(0, pos);
    octx.lineTo(SIZE, pos);
    octx.stroke();
  }
  octx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  octx.lineWidth = 2;
  octx.strokeRect(2, 2, SIZE - 4, SIZE - 4);

  return offscreen;
}

function drawBackground(_time: number) {
  const board = getBoardRenderProps();
  if (backgroundCache) {
    ctx.drawImage(backgroundCache, 0, 0);
  } else {
    ctx.clearRect(0, 0, SIZE, SIZE);
    const backdrop = ctx.createRadialGradient(SIZE * 0.5, SIZE * 0.45, 0, SIZE * 0.5, SIZE * 0.47, SIZE * 0.75);
    backdrop.addColorStop(0, board.backdrop[0]);
    backdrop.addColorStop(0.56, board.backdrop[1]);
    backdrop.addColorStop(1, board.backdrop[2]);
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const warm = ctx.createRadialGradient(-40, -40, 0, -40, -40, SIZE * 0.55);
    warm.addColorStop(0, board.warm[0]);
    warm.addColorStop(1, board.warm[1]);
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const cool = ctx.createRadialGradient(SIZE + 40, SIZE + 40, 0, SIZE + 40, SIZE + 40, SIZE * 0.6);
    cool.addColorStop(0, board.cool[0]);
    cool.addColorStop(1, board.cool[1]);
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, SIZE, SIZE);

    if (board.stars) {
      for (const star of stars) {
        ctx.fillStyle = board.starColor;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.lineWidth = 1;
    for (let i = 0; i <= CELLS; i++) {
      const pos = i * CELL;
      ctx.strokeStyle = i % 5 === 0 ? board.gridHeavyColor : board.gridColor;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(SIZE, pos);
      ctx.stroke();
    }
    ctx.strokeStyle = board.borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
  }

  if (levelUpFlash > 0) {
    levelUpFlash -= 1 / 60;
    const alpha = Math.min(1, levelUpFlash) * 0.18;
    ctx.fillStyle = `rgba(255, 214, 168, ${alpha})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
}

// Cosmetic rendering helpers (Session 7) — pure functions that return render
// properties for the currently equipped cosmetics. They never throw and always
// return safe defaults.
function getSnakeRenderProps(): { primary: string; secondary: string; glow: string; pattern: 'solid' | 'gradient' | 'circuit' | 'crystalline' | 'nebula' | 'gold' } {
  const cosmetic = getCosmetic(equippedCosmetics.snake);
  if (!cosmetic) return { primary: '#ffffff', secondary: '#ff7a17', glow: 'rgba(255, 122, 23, 0.35)', pattern: 'solid' };
  switch (cosmetic.renderKey) {
    case 'neon':
      return { primary: '#00ffff', secondary: '#ff00ff', glow: 'rgba(0, 255, 255, 0.4)', pattern: 'gradient' };
    case 'cyber':
      return { primary: '#00ff88', secondary: '#ff0066', glow: 'rgba(0, 255, 136, 0.4)', pattern: 'circuit' };
    case 'inferno':
      return { primary: '#ff4500', secondary: '#ffd700', glow: 'rgba(255, 69, 0, 0.4)', pattern: 'gradient' };
    case 'ice':
      return { primary: '#7dd3fc', secondary: '#e0f2fe', glow: 'rgba(125, 211, 252, 0.4)', pattern: 'crystalline' };
    case 'void':
      return { primary: '#1a1a2e', secondary: '#c4b5fd', glow: 'rgba(196, 181, 253, 0.3)', pattern: 'nebula' };
    case 'gold':
      return { primary: '#ffd700', secondary: '#fff8dc', glow: 'rgba(255, 215, 0, 0.35)', pattern: 'gold' };
    case 'galaxy':
      return { primary: '#8b5cf6', secondary: '#ec4899', glow: 'rgba(139, 92, 246, 0.4)', pattern: 'nebula' };
    default:
      return { primary: '#ffffff', secondary: '#ff7a17', glow: 'rgba(255, 122, 23, 0.35)', pattern: 'solid' };
  }
}

function getFoodRenderProps(): { aura: string; petalA: string; petalB: string; core: string[]; ring: string } {
  const cosmetic = getCosmetic(equippedCosmetics.food);
  if (!cosmetic) return { aura: '255, 194, 133', petalA: '#ff7a17', petalB: '#ffc285', core: ['#fff7ed', '#ffd9a8', '#ff5f1f'], ring: 'rgba(255, 255, 255, 0.85)' };
  switch (cosmetic.renderKey) {
    case 'crystal':
      return { aura: '165, 243, 252', petalA: '#67e8f9', petalB: '#a5f3fc', core: ['#f0f9ff', '#a5f3fc', '#06b6d4'], ring: 'rgba(165, 243, 252, 0.9)' };
    case 'orb':
      return { aura: '196, 181, 253', petalA: '#a78bfa', petalB: '#ddd6fe', core: ['#f5f3ff', '#c4b5fd', '#7c3aed'], ring: 'rgba(196, 181, 253, 0.9)' };
    case 'star':
      return { aura: '253, 224, 71', petalA: '#fde047', petalB: '#fef08a', core: ['#fefce8', '#fde047', '#ca8a04'], ring: 'rgba(253, 224, 71, 0.9)' };
    case 'energy-core':
      return { aura: '251, 146, 60', petalA: '#fb923c', petalB: '#fed7aa', core: ['#fff7ed', '#fb923c', '#c2410c'], ring: 'rgba(251, 146, 60, 0.9)' };
    default:
      return { aura: '255, 194, 133', petalA: '#ff7a17', petalB: '#ffc285', core: ['#fff7ed', '#ffd9a8', '#ff5f1f'], ring: 'rgba(255, 255, 255, 0.85)' };
  }
}

function getTrailRenderProps(): { enabled: boolean; color: string; style: 'glow' | 'particles' | 'fire' | 'lightning' | 'rainbow' } {
  const cosmetic = getCosmetic(equippedCosmetics.trail);
  if (!cosmetic || cosmetic.renderKey === 'none') return { enabled: false, color: '#ff7a17', style: 'glow' };
  return {
    enabled: true,
    color: cosmetic.preview?.color ?? '#ff7a17',
    style: cosmetic.renderKey as 'glow' | 'particles' | 'fire' | 'lightning' | 'rainbow',
  };
}

function getBoardRenderProps(): { backdrop: [string, string, string]; warm: [string, string]; cool: [string, string]; gridColor: string; gridHeavyColor: string; borderColor: string; stars: boolean; starColor: string; animated: boolean } {
  const cosmetic = getCosmetic(equippedCosmetics.board);
  if (!cosmetic) return {
    backdrop: ['#171717', '#0e0e0e', '#0a0a0a'],
    warm: ['rgba(255, 122, 23, 0.05)', 'rgba(255, 122, 23, 0)'],
    cool: ['rgba(124, 58, 237, 0.05)', 'rgba(124, 58, 237, 0)'],
    gridColor: 'rgba(255, 255, 255, 0.04)',
    gridHeavyColor: 'rgba(255, 255, 255, 0.09)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    stars: true,
    starColor: 'rgba(255, 255, 255, 0.45)',
    animated: false,
  };
  switch (cosmetic.renderKey) {
    case 'arcade':
      return {
        backdrop: ['#0d1a0d', '#0a150a', '#050f05'],
        warm: ['rgba(57, 255, 20, 0.08)', 'rgba(57, 255, 20, 0)'],
        cool: ['rgba(57, 255, 20, 0.04)', 'rgba(57, 255, 20, 0)'],
        gridColor: 'rgba(57, 255, 20, 0.06)',
        gridHeavyColor: 'rgba(57, 255, 20, 0.15)',
        borderColor: 'rgba(57, 255, 20, 0.5)',
        stars: false,
        starColor: 'rgba(57, 255, 20, 0.3)',
        animated: true,
      };
    case 'matrix':
      return {
        backdrop: ['#000000', '#000000', '#000000'],
        warm: ['rgba(0, 255, 65, 0.08)', 'rgba(0, 255, 65, 0)'],
        cool: ['rgba(0, 255, 65, 0.04)', 'rgba(0, 255, 65, 0)'],
        gridColor: 'rgba(0, 255, 65, 0.06)',
        gridHeavyColor: 'rgba(0, 255, 65, 0.12)',
        borderColor: 'rgba(0, 255, 65, 0.4)',
        stars: false,
        starColor: 'rgba(0, 255, 65, 0.3)',
        animated: true,
      };
    case 'sunset':
      return {
        backdrop: ['#2d1005', '#1a0a0a', '#0a0505'],
        warm: ['rgba(255, 122, 23, 0.12)', 'rgba(255, 122, 23, 0)'],
        cool: ['rgba(196, 181, 253, 0.06)', 'rgba(196, 181, 253, 0)'],
        gridColor: 'rgba(255, 122, 23, 0.04)',
        gridHeavyColor: 'rgba(255, 122, 23, 0.08)',
        borderColor: 'rgba(255, 122, 23, 0.35)',
        stars: true,
        starColor: 'rgba(255, 122, 23, 0.2)',
        animated: true,
      };
    case 'void':
      return {
        backdrop: ['#000000', '#000000', '#000000'],
        warm: ['rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0)'],
        cool: ['rgba(255, 255, 255, 0.01)', 'rgba(255, 255, 255, 0)'],
        gridColor: 'rgba(255, 255, 255, 0.015)',
        gridHeavyColor: 'rgba(255, 255, 255, 0.03)',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        stars: true,
        starColor: 'rgba(255, 255, 255, 0.6)',
        animated: true,
      };
    case 'grid':
      return {
        backdrop: ['#0f0f0f', '#0a0a0a', '#050505'],
        warm: ['rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0)'],
        cool: ['rgba(255, 255, 255, 0.01)', 'rgba(255, 255, 255, 0)'],
        gridColor: 'rgba(255, 255, 255, 0.08)',
        gridHeavyColor: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        stars: false,
        starColor: 'rgba(255, 255, 255, 0.2)',
        animated: false,
      };
    default: // midnight
      return {
        backdrop: ['#171717', '#0e0e0e', '#0a0a0a'],
        warm: ['rgba(255, 122, 23, 0.05)', 'rgba(255, 122, 23, 0)'],
        cool: ['rgba(124, 58, 237, 0.05)', 'rgba(124, 58, 237, 0)'],
        gridColor: 'rgba(255, 255, 255, 0.04)',
        gridHeavyColor: 'rgba(255, 255, 255, 0.09)',
        borderColor: 'rgba(255, 255, 255, 0.28)',
        stars: true,
        starColor: 'rgba(255, 255, 255, 0.45)',
        animated: false,
      };
  }
}

function drawFood(time: number) {
  const food = game.food;
  if (!food) return;
  const cosmetic = getFoodRenderProps();
  const x = (food.x + 0.5) * CELL;
  const y = (food.y + 0.5) * CELL;
  const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 0.005) * 0.1;
  const auraRadius = CELL * 1.45 * pulse;
  const aura = ctx.createRadialGradient(x, y, 0, x, y, auraRadius);
  aura.addColorStop(0, `rgba(${cosmetic.aura}, 0.38)`);
  aura.addColorStop(0.3, `rgba(${cosmetic.aura}, 0.18)`);
  aura.addColorStop(1, `rgba(${cosmetic.aura}, 0)`);
  ctx.fillStyle = aura;
  ctx.fillRect(x - auraRadius, y - auraRadius, auraRadius * 2, auraRadius * 2);

  if (!reducedMotion) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.0012);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = i % 2 ? cosmetic.petalA : cosmetic.petalB;
      ctx.globalAlpha = 0.77;
      ctx.beginPath();
      ctx.ellipse(0, -CELL * 0.27, CELL * 0.09, CELL * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const coreRadius = 13 * pulse;
  const core = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, coreRadius);
  core.addColorStop(0, cosmetic.core[0]);
  core.addColorStop(0.22, cosmetic.core[1]);
  core.addColorStop(0.58, cosmetic.core[2]);
  core.addColorStop(1, cosmetic.core[2]);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  if (game.foodType !== 'normal') {
    ctx.strokeStyle = cosmetic.ring;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, coreRadius * 1.35, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function segmentHue(i: number, total: number) {
  return 24 + (Math.min(i, total - 1) / (total - 1)) * 238;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function drawGhostSnake(ghostSnake: Cell[]) {
  const total = ghostSnake.length;
  if (!total) return;

  // Use a simple segment array for ghost (no interpolation needed for ghost as we're using the current time)
  const segments: { x: number; y: number; index: number }[] = [];
  for (let i = 0; i < total; i++) {
    const c = ghostSnake[i];
    segments.push({
      x: (c.x + 0.5) * CELL,
      y: (c.y + 0.5) * CELL,
      index: i,
    });
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.25; // Ghost is translucent

  // Ghost snake uses a simple white/translucent style
  for (let i = total - 1; i >= 0; i--) {
    const s = segments[i];
    const r = Math.max(6, CELL * (0.28 - Math.min(i, 10) * 0.005));
    
    // Ghost body segments
    if (i > 0) {
      const a = segments[i];
      const b = segments[i - 1];
      const width = Math.max(14, CELL * (0.64 - Math.min(i, 10) * 0.012));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = width;
      ctx.globalAlpha = 0.15 * (1 - i / total);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    
    // Ghost segment circles
    ctx.fillStyle = `rgba(255, 255, 255, ${0.2 * (1 - i / total)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ghost head - slightly more visible
  const head = segments[0];
  if (head) {
    const r = Math.max(6, CELL * 0.28);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
    ctx.fill();
    
    // Ghost eyes
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    const eyeOffset = r * 0.3;
    ctx.beginPath();
    ctx.arc(head.x - eyeOffset, head.y - eyeOffset, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x + eyeOffset, head.y - eyeOffset, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSnake(interp: number) {
  const curr = game.snake;
  const prev = prevSnake.length === curr.length ? prevSnake : curr;
  const total = curr.length;
  if (!total) return;

  const snakeProps = getSnakeRenderProps();
  const trailProps = getTrailRenderProps();

  // Render personal ghost first (behind the current snake)
  if (hasValidGhost(profile, activeMode.id) && ghostData.enabled && !reducedMotion) {
    const ghostSnake = getGhostSnakeAtTime(ghostData, currentRunMs(), interp);
    if (ghostSnake) {
      drawGhostSnake(ghostSnake);
    }
  }

  const segments: { x: number; y: number; px: number; py: number; index: number }[] = [];
  for (let i = 0; i < total; i++) {
    const c = curr[i];
    const p = prev[i] || c;
    segments.push({
      x: (c.x + 0.5) * CELL,
      y: (c.y + 0.5) * CELL,
      px: (p.x + 0.5) * CELL,
      py: (p.y + 0.5) * CELL,
      index: i,
    });
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Trail effect (rendered first, behind the snake)
  if (trailProps.enabled && !reducedMotion) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = total - 1; i > 0; i--) {
      const s = segments[i];
      const ix = lerp(s.px, s.x, interp);
      const iy = lerp(s.py, s.y, interp);
      const r = Math.max(4, CELL * (0.2 - Math.min(i, 8) * 0.008));
      const alpha = 0.15 * (1 - i / total);
      switch (trailProps.style) {
        case 'glow': {
          const glow = ctx.createRadialGradient(ix, iy, 0, ix, iy, r * 3);
          glow.addColorStop(0, trailProps.color.replace(')', ', 0)').replace('rgb', 'rgba').replace('#', ''));
          glow.addColorStop(1, trailProps.color.replace(')', ', 0)').replace('rgb', 'rgba').replace('#', ''));
          ctx.fillStyle = glow;
          ctx.fillRect(ix - r * 3, iy - r * 3, r * 6, r * 6);
          break;
        }
        case 'particles': {
          ctx.fillStyle = trailProps.color;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(ix + (Math.random() - 0.5) * 6, iy + (Math.random() - 0.5) * 6, Math.max(1, r * 0.3), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'fire': {
          const fire = ctx.createRadialGradient(ix, iy, 0, ix, iy, r * 2);
          fire.addColorStop(0, 'rgba(255, 69, 0, 0.4)');
          fire.addColorStop(0.5, 'rgba(255, 140, 0, 0.2)');
          fire.addColorStop(1, 'rgba(255, 215, 0, 0)');
          ctx.fillStyle = fire;
          ctx.fillRect(ix - r * 2, iy - r * 2, r * 4, r * 4);
          break;
        }
        case 'lightning': {
          ctx.strokeStyle = trailProps.color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = alpha * 2;
          ctx.beginPath();
          ctx.moveTo(ix, iy);
          ctx.lineTo(ix + (Math.random() - 0.5) * 10, iy + (Math.random() - 0.5) * 10);
          ctx.stroke();
          break;
        }
        case 'rainbow': {
          const hue = (Date.now() * 0.1 + i * 30) % 360;
          ctx.fillStyle = `hsl(${hue} 100% 60%)`;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(ix, iy, Math.max(1, r * 0.4), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Body strokes carry no shadow: glow is reserved for the short leading
  // section next to the head so the motion trail stays crisp and cheap.
  const strokeSegment = (i: number) => {
    const a = segments[i];
    const b = segments[i - 1];
    const ix = lerp(a.px, a.x, interp);
    const iy = lerp(a.py, a.y, interp);
    const jx = lerp(b.px, b.x, interp);
    const jy = lerp(b.py, b.y, interp);
    const width = Math.max(14, CELL * (0.64 - Math.min(i, 10) * 0.012));

    let strokeColor: string;
    switch (snakeProps.pattern) {
      case 'gradient': {
        const hue0 = segmentHue(i, total);
        const hue1 = segmentHue(i - 1, total);
        strokeColor = `hsl(${lerp(hue0, hue1, 0.5)} 85% 55%)`;
        break;
      }
      case 'circuit': {
        // Cyber: alternating circuit green/pink
        strokeColor = i % 2 === 0 ? snakeProps.primary : snakeProps.secondary;
        break;
      }
      case 'crystalline': {
        // Ice: blue-white gradient
        const hue = 200 - (i / total) * 40;
        strokeColor = `hsl(${hue} 80% 60%)`;
        break;
      }
      case 'nebula': {
        // Void/Galaxy: purple-pink gradient
        const hue = 270 + (i / total) * 60;
        strokeColor = `hsl(${hue} 70% 60%)`;
        break;
      }
      case 'gold': {
        // Gold: solid gold
        strokeColor = snakeProps.primary;
        break;
      }
      default: {
        // Classic/solid: original rainbow
        const hue0 = segmentHue(i, total);
        const hue1 = segmentHue(i - 1, total);
        strokeColor = `hsl(${lerp(hue0, hue1, 0.5)} 85% 55%)`;
        break;
      }
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = width;
    ctx.globalAlpha = i < 5 ? 0.95 : 0.85;
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(jx, jy);
    ctx.stroke();
  };

  for (let i = total - 1; i > 0; i--) {
    strokeSegment(i);
  }

  if (!reducedMotion) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = snakeProps.glow;
    const leading = Math.min(3, total - 1);
    for (let i = leading; i > 0; i--) {
      strokeSegment(i);
    }
    ctx.shadowBlur = 0;
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  for (let i = total - 1; i >= 0; i--) {
    const s = segments[i];
    const ix = lerp(s.px, s.x, interp);
    const iy = lerp(s.py, s.y, interp);
    const r = Math.max(6, CELL * (0.28 - Math.min(i, 10) * 0.005));

    let fillColor: string;
    switch (snakeProps.pattern) {
      case 'gradient': {
        const hue = segmentHue(i, total);
        const lightness = i === 0 ? 60 : 45 + Math.min(i, 8) * 2;
        fillColor = `hsl(${hue} 85% ${lightness}%)`;
        break;
      }
      case 'circuit': {
        fillColor = i % 2 === 0 ? snakeProps.primary : snakeProps.secondary;
        break;
      }
      case 'crystalline': {
        const hue = 200 - (i / total) * 40;
        const lightness = i === 0 ? 70 : 50 + Math.min(i, 8) * 2;
        fillColor = `hsl(${hue} 80% ${lightness}%)`;
        break;
      }
      case 'nebula': {
        const hue = 270 + (i / total) * 60;
        const lightness = i === 0 ? 70 : 50 + Math.min(i, 8) * 2;
        fillColor = `hsl(${hue} 70% ${lightness}%)`;
        break;
      }
      case 'gold': {
        fillColor = snakeProps.primary;
        break;
      }
      default: {
        const hue = segmentHue(i, total);
        const lightness = i === 0 ? 60 : 45 + Math.min(i, 8) * 2;
        fillColor = `hsl(${hue} 85% ${lightness}%)`;
        break;
      }
    }

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.arc(ix, iy, r, 0, Math.PI * 2);
    ctx.fill();

    if (i === 0) {
      ctx.fillStyle = '#fff5ea';
      ctx.beginPath();
      ctx.arc(ix - r * 0.15, iy - r * 0.2, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (i % 3 === 0) {
      ctx.fillStyle = snakeProps.pattern === 'gold' ? 'rgba(255, 248, 220, 0.3)' : 'rgba(255, 250, 245, 0.25)';
      ctx.beginPath();
      ctx.arc(ix - r * 0.18, iy - r * 0.25, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const head = segments[0];
  const hx = lerp(head.px, head.x, interp);
  const hy = lerp(head.py, head.y, interp);
  const ex = game.direction.x;
  const ey = game.direction.y;
  const sx = -game.direction.y;
  const sy = game.direction.x;
  for (const side of [-1, 1]) {
    const eyeX = hx + ex * 7 + sx * side * 7;
    const eyeY = hy + ey * 7 + sy * side * 7;
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = snakeProps.pattern === 'gold' ? '#fff8dc' : '#fff5ea';
    ctx.beginPath();
    ctx.arc(eyeX + ex * 1.2, eyeY + ey * 1.2, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function makeBurst(x: number, y: number, color: string, count: number) {
  const actual = reducedMotion ? Math.round(count * 0.5) : count;
  const remaining = MAX_PARTICLES - particles.length;
  const toAdd = Math.min(actual, Math.max(0, remaining));
  for (let i = 0; i < toAdd; i++) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = 1.2 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 1, size: 1 + Math.random() * 3, color });
  }
}

let lastEffectFrame = 0;

// Particle and ripple motion is scaled by the real frame delta so the effect
// speed no longer depends on the refresh rate. `stepScale` is relative to a
// 60 Hz reference frame and clamped so a slow frame cannot teleport effects.
function drawEffects(time: number) {
  const dt = lastEffectFrame ? Math.min(50, time - lastEffectFrame) : 16.7;
  lastEffectFrame = time;
  const stepScale = dt / 16.667;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  particles = particles.filter((p) => p.life > 0.02);
  for (const p of particles) {
    p.x += p.vx * stepScale;
    p.y += p.vy * stepScale;
    const decay = Math.pow(0.96, stepScale);
    p.vx *= decay;
    p.vy *= decay;
    p.life *= Math.pow(0.95, stepScale);
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ripples = ripples.filter((r) => r.age < 1);
  if (ripples.length > MAX_RIPPLES) ripples.length = MAX_RIPPLES;
  for (const r of ripples) {
    const step = (reducedMotion ? 0.04 : 0.023) * stepScale;
    r.age += step;
    ctx.globalAlpha = 1 - r.age;
    ctx.strokeStyle = `hsla(${r.hue}, 95%, 72%, 0.85)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 10 + r.age * 45, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function animate(time: number) {
  try {
    tick(time);
  } catch (error) {
    game = { ...game, status: 'gameover' };
    cancelAnimationFrame(animationFrame);
    pauseButton.disabled = true;
    reportFatalError(error);
  }
}

function tick(time: number) {
  if (
    isRunning() &&
    activeMode.rules.timeLimitMs != null &&
    currentRunMs() >= activeMode.rules.timeLimitMs + foodEffects.timeBonusMs
  ) {
    game = { ...game, status: 'gameover', deathReason: 'time' };
    endGame('time');
    updateHud();
  }
  const running = isRunning();
  if (running) {
    const now = currentRunMs();
    // Events (Session 6): resolve expiry, then roll a new trigger on the check
    // throttle. Both use active-play ms, so events freeze during pause.
    const resolved = resolveEvent(eventState, now);
    if (eventState.activeEventId !== null && resolved.active === null) {
      endEvent(eventState.activeEventId);
    }
    eventState = resolved.state;
    if (now - lastEventCheck >= eventRules.checkIntervalMs) {
      lastEventCheck = now;
      const roll = rollEvent(eventState, eventRules, now);
      if (roll.started) {
        eventState = roll.next;
        startEvent(roll.started);
      }
    }
    const effects = activeEventEffects();
    const baseDelay = getMoveDelay(game.score);
    const foodDelay = effectiveMoveDelay(foodEffects, foodRules, baseDelay, now);
    const eventDelay = eventMoveDelay(foodDelay, effects, foodRules.minMoveDelay);
    // Apply daily challenge speed factor (1.0 = normal, <1 = faster)
    const speedFactor = activeMode.rules.speedFactor ?? 1.0;
    const moveDelay = eventDelay * speedFactor;
    if (isMoveDue(time, lastMove, moveDelay)) {
      move();
      lastMove = advanceLastMove(time, lastMove, moveDelay);
    }
  }
  updateEventBanner();
  const speedFactor = activeMode.rules.speedFactor ?? 1.0;
  const baseDelay = getMoveDelay(game.score);
  const foodDelay = effectiveMoveDelay(foodEffects, foodRules, baseDelay, currentRunMs());
  const eventDelay = eventMoveDelay(foodDelay, activeEventEffects(), foodRules.minMoveDelay);
  const moveDelay = eventDelay * speedFactor;
  const interp = isOver()
    ? 1
    : interpolationAlpha(time, lastMove, moveDelay, running);
  drawBackground(time);
  drawFood(time);
  drawSnake(interp);
  drawEffects(time);
  if (isActive() || particles.length || ripples.length) animationFrame = requestAnimationFrame(animate);
}

function playTone(frequency: number, duration: number, type: OscillatorType) {
  if (muted || audioDisabled) return;
  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio is not supported');
    audioCtx ||= new AudioContextCtor();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch((error) => console.warn('[serpent] audio could not resume:', error));
    }
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    oscillator.connect(gain).connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
  } catch (error) {
    audioDisabled = true;
    console.warn('[serpent] audio disabled:', error);
  }
}

function wireInput() {
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      if (game.status === 'idle' || isOver()) startGame();
      else togglePause();
      return;
    }
    if (event.key === 'p' || event.key === 'P') {
      togglePause();
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      startGame();
      return;
    }
    if (event.key === 'm' || event.key === 'M') {
      toggleSound();
      return;
    }
    if (event.key === 'f' || event.key === 'F') {
      toggleFullscreen();
      return;
    }
    if (DIRECTIONS[event.key]) {
      event.preventDefault();
      setDirection(DIRECTIONS[event.key]);
    }
  });

  requireElement('start-button').addEventListener('click', startGame);
  requireElement('restart-button').addEventListener('click', startGame);
  requireElement('resume-button').addEventListener('click', togglePause);
  pauseButton.addEventListener('click', togglePause);
  soundButton.addEventListener('click', toggleSound);
shareButton.addEventListener('click', () => {
    shareScore().catch((error) => console.warn('[serpent] share failed:', error));
  });

  // Challenge share button - creates and shares a challenge link
  const challengeShareButton = document.getElementById('challenge-share-button');
  if (challengeShareButton) {
    challengeShareButton.addEventListener('click', () => {
      shareChallenge().catch((error) => console.warn('[serpent] challenge share failed:', error));
    });
  }

  copyButton.addEventListener('click', () => {
    copyResult().catch((error) => console.warn('[serpent] copy failed:', error));
  });

  ghostToggleInput.addEventListener('change', () => {
    profile = toggleGhostEnabled(profile, activeMode.id);
    ghostData = getGhost(profile, activeMode.id);
    saveProfile(profile);
    announce(ghostToggleInput.checked ? 'Ghost enabled.' : 'Ghost disabled.');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.mode;
      if (id && isGameModeId(id)) selectMode(id);
    });
  });

  let touchStart: { x: number; y: number } | undefined;
  let activePointerId: number | undefined;

  const handleSwipe = (event: PointerEvent) => {
    if (!touchStart || event.pointerId !== activePointerId) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    setDirection(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
    touchStart = undefined;
  };

  canvas.addEventListener('pointerdown', (event) => {
    activePointerId = event.pointerId;
    touchStart = { x: event.clientX, y: event.clientY };
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch (error) {
      console.warn('[serpent] pointer capture unavailable:', error);
    }
  });
  canvas.addEventListener('pointermove', handleSwipe);
  canvas.addEventListener('pointerup', (event) => {
    handleSwipe(event);
    if (event.pointerId === activePointerId) {
      touchStart = undefined;
      activePointerId = undefined;
    }
  });
  canvas.addEventListener('pointercancel', () => {
    touchStart = undefined;
    activePointerId = undefined;
  });

  document.querySelectorAll<HTMLButtonElement>('.direction-button').forEach((button) => {
    const applyDirection = (event: Event) => {
      event.preventDefault();
      const dir = button.dataset.direction;
      if (dir) setDirection(TOUCH_DIRECTIONS[dir]);
    };
    button.addEventListener('pointerdown', applyDirection);
    button.addEventListener('click', (event) => {
      if (event.detail === 0) applyDirection(event);
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRunning()) togglePause();
  });
  window.addEventListener('blur', () => {
    if (isRunning()) togglePause();
  });
}

export function mountGame() {
  try {
    createStars();
    backgroundCache = createBackgroundCache();
    soundButton.setAttribute('aria-pressed', String(muted));
    soundButtonLabel.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    ensureDailyForToday();
    const initial = createInitialState();
    if (activeMode.id === 'daily') {
      game = {
        ...initial,
        food: firstDailyFood(initial.snake),
        foodType: 'normal',
      };
    } else {
      const placed = rollPlacedFood(initial.snake, Math.random, foodRules);
      game = { ...initial, food: placed?.cell ?? null, foodType: placed?.type ?? 'normal' };
    }
    prevSnake = game.snake.map(s => ({ ...s }));
    wireInput();
    wireFullscreen();
    ensureDailyForToday();
    refreshModeUI();
    refreshMissionsUI();
    refreshWeeklyGoalsUI();
    // Retroactive grants (seeded bests, lifetime counters) are applied silently
    // at boot so a returning player is not spammed with toasts.
    dispatchAchievements(true);
    dispatchCosmetics(true);
    dispatchStreakRewards(true);
    // Weekly goals: load for current week (handles week boundary).
    weeklyGoalsSave = loadWeeklyGoals(profile);
    setModePickerVisible(true);
    updateHud();
    drawBackground(0);
    drawFood(0);
    drawSnake(0);
    if (import.meta.env.DEV) {
      (window as unknown as { __serpent?: object }).__serpent = {
        getGame: () => game,
        getMode: () => activeMode.id,
        getDaily: () => dailyChallenge,
        getDailyFoodIndex: () => dailyFoodIndex,
        getTodayKey: () => todayKey,
        getProfile: () => profile,
        getRank: () => rankProgress(profile.xp).rank.name,
        getMissions: () => missionSave.active,
        getAchievements: () => profile.unlockedAchievements,
        getFoodType: () => game.foodType,
        getFoodEffects: () => foodEffects,
        forceFoodType: (type: string) => {
          const valid: FoodType[] = ['normal', 'golden', 'slow', 'multiplier', 'cursed', 'time'];
          if (valid.includes(type as FoodType)) {
            game = { ...game, foodType: type as FoodType };
          }
        },
        selectMode: (id: string) => {
          if (isGameModeId(id)) selectMode(id);
        },
        getEvents: () => eventState,
        getEventRules: () => eventRules,
        forceEvent: (id: string) => {
          if (eventRules.enabled && isEventId(id)) {
            const def = EVENT_DEFINITIONS[id as EventId];
            eventState = { activeEventId: id as EventId, eventUntil: currentRunMs() + def.durationMs, lastEventAt: currentRunMs(), triggered: eventState.triggered + 1 };
            startEvent(id as EventId);
          }
        },
      };
    }
  } catch (error) {
    reportFatalError(error);
    throw error;
  }
}

// The challenge must flip automatically at the next local midnight even if the
// tab stays open. When idle the start overlay refreshes immediately; a run in
// progress is never interrupted — the next start regenerates for the new day.
function scheduleMidnightRefresh() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50);
  const delay = Math.max(1000, next.getTime() - now.getTime());
  window.setTimeout(() => {
    if (activeMode.id === 'daily' && !isActive()) {
      ensureDailyForToday();
      refreshDailyUI();
    }
    scheduleMidnightRefresh();
  }, delay);
}

/** Determine the next goal for the player to pursue. */
function getNextGoal(profile: PlayerProfile, mode: GameModeId): { text: string } | null {
  const rank = rankProgress(profile.xp);
  const nextRank = rank.next;
  
  // 1. Next rank
  if (nextRank) {
    const xpNeeded = nextRank.minXp - profile.xp;
    return { text: `Reach ${nextRank.name} (${xpNeeded} XP)` };
  }

  // 2. Next mission (check active missions)
  const activeMissions = missionSave.active.filter(m => !m.completed);
  if (activeMissions.length > 0) {
    const m = activeMissions[0];
    const remaining = m.target - m.progress;
    return { text: `Complete "${m.title}" (${remaining} more)` };
  }

  // 3. Next streak reward
  const streakRewards = STREAK_REWARDS.filter(r => r.day > (profile.streakRewardsClaimed?.length || 0));
  if (streakRewards.length > 0) {
    const next = streakRewards[0];
    const currentStreak = computeDailyStreak(readStoredDailyHistory(), dailyDateKey());
    const daysNeeded = next.day - currentStreak;
    if (daysNeeded > 0) {
      return { text: `Reach ${next.day}-day streak for ${next.label} (${daysNeeded} more days)` };
    }
  }

  // 4. Next weekly goal
  const weeklyGoals = weeklyGoalsSave.active.filter(g => !g.completed);
  if (weeklyGoals.length > 0) {
    const g = weeklyGoals[0];
    const remaining = g.target - g.progress;
    return { text: `Weekly: ${g.title} (${remaining} more)` };
  }

  // 5. Next cosmetic unlock
  const daily = computeDailyStats(readStoredDailyHistory(), dailyDateKey());
  const availableCosmetics = evaluateCosmetics(profile, daily);
  if (availableCosmetics.length > 0) {
    return { text: `Unlock ${availableCosmetics[0].name} cosmetic` };
  }

  // 6. Next rank/XP goal (if at max rank)
  return { text: 'Max rank achieved! Chase a new personal best.' };
}