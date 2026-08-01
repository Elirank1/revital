// @vitest-environment jsdom
/**
 * CardBack DOM tests (jsdom) — kanban-ui, Wave 3.
 *
 * Covered: the merged per-deal trail (stage events incl. creation +
 * skip-events + rejection reasons, contact events, suggestion lifecycle
 * from the audit log with evidence claims + source refs, no duplicate
 * move rows), BiDi dir="auto" on user content, and the paste-a-thread
 * flow: pure parse report first, store untouched until the EXPLICIT
 * apply, application through logContact/setReplyState only (message
 * HASHES, never texts), and paste-twice idempotency.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { hashMessage } from '../../lib/outreach';
import { CardBack, buildDealTrail } from './CardBack';
import {
  resetPipelineStore,
  seedPersonWithDeal,
} from '../../views/Pipeline/storeTestKit';

const store = () => usePipelineStore.getState();

beforeEach(() => resetPipelineStore());
afterEach(cleanup);

const THREAD = [
  'זו שורה לא תקינה בלי כותרת',
  '[30.7.2026, 9:12:00] רויטל קרן: היי דנה, ראית את המשרה?',
  '[30.7.2026, 10:03:11] דנה לוי: כן! נשמע מעניין',
].join('\n');

describe('trail rendering', () => {
  it('merges stage events, contacts, and suggestion audit rows chronologically', () => {
    const { person, deal } = seedPersonWithDeal({
      name: 'דנה לוי',
      jobTitle: 'QA Lead',
      stage: 'Outreach',
    });
    store().moveDeal(deal.id, 'Submitted'); // skips InConversation
    store().logContact(person.id, 'whatsapp', 'hash_abc');
    const sug = store().addSuggestion({
      agent: 'pit_boss',
      kind: 'next_action',
      dealId: deal.id,
      title: 'לדחוף את הכרטיס',
      body: 'גוף ההצעה',
      evidence: [
        { claim: '8 ימים בשלב הוגשו', sourceType: 'deal', sourceId: deal.id },
      ],
    });
    store().acceptSuggestion(sug.id);

    render(<CardBack dealId={deal.id} onClose={() => {}} />);
    const trail = screen.getByTestId('card-trail');

    // stage rows: creation + ONE move row (audit deal.move is excluded —
    // StageEvents already tell that truth once)
    expect(within(trail).getByText('הכרטיס נוצר בשלב פנייה')).toBeTruthy();
    const moveRows = within(trail)
      .getAllByTestId('trail-entry')
      .filter((e) => e.getAttribute('data-kind') === 'stage');
    expect(moveRows).toHaveLength(2); // creation + the single move
    expect(
      within(trail).getByText('מעבר משלב פנייה לשלב הוגשו').getAttribute('dir'),
    ).toBe('auto');
    // skip-event surfaced
    expect(within(trail).getByText(/דילוג על: בשיחה/)).toBeTruthy();

    // contact row with channel
    expect(within(trail).getByText('נשלחה פנייה')).toBeTruthy();
    expect(within(trail).getByText('ערוץ: וואטסאפ')).toBeTruthy();

    // suggestion lifecycle rows with agent attribution + evidence refs
    expect(within(trail).getByText('הצעה חדשה: לדחוף את הכרטיס')).toBeTruthy();
    expect(within(trail).getByText('הצעה אושרה: לדחוף את הכרטיס')).toBeTruthy();
    const evidence = within(trail).getAllByTestId('trail-evidence');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].textContent).toContain('8 ימים בשלב הוגשו');
    expect(evidence[0].textContent).toContain('deal'); // source chip
    expect(within(trail).getAllByText('pit_boss').length).toBeGreaterThan(0);
  });

  it('shows the rejection reason on the move row', () => {
    const { deal } = seedPersonWithDeal({
      name: 'יוסי מזרחי',
      jobTitle: 'DevOps',
      stage: 'ClientInterview',
    });
    store().moveDeal(deal.id, 'Rejected', { reason: 'שכר גבוה מדי' });
    render(<CardBack dealId={deal.id} onClose={() => {}} />);
    expect(screen.getByText('סיבה: שכר גבוה מדי')).toBeTruthy();
  });

  it('buildDealTrail is pure and ignores other deals', () => {
    const a = seedPersonWithDeal({ name: 'א', jobTitle: 'X', stage: 'Sourced' });
    const b = seedPersonWithDeal({ name: 'ב', jobTitle: 'Y', stage: 'Sourced' });
    store().moveDeal(b.deal.id, 'Screened');
    const s = store();
    const trail = buildDealTrail({
      deal: s.deals.find((d) => d.id === a.deal.id)!,
      person: s.persons.find((p) => p.id === a.person.id),
      stageEvents: s.stageEvents,
      auditLog: s.auditLog,
      suggestions: s.suggestions,
    });
    expect(trail).toHaveLength(1); // only a's creation event
    expect(trail[0].label).toContain('הכרטיס נוצר');
  });
});

describe('paste-a-thread → parse report → explicit apply', () => {
  it('parse shows the report WITHOUT touching the store; apply logs contacts + reply state', () => {
    const { person, deal } = seedPersonWithDeal({
      name: 'דנה לוי',
      phone: '0501234567',
      jobTitle: 'QA Lead',
      stage: 'Outreach',
    });

    render(<CardBack dealId={deal.id} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('thread-paste'), {
      target: { value: THREAD },
    });
    fireEvent.click(screen.getByTestId('thread-parse-button'));

    // report: 2 messages (1 hers · 1 candidate), 1 skipped, latest = replied
    const report = screen.getByTestId('thread-report');
    expect(report.textContent).toContain('זוהו 2 הודעות');
    expect(report.textContent).toContain('1 שלך');
    expect(report.textContent).toContain('1 של המועמד/ת');
    expect(report.textContent).toContain('דולגו 1 שורות');
    expect(report.textContent).toContain('המועמד/ת הגיב/ה אחרון/ה');

    // parsing is pure — nothing reached the store yet
    expect(
      store().persons.find((p) => p.id === person.id)!.contactEvents,
    ).toHaveLength(0);

    // explicit apply → contract actions only
    fireEvent.click(screen.getByTestId('thread-apply-button'));
    const events = store().persons.find((p) => p.id === person.id)!.contactEvents;
    expect(events).toHaveLength(2);
    const contacted = events.find((e) => e.kind === 'contacted')!;
    expect(contacted.channel).toBe('whatsapp');
    expect(contacted.ts).toBe('2026-07-30T09:12:00.000Z');
    // the store carries the HASH of the pasted text, never the text
    expect(contacted.messageHash).toBe(hashMessage('היי דנה, ראית את המשרה?'));
    expect(JSON.stringify(events)).not.toContain('ראית את המשרה');
    const replied = events.find((e) => e.kind === 'replied')!;
    expect(replied.ts).toBe('2026-07-30T10:03:11.000Z');

    expect(screen.getByTestId('thread-apply-result').textContent).toContain(
      'הוחל: 1 פניות · 1 מענים · 0 דולגו',
    );
  });

  it('paste-twice is idempotent: the second apply skips everything', () => {
    const { person, deal } = seedPersonWithDeal({
      name: 'דנה לוי',
      jobTitle: 'QA Lead',
      stage: 'Outreach',
    });
    render(<CardBack dealId={deal.id} onClose={() => {}} />);

    const paste = () => {
      fireEvent.change(screen.getByTestId('thread-paste'), {
        target: { value: THREAD },
      });
      fireEvent.click(screen.getByTestId('thread-parse-button'));
      fireEvent.click(screen.getByTestId('thread-apply-button'));
    };
    paste();
    paste();

    const events = store().persons.find((p) => p.id === person.id)!.contactEvents;
    expect(events).toHaveLength(2); // no duplicates
    expect(screen.getByTestId('thread-apply-result').textContent).toContain(
      'הוחל: 0 פניות · 0 מענים · 2 דולגו',
    );
  });

  it('warns when no message matched her identity', () => {
    const { deal } = seedPersonWithDeal({
      name: 'דנה לוי',
      jobTitle: 'QA Lead',
      stage: 'Outreach',
    });
    render(<CardBack dealId={deal.id} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('thread-paste'), {
      target: { value: '[30.7.2026, 9:12] מישהי אחרת: שלום' },
    });
    fireEvent.click(screen.getByTestId('thread-parse-button'));
    expect(screen.getByTestId('thread-her-warning')).toBeTruthy();
  });
});
