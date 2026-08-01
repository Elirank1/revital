/**
 * Shared e2e fixtures — Wave 3 Batch C (quality-gate).
 *
 * G4 HARD RULE (charter): the e2e suite blocks EVERY external request.
 * An auto fixture routes '**' + '/*' on the browser context and aborts
 * anything that is not the local vite server (http://localhost:5299 /
 * http://127.0.0.1:5299). External URLs that the page merely REFERENCES
 * (Google Fonts in index.html) are blocked and tolerated; URLs shaped
 * like real outreach (wa.me / WhatsApp APIs / graph.facebook) must never
 * even be ATTEMPTED — the fixture fails the test if one shows up.
 * wa.me links are asserted by reading `href` attributes, never clicked.
 *
 * Also provides:
 *  - seed(entries): injects localStorage payloads via an init script that
 *    runs before any app code on every navigation;
 *  - dragTo(page, source, target): pointer-event drag that satisfies
 *    dnd-kit's PointerSensor (activation distance 4px).
 */

import { test as base, expect, type Locator, type Page } from '@playwright/test';

export const ALLOWED_ORIGINS = [
  'http://localhost:5299',
  'http://127.0.0.1:5299',
];

/** Outreach-shaped hosts: attempting one of these is a G4 violation. */
const OUTREACH_PATTERN = /wa\.me|whatsapp|graph\.facebook/i;

interface Fixtures {
  /** Every blocked external URL the page attempted (fonts land here). */
  externalAttempts: string[];
  /** Inject localStorage entries before the app boots. */
  seed: (entries: Record<string, string>) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  externalAttempts: [
    async ({ context }, use) => {
      const attempts: string[] = [];
      await context.route('**/*', (route) => {
        const url = route.request().url();
        const allowed = ALLOWED_ORIGINS.some(
          (o) => url === o || url.startsWith(`${o}/`),
        );
        if (allowed) return route.continue();
        attempts.push(url);
        return route.abort('blockedbyclient');
      });
      await use(attempts);
      // G4: the app must never even attempt an outreach-shaped request.
      expect(
        attempts.filter((u) => OUTREACH_PATTERN.test(u)),
        'no wa.me/WhatsApp/graph.facebook request may ever be attempted',
      ).toEqual([]);
    },
    { auto: true },
  ],

  seed: async ({ page }, use) => {
    await use(async (entries) => {
      await page.addInitScript((kv: Record<string, string>) => {
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
      }, entries);
    });
  },
});

export { expect };

/**
 * Drag a dnd-kit draggable onto a droppable. PointerSensor arms after
 * 4px of movement, so the path jiggles first, then travels in steps.
 */
export async function dragTo(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error('dragTo: source or target not visible');
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 4 }); // arm the sensor
  await page.mouse.move(t.x + t.width / 2, t.y + Math.min(t.height / 2, 120), {
    steps: 15,
  });
  await page.mouse.up();
}

/** Open the app and enter the V3 board via the לוח nav entry. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  // The לוח button is the first nav button when the flag is on; its text
  // span is hidden on narrow viewports, so target the button by position.
  await page.locator('header nav button').first().click();
  await expect(page.getByTestId('column-Sourced')).toBeVisible();
}
