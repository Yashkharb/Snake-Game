import { test, expect, type Page } from '@playwright/test';

interface SerpentGame {
  snake: { x: number; y: number }[];
  direction: { x: number; y: number };
  food: { x: number; y: number } | null;
  score: number;
  status: string;
  runId: number;
  deathReason: string | null;
}

interface SerpentHook {
  getGame: () => SerpentGame;
  getMode: () => string;
  selectMode: (id: string) => void;
}

async function getGame(page: Page): Promise<SerpentGame> {
  return page.evaluate(() => {
    const h = (window as unknown as { __serpent?: SerpentHook }).__serpent;
    if (!h) throw new Error('__serpent hook missing — dev server required');
    return h.getGame();
  });
}

async function getMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const h = (window as unknown as { __serpent?: SerpentHook }).__serpent;
    if (!h) throw new Error('__serpent hook missing — dev server required');
    return h.getMode();
  });
}

async function selectMode(page: Page, id: string): Promise<void> {
  await page.locator(`[data-mode="${id}"]`).click();
}

const KEY_DIRS: Record<string, { x: number; y: number }> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  ArrowUp: { x: 0, y: -1 },
};
const OPPOSITE: Record<string, string> = {
  ArrowRight: 'ArrowLeft',
  ArrowLeft: 'ArrowRight',
  ArrowDown: 'ArrowUp',
  ArrowUp: 'ArrowDown',
};

// Steer the snake toward the current fruit with the arrow keys until the score
// increases (returns true) or the run dies (returns false).
async function eatFruit(page: Page): Promise<boolean> {
  const before = (await getGame(page)).score;
  for (let i = 0; i < 600; i++) {
    const g = await getGame(page);
    if (g.score > before) return true;
    if (g.status !== 'running' || !g.food) return false;
    const head = g.snake[0];
    const food = g.food;
    const dx = food.x - head.x;
    const dy = food.y - head.y;
    let key: string | null = null;
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) key = dx > 0 ? 'ArrowRight' : 'ArrowLeft';
    else if (dy !== 0) key = dy > 0 ? 'ArrowDown' : 'ArrowUp';
    if (key) {
      const current = Object.keys(KEY_DIRS).find((k) => {
        const d = KEY_DIRS[k];
        return d.x === g.direction.x && d.y === g.direction.y;
      });
      if (current && key === OPPOSITE[current]) {
        // Never queue a 180° turn — break through a perpendicular first.
        key = current === 'ArrowRight' || current === 'ArrowLeft' ? 'ArrowUp' : 'ArrowRight';
      }
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(45);
  }
  return (await getGame(page)).score > before;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/Snake-Game/');
  await expect(page.locator('.fatal-error')).toHaveCount(0);
});

test('initial state shows classic mode and a ready start screen', async ({ page }) => {
  await expect(page.locator('#mode-badge')).toHaveText('CLASSIC');
  await expect(page.locator('#start-overlay')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('000');
  await expect(page.locator('#pause-button')).toBeDisabled();
  await expect(page.locator('[data-mode]')).toHaveCount(4);
  expect(await getGame(page)).toMatchObject({ status: 'idle', score: 0, runId: 0 });
});

test('space starts the run and the HUD reflects a live game', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#pause-button')).toBeEnabled();
  const before = await getGame(page);
  expect(before).toMatchObject({ score: 0, runId: 1 });
});

test('arrow keys steer the snake', async ({ page }) => {
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => getGame(page).then((g) => g.direction.y)).toBe(-1);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => getGame(page).then((g) => g.direction.x)).toBe(1);
});

test('pause and resume work and manage focus', async ({ page }) => {
  await page.keyboard.press('Space');
  await page.keyboard.press('p');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('paused');
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect(page.locator('#resume-button')).toBeFocused();
  await page.keyboard.press('p');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  await expect(page.locator('#pause-button')).toBeFocused();
});

test('restart begins a fresh run with a new run id', async ({ page }) => {
  await page.keyboard.press('Space');
  const first = (await getGame(page)).runId;
  await page.keyboard.press('r');
  await expect.poll(() => getGame(page).then((g) => g.runId)).toBeGreaterThan(first);
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
});

test('the mode picker is locked while a run is active', async ({ page }) => {
  await expect(page.locator('#mode-picker')).toBeVisible();
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  // The picker is hidden (and therefore locked) for the whole run.
  await expect(page.locator('#mode-picker')).toBeHidden();
  await expect(page.locator('[data-mode="zen"]')).toBeHidden();
  // Ending the run restores the picker and unlocks mode switching.
  await expect.poll(() => getGame(page).then((g) => g.status), { timeout: 15_000 }).toBe('gameover');
  await expect(page.locator('#mode-picker')).toBeVisible();
  await page.locator('[data-mode="zen"]').click();
  await expect.poll(() => getMode(page)).toBe('zen');
});

test('classic run ends with a wall death and correct results stats', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status), { timeout: 15_000 }).toBe('gameover');
  const g = await getGame(page);
  expect(g.deathReason).toBe('wall');
  await expect(page.locator('#gameover-overlay')).toBeVisible();
  await expect(page.locator('#gameover-kicker')).toHaveText('RUN OVER');
  await expect(page.locator('#final-score')).toHaveText('000');
  await expect(page.locator('#final-best')).toHaveText('000');
  await expect(page.locator('#new-best-badge')).not.toHaveClass(/is-new-best/);
});

test('zen mode wraps at the wall instead of dying', async ({ page }) => {
  await selectMode(page, 'zen');
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  // The head starts at x=10 moving right; after crossing x=19 it re-enters at 0.
  await expect
    .poll(() => getGame(page).then((g) => g.snake[0].x), { timeout: 15_000 })
    .toBeLessThan(10);
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  await expect(page.locator('#gameover-overlay')).toBeHidden();
});

test('time attack ends with TIME UP when the clock expires', async ({ page }) => {
  await selectMode(page, 'time-attack');
  await page.clock.install();
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  await page.clock.fastForward(61_000);
  await expect(page.locator('#gameover-overlay')).toBeVisible();
  await expect(page.locator('#gameover-kicker')).toHaveText('TIME UP');
  const g = await getGame(page);
  expect(g.deathReason).toBe('time');
});

test('eating a fruit scores, grows, and records a new best', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  expect(await eatFruit(page)).toBe(true);
  const g = await getGame(page);
  expect(g.score).toBeGreaterThan(0);
  expect(g.snake.length).toBeGreaterThan(4);
  // Let the run die to flush the results screen.
  await expect.poll(() => getGame(page).then((s) => s.status), { timeout: 20_000 }).toBe('gameover');
  await expect(page.locator('#new-best-badge')).toHaveClass(/is-new-best/);
  await expect(page.locator('#final-score')).not.toHaveText('000');
  const best = await page.evaluate(() => localStorage.getItem('serpent-high-score'));
  expect(Number(best)).toBe(g.score);
});

test('best score persists across a reload', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('serpent-high-score', '50'));
  await page.reload();
  await expect(page.locator('#high-score')).toHaveText('050');
});

test('daily flow: seeded board, safe food, date UI, and result persistence', async ({ page }) => {
  await selectMode(page, 'daily');
  await expect(page.locator('#daily-date')).toBeVisible();
  await expect(page.locator('#start-kicker')).toHaveText('DAILY CHALLENGE');
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  const g = await getGame(page);
  expect(g.food).not.toBeNull();
  expect(g.snake.some((s) => s.x === g.food!.x && s.y === g.food!.y)).toBe(false);
  // Daily has walls: the run ends at the perimeter like classic.
  await expect.poll(() => getGame(page).then((s) => s.status), { timeout: 15_000 }).toBe('gameover');
  await expect(page.locator('#gameover-kicker')).toHaveText('DAILY CHALLENGE');
  const status = await page.evaluate(() => JSON.parse(localStorage.getItem('serpent-daily-status') || '{}'));
  expect(typeof status.dateKey).toBe('string');
  expect(status.score).toBe(0);
  expect(status.completed).toBe(false);
});

test('live status announcements are emitted for discrete state changes', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(async () => await page.locator('#status-announcer').textContent()).toContain('Game started');
  await page.keyboard.press('p');
  await expect.poll(async () => await page.locator('#status-announcer').textContent()).toContain('Game paused');
  await page.keyboard.press('p');
  await expect.poll(async () => await page.locator('#status-announcer').textContent()).toContain('Game resumed');
});

test('desktop layout: no horizontal overflow, board fully visible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/Snake-Game/');
  await expect(page.locator('.fatal-error')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const box = await page.locator('#game-board').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280 + 1);
});

test('portrait mobile layout: compact scoreboard above a visible board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/Snake-Game/');
  await expect(page.locator('.fatal-error')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const rail = await page.locator('.stat-rail').boundingBox();
  const board = await page.locator('#game-board').boundingBox();
  expect(rail).not.toBeNull();
  expect(board).not.toBeNull();
  expect(board!.y).toBeGreaterThanOrEqual(0);
  expect(board!.y + board!.height).toBeLessThanOrEqual(844 + 1);
  expect(board!.x).toBeGreaterThanOrEqual(0);
  expect(board!.x + board!.width).toBeLessThanOrEqual(390 + 1);
});

test('short landscape: the whole board fits on screen', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto('/Snake-Game/');
  await expect(page.locator('.fatal-error')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const board = await page.locator('#game-board').boundingBox();
  expect(board).not.toBeNull();
  expect(board!.x).toBeGreaterThanOrEqual(0);
  expect(board!.x + board!.width).toBeLessThanOrEqual(667 + 1);
  expect(board!.y).toBeGreaterThanOrEqual(0);
  expect(board!.y + board!.height).toBeLessThanOrEqual(375 + 1);
});

test('sound toggle mutes via the button and the M key, persisting the preference', async ({ page }) => {
  const label = page.locator('#sound-button-label');
  await expect(label).toHaveText('SOUND ON');
  await page.locator('#sound-button').click();
  await expect(label).toHaveText('SOUND OFF');
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'true');
  const pref = await page.evaluate(() => localStorage.getItem('serpent-pref:audio'));
  expect(pref).toBe('off');

  await page.reload();
  await expect(page.locator('#sound-button-label')).toHaveText('SOUND OFF');

  await page.keyboard.press('m');
  await expect(page.locator('#sound-button-label')).toHaveText('SOUND ON');
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
});

async function waitForFullscreen(page: Page, active: boolean) {
  // The CSS class flips synchronously, but the browser's real fullscreen
  // transition is async. If we toggle again while an exit is still in
  // flight, the re-entry request gets rejected and a stale fullscreenchange
  // event flips the class back, hiding the in-board controls. Wait for
  // document.fullscreenElement to settle first. With no Fullscreen API
  // (pure-CSS fallback) there is nothing async to wait for.
  await expect
    .poll(
      () =>
        page.evaluate((want) => {
          const doc = document as Document & { webkitFullscreenElement?: Element | null };
          const el = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
          const hasApi =
            'requestFullscreen' in document.documentElement ||
            'webkitRequestFullscreen' in document.documentElement;
          if (!hasApi) return true;
          return Boolean(el) === want;
        }, active),
      { timeout: 10_000 },
    )
    .toBe(true);
}

test('fullscreen puts the board on the full screen and back again', async ({ page }) => {
  const immersive = () => page.evaluate(() => document.body.classList.contains('is-fullscreen'));

  await expect(page.locator('#fullscreen-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#fullscreen-button-label')).toHaveText('FULLSCREEN');

  await page.locator('#fullscreen-button').click();
  await expect.poll(immersive).toBe(true);
  await waitForFullscreen(page, true);
  await expect(page.locator('#fullscreen-button-label')).toHaveText('EXIT');
  // The chrome disappears and the board owns the viewport.
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.hero')).toBeHidden();
  await expect(page.locator('.stat-rail')).toBeHidden();
  await expect(page.locator('.info-rail')).toBeHidden();
  await expect(page.locator('.mode-picker')).toBeHidden();
  await expect(page.locator('.touch-controls')).toBeHidden();
  await expect(page.locator('.fs-controls')).toBeVisible();

  // Fullscreen controls stay functional: pause + sound.
  await page.keyboard.press('Space');
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('running');
  await page.locator('#fs-pause').click();
  await expect.poll(() => getGame(page).then((g) => g.status)).toBe('paused');
  await page.locator('#fs-sound').click();
  await expect(page.locator('#fs-sound-label')).toHaveText('SOUND OFF');

  // Exit via the in-board exit button.
  await page.locator('#fs-exit').click();
  await expect.poll(immersive).toBe(false);
  await waitForFullscreen(page, false);
  await expect(page.locator('#fullscreen-button-label')).toHaveText('FULLSCREEN');
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.fs-controls')).toBeHidden();

  // Re-enter via the F key, then leave again the same way.
  await page.keyboard.press('f');
  await expect.poll(immersive).toBe(true);
  await waitForFullscreen(page, true);
  await expect(page.locator('.fs-controls')).toBeVisible();

  await page.keyboard.press('f');
  await expect.poll(immersive).toBe(false);
  await waitForFullscreen(page, false);
  await expect(page.locator('.fs-controls')).toBeHidden();
});