function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing required element #${id}`);
  return element;
}

function reportFatalError(error) {
  console.error('[serpent]', error);
  const banner = document.querySelector('.fatal-error') || document.createElement('p');
  banner.className = 'fatal-error';
  banner.setAttribute('role', 'alert');
  banner.textContent = `Serpent could not run: ${error instanceof Error ? error.message : String(error)}`;
  document.body.append(banner);
}

let canvas, ctx, scoreEl, highScoreEl, levelEl, speedNameEl, speedMeter, scoreDetail;
let startOverlay, pauseOverlay, gameoverOverlay, gameoverMessage, pauseButton;

try {
  canvas = requireElement('game');
  ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser did not provide a 2D canvas context');
  scoreEl = requireElement('score');
  highScoreEl = requireElement('high-score');
  levelEl = requireElement('level');
  speedNameEl = requireElement('speed-name');
  speedMeter = requireElement('speed-meter');
  scoreDetail = requireElement('score-detail');
  startOverlay = requireElement('start-overlay');
  pauseOverlay = requireElement('pause-overlay');
  gameoverOverlay = requireElement('gameover-overlay');
  gameoverMessage = requireElement('gameover-message');
  pauseButton = requireElement('pause-button');
} catch (error) {
  reportFatalError(error);
  throw error;
}

const SIZE = 800;
const CELLS = 20;
const CELL = SIZE / CELLS;
const directions = {
  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 }
};
const PAUSE_LABEL = '<span class="pause-icon">Ⅱ</span><span>PAUSE</span><kbd>P</kbd>';
const RESUME_LABEL = '<span class="pause-icon">▶</span><span>RESUME</span><kbd>P</kbd>';
const speedLabels = ['FLOW', 'PULSE', 'SURGE', 'HYPER', 'NOVA', 'LUDICROUS'];

let snake, direction, turnQueue, food, score, running, paused, gameOver;
let lastMove = 0, animationFrame, particles = [], ripples = [], stars = [], highScore = 0, audioCtx, runId = 0;
let audioDisabled = false;

try {
  const stored = Number(localStorage.getItem('serpent-high-score'));
  highScore = Number.isFinite(stored) && stored > 0 ? stored : 0;
} catch (error) {
  console.warn('[serpent] high score could not be read from localStorage:', error);
}
highScoreEl.textContent = String(highScore).padStart(3, '0');

function createStars() {
  stars = Array.from({ length: 100 }, () => ({
    x: Math.random() * SIZE, y: Math.random() * SIZE, r: Math.random() * 1.5 + .2,
    phase: Math.random() * Math.PI * 2, tone: Math.random() > .82 ? '203, 175, 255' : '141, 217, 255'
  }));
}

function resetGame() {
  snake = [{ x: 10, y: 12 }, { x: 9, y: 12 }, { x: 8, y: 12 }, { x: 7, y: 12 }];
  direction = { x: 1, y: 0 };
  turnQueue = [];
  score = 0;
  particles = [];
  ripples = [];
  food = spawnFood();
  updateHud();
}

function spawnFood() {
  const openCells = [];
  for (let x = 0; x < CELLS; x++) {
    for (let y = 0; y < CELLS; y++) {
      if (!snake.some(s => s.x === x && s.y === y)) openCells.push({ x, y });
    }
  }
  // No open cell left means the board is cleared; callers must handle the null.
  if (!openCells.length) return null;
  return openCells[Math.floor(Math.random() * openCells.length)];
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  runId += 1;
  resetGame();
  // Drives the compact in-game layout; the start screen chrome never returns.
  document.body.classList.add('is-started');
  running = true;
  paused = false;
  gameOver = false;
  pauseButton.innerHTML = PAUSE_LABEL;
  // Begin on the next frame, so tapping Start feels instant instead of delayed.
  lastMove = performance.now() - getMoveDelay();
  startOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  pauseButton.disabled = false;
  animate(performance.now());
  playTone(220, .035, 'sine');
}

function togglePause() {
  if (!running || gameOver) return;
  paused = !paused;
  pauseOverlay.classList.toggle('hidden', !paused);
  pauseButton.innerHTML = paused ? RESUME_LABEL : PAUSE_LABEL;
  // Cancel first: a pending frame from the particle tail would otherwise leave
  // two loops running for the rest of the session.
  cancelAnimationFrame(animationFrame);
  if (!paused) { lastMove = performance.now(); animationFrame = requestAnimationFrame(animate); }
}

function setDirection(next) {
  if (!running || paused || gameOver) return;
  const lastPlannedDirection = turnQueue[turnQueue.length - 1] || direction;
  if ((next.x === lastPlannedDirection.x && next.y === lastPlannedDirection.y) ||
      (next.x === -lastPlannedDirection.x && next.y === -lastPlannedDirection.y)) return;
  // Keep a short input buffer: fast turns from a swipe or D-pad tap are never lost.
  if (turnQueue.length < 2) turnQueue.push({ ...next });
}

function move() {
  direction = turnQueue.shift() || direction;
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
  const willGrow = !!food && head.x === food.x && head.y === food.y;
  // The tail vacates its cell on this tick unless the snake grows, so following
  // your own tail is a legal move.
  const blocking = willGrow ? snake : snake.slice(0, -1);
  if (head.x < 0 || head.x >= CELLS || head.y < 0 || head.y >= CELLS || blocking.some(part => part.x === head.x && part.y === head.y)) {
    endGame();
    return;
  }
  snake.unshift(head);
  if (willGrow) {
    score += 10;
    makeBurst((head.x + .5) * CELL, (head.y + .5) * CELL, '#ff9a8d', 22);
    ripples.push({ x: (head.x + .5) * CELL, y: (head.y + .5) * CELL, age: 0, hue: 337 });
    food = spawnFood();
    updateHud();
    playTone(380 + score * 1.5, .055, 'triangle');
    if (!food) { endGame('cleared'); return; }
  } else {
    snake.pop();
  }
}

function endGame(reason) {
  running = false;
  gameOver = true;
  pauseButton.disabled = true;
  makeBurst((snake[0].x + .5) * CELL, (snake[0].y + .5) * CELL, '#a783ff', 55);
  const endedRun = runId;
  setTimeout(() => {
    if (endedRun !== runId || !gameOver) return;
    gameoverOverlay.classList.remove('hidden');
    document.getElementById('restart-button')?.focus();
  }, 390);
  const cleared = reason === 'cleared';
  const kicker = gameoverOverlay.querySelector('.overlay-kicker');
  kicker.textContent = cleared ? 'GARDEN COMPLETE' : 'RUN TERMINATED';
  kicker.classList.toggle('failure', !cleared);
  gameoverOverlay.querySelector('h2').textContent = cleared ? 'Flawless.' : 'Beautiful chaos.';
  const fruitCount = score / 10;
  gameoverMessage.textContent = cleared
    ? `You cleared the garden with ${fruitCount} solar fruits at level ${String(getLevel()).padStart(2, '0')}.`
    : `You gathered ${fruitCount} solar fruit${fruitCount === 1 ? '' : 's'} and reached level ${String(getLevel()).padStart(2, '0')}.`;
  if (score > highScore) {
    highScore = score;
    highScoreEl.textContent = String(highScore).padStart(3, '0');
    try {
      localStorage.setItem('serpent-high-score', String(highScore));
    } catch (error) {
      console.warn('[serpent] high score could not be saved to localStorage:', error);
    }
  }
  playTone(110, .18, 'sawtooth');
  setTimeout(() => playTone(73, .25, 'sawtooth'), 100);
}

function getLevel() { return Math.min(12, 1 + Math.floor(score / 40)); }
function getMoveDelay() { return Math.max(50, 105 - (getLevel() - 1) * 6); }

function updateHud() {
  const level = getLevel();
  scoreEl.textContent = String(score).padStart(3, '0');
  scoreEl.setAttribute('aria-label', `Score ${score}`);
  levelEl.textContent = String(level).padStart(2, '0');
  speedNameEl.textContent = speedLabels[Math.min(speedLabels.length - 1, Math.floor((level - 1) / 2))];
  speedMeter.style.width = `${Math.min(100, 12 + (level - 1) * 8)}%`;
  scoreDetail.textContent = score ? `${snake.length} SEGMENTS SYNCHRONIZED` : 'FIND THE FIRST ORB';
}

function drawBackground(time) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const backdrop = ctx.createRadialGradient(SIZE * .5, SIZE * .43, 0, SIZE * .5, SIZE * .47, SIZE * .73);
  backdrop.addColorStop(0, '#0d2140');
  backdrop.addColorStop(.56, '#08172d');
  backdrop.addColorStop(1, '#040914');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (const star of stars) {
    const flicker = .22 + (Math.sin(time * .0016 + star.phase) + 1) * .16;
    ctx.fillStyle = `rgba(${star.tone}, ${flicker})`;
    ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 1;
  for (let i = 0; i <= CELLS; i++) {
    const pos = i * CELL;
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(136, 197, 255, .12)' : 'rgba(136, 197, 255, .055)';
    ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(SIZE, pos); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(85, 243, 213, .55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
}

function drawFood(time) {
  if (!food) return;
  const x = (food.x + .5) * CELL, y = (food.y + .5) * CELL;
  const pulse = 1 + Math.sin(time * .005) * .1;
  const aura = ctx.createRadialGradient(x, y, 0, x, y, CELL * 1.45 * pulse);
  aura.addColorStop(0, 'rgba(255, 242, 184, .4)'); aura.addColorStop(.25, 'rgba(255, 90, 132, .24)'); aura.addColorStop(1, 'rgba(255, 71, 158, 0)');
  ctx.fillStyle = aura; ctx.fillRect(x - CELL * 1.5, y - CELL * 1.5, CELL * 3, CELL * 3);
  ctx.save(); ctx.translate(x, y); ctx.rotate(time * .0012);
  for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillStyle = i % 2 ? '#ff8293' : '#ffd488'; ctx.globalAlpha = .77; ctx.beginPath(); ctx.ellipse(0, -CELL * .27, CELL * .09, CELL * .2, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  const core = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, 14); core.addColorStop(0, '#fffef1'); core.addColorStop(.22, '#fff4b7'); core.addColorStop(.58, '#ff887d'); core.addColorStop(1, '#ef477b');
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, 13 * pulse, 0, Math.PI * 2); ctx.fill();
}

function drawSnake() {
  // Render the current grid position. Interpolation made the snake appear to
  // trail behind every turn, which felt like input lag.
  const segments = snake.map((current, index) => ({
    x: (current.x + .5) * CELL, y: (current.y + .5) * CELL, index
  }));
  if (!segments.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = segments.length - 1; i > 0; i--) {
    const a = segments[i], b = segments[i - 1];
    const width = Math.max(15, CELL * (.66 - Math.min(i, 11) * .014));
    const trail = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    trail.addColorStop(0, `hsla(${248 - i * 1.8}, 73%, ${47 + Math.min(i, 8)}%, .78)`);
    trail.addColorStop(1, 'hsla(166, 88%, 66%, .96)');
    ctx.strokeStyle = trail; ctx.lineWidth = width; ctx.shadowBlur = 13; ctx.shadowColor = i < 5 ? '#4ef1d6' : '#7d74e6';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]; const r = Math.max(7, CELL * (.30 - Math.min(i, 12) * .006));
    const grad = ctx.createRadialGradient(s.x - r * .3, s.y - r * .4, 1, s.x, s.y, r * 1.2);
    grad.addColorStop(0, i === 0 ? '#edffff' : '#b5ffe8'); grad.addColorStop(.25, i === 0 ? '#73ffdd' : '#57dcbf'); grad.addColorStop(1, i === 0 ? '#3478bd' : '#4b53ad');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    if (i % 2 === 0 && i > 1) { ctx.fillStyle = 'rgba(232,255,252,.36)'; ctx.beginPath(); ctx.arc(s.x - r * .2, s.y - r * .28, r * .16, 0, Math.PI * 2); ctx.fill(); }
  }
  const head = segments[0];
  const ex = direction.x, ey = direction.y, sx = -direction.y, sy = direction.x;
  for (const side of [-1, 1]) {
    const eyeX = head.x + ex * 7 + sx * side * 7, eyeY = head.y + ey * 7 + sy * side * 7;
    ctx.fillStyle = '#071123'; ctx.beginPath(); ctx.arc(eyeX, eyeY, 4.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8fffd'; ctx.beginPath(); ctx.arc(eyeX + ex * 1.2, eyeY + ey * 1.2, 1.35, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function makeBurst(x, y, color, count) {
  for (let i = 0; i < count; i++) { const angle = Math.random() * Math.PI * 2, velocity = 1.2 + Math.random() * 5; particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 1, size: 1 + Math.random() * 3, color }); }
}
function drawEffects() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  particles = particles.filter(p => p.life > .02);
  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= .96; p.vy *= .96; p.life *= .95; ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill(); }
  ripples = ripples.filter(r => r.age < 1);
  for (const r of ripples) { r.age += .023; ctx.globalAlpha = 1 - r.age; ctx.strokeStyle = `hsla(${r.hue}, 95%, 72%, .85)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(r.x, r.y, 10 + r.age * 45, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}

function animate(time) {
  try {
    step(time);
  } catch (error) {
    // A throw inside the loop would otherwise stop the game with a frozen board.
    running = false;
    paused = false;
    gameOver = true;
    cancelAnimationFrame(animationFrame);
    pauseButton.disabled = true;
    reportFatalError(error);
  }
}

function step(time) {
  const elapsed = time - lastMove;
  if (running && !paused && elapsed >= getMoveDelay()) {
    const moveDelay = getMoveDelay();
    move();
    // Preserve the game rhythm instead of adding one frame of delay each move.
    lastMove += moveDelay;
    if (time - lastMove > moveDelay) lastMove = time;
  }
  drawBackground(time);
  drawFood(time);
  drawSnake();
  drawEffects();
  // Stop the loop while paused; togglePause restarts it. Otherwise resuming
  // would leave a second loop running for the rest of the session.
  if ((running && !paused) || particles.length) animationFrame = requestAnimationFrame(animate);
}

function playTone(frequency, duration, type) {
  if (audioDisabled) return;
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio is not supported');
    audioCtx ||= new AudioContextCtor();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(error => console.warn('[serpent] audio could not resume:', error));
    }
    const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain();
    oscillator.type = type; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.035, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
    oscillator.connect(gain).connect(audioCtx.destination); oscillator.start(); oscillator.stop(audioCtx.currentTime + duration);
  } catch (error) {
    // Audio is an enhancement: report once, then stay silent for the session.
    audioDisabled = true;
    console.warn('[serpent] audio disabled:', error);
  }
}

document.addEventListener('keydown', event => {
  if (event.code === 'Space') { event.preventDefault(); if (!running || gameOver) startGame(); else togglePause(); return; }
  if (event.code === 'KeyP') { togglePause(); return; }
  if (event.code === 'KeyR') { startGame(); return; }
  if (directions[event.code]) { event.preventDefault(); setDirection(directions[event.code]); }
});
document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('restart-button').addEventListener('click', startGame);
document.getElementById('resume-button').addEventListener('click', togglePause);
pauseButton.addEventListener('click', togglePause);
const touchDirections = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
};
let touchStart, activePointerId;

function handleSwipe(event) {
  if (!touchStart || event.pointerId !== activePointerId) return;
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
  setDirection(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
  // One continuous gesture can steer through several turns without lifting.
  touchStart = { x: event.clientX, y: event.clientY };
}

canvas.addEventListener('pointerdown', event => {
  activePointerId = event.pointerId;
  touchStart = { x: event.clientX, y: event.clientY };
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch (error) {
    console.warn('[serpent] pointer capture unavailable:', error);
  }
});
canvas.addEventListener('pointermove', handleSwipe);
canvas.addEventListener('pointerup', event => {
  handleSwipe(event);
  if (event.pointerId === activePointerId) { touchStart = undefined; activePointerId = undefined; }
});
canvas.addEventListener('pointercancel', () => { touchStart = undefined; activePointerId = undefined; });

document.querySelectorAll('.direction-button').forEach(button => {
  const applyDirection = event => {
    event.preventDefault();
    setDirection(touchDirections[button.dataset.direction]);
  };
  button.addEventListener('pointerdown', applyDirection);
  button.addEventListener('click', event => {
    // Pointer input has already been handled above; this preserves keyboard accessibility.
    if (event.detail === 0) applyDirection(event);
  });
});

try {
  createStars();
  resetGame();
  drawBackground(0); drawFood(0); drawSnake();
} catch (error) {
  reportFatalError(error);
  throw error;
}
