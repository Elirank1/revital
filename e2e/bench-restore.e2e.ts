/**
 * Bench rail — silver badge + restore-to-board — Wave 3 Batch C
 * (quality-gate). A benched silver medalist renders on the rail; the
 * restore CTA moves the parked deal back to the stage it left (read
 * from the parking StageEvent) and clears the bench flag.
 */

import { test, expect, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, v3Storage } from './seeds';

test('silver medalist renders; restore returns the deal to its prior stage', async ({
  page,
  seed,
}) => {
  const now = Date.now();
  const benchedAt = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
  await seed(
    v3Storage({
      persons: [
        {
          ...mkPerson({ id: 'p_bn_1', name: 'עדי מור-בדיקה' }),
          bench: {
            reason: 'הלקוח בחר מועמד אחר',
            since: benchedAt,
            benchedAt,
            benchReason: 'הלקוח בחר מועמד אחר',
            silverMedalist: true,
          },
        },
      ],
      deals: [
        mkDeal({
          id: 'd_bn_1',
          personId: 'p_bn_1',
          jobId: 'job_bn',
          jobTitle: 'Frontend Lead',
          stage: 'Bench',
        }),
      ],
      events: [
        mkStageEvent({ id: 'e_bn_1', dealId: 'd_bn_1', from: null, to: 'Submitted', daysAgo: 9 }),
        mkStageEvent({ id: 'e_bn_2', dealId: 'd_bn_1', from: 'Submitted', to: 'Bench', daysAgo: 5 }),
      ],
    }),
  );
  await openBoard(page);

  // The rail renders the benched person with the silver-medalist badge
  // and the bench reason (stored metadata, never recomputed in the UI).
  const benchCard = page.getByTestId('bench-card');
  await expect(benchCard).toHaveCount(1);
  await expect(benchCard).toContainText('עדי מור-בדיקה');
  await expect(benchCard.getByTestId('silver-badge')).toBeVisible();
  await expect(benchCard).toContainText('הלקוח בחר מועמד אחר');
  await expect(page.getByTestId('count-Submitted')).toHaveText('0');

  // Restore: the parked deal returns to the stage it was parked FROM
  // (Submitted, per the seeded parking StageEvent) and the person leaves
  // the bench.
  await benchCard.getByTestId('bench-restore').click();
  await expect(page.getByTestId('count-Submitted')).toHaveText('1');
  await expect(page.getByTestId('bench-card')).toHaveCount(0);
  await expect(
    page.getByTestId('column-Submitted').getByTestId('deal-card'),
  ).toContainText('עדי מור-בדיקה');

  // Persisted: the person's bench entry is gone, the deal is Submitted.
  const state = await page.evaluate(() => ({
    person: JSON.parse(localStorage.getItem('revital_v3_persons') ?? '[]')[0],
    deal: JSON.parse(localStorage.getItem('revital_v3_deals') ?? '[]')[0],
  }));
  expect(state.person.bench).toBeUndefined();
  expect(state.deal.stage).toBe('Submitted');
});
