/**
 * 390px Today view — Wave 3 Batch C (quality-gate).
 *
 * Mobile-first check at iPhone-14 width: the היום tab renders the
 * approvals queue and work ranking stacked, accept works by tap, and the
 * page never scrolls horizontally (RTL layout discipline).
 */

import { test, expect, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, mkSuggestion, v3Storage } from './seeds';

test.use({ viewport: { width: 390, height: 844 } });

test('Today view works at 390px with no horizontal overflow', async ({
  page,
  seed,
}) => {
  await seed(
    v3Storage({
      persons: [
        mkPerson({ id: 'p_mb_1', name: 'שירה נחום-בדיקה', phone: '052-9876543' }),
      ],
      deals: [
        mkDeal({
          id: 'd_mb_1',
          personId: 'p_mb_1',
          jobId: 'job_mb',
          jobTitle: 'Mobile Developer',
          stage: 'Outreach',
          enteredDaysAgo: 6,
        }),
      ],
      events: [
        mkStageEvent({
          id: 'e_mb_1',
          dealId: 'd_mb_1',
          from: null,
          to: 'Outreach',
          daysAgo: 6,
        }),
      ],
      suggestions: [
        mkSuggestion({
          id: 's_mb_1',
          agent: 'outreach_runner',
          kind: 'draft_message',
          personId: 'p_mb_1',
          title: 'טיוטת תזכורת: שירה נחום-בדיקה',
          body: 'היי שירה, מזכירה את המשרה שדיברנו עליה.',
        }),
      ],
    }),
  );
  await openBoard(page);

  // Enter the היום tab.
  await page.getByRole('button', { name: 'היום' }).click();
  await expect(page.getByTestId('today-view')).toBeVisible();

  // Approvals queue renders the pending draft as a tappable row.
  const row = page.getByTestId('approval-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('שירה נחום-בדיקה');

  // The V3 surfaces fit the 390px viewport: no element inside <main>
  // (today view, board header, money block) leaks past the right edge.
  // The PAGE-level scrollWidth is asserted in the fixme below — the
  // legacy V2 header nav overflows at 390px (pre-existing, FIX filed).
  const mainOverflow = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const main = document.querySelector('main');
    if (!main) return ['no <main>'];
    return Array.from(main.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().right > limit + 1)
      .map((el) => `${el.tagName}:${(el as HTMLElement).dataset?.testid ?? el.className}`)
      .slice(0, 10);
  });
  expect(mainOverflow).toEqual([]);

  // Accept by tap → the row resolves out of the queue.
  await row.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByTestId('approval-row')).toHaveCount(0);

  // No ₪ anywhere: nothing is calibrated in this seed (hard rule).
  expect(await page.getByTestId('today-view').innerText()).not.toContain('₪');
});

// The whole-page horizontal-scroll check is blocked by a PRE-EXISTING
// legacy chrome issue, not by the V3 work this suite gates: at 390px the
// V2 header (7 icon nav buttons + status badges, src/components/Layout/
// Header.tsx) lays out ~547px wide, so document.scrollWidth > 390 on
// EVERY view, legacy included. quality-gate does not edit src — a
// FIX(lead) line is filed in docs/BOARD-STATUS.md. When the header wraps
// or collapses at mobile widths, replace this fixme with:
//   scrollWidth <= clientWidth  after opening the היום tab.
test.fixme(
  'page-level: no horizontal scroll at 390px (blocked by legacy header overflow)',
  async () => undefined,
);
