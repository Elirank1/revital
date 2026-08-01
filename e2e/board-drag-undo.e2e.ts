/**
 * Board render + drag + undo toast — Wave 3 Batch C (quality-gate).
 *
 * Flag on, seeded synthetic data: the board renders all nine columns and
 * the bench rail; a real pointer drag moves a card between columns
 * (dnd-kit PointerSensor); the 6-second undo toast appears and its
 * ביטול button restores the previous stage.
 */

import { test, expect, dragTo, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, v3Storage } from './seeds';

test('board renders, drag Sourced→Screened, undo restores', async ({
  page,
  seed,
}) => {
  await seed(
    v3Storage({
      persons: [mkPerson({ id: 'p_e2e_1', name: 'נועה ישראלי-בדיקה' })],
      deals: [
        mkDeal({
          id: 'd_e2e_1',
          personId: 'p_e2e_1',
          jobId: 'job_e2e_1',
          jobTitle: 'QA Engineer',
          stage: 'Sourced',
        }),
      ],
      events: [
        mkStageEvent({ id: 'e_e2e_1', dealId: 'd_e2e_1', from: null, to: 'Sourced' }),
      ],
    }),
  );
  await openBoard(page);

  // All nine columns + bench rail render.
  for (const stage of [
    'Sourced',
    'Screened',
    'Outreach',
    'InConversation',
    'Submitted',
    'ClientInterview',
    'Offer',
    'Placed',
    'Paid',
  ]) {
    await expect(page.getByTestId(`column-${stage}`)).toBeVisible();
  }
  await expect(page.getByTestId('bench-rail')).toBeVisible();

  // The seeded card sits in Sourced.
  const card = page.getByTestId('deal-card');
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId('count-Sourced')).toHaveText('1');
  await expect(card.getByText('נועה ישראלי-בדיקה')).toBeVisible();

  // Drag it into Screened.
  await dragTo(page, card, page.getByTestId('column-Screened'));
  await expect(page.getByTestId('count-Screened')).toHaveText('1');
  await expect(page.getByTestId('count-Sourced')).toHaveText('0');

  // Undo toast appears with the target-stage message; ביטול reverts.
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('סוננו');
  await toast.getByRole('button', { name: 'ביטול' }).click();
  await expect(page.getByTestId('count-Sourced')).toHaveText('1');
  await expect(page.getByTestId('count-Screened')).toHaveText('0');
  await expect(toast).toHaveCount(0);

  // The undo persisted: reload keeps the card in Sourced.
  await page.reload();
  await page.locator('header nav button').first().click();
  await expect(page.getByTestId('count-Sourced')).toHaveText('1');
});
