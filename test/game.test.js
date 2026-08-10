import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGame } from './harness.js';

/** The snake after eating `eaten` fruits laid out straight ahead of the spawn position. */
function snakeAfter(eaten) {
  return Array.from({ length: 4 + eaten }, (unused, index) => ({ x: 10 + eaten - index, y: 12 }));
}

describe('game.js', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.className = '';
  });

  describe('initial render', () => {
    it('draws the idle board and resets the hud', async () => {
      const game = await loadGame();

      expect(game.text('score')).toBe('000');
      expect(game.text('level')).toBe('01');
      expect(game.text('speed-name')).toBe('FLOW');
      expect(game.text('score-detail')).toBe('FIND THE FIRST ORB');
      expect(game.element('speed-meter').style.width).toBe('12%');
      expect(game.isHidden('start-overlay')).toBe(false);
      expect(game.element('pause-button').disabled).toBe(true);
      expect(game.hasPendingFrame()).toBe(false);
    });

    it('restores the stored high score', async () => {
      localStorage.setItem('serpent-high-score', '250');
      const game = await loadGame();

      expect(game.text('high-score')).toBe('250');
    });

    it('falls back to zero when the stored high score is unusable', async () => {
      localStorage.setItem('serpent-high-score', 'not-a-number');
      const game = await loadGame();

      expect(game.text('high-score')).toBe('000');
    });
  });

  describe('starting a run', () => {
    it('hides the overlays and starts the loop on space', async () => {
      const game = await loadGame();

      const event = game.press(' ', { code: 'Space' });

      expect(event.defaultPrevented).toBe(true);
      expect(game.isHidden('start-overlay')).toBe(true);
      expect(game.isHidden('pause-overlay')).toBe(true);
      expect(game.isHidden('gameover-overlay')).toBe(true);
      expect(game.element('pause-button').disabled).toBe(false);
      expect(document.body.classList.contains('is-playing')).toBe(true);
      expect(game.hasPendingFrame()).toBe(true);
    });

    it('starts from the start button and the restart button', async () => {
      const game = await loadGame();

      game.click('start-button');
      expect(document.body.classList.contains('is-playing')).toBe(true);

      game.click('restart-button');
      expect(game.text('score')).toBe('000');
      expect(game.hasPendingFrame()).toBe(true);
    });

    it('restarts the run when R is pressed', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 12 });
      game.click('start-button');
      expect(game.text('score')).toBe('010');

      game.press('R');

      expect(game.text('score')).toBe('000');
      expect(game.text('score-detail')).toBe('FIND THE FIRST ORB');
    });
  });

  describe('movement and food', () => {
    it('eats food in the snake path and grows the snake', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 12 });

      game.click('start-button');

      expect(game.text('score')).toBe('010');
      expect(game.text('score-detail')).toBe('5 SEGMENTS SYNCHRONIZED');
    });

    it('keeps the score when the head misses the food', async () => {
      const game = await loadGame();
      game.foodAt({ x: 3, y: 3 });

      game.click('start-button');
      game.step();

      expect(game.text('score')).toBe('000');
    });

    it('only moves once the move delay has elapsed', async () => {
      const game = await loadGame();
      game.foodAt({ x: 12, y: 12 });
      game.click('start-button');

      game.frame(10);
      expect(game.text('score')).toBe('000');

      game.frame(200);
      expect(game.text('score')).toBe('010');
    });

    it('raises the level and speed label as the score climbs', async () => {
      const game = await loadGame();
      // Line up four fruits straight ahead: one per spawn, each seen by a longer snake.
      for (let eaten = 0; eaten < 4; eaten++) game.foodAt({ x: 11 + eaten, y: 12 }, snakeAfter(eaten));

      game.click('start-button');
      game.step();
      game.step();
      game.step();

      expect(game.text('score')).toBe('040');
      expect(game.text('level')).toBe('02');
      expect(game.text('speed-name')).toBe('FLOW');
      expect(game.element('speed-meter').style.width).toBe('20%');
    });
  });

  describe('steering', () => {
    it('applies a perpendicular turn on the next move', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 13 });
      game.click('start-button');

      game.press('ArrowDown');
      game.step();

      expect(game.text('score')).toBe('010');
    });

    it('ignores a reversal into the snake body', async () => {
      const game = await loadGame();
      game.foodAt({ x: 12, y: 12 });
      game.click('start-button');

      game.press('ArrowLeft');
      game.step();

      expect(game.text('score')).toBe('010');
    });

    it('accepts wasd keys', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 11 });
      game.click('start-button');

      game.press('w');
      game.step();

      expect(game.text('score')).toBe('010');
    });

    it('buffers at most two queued turns', async () => {
      const game = await loadGame();
      game.foodAt({ x: 10, y: 13 });
      game.click('start-button');

      game.press('ArrowDown');
      game.press('ArrowLeft');
      game.press('ArrowUp'); // dropped: the buffer already holds two turns
      game.step(); // down to (11, 13)
      game.step(); // left to (10, 13)

      expect(game.text('score')).toBe('010');
    });

    it('ignores steering before the run starts', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 12 });

      game.press('ArrowUp');
      game.click('start-button');

      expect(game.text('score')).toBe('010');
    });

    it('steers from the direction pad', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 11 });
      game.click('start-button');

      const button = document.querySelector('[data-direction="up"]');
      const event = new window.Event('pointerdown', { bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      game.step();

      expect(event.defaultPrevented).toBe(true);
      expect(game.text('score')).toBe('010');
    });

    it('steers from a keyboard activated direction pad button', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 11 });
      game.click('start-button');

      const button = document.querySelector('[data-direction="up"]');
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
      game.step();

      expect(game.text('score')).toBe('010');
    });
  });

  describe('swipe controls', () => {
    it('turns on a swipe longer than the threshold', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 13 });
      game.click('start-button');

      game.pointer('pointerdown', { x: 100, y: 100 });
      game.pointer('pointermove', { x: 100, y: 140 });
      game.step();

      expect(game.text('score')).toBe('010');
    });

    it('ignores a swipe shorter than the threshold', async () => {
      const game = await loadGame();
      game.foodAt({ x: 12, y: 12 });
      game.click('start-button');

      game.pointer('pointerdown', { x: 100, y: 100 });
      game.pointer('pointermove', { x: 100, y: 110 });
      game.step();

      expect(game.text('score')).toBe('010');
    });

    it('ignores pointer moves from another pointer', async () => {
      const game = await loadGame();
      game.foodAt({ x: 12, y: 12 });
      game.click('start-button');

      game.pointer('pointerdown', { x: 100, y: 100, pointerId: 1 });
      game.pointer('pointermove', { x: 100, y: 160, pointerId: 2 });
      game.step();

      expect(game.text('score')).toBe('010');
    });

    it('stops steering once the gesture ends', async () => {
      const game = await loadGame();
      game.foodAt({ x: 12, y: 12 });
      game.click('start-button');

      game.pointer('pointerdown', { x: 100, y: 100 });
      game.pointer('pointerup', { x: 100, y: 100 });
      game.pointer('pointermove', { x: 100, y: 160 });
      game.step();

      expect(game.text('score')).toBe('010');
    });

    it('stops steering when the gesture is cancelled', async () => {
      const game = await loadGame();
      game.foodAt({ x: 12, y: 12 });
      game.click('start-button');

      game.pointer('pointerdown', { x: 100, y: 100 });
      game.pointer('pointercancel', { x: 100, y: 100 });
      game.pointer('pointermove', { x: 100, y: 160 });
      game.step();

      expect(game.text('score')).toBe('010');
    });
  });

  describe('pausing', () => {
    it('freezes the run and resumes it', async () => {
      const game = await loadGame();
      game.foodAt({ x: 13, y: 12 });
      game.click('start-button');

      game.press('p');
      expect(game.isHidden('pause-overlay')).toBe(false);
      expect(game.element('pause-button').textContent).toContain('RESUME');

      game.step();
      game.step();
      expect(game.text('score')).toBe('000');

      game.press('p');
      expect(game.isHidden('pause-overlay')).toBe(true);
      expect(game.element('pause-button').textContent).toContain('PAUSE');

      game.step();
      game.step();
      expect(game.text('score')).toBe('010');
    });

    it('toggles from the pause button and the resume button', async () => {
      const game = await loadGame();
      game.click('start-button');

      game.click('pause-button');
      expect(game.isHidden('pause-overlay')).toBe(false);

      game.click('resume-button');
      expect(game.isHidden('pause-overlay')).toBe(true);
    });

    it('pauses and resumes with space during a run', async () => {
      const game = await loadGame();
      game.click('start-button');

      game.press(' ', { code: 'Space' });
      expect(game.isHidden('pause-overlay')).toBe(false);

      game.press(' ', { code: 'Space' });
      expect(game.isHidden('pause-overlay')).toBe(true);
    });

    it('does nothing before the run starts', async () => {
      const game = await loadGame();

      game.press('p');

      expect(game.isHidden('pause-overlay')).toBe(true);
    });
  });

  describe('ending a run', () => {
    it('ends the run when the snake hits a wall', async () => {
      const game = await loadGame();
      game.foodAt({ x: 3, y: 3 });
      game.click('start-button');

      for (let i = 0; i < 9; i++) game.step();

      expect(game.element('pause-button').disabled).toBe(true);
      expect(game.text('gameover-message')).toBe('You gathered 0 solar fruits and reached level 01.');

      vi.advanceTimersByTime(400);
      expect(game.isHidden('gameover-overlay')).toBe(false);
    });

    it('ends the run when the snake bites itself', async () => {
      const game = await loadGame();
      game.foodAt({ x: 3, y: 3 });
      game.click('start-button');

      game.press('ArrowDown');
      game.step();
      game.press('ArrowLeft');
      game.step();
      game.press('ArrowUp');
      game.step();

      vi.advanceTimersByTime(400);
      expect(game.isHidden('gameover-overlay')).toBe(false);
    });

    it('uses the singular fruit wording for a single fruit', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 12 });
      game.foodAt({ x: 3, y: 3 }, snakeAfter(1));
      game.click('start-button');

      for (let i = 0; i < 9; i++) game.step();

      expect(game.text('gameover-message')).toBe('You gathered 1 solar fruit and reached level 01.');
    });

    it('stores a new high score', async () => {
      const game = await loadGame();
      game.foodAt({ x: 11, y: 12 });
      game.foodAt({ x: 3, y: 3 }, snakeAfter(1));
      game.click('start-button');

      for (let i = 0; i < 9; i++) game.step();

      expect(game.text('high-score')).toBe('010');
      expect(localStorage.getItem('serpent-high-score')).toBe('10');
    });

    it('keeps a higher stored high score', async () => {
      localStorage.setItem('serpent-high-score', '500');
      const game = await loadGame();
      game.foodAt({ x: 3, y: 3 });
      game.click('start-button');

      for (let i = 0; i < 9; i++) game.step();

      expect(game.text('high-score')).toBe('500');
      expect(localStorage.getItem('serpent-high-score')).toBe('500');
    });

    it('ignores pause input after the run ends', async () => {
      const game = await loadGame();
      game.foodAt({ x: 3, y: 3 });
      game.click('start-button');
      for (let i = 0; i < 9; i++) game.step();

      game.press('p');

      expect(game.isHidden('pause-overlay')).toBe(true);
    });

    it('does not show the overlay of an abandoned run after a restart', async () => {
      const game = await loadGame();
      game.foodAt({ x: 3, y: 3 });
      game.click('start-button');
      for (let i = 0; i < 9; i++) game.step();

      game.press('R');
      vi.advanceTimersByTime(400);

      expect(game.isHidden('gameover-overlay')).toBe(true);
    });

    it('keeps animating the death particles after the run ends', async () => {
      const game = await loadGame();
      game.foodAt({ x: 3, y: 3 });
      game.click('start-button');
      for (let i = 0; i < 9; i++) game.step();

      expect(game.hasPendingFrame()).toBe(true);
    });
  });

  describe('rendering', () => {
    it('redraws the board, the food and the snake every frame', async () => {
      const game = await loadGame();
      game.click('start-button');
      game.context.calls.length = 0;

      game.step();

      const methods = game.context.calls.map(call => call.method);
      expect(methods).toContain('clearRect');
      expect(methods).toContain('fillRect');
      expect(methods).toContain('arc');
      expect(methods).toContain('strokeRect');
    });

    it('survives without an audio context', async () => {
      const game = await loadGame();

      expect(() => game.click('start-button')).not.toThrow();
    });
  });
});
