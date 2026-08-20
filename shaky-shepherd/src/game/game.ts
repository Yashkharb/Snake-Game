import {
  buildShareMessage,
  CELLS,
  createInitialState,
  formatCountdown,
  formatDuration,
  getLevel,
  getMoveDelay,
  queueDirection,
  spawnFood,
  startRun,
  step as stepGame,
  togglePause as togglePauseGame,
} from './core.ts';
import type { GameState, Vec, Cell, DeathReason } from './core.ts';
import { DEFAULT_MODE_ID, getMode, isGameModeId } from './modes.ts';
import type { GameMode, GameModeId } from './modes.ts';
import {
  buildDailyShareMessage,
  dailyDateKey,
  dailyFoodFor,
  DAILY_FOOD_COUNT,
  formatDailyDate,
  generateDailyChallenge,
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
const dailyDateEl = requireElement('daily-date');
const dailyBestEl = requireElement('daily-best');
const dailyStreakEl = requireElement('daily-streak');
const copyButton = requireElement<HTMLButtonElement>('copy-button');
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
    case 'daily':
      startModeInfo.textContent = `FRUITS ${dailyProgress()} / ${DAILY_FOOD_COUNT}`;
      break;
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
  return Math.max(0, Math.min(DAILY_FOOD_COUNT, dailyFoodIndex - 1));
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
    const status = readStoredDailyStatus();
    const today =
      status && dailyChallenge && status.dateKey === dailyChallenge.dateKey
        ? `TODAY ${String(status.score).padStart(3, '0')}${status.completed ? ' · COMPLETED' : ''}`
        : '';
    dailyBestEl.textContent = `BEST ${String(highScore).padStart(3, '0')}${today ? ` · ${today}` : ''}`;
    const streak = computeDailyStreak(readStoredDailyHistory(), dailyChallenge?.dateKey ?? '');
    dailyStreakEl.textContent = streak > 0 ? `STREAK ${streak}${streak === 1 ? ' DAY' : ' DAYS'}` : '';
    dailyStreakEl.hidden = streak === 0;
  }
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
  if (dailyFoodIndex >= DAILY_FOOD_COUNT) return null;
  return dailyFoodFor(dailyChallenge.dateKey, dailyFoodIndex, snake);
}

// Places fruit index 0 for a fresh daily run and records that one fruit is on
// the board (`dailyFoodIndex` becomes the next index to place).
function firstDailyFood(snake: Cell[]): Cell | null {
  dailyFoodIndex = 1;
  return dailyChallenge ? dailyFoodFor(dailyChallenge.dateKey, 0, snake) : null;
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
  activeMode = getMode(id);
  writePreference('mode', id);
  highScore = readStoredNumber(activeMode.bestKey, 0);
  bestLength = readStoredNumber(activeMode.bestLengthKey, 0);
  highScoreEl.textContent = String(highScore).padStart(3, '0');
  const fresh = createInitialState();
  if (id === 'daily') {
    ensureDailyForToday();
    game = {
      ...fresh,
      food: firstDailyFood(fresh.snake),
    };
  } else {
    game = { ...fresh, food: spawnFood(fresh.snake) };
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
    };
  } else {
    game = startRun(game);
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
  activeRunMs = 0;
  maxLength = game.snake.length;
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
  const prevLevel = getLevel(game.score);
  const { state: next, ate } = stepGame(game, {
    rng: Math.random,
    wrap: activeMode.rules.wrap,
    pointsPerFruit: activeMode.scoring.pointsPerFruit,
    foodSource: activeMode.id === 'daily' ? dailyFoodSource : undefined,
  });
  game = next;
  if (ate) dailyFoodIndex += 1;
  maxLength = Math.max(maxLength, game.snake.length);
  const newLevel = getLevel(game.score);
  if (newLevel > prevLevel) {
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
  if (ate) {
    const head = next.snake[0];
    makeBurst((head.x + 0.5) * CELL, (head.y + 0.5) * CELL, '#ffc285', 22);
    ripples.push({ x: (head.x + 0.5) * CELL, y: (head.y + 0.5) * CELL, age: 0, hue: 28 });
    playTone(380 + next.score * 1.5, 0.055, 'triangle');
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
  makeBurst((game.snake[0].x + 0.5) * CELL, (game.snake[0].y + 0.5) * CELL, '#c4b5fd', 55);
  const endedRun = game.runId;

  const durationMs = activeRunMs + (runStart ? performance.now() - runStart : 0);
  activeRunMs = 0;
  runStart = 0;
  lastRunMs = durationMs;

  const fruitCount = game.score / activeMode.scoring.pointsPerFruit;
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

  finalScoreEl.textContent = String(game.score).padStart(3, '0');
  finalBestEl.textContent = String(highScore).padStart(3, '0');
  finalLevelEl.textContent = String(getLevel(game.score)).padStart(2, '0');
  finalLengthEl.textContent = String(length);
  finalLongestEl.textContent = String(maxLength);
  finalRecordEl.textContent = String(bestLength);
  finalFruitEl.textContent = String(fruitCount);
  finalDurationEl.textContent = formatDuration(durationMs);
  newBestBadge.classList.toggle('is-new-best', isNewBest);

  const cleared = reason === 'cleared';
  const isDaily = activeMode.id === 'daily';
  const completed = cleared && isDaily;
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
  }

  const shareSupported = Boolean(navigator.share || (navigator.clipboard && navigator.clipboard.writeText));
  const canCopy = Boolean(navigator.clipboard && navigator.clipboard.writeText);
  lastShareText = isDaily && dailyChallenge
    ? buildDailyShareMessage(dailyChallenge.dateKey, game.score, isNewBest, completed)
    : buildShareMessage(game.score, isNewBest);
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
}

function updateHud() {
  scoreEl.textContent = String(game.score).padStart(3, '0');
  const timeLimit = activeMode.rules.timeLimitMs;
  if (timeLimit != null) {
    // Time Attack: the speed card becomes a clear, always-visible countdown.
    const remaining = Math.max(0, timeLimit - currentRunMs());
    speedLabelEl.textContent = 'TIME';
    levelEl.textContent = formatCountdown(remaining);
    speedNameEl.hidden = true;
    speedMeter.style.width = `${Math.min(100, (remaining / timeLimit) * 100)}%`;
    scoreDetail.textContent = `TARGET ${formatCountdown(timeLimit)}`;
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
  if (backgroundCache) {
    ctx.drawImage(backgroundCache, 0, 0);
  } else {
    ctx.clearRect(0, 0, SIZE, SIZE);
    const backdrop = ctx.createRadialGradient(SIZE * 0.5, SIZE * 0.45, 0, SIZE * 0.5, SIZE * 0.47, SIZE * 0.75);
    backdrop.addColorStop(0, '#171717');
    backdrop.addColorStop(0.56, '#0e0e0e');
    backdrop.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const warm = ctx.createRadialGradient(-40, -40, 0, -40, -40, SIZE * 0.55);
    warm.addColorStop(0, 'rgba(255, 122, 23, 0.05)');
    warm.addColorStop(1, 'rgba(255, 122, 23, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const cool = ctx.createRadialGradient(SIZE + 40, SIZE + 40, 0, SIZE + 40, SIZE + 40, SIZE * 0.6);
    cool.addColorStop(0, 'rgba(124, 58, 237, 0.05)');
    cool.addColorStop(1, 'rgba(124, 58, 237, 0)');
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (const star of stars) {
      ctx.fillStyle = `rgba(${star.tone}, 0.45)`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    for (let i = 0; i <= CELLS; i++) {
      const pos = i * CELL;
      ctx.strokeStyle = i % 5 === 0 ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(SIZE, pos);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
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

function drawFood(time: number) {
  const food = game.food;
  if (!food) return;
  const x = (food.x + 0.5) * CELL;
  const y = (food.y + 0.5) * CELL;
  const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 0.005) * 0.1;
  const auraRadius = CELL * 1.45 * pulse;
  const aura = ctx.createRadialGradient(x, y, 0, x, y, auraRadius);
  aura.addColorStop(0, 'rgba(255, 194, 133, 0.38)');
  aura.addColorStop(0.3, 'rgba(255, 122, 23, 0.18)');
  aura.addColorStop(1, 'rgba(255, 122, 23, 0)');
  ctx.fillStyle = aura;
  ctx.fillRect(x - auraRadius, y - auraRadius, auraRadius * 2, auraRadius * 2);

  if (!reducedMotion) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.0012);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = i % 2 ? '#ff7a17' : '#ffc285';
      ctx.globalAlpha = 0.77;
      ctx.beginPath();
      ctx.ellipse(0, -CELL * 0.27, CELL * 0.09, CELL * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const coreRadius = 13 * pulse;
  const core = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, coreRadius);
  core.addColorStop(0, '#fff7ed');
  core.addColorStop(0.22, '#ffd9a8');
  core.addColorStop(0.58, '#ff8a3d');
  core.addColorStop(1, '#ff5f1f');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
  ctx.fill();
}

function segmentHue(i: number, total: number) {
  return 24 + (Math.min(i, total - 1) / (total - 1)) * 238;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function drawSnake(interp: number) {
  const curr = game.snake;
  const prev = prevSnake.length === curr.length ? prevSnake : curr;
  const total = curr.length;
  if (!total) return;

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
    const hue0 = segmentHue(i, total);
    const hue1 = segmentHue(i - 1, total);
    ctx.strokeStyle = `hsl(${lerp(hue0, hue1, 0.5)} 85% 55%)`;
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
    ctx.shadowColor = 'rgba(255, 122, 23, 0.35)';
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
    const hue = segmentHue(i, total);
    const lightness = i === 0 ? 60 : 45 + Math.min(i, 8) * 2;
    ctx.fillStyle = `hsl(${hue} 85% ${lightness}%)`;
    ctx.beginPath();
    ctx.arc(ix, iy, r, 0, Math.PI * 2);
    ctx.fill();

    if (i === 0) {
      ctx.fillStyle = '#fff5ea';
      ctx.beginPath();
      ctx.arc(ix - r * 0.15, iy - r * 0.2, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (i % 3 === 0) {
      ctx.fillStyle = 'rgba(255, 250, 245, 0.25)';
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
    ctx.fillStyle = '#fff5ea';
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
  if (isRunning() && activeMode.rules.timeLimitMs != null && currentRunMs() >= activeMode.rules.timeLimitMs) {
    game = { ...game, status: 'gameover', deathReason: 'time' };
    endGame('time');
    updateHud();
  }
  const running = isRunning();
  if (running) {
    // Advance the simulation first, then move the clock forward. Because
    // lastMove is bumped to the tick instant, the render alpha below always
    // starts at 0 right after a move and climbs toward 1 — never backwards.
    const moveDelay = getMoveDelay(game.score);
    if (isMoveDue(time, lastMove, moveDelay)) {
      move();
      lastMove = advanceLastMove(time, lastMove, moveDelay);
    }
  }
  // Render alpha is derived from the post-update timing state. The delay is
  // re-read after a potential eat so a level-up speed change takes effect
  // immediately without any jump. A finished run stays at alpha 1 (final cell).
  const interp = isOver() ? 1 : interpolationAlpha(time, lastMove, getMoveDelay(game.score), running);
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
  copyButton.addEventListener('click', () => {
    copyResult().catch((error) => console.warn('[serpent] copy failed:', error));
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
      };
    } else {
      game = { ...initial, food: spawnFood(initial.snake) };
    }
    prevSnake = game.snake.map(s => ({ ...s }));
    wireInput();
    wireFullscreen();
    ensureDailyForToday();
    refreshModeUI();
    setModePickerVisible(true);
    scheduleMidnightRefresh();
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
        selectMode: (id: string) => {
          if (isGameModeId(id)) selectMode(id);
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