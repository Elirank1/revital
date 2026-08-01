/**
 * Deletion cascade behind the export gate — Wave 3 Batch C (quality-gate).
 *
 * The data panel's cascade is triple-gated: (1) the typed-confirmation
 * input stays DISABLED until the full JSON backup actually downloads,
 * (2) the delete button requires the person's exact name, (3) the store
 * itself requires {confirm:true}. The cascade tombstones person + deals
 * + suggestions and offers one-click undo.
 */

import { test, expect, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, mkSuggestion, v3Storage } from './seeds';

const NAME = 'תמר גולן-בדיקה';

test('export-gated cascade deletes person + card + suggestion; undo restores', async ({
  page,
  seed,
}) => {
  await seed(
    v3Storage({
      persons: [mkPerson({ id: 'p_del_1', name: NAME })],
      deals: [
        mkDeal({
          id: 'd_del_1',
          personId: 'p_del_1',
          jobId: 'job_del',
          jobTitle: 'Product Manager',
          stage: 'Screened',
        }),
      ],
      events: [
        mkStageEvent({ id: 'e_del_1', dealId: 'd_del_1', from: null, to: 'Screened' }),
      ],
      suggestions: [
        mkSuggestion({
          id: 's_del_1',
          agent: 'pit_boss',
          kind: 'next_action',
          dealId: 'd_del_1',
          title: 'לקבוע שיחת המשך',
          body: 'הצעה סינתטית לבדיקת הקסקדה.',
        }),
      ],
    }),
  );
  await openBoard(page);
  await expect(page.getByTestId('deal-card')).toHaveCount(1);

  // Open the data panel from the board tools menu.
  await page.getByTestId('board-tools-button').click();
  await page.getByTestId('data-panel-button').click();
  await expect(page.getByTestId('data-panel')).toBeVisible();

  // Pick the person. BEFORE exporting: confirmation input and delete
  // button are both disabled — the gate is enforced, not suggested.
  await page.getByTestId('cascade-person-select').selectOption('p_del_1');
  await expect(page.getByTestId('cascade-confirm-input')).toBeDisabled();
  await expect(page.getByTestId('cascade-delete-button')).toBeDisabled();

  // Export the full backup — a real browser download must fire.
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('cascade-export-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  // Typed confirmation: wrong name keeps delete disabled; exact name arms it.
  const confirmInput = page.getByTestId('cascade-confirm-input');
  await expect(confirmInput).toBeEnabled();
  await confirmInput.fill('שם שגוי');
  await expect(page.getByTestId('cascade-delete-button')).toBeDisabled();
  await confirmInput.fill(NAME);
  await expect(page.getByTestId('cascade-delete-button')).toBeEnabled();
  await page.getByTestId('cascade-delete-button').click();

  // Cascade result reports what was tombstoned; the board card is gone.
  const result = page.getByTestId('cascade-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('1 כרטיסים');
  await expect(result).toContainText('1 הצעות');
  await expect(page.getByTestId('deal-card')).toHaveCount(0);
  await expect(page.getByTestId('inbox-badge-count')).toHaveText('0');

  // Tombstones, not physical removal (retention owns physical purge).
  const tombstoned = await page.evaluate(() => ({
    person: JSON.parse(localStorage.getItem('revital_v3_persons') ?? '[]')[0],
    deal: JSON.parse(localStorage.getItem('revital_v3_deals') ?? '[]')[0],
    suggestion: JSON.parse(localStorage.getItem('revital_v3_suggestions') ?? '[]')[0],
  }));
  expect(tombstoned.person.deleted).toBe(true);
  expect(tombstoned.deal.deleted).toBe(true);
  expect(tombstoned.suggestion.deleted).toBe(true);

  // One-click undo restores everything live.
  await page.getByTestId('cascade-undo-button').click();
  await expect(page.getByTestId('cascade-undone')).toBeVisible();
  await page.getByTestId('data-panel-close').click();
  await expect(page.getByTestId('deal-card')).toHaveCount(1);
  await expect(page.getByTestId('inbox-badge-count')).toHaveText('1');
});
