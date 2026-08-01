/**
 * Progressive seeding wizard — Wave 3 final dispatch (quality-gate).
 *
 * Pins the D-042 / D-050 / D-051 contract at the e2e level:
 *  (a) a mandate present in `revital_v3_*` data but ABSENT from
 *      `revital_v3_seeding` surfaces the wizard chip AND renders zero ₪
 *      anywhere — even when the seed payload already carries a COMPLETE
 *      fee (D-042 fail-closed direction);
 *  (b) completing the wizard in-browser (fee via the reused FeeCapture,
 *      stage confirm, finish) lifts ₪ LIVE for that mandate only
 *      (D-042 lift direction + D-051 same-paint subscription);
 *  (c) dismissing never blocks the board — chip persists, board stays
 *      fully interactive (drag included), chip reopens the panel and the
 *      wizard's stage pickers mirror live store state.
 *
 * Same G4 block-all fixture as every other spec: no external request is
 * ever attempted; the wizard's copy button is composition-only and is
 * asserted present, never "sent".
 */

import { test, expect, dragTo, openBoard } from './fixtures';
import {
  mkDeal,
  mkPerson,
  mkStageEvent,
  v3Storage,
  type SeedFee,
} from './seeds';

/** Deterministic backfill id shape (src/lib/backfill.ts#backfillDealId). */
const BF_ANALYSIS_ID = 'a_wiz_1';
const BF_DEAL_ID = `d_bf_${BF_ANALYSIS_ID}`;

/** job_wiz = the wizard's mandate (backfilled ⇒ auto-opens first);
 *  job_ctl = control mandate proving "₪ for that mandate ONLY". */
const BASE_SEED = {
  persons: [
    mkPerson({ id: 'p_wiz_a', name: 'נועה כהן-בדיקה' }),
    mkPerson({ id: 'p_wiz_b', name: 'אורי לוי-בדיקה' }),
    mkPerson({ id: 'p_ctl_1', name: 'דנה מור-בדיקה' }),
  ],
  deals: [
    {
      // Backfilled card (importer id shape) awaiting its TRUE stage.
      ...mkDeal({
        id: BF_DEAL_ID,
        personId: 'p_wiz_a',
        jobId: 'job_wiz',
        jobTitle: 'Backend Engineer',
        stage: 'Screened',
      }),
      analysisId: BF_ANALYSIS_ID,
    },
    // Past-Screened deal: calibration may lift the moment job_wiz seeds.
    mkDeal({
      id: 'd_wiz_2',
      personId: 'p_wiz_b',
      jobId: 'job_wiz',
      jobTitle: 'Backend Engineer',
      stage: 'Submitted',
    }),
    mkDeal({
      id: 'd_ctl_1',
      personId: 'p_ctl_1',
      jobId: 'job_ctl',
      jobTitle: 'QA Lead',
      stage: 'Submitted',
    }),
  ],
  events: [
    mkStageEvent({ id: 'e_wiz_1', dealId: BF_DEAL_ID, from: null, to: 'Screened' }),
    mkStageEvent({ id: 'e_wiz_2', dealId: 'd_wiz_2', from: null, to: 'Submitted' }),
    mkStageEvent({ id: 'e_ctl_1', dealId: 'd_ctl_1', from: null, to: 'Submitted' }),
  ],
};

const COMPLETE_FEE: SeedFee = {
  jobId: 'job_wiz',
  kind: 'percent',
  percent: 10,
  expectedSalary: 300_000,
  currency: 'ILS',
  guaranteeDays: 0,
  invoiceStatus: 'none',
  updatedAt: new Date().toISOString(),
};

test('unseeded mandate: chip + wizard surface, zero ₪ even with a complete seeded fee (D-042 fail-closed)', async ({
  page,
  seed,
}) => {
  // Complete fee + Submitted deal in the payload — but NO revital_v3_seeding.
  await seed(v3Storage({ ...BASE_SEED, fees: { job_wiz: COMPLETE_FEE } }));
  await openBoard(page);

  // Chips for BOTH unseeded mandates.
  await expect(page.getByTestId('seeding-chip-job_wiz')).toBeVisible();
  await expect(page.getByTestId('seeding-chip-job_ctl')).toBeVisible();

  // First-open auto-surfaces the backfill-carrying mandate — as an
  // IN-FLOW banner (no dialog role), the board fully rendered around it.
  const wizard = page.getByTestId('seeding-wizard');
  await expect(wizard).toBeVisible();
  await expect(wizard).toContainText('Backend Engineer');
  await expect(wizard).not.toHaveAttribute('role', 'dialog');
  await expect(wizard).toContainText('יובא אוטומטית'); // backfilled card badged
  await expect(wizard.getByTestId('seeding-fee-done')).toBeVisible(); // fee already complete
  await expect(page.getByTestId('column-Sourced')).toBeVisible();

  // Uncalibrated everywhere: hint, no headline, no chips, NOT ONE ₪.
  await expect(page.getByTestId('calibration-hint')).toBeVisible();
  await expect(page.getByTestId('qualified-ev')).toHaveCount(0);
  await expect(page.getByTestId('ev-chip')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('₪');
});

test('completing the wizard lifts ₪ for that mandate only (fee via FeeCapture + stage confirm + finish)', async ({
  page,
  seed,
}) => {
  await seed(v3Storage(BASE_SEED)); // no fee, no seeding — wizard does it all
  await openBoard(page);

  const wizard = page.getByTestId('seeding-wizard');
  await expect(wizard).toContainText('Backend Engineer');

  // Finish is disabled until fee AND stage confirmation are done.
  await expect(page.getByTestId('seeding-finish')).toBeDisabled();

  // The backfilled card's stage picker drives the SAME writer as a board
  // drag: correcting Screened → Outreach moves the card on the board.
  const picker = page.getByTestId(`seeding-stage-${BF_DEAL_ID}`);
  await expect(picker).toHaveValue('Screened');
  await picker.selectOption('Outreach');
  await expect(
    page.getByTestId('column-Outreach').getByTestId('deal-card'),
  ).toContainText('נועה כהן-בדיקה');

  // Step 1 — the ONE fee field is the existing FeeCapture editor.
  await page.getByTestId('seeding-fee-button').click();
  const modal = page.getByTestId('fee-capture');
  await expect(modal).toBeVisible();
  await page.getByTestId('fee-percent').fill('10');
  await page.getByTestId('fee-salary').fill('300000');
  await expect(page.getByTestId('fee-preview')).toContainText('₪30,000');
  await page.getByTestId('fee-save').click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId('seeding-fee-done')).toBeVisible();

  // Fee complete but still UNSEEDED ⇒ the board stays ₪-free.
  await expect(page.getByTestId('qualified-ev')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('₪');

  // Step 2 — confirm stages, then finish.
  await page.getByTestId('seeding-stages-confirm').click();
  await expect(page.getByTestId('seeding-stages-done')).toBeVisible();
  await expect(page.getByTestId('seeding-finish')).toBeEnabled();
  await page.getByTestId('seeding-finish').click();

  // Done step: baseline card, and the wizard panel itself carries no ₪.
  await expect(page.getByTestId('seeding-done')).toBeVisible();
  await expect(page.getByTestId('baseline-card')).toBeVisible();
  expect(await wizard.innerText()).not.toContain('₪');

  // ₪ lifted in the SAME view for job_wiz: headline + column ΣEV + card chip.
  const qualified = page.getByTestId('qualified-ev');
  await expect(qualified).toBeVisible();
  await expect(qualified).toContainText('₪');
  await expect(page.getByTestId('ev-Submitted')).toContainText('ΣEV ₪');
  const submittedCards = page
    .getByTestId('column-Submitted')
    .getByTestId('deal-card');
  const wizCard = submittedCards.filter({ hasText: 'אורי לוי-בדיקה' });
  await expect(wizCard.getByTestId('ev-chip')).toContainText('₪');

  // …and for job_wiz ONLY: the control mandate's card stays ₪-free and
  // its chip persists, while job_wiz's chip is gone (seeded out).
  const ctlCard = submittedCards.filter({ hasText: 'דנה מור-בדיקה' });
  await expect(ctlCard).toBeVisible();
  expect(await ctlCard.innerText()).not.toContain('₪');
  await expect(page.getByTestId('seeding-chip-job_wiz')).toHaveCount(0);
  await expect(page.getByTestId('seeding-chip-job_ctl')).toBeVisible();

  // Persistence pins: seeding record, fee record, seeding.mark audit entry.
  const persisted = await page.evaluate(() => ({
    seeding: JSON.parse(localStorage.getItem('revital_v3_seeding') ?? '{}'),
    fees: JSON.parse(localStorage.getItem('revital_v3_fees') ?? '{}'),
    audit: JSON.parse(localStorage.getItem('revital_v3_audit') ?? '[]'),
  }));
  expect(persisted.seeding.job_wiz).toMatchObject({ jobId: 'job_wiz' });
  expect(typeof persisted.seeding.job_wiz.seededAt).toBe('string');
  expect(persisted.seeding.job_ctl).toBeUndefined();
  expect(persisted.fees.job_wiz).toMatchObject({
    jobId: 'job_wiz',
    kind: 'percent',
    percent: 10,
    expectedSalary: 300_000,
  });
  expect(
    persisted.audit.some(
      (e: { action?: string; entityId?: string }) =>
        e.action === 'seeding.mark' && e.entityId === 'job_wiz',
    ),
  ).toBe(true);
});

test('dismiss: chip persists, chip reopens, board drag works with the panel open', async ({
  page,
  seed,
}) => {
  await seed(v3Storage(BASE_SEED));
  await openBoard(page);

  await expect(page.getByTestId('seeding-wizard')).toBeVisible();
  await page.getByTestId('seeding-dismiss').click();
  await expect(page.getByTestId('seeding-wizard')).toHaveCount(0);

  // Chip + async-form copy button (composition only — G4) survive dismissal.
  await expect(page.getByTestId('seeding-chip-job_wiz')).toBeVisible();
  await expect(page.getByTestId('seeding-copy-form')).toBeVisible();

  // The chip reopens the panel.
  await page.getByTestId('seeding-chip-job_wiz').click();
  await expect(page.getByTestId('seeding-wizard')).toBeVisible();
  await expect(page.getByTestId(`seeding-stage-${BF_DEAL_ID}`)).toHaveValue(
    'Screened',
  );

  // Board stays fully interactive WITH the panel open (in-flow banner,
  // never a modal): a real drag Screened → Outreach still works, and the
  // wizard's stage picker mirrors the live store state in place
  // ("dragging on the board itself works too").
  // NOTE: deliberately no click immediately after the drag — Playwright's
  // hit-target interceptor can swallow the first post-drag click (harness
  // artifact, not app behavior); these are pure render assertions.
  const card = page.getByTestId('column-Screened').getByTestId('deal-card');
  await dragTo(page, card, page.getByTestId('column-Outreach'));
  await expect(
    page.getByTestId('column-Outreach').getByTestId('deal-card'),
  ).toContainText('נועה כהן-בדיקה');
  await expect(page.getByTestId(`seeding-stage-${BF_DEAL_ID}`)).toHaveValue(
    'Outreach',
  );
  await expect(page.getByTestId('seeding-chip-job_wiz')).toBeVisible();

  // No ₪ anywhere throughout — nothing was seeded in this test.
  expect(await page.locator('body').innerText()).not.toContain('₪');
});
