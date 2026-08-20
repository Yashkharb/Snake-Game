import { defineConfig } from '@playwright/test';

/**
 * Browser test suite.
 *
 * Two projects share one suite of checks:
 *  - `dev`: runs against the Astro dev server where the dev-only `__serpent`
 *    hook exists, letting tests drive deterministic assertions on engine state.
 *  - `prod`: runs against the built site (dist served by `astro preview`) and
 *    verifies the production behavior — including that dev-only hooks are
 *    absent from the shipped bundle.
 *
 * `webServer` is a top-level option, so both servers are started for any run.
 * `scripts/e2e-server.mjs` wraps the Astro CLI to keep it in the foreground
 * (Astro 7 auto-daemonizes when it detects an agent environment, which breaks
 * Playwright's server lifecycle).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      name: 'dev',
      command: 'node scripts/e2e-server.mjs dev --host 127.0.0.1 --port 4322',
      url: 'http://127.0.0.1:4322/Snake-Game/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      name: 'prod',
      command: 'npm run build && node scripts/e2e-server.mjs preview --host 127.0.0.1 --port 4323',
      url: 'http://127.0.0.1:4323/Snake-Game/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'dev',
      testMatch: /e2e\/dev\/.*\.spec\.ts/,
      use: {
        baseURL: 'http://127.0.0.1:4322',
      },
    },
    {
      name: 'prod',
      testMatch: /e2e\/prod\/.*\.spec\.ts/,
      use: {
        baseURL: 'http://127.0.0.1:4323',
      },
    },
  ],
});