/**
 * Playwright e2e config — Wave 3 Batch C (quality-gate).
 *
 * - Own vite server on port 5299 (the lead's dev server on 5199 is NEVER
 *   touched); `--strictPort` fails loudly instead of silently drifting.
 * - Spec files are `e2e/*.e2e.ts` ON PURPOSE: vitest's default include
 *   pattern grabs `*.{test,spec}.*` anywhere in the repo, and `npm run
 *   test:unit` must never try to execute Playwright specs.
 * - Fixed locale/timezone so date math renders deterministically on any
 *   machine.
 * - G4: every test runs behind the external-network blocker fixture in
 *   `e2e/fixtures.ts` (only http://localhost:5299 is ever allowed out).
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5299',
    browserName: 'chromium',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5299 --strictPort',
    url: 'http://localhost:5299',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium' }],
});
