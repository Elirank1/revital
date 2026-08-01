/**
 * Approvals Inbox — batch approve/dismiss + digest mode — Wave 3 Batch C
 * (quality-gate). The "אישורים" board tab hosts the full inbox: agent
 * groups, per-item checkboxes, batch bar, measured metrics, and the
 * morning-digest mode ("מה מחכה לך הבוקר").
 */

import { test, expect, openBoard } from './fixtures';
import { mkDeal, mkPerson, mkStageEvent, mkSuggestion, v3Storage } from './seeds';

test('batch approve + batch dismiss resolve suggestions; digest renders', async ({
  page,
  seed,
}) => {
  await seed(
    v3Storage({
      persons: [mkPerson({ id: 'p_ap_1', name: 'גיל שמש-בדיקה' })],
      deals: [
        mkDeal({
          id: 'd_ap_1',
          personId: 'p_ap_1',
          jobId: 'job_ap',
          jobTitle: 'Data Engineer',
          stage: 'InConversation',
        }),
      ],
      events: [
        mkStageEvent({ id: 'e_ap_1', dealId: 'd_ap_1', from: null, to: 'InConversation' }),
      ],
      suggestions: [
        mkSuggestion({
          id: 's_ap_pb1',
          agent: 'pit_boss',
          kind: 'next_action',
          dealId: 'd_ap_1',
          title: 'לקדם את גיל: לתאם ראיון לקוח',
          body: 'העסקה בשלב שיחה כבר מספר ימים — הצעד הבא הוא תיאום ראיון.',
          minutesAgo: 10,
        }),
        mkSuggestion({
          id: 's_ap_pb2',
          agent: 'pit_boss',
          kind: 'next_action',
          dealId: 'd_ap_1',
          title: 'לעדכן את הלקוח בסטטוס',
          body: 'שליחת עדכון סטטוס שבועי ללקוח.',
          minutesAgo: 20,
        }),
        mkSuggestion({
          id: 's_ap_sc1',
          agent: 'screener',
          kind: 'flag',
          personId: 'p_ap_1',
          title: 'דגל: פער בקורות החיים',
          body: 'נמצא פער תעסוקתי לא מוסבר (נתון סינתטי).',
          minutesAgo: 30,
        }),
        mkSuggestion({
          id: 's_ap_or1',
          agent: 'outreach_runner',
          kind: 'draft_message',
          personId: 'p_ap_1',
          title: 'טיוטת תזכורת: גיל שמש-בדיקה',
          body: 'היי גיל, רק מוודאת שראית את ההודעה הקודמת.',
          minutesAgo: 40,
        }),
      ],
    }),
  );
  await openBoard(page);
  await page.getByTestId('tab-approvals').click();

  const inbox = page.getByTestId('approvals-inbox');
  await expect(inbox).toBeVisible();
  await expect(page.getByTestId('approval-item')).toHaveCount(4);
  await expect(page.getByTestId('agent-group-pit_boss')).toBeVisible();
  await expect(page.getByTestId('agent-group-screener')).toBeVisible();
  await expect(page.getByTestId('agent-group-outreach_runner')).toBeVisible();

  // Nothing resolved yet — rates are honestly unmeasured.
  await expect(page.getByTestId('metric-accept-rate')).toHaveText('—');

  // Select the whole pit_boss group via its group checkbox → batch bar.
  await page.getByTestId('group-select-pit_boss').check();
  const batchBar = page.getByTestId('batch-bar');
  await expect(batchBar).toBeVisible();
  await expect(batchBar).toContainText('2');
  await page.getByTestId('batch-approve').click();

  // Both pit_boss items resolved; group disappears.
  await expect(page.getByTestId('approval-item')).toHaveCount(2);
  await expect(page.getByTestId('agent-group-pit_boss')).toHaveCount(0);
  await expect(page.getByTestId('batch-bar')).toHaveCount(0);

  // Batch dismiss the screener flag via its item checkbox.
  await page
    .getByTestId('agent-group-screener')
    .getByTestId('approval-select')
    .check();
  await page.getByTestId('batch-dismiss').click();
  await expect(page.getByTestId('approval-item')).toHaveCount(1);
  await expect(page.getByTestId('agent-group-screener')).toHaveCount(0);

  // Metrics are measured now: 2 accepted / 3 resolved = 67%.
  await expect(page.getByTestId('metric-accept-rate')).toHaveText('67%');

  // A batch accept is an unedited accept — edit-rate measured at 0%.
  await expect(page.getByTestId('metric-edit-rate')).toHaveText('0%');

  // Digest mode: the morning worklist renders with the remaining pending
  // suggestion grouped under its agent.
  await page.getByTestId('mode-digest').click();
  await expect(page.getByTestId('morning-digest')).toBeVisible();
  await expect(page.getByText('מה מחכה לך הבוקר')).toBeVisible();
  await expect(page.getByTestId('digest-agent-row').first()).toBeVisible();
  // No fee was ever captured — the digest stays money-free (no ₪).
  expect(
    await page.getByTestId('morning-digest').innerText(),
  ).not.toContain('₪');

  // Resolutions persisted (LWW records under revital_v3_suggestions).
  const statuses = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('revital_v3_suggestions') ?? '[]');
    return Object.fromEntries(
      all.map((s: { id: string; status: string }) => [s.id, s.status]),
    );
  });
  expect(statuses).toMatchObject({
    s_ap_pb1: 'accepted',
    s_ap_pb2: 'accepted',
    s_ap_sc1: 'dismissed',
    s_ap_or1: 'pending',
  });
});
