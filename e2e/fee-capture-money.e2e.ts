/**
 * Fee capture → header ₪ (calibration lift) — Wave 3 Batch C (quality-gate).
 *
 * Calibration per D-042 (Batch C-seed, landed in this wave): a mandate
 * shows ₪ only when it is SEEDED (`revital_v3_seeding`) AND has a
 * complete fee AND ≥1 live deal past Screened. This spec pins the lift
 * (seeded mandate + fee capture ⇒ header ₪) and the fail-closed side
 * (fee without seeding ⇒ zero ₪ anywhere).
 *
 * The board's columns live in an overflow-x container capped by the
 * app's max-w-7xl main, so Placed is scrolled into view before the drag
 * (a wide viewport does NOT widen the board).
 */

import { test, expect, dragTo, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, v3Storage } from './seeds';

function seedingRecord(jobId: string): Record<string, string> {
  return {
    revital_v3_seeding: JSON.stringify({
      [jobId]: { jobId, seededAt: new Date().toISOString() },
    }),
  };
}

const BASE_SEED = {
  persons: [
    mkPerson({ id: 'p_fee_1', name: 'אורי כהן-בדיקה' }),
    mkPerson({ id: 'p_fee_2', name: 'רות אלון-בדיקה' }),
  ],
  deals: [
    mkDeal({
      id: 'd_fee_1',
      personId: 'p_fee_1',
      jobId: 'job_fee',
      jobTitle: 'DevOps Lead',
      stage: 'Offer',
    }),
    mkDeal({
      id: 'd_fee_2',
      personId: 'p_fee_2',
      jobId: 'job_fee',
      jobTitle: 'DevOps Lead',
      stage: 'Submitted',
    }),
  ],
  events: [
    mkStageEvent({ id: 'e_fee_1', dealId: 'd_fee_1', from: null, to: 'Offer' }),
    mkStageEvent({ id: 'e_fee_2', dealId: 'd_fee_2', from: null, to: 'Submitted' }),
  ],
};

test('seeded mandate: fee capture on drag→Placed lifts the header ₪', async ({
  page,
  seed,
}) => {
  await seed({ ...v3Storage(BASE_SEED), ...seedingRecord('job_fee') });
  await openBoard(page);

  // Seeded but no fee ⇒ still uncalibrated: hint, no qualified figure,
  // and NOT ONE ₪ character anywhere (the leak-sweep hard rule, e2e level).
  await expect(page.getByTestId('calibration-hint')).toBeVisible();
  await expect(page.getByTestId('qualified-ev')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('₪');

  // Bring the deep columns into view, then drag Offer → Placed.
  await page.getByTestId('column-Paid').scrollIntoViewIfNeeded();
  const offerCard = page.getByTestId('column-Offer').getByTestId('deal-card');
  await dragTo(page, offerCard, page.getByTestId('column-Placed'));

  // FeeCapture auto-opens for the mandate; complete percent fee: 10% of
  // ₪300,000 → live preview, save.
  const modal = page.getByTestId('fee-capture');
  await expect(modal).toBeVisible();
  await page.getByTestId('fee-percent').fill('10');
  await page.getByTestId('fee-salary').fill('300000');
  await expect(page.getByTestId('fee-preview')).toContainText('₪30,000');
  await page.getByTestId('fee-save').click();
  await expect(modal).toHaveCount(0);

  // Calibrated (seeded + fee + past-Screened): header ₪ appears.
  const qualified = page.getByTestId('qualified-ev');
  await expect(qualified).toBeVisible();
  await expect(qualified).toContainText('₪');
  await expect(page.getByTestId('calibration-hint')).toHaveCount(0);

  // Column ΣEV replaces the placeholder and cards carry EV chips.
  await expect(page.getByTestId('ev-Submitted')).toContainText('ΣEV ₪');
  await expect(page.getByTestId('ev-chip').first()).toContainText('₪');

  // The fee persisted under revital_v3_fees (audited store write).
  const fees = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('revital_v3_fees') ?? '{}'),
  );
  expect(fees.job_fee).toMatchObject({
    jobId: 'job_fee',
    kind: 'percent',
    percent: 10,
    expectedSalary: 300000,
    currency: 'ILS',
  });
});

test('unseeded mandate: a complete fee alone lifts NO ₪ (D-042 invariant)', async ({
  page,
  seed,
}) => {
  // Complete fee + deal past Screened, but NO revital_v3_seeding record.
  await seed(
    v3Storage({
      ...BASE_SEED,
      fees: {
        job_fee: {
          jobId: 'job_fee',
          kind: 'percent',
          percent: 10,
          expectedSalary: 300000,
          currency: 'ILS',
          guaranteeDays: 0,
          invoiceStatus: 'none',
          updatedAt: new Date().toISOString(),
        },
      },
    }),
  );
  await openBoard(page);

  await expect(page.getByTestId('calibration-hint')).toBeVisible();
  await expect(page.getByTestId('qualified-ev')).toHaveCount(0);
  await expect(page.getByTestId('ev-chip')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('₪');
});
