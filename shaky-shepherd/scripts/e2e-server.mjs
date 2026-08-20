// Playwright webServer launcher for the Astro dev/preview servers.
//
// Astro 7 auto-detects agent environments and daemonizes `astro dev` /
// `astro preview` into a detached background process. Playwright treats a
// spawned process that exits as a failure, so that behavior breaks the
// `webServer` lifecycle. This wrapper keeps the CLI in the foreground by
// disabling auto-backgrounding (`ASTRO_*_BACKGROUND`) and stays alive for as
// long as the server runs, so Playwright can start and stop it deterministically.
import { spawn } from 'node:child_process';

const mode = process.argv[2];
const args = process.argv.slice(3);

const child = spawn(
  process.execPath,
  ['node_modules/astro/bin/astro.mjs', mode, ...args],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      ASTRO_DEV_BACKGROUND: '1',
      ASTRO_PREVIEW_BACKGROUND: '1',
    },
  },
);

const shutdown = (signal) => {
  if (!child.killed) child.kill(signal);
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});