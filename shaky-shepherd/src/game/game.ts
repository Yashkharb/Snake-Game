interface Cell {
  x: number;
  y: number;
}

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

type Vec = { x: number; y: number };

const SIZE = 800;
const CELLS = 20;
const CELL = SIZE / CELLS;

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
  banner.textContent = `Serpent could not run: ${error instanceof Error ? error.message : String(error)}`;
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
const startOverlay = requireElement('start-overlay');
const pauseOverlay = requireElement('pause-overlay');
const gameoverOverlay = requireElement('gameover-overlay');
const gameoverMessage = requireElement('gameover-message');
const pauseButton = requireElement<HTMLButtonElement>('pause-button');

// Crisp rendering on high-density displays while keeping 800×800 logical units.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = Math.round(SIZE * dpr);
canvas.height = Math.round(SIZE * dpr);
ctx.scale(dpr, dpr);

let snake: Cell[];
let direction: Vec;
let turnQueue: Vec[];
let food: Cell | null;
let score: number;
let running = false;
let paused = false;
let gameOver = false;
let lastMove = 0;
let animationFrame = 0;
let particles: Particle[] = [];
let ripples: Ripple[] = [];
let stars: Star[] = [];
let highScore = 0;
let audioCtx: AudioContext | null = null;
let audioDisabled = false;
let runId = 0;

try {
  const stored = Number(localStorage.getItem('serpent-high-score'));
  highScore = Number.isFinite(stored) && stored > 0 ? stored : 0;
} catch {
  console.warn('[serpent] high score could not be read from localStorage');
}
highScoreEl.textContent = String(highScore).padStart(3, '0');

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
  snake = [
    { x: 10, y: 12 },
    { x: 9, y: 12 },
    { x: 8, y: 12 },
    { x: 7, y: 12 },
  ];
  direction = { x: 1, y: 0 };
  turnQueue = [];
  score = 0;
  particles = [];
  ripples = [];
  food = spawnFood();
  updateHud();
}

function spawnFood(): Cell | null {
  const openCells: Cell[] = [];
  for (let x = 1; x < CELLS - 1; x++) {
    for (let y = 1; y < CELLS - 1; y++) {
      if (!snake.some((s) => s.x === x && s.y === y)) openCells.push({ x, y });
    }
  }
  if (!openCells.length) return null;
  return openCells[Math.floor(Math.random() * openCells.length)];
}

function getLevel() {
  return Math.min(12, 1 + Math.floor(score / 40));
}

function getMoveDelay() {
  return Math.max(50, 105 - (getLevel() - 1) * 6);
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  runId += 1;
  resetGame();
  document.body.classList.add('is-playing');
  running = true;
  paused = false;
  gameOver = false;
  lastMove = performance.now() - getMoveDelay();
  startOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  pauseButton.disabled = false;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  animate(performance.now());
  playTone(220, 0.035, 'sine');
}

function togglePause() {
  if (!running || gameOver) return;
  paused = !paused;
  pauseOverlay.classList.toggle('hidden', !paused);
  pauseButton.innerHTML = paused
    ? '<span class="pause-icon" aria-hidden="true">▶</span><span>RESUME</span><kbd class="keycap" translate="no">P</kbd>'
    : '<span class="pause-icon" aria-hidden="true">Ⅱ</span><span>PAUSE</span><kbd class="keycap" translate="no">P</kbd>';
  if (!paused) {
    lastMove = performance.now();
    animate(lastMove);
  }
}

function setDirection(next: Vec) {
  if (!running || paused || gameOver) return;
  const lastPlanned = turnQueue[turnQueue.length - 1] || direction;
  if (
    (next.x === lastPlanned.x && next.y === lastPlanned.y) ||
    (next.x === -lastPlanned.x && next.y === -lastPlanned.y)
  ) {
    return;
  }
  if (turnQueue.length < 2) turnQueue.push({ ...next });
}

function move() {
  direction = turnQueue.shift() || direction;
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
  if (
    head.x < 0 ||
    head.x >= CELLS ||
    head.y < 0 ||
    head.y >= CELLS ||
    snake.some((part) => part.x === head.x && part.y === head.y)
  ) {
    endGame();
    return;
  }
  snake.unshift(head);
  if (food && head.x === food.x && head.y === food.y) {
    score += 10;
    makeBurst((head.x + 0.5) * CELL, (head.y + 0.5) * CELL, '#ffc285', 22);
    ripples.push({ x: (head.x + 0.5) * CELL, y: (head.y + 0.5) * CELL, age: 0, hue: 28 });
    food = spawnFood();
    updateHud();
    playTone(380 + score * 1.5, 0.055, 'triangle');
    if (!food) {
      endGame('cleared');
      return;
    }
  } else {
    snake.pop();
  }
}

function endGame(reason?: 'cleared') {
  running = false;
  gameOver = true;
  pauseButton.disabled = true;
  makeBurst((snake[0].x + 0.5) * CELL, (snake[0].y + 0.5) * CELL, '#c4b5fd', 55);
  const endedRun = runId;
  window.setTimeout(() => {
    if (endedRun === runId && gameOver) {
      gameoverOverlay.classList.remove('hidden');
      document.getElementById('restart-button')?.focus();
    }
  }, 390);
  const fruitCount = score / 10;
  gameoverMessage.textContent =
    reason === 'cleared'
      ? `You cleared the garden with ${fruitCount} solar fruits at level ${String(getLevel()).padStart(2, '0')}.`
      : `You gathered ${fruitCount} solar fruit${fruitCount === 1 ? '' : 's'} and reached level ${String(getLevel()).padStart(2, '0')}.`;
  if (score > highScore) {
    highScore = score;
    highScoreEl.textContent = String(highScore).padStart(3, '0');
    try {
      localStorage.setItem('serpent-high-score', String(highScore));
    } catch {
      console.warn('[serpent] high score could not be saved to localStorage');
    }
  }
  playTone(110, 0.18, 'sawtooth');
  window.setTimeout(() => playTone(73, 0.25, 'sawtooth'), 100);
}

function updateHud() {
  const level = getLevel();
  scoreEl.textContent = String(score).padStart(3, '0');
  levelEl.textContent = String(level).padStart(2, '0');
  speedNameEl.textContent = SPEED_LABELS[Math.min(SPEED_LABELS.length - 1, Math.floor((level - 1) / 2))];
  speedMeter.style.width = `${Math.min(100, 12 + (level - 1) * 8)}%`;
  scoreDetail.textContent = score ? `${snake.length} SEGMENTS SYNCHRONIZED` : 'FIND THE FIRST ORB';
}

function drawBackground(time: number) {
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
    const flicker = reducedMotion ? 0.5 : 0.22 + (Math.sin(time * 0.0016 + star.phase) + 1) * 0.16;
    ctx.fillStyle = `rgba(${star.tone}, ${flicker})`;
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

function drawFood(time: number) {
  if (!food) return;
  const x = (food.x + 0.5) * CELL;
  const y = (food.y + 0.5) * CELL;
  const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 0.005) * 0.1;
  const aura = ctx.createRadialGradient(x, y, 0, x, y, CELL * 1.45 * pulse);
  aura.addColorStop(0, 'rgba(255, 194, 133, 0.38)');
  aura.addColorStop(0.3, 'rgba(255, 122, 23, 0.18)');
  aura.addColorStop(1, 'rgba(255, 122, 23, 0)');
  ctx.fillStyle = aura;
  ctx.fillRect(x - CELL * 1.5, y - CELL * 1.5, CELL * 3, CELL * 3);

  ctx.save();
  ctx.translate(x, y);
  if (!reducedMotion) ctx.rotate(time * 0.0012);
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = i % 2 ? '#ff7a17' : '#ffc285';
    ctx.globalAlpha = 0.77;
    ctx.beginPath();
    ctx.ellipse(0, -CELL * 0.27, CELL * 0.09, CELL * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const core = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, 14);
  core.addColorStop(0, '#fff7ed');
  core.addColorStop(0.22, '#ffd9a8');
  core.addColorStop(0.58, '#ff8a3d');
  core.addColorStop(1, '#ff5f1f');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, 13 * pulse, 0, Math.PI * 2);
  ctx.fill();
}

function segmentHue(i: number, total: number) {
  return 24 + (Math.min(i, total - 1) / (total - 1)) * 238;
}

function drawSnake() {
  const segments = snake.map((current, index) => ({
    x: (current.x + 0.5) * CELL,
    y: (current.y + 0.5) * CELL,
    index,
  }));
  if (!segments.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const total = segments.length;

  for (let i = segments.length - 1; i > 0; i--) {
    const a = segments[i];
    const b = segments[i - 1];
    const width = Math.max(15, CELL * (0.66 - Math.min(i, 11) * 0.014));
    const trail = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    trail.addColorStop(0, `hsla(${segmentHue(i, total)}, 85%, ${47 + Math.min(i, 8)}%, 0.78)`);
    trail.addColorStop(1, `hsla(${segmentHue(i - 1, total)}, 88%, 62%, 0.96)`);
    ctx.strokeStyle = trail;
    ctx.lineWidth = width;
    ctx.shadowBlur = 13;
    ctx.shadowColor = i < 5 ? 'rgba(255, 122, 23, 0.9)' : 'rgba(124, 58, 237, 0.9)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const r = Math.max(7, CELL * (0.3 - Math.min(i, 12) * 0.006));
    const hue = segmentHue(i, total);
    const grad = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.4, 1, s.x, s.y, r * 1.2);
    grad.addColorStop(0, i === 0 ? '#fff5ea' : `hsl(${hue} 92% 70%)`);
    grad.addColorStop(0.25, i === 0 ? '#ffb06b' : `hsl(${hue} 88% 48%)`);
    grad.addColorStop(1, i === 0 ? '#ff5f1f' : `hsl(${hue} 78% 24%)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (i % 2 === 0 && i > 1) {
      ctx.fillStyle = 'rgba(255, 250, 245, 0.36)';
      ctx.beginPath();
      ctx.arc(s.x - r * 0.2, s.y - r * 0.28, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const head = segments[0];
  const ex = direction.x;
  const ey = direction.y;
  const sx = -direction.y;
  const sy = direction.x;
  for (const side of [-1, 1]) {
    const eyeX = head.x + ex * 7 + sx * side * 7;
    const eyeY = head.y + ey * 7 + sy * side * 7;
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, 4.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff5ea';
    ctx.beginPath();
    ctx.arc(eyeX + ex * 1.2, eyeY + ey * 1.2, 1.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function makeBurst(x: number, y: number, color: string, count: number) {
  const actual = reducedMotion ? Math.round(count * 0.5) : count;
  for (let i = 0; i < actual; i++) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = 1.2 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 1, size: 1 + Math.random() * 3, color });
  }
}

function drawEffects() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  particles = particles.filter((p) => p.life > 0.02);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life *= 0.95;
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ripples = ripples.filter((r) => r.age < 1);
  for (const r of ripples) {
    r.age += reducedMotion ? 0.04 : 0.023;
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
    step(time);
  } catch (error) {
    running = false;
    paused = false;
    gameOver = true;
    cancelAnimationFrame(animationFrame);
    pauseButton.disabled = true;
    reportFatalError(error);
  }
}

function step(time: number) {
  const elapsed = time - lastMove;
  if (running && !paused && elapsed >= getMoveDelay()) {
    const moveDelay = getMoveDelay();
    move();
    lastMove += moveDelay;
    if (time - lastMove > moveDelay) lastMove = time;
  }
  drawBackground(time);
  drawFood(time);
  drawSnake();
  drawEffects();
  if (running || particles.length) animationFrame = requestAnimationFrame(animate);
}

function playTone(frequency: number, duration: number, type: OscillatorType) {
  if (audioDisabled) return;
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
      if (!running || gameOver) startGame();
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
    if (DIRECTIONS[event.key]) {
      event.preventDefault();
      setDirection(DIRECTIONS[event.key]);
    }
  });

  requireElement('start-button').addEventListener('click', startGame);
  requireElement('restart-button').addEventListener('click', startGame);
  requireElement('resume-button').addEventListener('click', togglePause);
  pauseButton.addEventListener('click', togglePause);

  let touchStart: { x: number; y: number } | undefined;
  let activePointerId: number | undefined;

  const handleSwipe = (event: PointerEvent) => {
    if (!touchStart || event.pointerId !== activePointerId) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    setDirection(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
    touchStart = { x: event.clientX, y: event.clientY };
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
    if (document.hidden && running && !paused && !gameOver) togglePause();
  });
  window.addEventListener('blur', () => {
    if (running && !paused && !gameOver) togglePause();
  });
}

export function mountGame() {
  try {
    createStars();
    resetGame();
    wireInput();
    drawBackground(0);
    drawFood(0);
    drawSnake();
  } catch (error) {
    reportFatalError(error);
    throw error;
  }
}