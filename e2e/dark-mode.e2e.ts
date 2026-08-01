/**
 * Dark mode sanity (snapshot-free) — Wave 3 Batch C (quality-gate).
 *
 * The header toggle flips the `dark` class on <html>; the board keeps
 * rendering all its surfaces in both themes and the setting persists
 * through reload. No pixel snapshots — structural assertions only.
 */

import { test, expect, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, mkSuggestion, v3Storage } from './seeds';

test('dark toggle flips <html>.dark, board survives, setting persists', async ({
  page,
  seed,
}) => {
  await seed(
    v3Storage({
      persons: [mkPerson({ id: 'p_dm_1', name: 'יעל דורון-בדיקה' })],
      deals: [
        mkDeal({
          id: 'd_dm_1',
          personId: 'p_dm_1',
          jobId: 'job_dm',
          jobTitle: 'Fullstack Engineer',
          stage: 'Outreach',
        }),
      ],
      events: [
        mkStageEvent({ id: 'e_dm_1', dealId: 'd_dm_1', from: null, to: 'Outreach' }),
      ],
      suggestions: [
        mkSuggestion({
          id: 's_dm_1',
          agent: 'pit_boss',
          kind: 'next_action',
          dealId: 'd_dm_1',
          title: 'תזכורת מעקב',
          body: 'הצעה סינתטית לבדיקת ערכת נושא.',
        }),
      ],
    }),
  );
  await openBoard(page);

  const html = page.locator('html');
  await expect(html).not.toHaveClass(/dark/);

  // Toggle dark mode from the header.
  await page.locator('header button[title="Dark mode"]').click();
  await expect(html).toHaveClass(/dark/);

  // Board surfaces all still render in dark mode.
  await expect(page.getByTestId('column-Outreach')).toBeVisible();
  await expect(page.getByTestId('deal-card')).toBeVisible();
  await expect(page.getByTestId('bench-rail')).toBeVisible();
  await expect(page.getByTestId('money-header')).toBeVisible();
  await expect(page.getByTestId('inbox-badge-count')).toHaveText('1');
  await page.getByTestId('tab-approvals').click();
  await expect(page.getByTestId('approvals-inbox')).toBeVisible();

  // Persisted: reload keeps dark mode (legacy settings key, flag-off safe).
  await page.reload();
  await expect(html).toHaveClass(/dark/);

  // And back to light.
  await page.locator('header button[title="Light mode"]').click();
  await expect(html).not.toHaveClass(/dark/);
});
