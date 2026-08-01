// @vitest-environment jsdom
/**
 * BenchRail DOM tests (jsdom) — kanban-ui, Wave 3.
 *
 * Covered: silver-medalist badge from the store's bench metadata (never
 * recomputed in the UI), silver-first ordering, bench reason rendering
 * (dir="auto"), the re-match CTA filing ONE pending `rematch` request
 * Suggestion addressed to the Bench Sourcer, and the restore-to-board
 * flow (moveDeal back to the stage the deal left + bench flag cleared),
 * plus the pure restore planner's edge cases.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { usePipelineStore } from '../../store/pipelineStore';
import { BenchRail, pendingRematchPersonIds, restorePlanForPerson } from './BenchRail';
import {
  resetPipelineStore,
  seedPersonWithDeal,
} from '../../views/Pipeline/storeTestKit';

const store = () => usePipelineStore.getState();

beforeEach(() => resetPipelineStore());
afterEach(cleanup);

function renderRail() {
  return render(
    <DndContext>
      <BenchRail />
    </DndContext>,
  );
}

/** Bench a person by rejecting their deal from the given stage. */
function benchVia(name: string, stage: 'Outreach' | 'ClientInterview', reason: string) {
  const seeded = seedPersonWithDeal({ name, jobTitle: 'Role', stage });
  store().moveDeal(seeded.deal.id, 'Rejected', { reason });
  return seeded;
}

describe('silver medalists', () => {
  it('badges deep-then-rejected persons and lists them first', () => {
    benchVia('רגיל רגיל', 'Outreach', 'לא רלוונטי'); // benched FIRST (older)
    benchVia('כסף כהן', 'ClientInterview', 'נבחר מועמד אחר'); // Submitted+ ⇒ silver

    renderRail();
    const cards = screen.getAllByTestId('bench-card');
    expect(cards).toHaveLength(2);
    // silver first, despite being benched later
    expect(within(cards[0]).getByText('כסף כהן')).toBeTruthy();
    expect(within(cards[0]).getByTestId('silver-badge')).toBeTruthy();
    expect(within(cards[1]).queryByTestId('silver-badge')).toBeNull();
    // reason renders, BiDi-safe
    const reason = within(cards[0]).getByText('נבחר מועמד אחר');
    expect(reason.getAttribute('dir')).toBe('auto');
  });
});

describe('re-match CTA', () => {
  it('files ONE pending rematch request addressed to the bench sourcer', () => {
    const { person } = benchVia('דנה לוי', 'ClientInterview', 'נבחר מועמד אחר');
    renderRail();

    fireEvent.click(screen.getByTestId('bench-rematch'));
    const requests = store().suggestions.filter((s) => s.kind === 'rematch');
    expect(requests).toHaveLength(1);
    expect(requests[0].agent).toBe('bench_sourcer');
    expect(requests[0].personId).toBe(person.id);
    expect(requests[0].status).toBe('pending');
    expect(requests[0].title).toContain('דנה לוי');
    // evidence cites person fields (reason + the silver medal)
    expect(requests[0].evidence.some((e) => e.claim.includes('נבחר מועמד אחר'))).toBe(true);
    expect(requests[0].evidence.every((e) => e.sourceId === person.id)).toBe(true);

    // the CTA locks while the request is pending — no duplicates
    const button = screen.getByTestId('bench-rematch') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(store().suggestions.filter((s) => s.kind === 'rematch')).toHaveLength(1);

    // resolving the request re-arms the CTA
    store().dismissSuggestion(requests[0].id);
    expect(pendingRematchPersonIds(store().suggestions).size).toBe(0);
  });
});

describe('restore to board', () => {
  it('moves the rejected deal back to the stage it left and clears the bench flag', () => {
    const { person, deal } = benchVia('יוסי מזרחי', 'ClientInterview', 'שכר גבוה');
    renderRail();

    fireEvent.click(screen.getByTestId('bench-restore'));
    const s = store();
    expect(s.deals.find((d) => d.id === deal.id)!.stage).toBe('ClientInterview');
    expect(s.persons.find((p) => p.id === person.id)!.bench).toBeUndefined();
    // rail empties
    expect(screen.queryByTestId('bench-card')).toBeNull();
    // the move is audited through the store (single writer)
    expect(
      s.auditLog.filter((e) => e.action === 'deal.move' && e.entityId === deal.id),
    ).toHaveLength(2); // reject + restore
  });

  it('restorePlanForPerson: parked deal ⇒ move; live pipeline deal ⇒ unbench; tombstoned-only ⇒ recreate at Sourced', () => {
    // parked (Rejected)
    const a = benchVia('א', 'Outreach', 'סיבה');
    let plan = restorePlanForPerson(a.person.id, store().deals, store().stageEvents);
    expect(plan).toEqual({ kind: 'move', dealId: a.deal.id, to: 'Outreach' });

    // live pipeline deal only (stale bench flag)
    const b = seedPersonWithDeal({ name: 'ב', jobTitle: 'Y', stage: 'Screened' });
    plan = restorePlanForPerson(b.person.id, store().deals, store().stageEvents);
    expect(plan).toEqual({ kind: 'unbench' });

    // tombstoned-only history ⇒ recreate on the last mandate at Sourced
    store().deleteDeal(a.deal.id);
    plan = restorePlanForPerson(a.person.id, store().deals, store().stageEvents);
    expect(plan).toEqual({
      kind: 'recreate',
      jobId: a.deal.jobId,
      jobTitle: a.deal.jobTitle,
      to: 'Sourced',
    });

    // no deals at all ⇒ just unbench
    const { person } = store().addPerson({ name: 'ג' });
    plan = restorePlanForPerson(person.id, store().deals, store().stageEvents);
    expect(plan).toEqual({ kind: 'unbench' });
  });

  it('recreate path: restore after the deal was tombstoned creates a fresh Sourced deal', () => {
    const { person, deal } = benchVia('רות אלון', 'Outreach', 'לא זמינה');
    store().deleteDeal(deal.id);
    renderRail();

    fireEvent.click(screen.getByTestId('bench-restore'));
    const s = store();
    const fresh = s.deals.filter((d) => d.personId === person.id && !d.deleted);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].stage).toBe('Sourced');
    expect(fresh[0].jobTitle).toBe(deal.jobTitle);
    expect(s.persons.find((p) => p.id === person.id)!.bench).toBeUndefined();
  });
});
