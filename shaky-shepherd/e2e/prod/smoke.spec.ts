import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/Snake-Game/');
  await expect(page.locator('.fatal-error')).toHaveCount(0);
});

test('production bundle boots without the dev-only __serpent hook', async ({ page }) => {
  const hasHook = await page.evaluate(() => typeof (window as unknown as { __serpent?: unknown }).__serpent);
  expect(hasHook).toBe('undefined');

  // The hook string must not be shipped in any emitted script either.
  const scriptSrcs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
      .map((s) => s.getAttribute('src'))
      .filter((src): src is string => Boolean(src)),
  );
  expect(scriptSrcs.length).toBeGreaterThan(0);
  for (const src of scriptSrcs) {
    const response = await page.request.get(new URL(src, page.url()).href);
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).not.toContain('__serpent');
  }
});

test('classic wall death shows the results stats and persists the best', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('serpent-high-score', '50'));
  await page.reload();
  await expect(page.locator('#high-score')).toHaveText('050');

  await page.keyboard.press('Space');
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#gameover-kicker')).toHaveText('RUN OVER');
  await expect(page.locator('#final-score')).toHaveText('000');
  await expect(page.locator('#final-best')).toHaveText('050');
  await expect(page.locator('#final-length')).toHaveText('4');
  await expect(page.locator('#new-best-badge')).not.toHaveClass(/is-new-best/);

  const stored = await page.evaluate(() => localStorage.getItem('serpent-high-score'));
  expect(stored).toBe('50');
});

test('sharing falls back to the clipboard and copies the run text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Space');
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#share-button')).toBeVisible();
  await page.locator('#share-button').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('I scored 0 in Snake Game');
});

test('restarting replays from a clean board', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(page.locator('#gameover-overlay')).toBeVisible({ timeout: 15_000 });
  await page.locator('#restart-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#gameover-overlay')).toBeHidden();
  await expect(page.locator('#score')).toHaveText('000');
  await expect(page.locator('#pause-button')).toBeEnabled();
});

test('mode switching updates the badge and the start-screen rule note', async ({ page }) => {
  await page.locator('[data-mode="zen"]').click();
  await expect(page.locator('#mode-badge')).toHaveText('ZEN');
  await expect(page.locator('#start-mode-note')).toContainText('wrap');
  await page.locator('[data-mode="time-attack"]').click();
  await expect(page.locator('#mode-badge')).toHaveText('TIME ATTACK');
});

test('desktop and portrait mobile layouts fit without overflow', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/Snake-Game/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `no horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    const board = await page.locator('#game-board').boundingBox();
    expect(board).not.toBeNull();
    expect(board!.x + board!.width, `board inside width at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(
      viewport.width + 1,
    );
  }
});