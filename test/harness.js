import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const markup = readFileSync(join(rootDir, 'index.html'), 'utf8');

const CELLS = 20;
export const INITIAL_SNAKE = [{ x: 10, y: 12 }, { x: 9, y: 12 }, { x: 8, y: 12 }, { x: 7, y: 12 }];

/** Cells spawnFood() can choose from, in the same order the game builds them. */
function openCells(snake) {
  const cells = [];
  for (let x = 1; x < CELLS - 1; x++) {
    for (let y = 1; y < CELLS - 1; y++) {
      if (!snake.some(part => part.x === x && part.y === y)) cells.push({ x, y });
    }
  }
  return cells;
}

/** Math.random() value that makes spawnFood() pick `target` for the given snake. */
function randomForFoodAt(target, snake) {
  const cells = openCells(snake);
  const index = cells.findIndex(cell => cell.x === target.x && cell.y === target.y);
  if (index < 0) throw new Error(`cell ${target.x},${target.y} is not spawnable`);
  return (index + 0.5) / cells.length;
}

function createContextStub() {
  const gradient = { addColorStop() {} };
  const calls = [];
  const context = new Proxy({ calls, canvas: null }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'createRadialGradient' || property === 'createLinearGradient') return () => gradient;
      return (...args) => { calls.push({ method: String(property), args }); };
    },
    set(target, property, value) { target[property] = value; return true; }
  });
  return context;
}

/**
 * Loads game.js into a jsdom page with a controllable clock, animation loop and
 * Math.random, so game logic can be driven frame by frame from tests.
 */
export async function loadGame({ random = 0 } = {}) {
  document.documentElement.innerHTML = markup
    .replace(/^[\s\S]*?<html[^>]*>/, '')
    .replace(/<\/html>[\s\S]*$/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

  const context = createContextStub();
  window.HTMLCanvasElement.prototype.getContext = () => context;

  let clock = 1000;
  const randomValues = [];
  const defaultRandom = random;
  let pendingFrame = null;
  let nextFrameId = 1;

  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // Particle bursts also draw randoms, so queued values are handed out to spawnFood() only.
  const isFoodSpawn = () => (new Error().stack ?? '').includes('spawnFood');
  vi.spyOn(Math, 'random').mockImplementation(() => (
    randomValues.length && isFoodSpawn() ? randomValues.shift() : defaultRandom
  ));
  window.requestAnimationFrame = callback => { pendingFrame = callback; return nextFrameId++; };
  window.cancelAnimationFrame = () => { pendingFrame = null; };
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;

  vi.resetModules();
  await import('../game.js');

  const api = {
    context,
    element: id => document.getElementById(id),
    text: id => document.getElementById(id).textContent,
    isHidden: id => document.getElementById(id).classList.contains('hidden'),
    /** Queue the cell the next spawnFood() call should choose. */
    foodAt: (target, snake = INITIAL_SNAKE) => { randomValues.push(randomForFoodAt(target, snake)); },
    /** Advance the clock and run the frame the game scheduled, as the browser would. */
    frame: (milliseconds = 0) => {
      clock += milliseconds;
      const callback = pendingFrame;
      pendingFrame = null;
      callback?.(clock);
      return Boolean(callback);
    },
    hasPendingFrame: () => Boolean(pendingFrame),
    press: (key, extra = {}) => {
      const event = new window.KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...extra });
      document.dispatchEvent(event);
      return event;
    },
    click: id => document.getElementById(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true })),
    pointer: (type, { x = 0, y = 0, pointerId = 1 } = {}) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { clientX: x, clientY: y, pointerId });
      document.getElementById('game').dispatchEvent(event);
      return event;
    },
    /** Play a full move: wait out the move delay, then run one animation frame. */
    step: (milliseconds = 200) => api.frame(milliseconds)
  };
  return api;
}
