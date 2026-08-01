// @vitest-environment jsdom
/**
 * ApprovalsInbox DOM tests (jsdom) — kanban-ui, Wave 3.
 *
 * Covered: grouping by agent (lexicon display names), multi-select +
 * batch approve/dismiss (store single-writer semantics, markers stamped),
 * inline edit routed through acceptSuggestion(id, { editedBody }),
 * accept-rate + edit-rate honesty display ('—' over fake zeros), and the
 * morning-digest contract (title, pending-by-agent, top-3 Pit Boss with
 * the ₪ calibration rule, overdue feedback, one-tap CTA, empty state).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import type { SuggestionWithEditMarker } from '../../store/pipelineStore';
import { ApprovalsInbox, formatRate, groupPendingByAgent } from './ApprovalsInbox';
import {
  backdateDeal,
  resetMoneyStore,
  resetPipelineStore,
  seedFee,
  seedPersonWithDeal,
} from '../Pipeline/storeTestKit';

const store = () => usePipelineStore.getState();

function seedSuggestion(args: {
  agent?: 'screener' | 'bench_sourcer' | 'outreach_runner' | 'client_reporter' | 'pit_boss';
  kind?: 'flag' | 'draft_message' | 'next_action';
  title: string;
  body?: string;
  personId?: string;
}) {
  return store().addSuggestion({
    agent: args.agent ?? 'screener',
    kind: args.kind ?? 'flag',
    title: args.title,
    body: args.body ?? '',
    ...(args.personId ? { personId: args.personId } : {}),
  });
}

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});
afterEach(cleanup);

describe('grouping + rates', () => {
  it('groups pending suggestions by agent with lexicon names and counts', () => {
    seedSuggestion({ agent: 'screener', title: 'דגל: פער שכר' });
    seedSuggestion({ agent: 'outreach_runner', kind: 'draft_message', title: 'טיוטה לנועה', body: 'היי' });
    seedSuggestion({ agent: 'outreach_runner', kind: 'draft_message', title: 'טיוטה לדנה', body: 'שלום' });

    render(<ApprovalsInbox />);
    const screenerGroup = screen.getByTestId('agent-group-screener');
    expect(within(screenerGroup).getByText('סינון אוטומטי')).toBeTruthy();
    const outreachGroup = screen.getByTestId('agent-group-outreach_runner');
    expect(within(outreachGroup).getByText('טיוטות פנייה')).toBeTruthy();
    expect(within(outreachGroup).getAllByTestId('approval-item')).toHaveLength(2);
    // no group for agents without pending items
    expect(screen.queryByTestId('agent-group-pit_boss')).toBeNull();
  });

  it('shows per-agent accept-rate from history and "—" when unmeasured', () => {
    // history: screener 1 accepted + 1 dismissed = 50%
    const a = seedSuggestion({ agent: 'screener', title: 'ישן א' });
    const b = seedSuggestion({ agent: 'screener', title: 'ישן ב' });
    store().acceptSuggestion(a.id);
    store().dismissSuggestion(b.id);
    seedSuggestion({ agent: 'screener', title: 'חדש' });
    seedSuggestion({ agent: 'pit_boss', kind: 'next_action', title: 'לטפל' });

    render(<ApprovalsInbox />);
    expect(screen.getByTestId('accept-rate-screener').textContent).toContain('50%');
    expect(screen.getByTestId('accept-rate-pit_boss').textContent).toContain('—');
  });

  it('overall accept-rate + edit-rate render measured values, never fake 0', () => {
    render(<ApprovalsInbox />);
    // nothing resolved, nothing instrumented — both '—'
    expect(screen.getByTestId('metric-accept-rate').textContent).toBe('—');
    expect(screen.getByTestId('metric-edit-rate').textContent).toBe('—');
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.5)).toBe('50%');
  });
});

describe('batch operations', () => {
  it('multi-select shows the batch bar; batch approve resolves ALL selected via the store', () => {
    const a = seedSuggestion({ agent: 'screener', title: 'אחת' });
    const b = seedSuggestion({ agent: 'screener', title: 'שתיים' });
    seedSuggestion({ agent: 'screener', title: 'שלוש' });

    render(<ApprovalsInbox />);
    expect(screen.queryByTestId('batch-bar')).toBeNull();
    const checks = screen.getAllByTestId('approval-select');
    fireEvent.click(checks[0]);
    fireEvent.click(checks[1]);
    expect(screen.getByTestId('batch-bar').textContent).toContain('2');

    fireEvent.click(screen.getByTestId('batch-approve'));
    const s = store();
    const statuses = new Map(s.suggestions.map((x) => [x.id, x.status]));
    // checks render newest-first: index 0/1 are the two NEWEST, so verify
    // by counting instead of guessing ids, then pin the survivor.
    expect(s.suggestions.filter((x) => x.status === 'accepted')).toHaveLength(2);
    expect(s.suggestions.filter((x) => x.status === 'pending')).toHaveLength(1);
    // marker stamped false on batch accepts (not edited, but measured)
    for (const x of s.suggestions as SuggestionWithEditMarker[]) {
      if (x.status === 'accepted') expect(x.editedBeforeAccept).toBe(false);
    }
    expect(statuses.has(a.id) && statuses.has(b.id)).toBe(true);
    // selection cleared
    expect(screen.queryByTestId('batch-bar')).toBeNull();
  });

  it('group select-all + batch dismiss resolves the whole group', () => {
    seedSuggestion({ agent: 'outreach_runner', kind: 'draft_message', title: 'א', body: 'x' });
    seedSuggestion({ agent: 'outreach_runner', kind: 'draft_message', title: 'ב', body: 'y' });
    seedSuggestion({ agent: 'screener', title: 'לא נבחרת' });

    render(<ApprovalsInbox />);
    fireEvent.click(screen.getByTestId('group-select-outreach_runner'));
    fireEvent.click(screen.getByTestId('batch-dismiss'));

    const s = store();
    expect(s.suggestions.filter((x) => x.status === 'dismissed')).toHaveLength(2);
    expect(
      s.suggestions.find((x) => x.title === 'לא נבחרת')?.status,
    ).toBe('pending');
  });
});

describe('inline edit → acceptSuggestion(id, { editedBody })', () => {
  it('edited accept persists the edited body and stamps the marker true', () => {
    const { person } = store().addPerson({ name: 'נועה כהן', phone: '0501111111' });
    seedSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      title: 'טיוטה',
      body: 'שלום נועה',
      personId: person.id,
    });

    render(<ApprovalsInbox />);
    const item = screen.getByTestId('approval-item');
    fireEvent.click(within(item).getByTestId('inline-edit-toggle'));
    const textarea = within(item).getByTestId('inline-edit') as HTMLTextAreaElement;
    expect(textarea.value).toBe('שלום נועה');
    fireEvent.change(textarea, { target: { value: 'שלום נועה, ערכתי' } });
    fireEvent.click(within(item).getByText('אישור'));

    const accepted = store().suggestions.find(
      (x) => x.status === 'accepted',
    ) as SuggestionWithEditMarker;
    expect(accepted.body).toBe('שלום נועה, ערכתי');
    expect(accepted.editedBeforeAccept).toBe(true);
    const actions = store().auditLog.map((e) => e.action);
    expect(actions.indexOf('suggestion.edit')).toBeGreaterThan(-1);
    expect(actions.indexOf('suggestion.edit')).toBeLessThan(
      actions.indexOf('suggestion.accepted'),
    );
  });
});

describe('morning digest (contract)', () => {
  const NOW = Date.parse('2026-07-31T06:00:00.000Z');

  it('renders the contract title, pending grouped by agent, and the CTA into the inbox', () => {
    seedSuggestion({ agent: 'screener', title: 'דגל א' });
    seedSuggestion({ agent: 'screener', title: 'דגל ב' });
    seedSuggestion({ agent: 'pit_boss', kind: 'next_action', title: 'לטפל' });

    render(
      <ApprovalsInbox initialMode="digest" now={() => NOW} rankMoveTheMoney={null} />,
    );
    expect(screen.getByText('מה מחכה לך הבוקר')).toBeTruthy();
    const rows = screen.getAllByTestId('digest-agent-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('סינון אוטומטי'),
      expect.stringContaining('Pit Boss'),
    ]);
    expect(rows[0].textContent).toContain('2');

    // one tap into the inbox
    fireEvent.click(screen.getByTestId('digest-cta'));
    expect(screen.queryByTestId('morning-digest')).toBeNull();
    expect(screen.getByTestId('inbox-metrics')).toBeTruthy();
    expect(screen.getAllByTestId('approval-item')).toHaveLength(3);
  });

  it('top-3 Pit Boss: at most 3 rows, ₪ ONLY on calibrated items', () => {
    const a = seedPersonWithDeal({ name: 'נועה כהן', jobTitle: 'Backend', stage: 'Submitted' });
    const b = seedPersonWithDeal({ name: 'דנה לוי', jobTitle: 'QA Lead', stage: 'Outreach' });
    const c = seedPersonWithDeal({ name: 'יוסי מזרחי', jobTitle: 'DevOps', stage: 'Offer' });
    const d = seedPersonWithDeal({ name: 'רות אלון', jobTitle: 'PM', stage: 'Offer' });
    // calibrate ONLY a's mandate (complete fee + past-Screened deal)
    seedFee({ jobId: a.deal.jobId, kind: 'fixed', fixedAmount: 40_000 });

    const ranker = () => [
      { dealId: a.deal.id, evAtRisk: 12_345, reasons: [{ claim: 'סיבת א' }], calibrated: true },
      { dealId: b.deal.id, evAtRisk: 0, reasons: [{ claim: 'סיבת ב' }], calibrated: false },
      { dealId: c.deal.id, evAtRisk: 999, reasons: [], calibrated: false },
      { dealId: d.deal.id, evAtRisk: 5, reasons: [], calibrated: false },
    ];
    render(
      <ApprovalsInbox initialMode="digest" now={() => NOW} rankMoveTheMoney={ranker} />,
    );

    const rows = screen.getAllByTestId('digest-top3-row');
    expect(rows).toHaveLength(3); // top-3, the 4th item is cut
    expect(rows[0].textContent).toContain('נועה כהן');
    expect(rows[0].textContent).toContain('סיבת א');
    // ₪ only on the calibrated first row
    expect(screen.getAllByTestId('digest-top3-ev')).toHaveLength(1);
    expect(rows[0].textContent).toContain('₪12,345');
    expect(rows[1].textContent).not.toContain('₪');
    expect(rows[2].textContent).not.toContain('₪');
  });

  it('overdue feedback lists Submitted/ClientInterview deals past the Pit Boss threshold', () => {
    const stuck = seedPersonWithDeal({ name: 'נועה כהן', jobTitle: 'Backend', stage: 'Submitted' });
    backdateDeal(stuck.deal.id, 8); // > FEEDBACK_OVERDUE_DAYS (6)
    const fresh = seedPersonWithDeal({ name: 'דנה לוי', jobTitle: 'QA', stage: 'Submitted' });
    backdateDeal(fresh.deal.id, 2); // inside the window
    const other = seedPersonWithDeal({ name: 'יוסי מזרחי', jobTitle: 'DevOps', stage: 'Outreach' });
    backdateDeal(other.deal.id, 30); // not a feedback stage

    render(
      <ApprovalsInbox initialMode="digest" rankMoveTheMoney={null} />,
    );
    const rows = screen.getAllByTestId('digest-overdue-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('נועה כהן');
    expect(rows[0].textContent).toContain('ללא משוב לקוח');
  });

  it('a clean morning shows the contract empty state', () => {
    render(
      <ApprovalsInbox initialMode="digest" now={() => NOW} rankMoveTheMoney={null} />,
    );
    expect(screen.getByTestId('digest-empty').textContent).toBe(
      'הבוקר נקי — אין פריטים שממתינים לך.',
    );
  });
});

describe('pure helpers', () => {
  it('groupPendingByAgent keeps canonical agent order and drops resolved items', () => {
    const a = seedSuggestion({ agent: 'pit_boss', kind: 'next_action', title: 'פ' });
    seedSuggestion({ agent: 'screener', title: 'ס' });
    store().dismissSuggestion(a.id);
    const groups = groupPendingByAgent(store().suggestions);
    expect(groups.map((g) => g.agent)).toEqual(['screener']);
  });
});
