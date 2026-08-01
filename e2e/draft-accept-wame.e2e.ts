/**
 * Accept a draft suggestion → wa.me href — Wave 3 Batch C (quality-gate).
 *
 * G4: the wa.me flow is asserted by READING the <a href> attribute.
 * Nothing here clicks the anchor, nothing navigates, and the network
 * blocker fixture fails the test if any wa.me request is even attempted.
 */

import { test, expect, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, mkSuggestion, v3Storage } from './seeds';

const DRAFT_BODY =
  'היי נועה, ראיתי את הניסיון שלך ב-QA ויש לי משרה שיכולה להתאים. נוח לך לדבר היום?';

test('accepting a draft renders the exact wa.me href, without navigation', async ({
  page,
  seed,
}) => {
  await seed(
    v3Storage({
      persons: [
        mkPerson({ id: 'p_wa_1', name: 'נועה בר-בדיקה', phone: '050-123-4567' }),
      ],
      deals: [
        mkDeal({
          id: 'd_wa_1',
          personId: 'p_wa_1',
          jobId: 'job_wa',
          jobTitle: 'QA Engineer',
          stage: 'Outreach',
        }),
      ],
      events: [
        mkStageEvent({ id: 'e_wa_1', dealId: 'd_wa_1', from: null, to: 'Outreach' }),
      ],
      suggestions: [
        mkSuggestion({
          id: 's_wa_1',
          agent: 'outreach_runner',
          kind: 'draft_message',
          personId: 'p_wa_1',
          title: 'טיוטת פנייה ראשונה: נועה בר-בדיקה',
          body: DRAFT_BODY,
          evidence: [
            { claim: 'קשר אחרון: אין', sourceType: 'person', sourceId: 'p_wa_1' },
          ],
        }),
      ],
    }),
  );
  await openBoard(page);

  // 050-123-4567 normalizes to 972501234567 (E.164, IL).
  const expectedHref = `https://wa.me/972501234567?text=${encodeURIComponent(DRAFT_BODY)}`;

  // Before acceptance the card's one-tap chat opener is the BARE wa.me
  // link — an unapproved draft never becomes a send link.
  await expect(page.getByTestId('inbox-badge-count')).toHaveText('1');
  await expect(page.getByTestId('wa-link')).toHaveAttribute(
    'href',
    'https://wa.me/972501234567',
  );

  // Open the inbox panel and accept the draft as-is.
  await page.getByTestId('inbox-badge').click();
  const item = page.getByTestId('suggestion-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(DRAFT_BODY);
  await item.getByRole('button', { name: 'אישור' }).click();

  // The accepted draft renders as a wa.me anchor carrying EXACTLY the
  // approved text — in the queue and on the deal card.
  await expect(page.getByTestId('accepted-wa-link')).toHaveAttribute(
    'href',
    expectedHref,
  );
  await expect(page.getByTestId('wa-link')).toHaveAttribute('href', expectedHref);

  // Anchors are safe (new tab + noopener) and NOT followed by the test.
  await expect(page.getByTestId('accepted-wa-link')).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(page.getByTestId('accepted-wa-link')).toHaveAttribute(
    'rel',
    /noopener/,
  );

  // No navigation happened; we are still on the local board.
  expect(page.url().startsWith('http://localhost:5299')).toBe(true);
  await expect(page.getByTestId('inbox-badge-count')).toHaveText('0');
});
