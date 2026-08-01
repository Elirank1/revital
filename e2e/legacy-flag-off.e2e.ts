/**
 * Legacy regression — flag OFF (default) — Wave 3 Batch C (quality-gate).
 *
 * The V2 app Revital uses daily must be byte-inert to V3 work: with no
 * flag, the dashboard renders, the analyze→results surface renders a
 * stored analysis, the לוח nav entry does not exist, and interacting
 * with legacy views writes zero revital_v3_* keys.
 */

import { test, expect } from './fixtures';
import { legacyStorage, mkAnalysis, mkLogEntry } from './seeds';

const CANDIDATE = 'דנה לוי-בדיקה';
const JOB_TITLE = 'Backend Engineer';

test('flag off: dashboard + results render, no לוח, zero v3 keys', async ({
  page,
  seed,
}) => {
  await seed(
    legacyStorage({
      analyses: [
        mkAnalysis({ id: 'an_e2e_1', candidateName: CANDIDATE, jobTitle: JOB_TITLE }),
      ],
      log: [
        mkLogEntry({ id: 'an_e2e_1', candidateName: CANDIDATE, jobTitle: JOB_TITLE }),
      ],
    }),
  );
  await page.goto('/');

  // Dashboard renders with the recent-analyses list.
  await expect(
    page.getByRole('heading', { name: /Revital/ }).first(),
  ).toBeVisible();
  await expect(page.getByText('Recent Analyses')).toBeVisible();

  // Flag off ⇒ no לוח nav entry anywhere.
  await expect(page.locator('header nav').getByText('לוח')).toHaveCount(0);

  // analyze → results path: open the stored analysis from the dashboard.
  await page.getByText(CANDIDATE).first().click();
  await expect(page.getByText('Back to History')).toBeVisible();
  await expect(page.getByText(CANDIDATE).first()).toBeVisible();
  await expect(page.getByText('87%').first()).toBeVisible();
  await expect(page.getByText('Strong Fit').first()).toBeVisible();

  // The legacy session wrote no v3 keys (flag-off inertia, RUNBOOK §2).
  const v3Keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('revital_v3_')),
  );
  expect(v3Keys).toEqual([]);
});

test('flag off: pipeline view is unreachable and renders nothing', async ({
  page,
  seed,
}) => {
  await seed(legacyStorage({}));
  await page.goto('/');
  await expect(page.getByText('Recent Analyses')).toHaveCount(0); // empty state
  // No board artifacts exist in the DOM at all.
  await expect(page.getByTestId('column-Sourced')).toHaveCount(0);
  await expect(page.getByTestId('bench-rail')).toHaveCount(0);
});
