// @vitest-environment jsdom
/**
 * Cross-teammate seam smoke tests (quality-gate, Wave 1).
 *
 * Independent verification of the seams BETWEEN owners' modules, which
 * each owner's own suite exercises only from its side:
 *
 *   1. agents-engine → platform-data → kanban-ui:
 *      runScreener on synthetic legacy analyses → cards render on the
 *      live board (Screened column, score chip from the read-only legacy
 *      subscription, flag suggestion in the inbox badge).
 *   2. integrations → platform-data → kanban-ui:
 *      openerDraft → draftToSuggestion → addSuggestion → HUMAN accept in
 *      the rendered queue → wa.me <a href> on both the queue and the card
 *      carry the draft text; a real DOM click logs a contact whose hash
 *      equals suggestionMessageHash (hash-stability through the glue).
 *   3. undo across the UI: accepted next_action stamped on the card, then
 *      undoLast restores BOTH the queue (pending again) and the card;
 *      Rejected → bench rail → undo empties the rail.
 *   4. Single-writer: accepting via the queue mutates ONLY through the
 *      store (frozen pre-click objects stay untouched; audit appended).
 *   5. BiDi: dir="auto" on every user-content node across the seams.
 *
 * G4: anchors are asserted as inert hrefs; a capture-phase preventDefault
 * blocks jsdom navigation so no click ever "sends".
 * Synthetic fixtures only; no network (fetch is spied and must stay idle).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CandidateAnalysis } from '../../types';
import { useAppStore } from '../../store/appStore';
import { usePipelineStore } from '../../store/pipelineStore';
import { runScreener, screenerDealId, screenerFlagSuggestionId } from '../../agents/screener';
import {
  composeWaMeUrl,
  draftToSuggestion,
  hashMessage,
  openerDraft,
  suggestionMessageHash,
} from '../../lib/outreach';
import { PipelineView } from './PipelineView';
import { resetPipelineStore, seedPersonWithDeal } from './storeTestKit';

// ---- synthetic legacy analysis (never real candidate data) ----
function makeAnalysis(
  id: string,
  candidateId: string,
  candidateName: string,
  overrides: Partial<CandidateAnalysis> = {},
): CandidateAnalysis {
  return {
    id,
    candidateId,
    jobId: `job-${id}`,
    candidateName,
    jobTitle: 'Backend Engineer',
    timestamp: '2026-07-30T10:00:00.000Z',
    profileSummary: '',
    matchScore: 82,
    verdict: 'Strong Fit',
    pillarScores: [],
    greenFlags: [],
    redFlags: [],
    autoRedFlags: [],
    truthTestQuestions: [],
    recruiterQuestions: [],
    recruiterNotes: { outreachAngle: '', salaryEstimate: '', additionalNotes: '' },
    recruiterComment: '',
    rawResponse: '',
    ...overrides,
  };
}

// G4: block jsdom navigation on anchor clicks — hrefs are asserted, never followed.
const blockNav = (e: Event) => e.preventDefault();

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPipelineStore(); // flag ON, clean v3 state, cleared localStorage
  useAppStore.setState({ analyses: [] });
  document.addEventListener('click', blockNav, true);
  fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((() =>
    Promise.reject(new Error('network disabled in tests (G2)'))) as never);
});

afterEach(() => {
  document.removeEventListener('click', blockNav, true);
  expect(fetchSpy).not.toHaveBeenCalled(); // no seam may touch the network
  fetchSpy.mockRestore();
  cleanup();
});

// ------------------------------------------------------------------
// 1. Screener → store → board
// ------------------------------------------------------------------

describe('screener → store → board seam', () => {
  it('screener-created cards render live in the Screened column with the score chip', () => {
    const a1 = makeAnalysis('a1', 'c1', 'נועה כהן');
    const a2 = makeAnalysis('a2', 'c2', 'Dana Levi', {
      matchScore: 31,
      verdict: 'Reject',
    });
    // Board reads analyses via its READ-ONLY legacy subscription.
    useAppStore.setState({ analyses: [a1, a2] });

    const result = runScreener([a1, a2]);
    expect(result.carded).toHaveLength(2);

    render(<PipelineView />);
    const column = screen.getByTestId('column-Screened');
    expect(screen.getByTestId('count-Screened').textContent).toBe('2');
    expect(within(column).getByText('נועה כהן')).toBeTruthy();
    expect(within(column).getByText('Dana Levi')).toBeTruthy();
    // Score chips come from the legacy analysis linked via deal.analysisId.
    const chips = within(column).getAllByTestId('score-chip');
    const chipTexts = chips.map((c) => c.textContent);
    expect(chipTexts).toContain('82 · Strong Fit');
    expect(chipTexts).toContain('31 · Reject');
  });

  it('a Reject verdict cards anyway AND surfaces its flag suggestion in the inbox', () => {
    const a = makeAnalysis('a9', 'c9', 'רון מזרחי', {
      matchScore: 28,
      verdict: 'Reject',
    });
    useAppStore.setState({ analyses: [a] });
    runScreener([a]);

    // The card exists (rejection is HER decision, D-022)…
    expect(
      usePipelineStore.getState().deals.some((d) => d.id === screenerDealId('a9')),
    ).toBe(true);

    // …and the reasoning is one tap away in the queue.
    render(<PipelineView />);
    expect(screen.getByTestId('inbox-badge-count').textContent).toBe('1');
    fireEvent.click(screen.getByTestId('inbox-badge'));
    const queue = screen.getByTestId('suggestions-queue');
    const sug = usePipelineStore
      .getState()
      .suggestions.find((s) => s.id === screenerFlagSuggestionId('a9'));
    expect(sug?.status).toBe('pending');
    expect(within(queue).getByText(sug!.title)).toBeTruthy();
    // Screener attribution is visible on the item (agent chip).
    expect(within(queue).getByText('screener')).toBeTruthy();
  });

  it('screener mutations are audit-attributed agent:screener end-to-end', () => {
    const a = makeAnalysis('a5', 'c5', 'יעל ברק');
    runScreener([a]);
    const audit = usePipelineStore.getState().auditLog;
    const create = audit.filter(
      (e) => e.actor === 'ai' && (e as { agent?: string }).agent === 'screener',
    );
    // person.create + deal.create at minimum, both attributed.
    expect(create.map((e) => e.action)).toEqual(
      expect.arrayContaining(['person.create', 'deal.create']),
    );
  });
});

// ------------------------------------------------------------------
// 2. Drafts → suggestion → accept → wa.me (hash stability through the UI)
// ------------------------------------------------------------------

describe('integrations → store → board wa.me seam', () => {
  function seedAcceptedDraftFlow() {
    const { person, deal } = seedPersonWithDeal({
      name: 'נועה כהן',
      phone: '050-123-4567',
      jobTitle: 'Senior Backend Engineer',
      stage: 'Outreach',
    });
    const draft = openerDraft(person, deal);
    const sug = usePipelineStore.getState().addSuggestion({
      ...draftToSuggestion(draft),
      dealId: deal.id,
      personId: person.id,
    });
    return { person, deal, draft, sug };
  }

  it('human accept in the queue → wa.me href carries the exact draft text (both surfaces)', () => {
    const { draft, sug } = seedAcceptedDraftFlow();
    render(<PipelineView />);

    // Accept through the rendered queue (the human tap).
    fireEvent.click(screen.getByTestId('inbox-badge'));
    const queue = screen.getByTestId('suggestions-queue');
    fireEvent.click(within(queue).getByText('אישור'));

    expect(
      usePipelineStore.getState().suggestions.find((s) => s.id === sug.id)?.status,
    ).toBe('accepted');

    // Queue surface: accepted-drafts section renders the wa.me anchor.
    const queueLink = within(queue).getByTestId('accepted-wa-link') as HTMLAnchorElement;
    const expectedHref = composeWaMeUrl('050-123-4567', draft.text);
    expect(queueLink.getAttribute('href')).toBe(expectedHref);
    expect(queueLink.getAttribute('href')).toContain('https://wa.me/972501234567');

    // Card surface: the one-tap button now carries the accepted draft too.
    const cardLink = within(screen.getByTestId('column-Outreach')).getByTestId(
      'wa-link',
    ) as HTMLAnchorElement;
    expect(cardLink.getAttribute('href')).toBe(expectedHref);

    // The encoded text round-trips to the exact accepted body — no drift.
    const encoded = queueLink.getAttribute('href')!.split('?text=')[1];
    expect(decodeURIComponent(encoded)).toBe(draft.text);
  });

  it('clicking the accepted link logs a contact whose hash equals suggestionMessageHash', () => {
    const { person, sug } = seedAcceptedDraftFlow();
    render(<PipelineView />);
    fireEvent.click(screen.getByTestId('inbox-badge'));
    const queue = screen.getByTestId('suggestions-queue');
    fireEvent.click(within(queue).getByText('אישור'));

    fireEvent.click(within(queue).getByTestId('accepted-wa-link'));

    const stored = usePipelineStore.getState().persons.find((p) => p.id === person.id)!;
    const contacted = stored.contactEvents.filter((e) => e.kind === 'contacted');
    expect(contacted).toHaveLength(1);
    const accepted = usePipelineStore
      .getState()
      .suggestions.find((s) => s.id === sug.id)!;
    expect((contacted[0] as { messageHash?: string }).messageHash).toBe(
      suggestionMessageHash(accepted),
    );
    expect((contacted[0] as { channel?: string }).channel).toBe('whatsapp');
    // And the audit trail captured the zero-keystroke log.
    expect(
      usePipelineStore.getState().auditLog.some((e) => e.action === 'person.contact'),
    ).toBe(true);
  });

  it('with no accepted draft the card link is a bare chat-opener and logs the empty hash', () => {
    const { person } = seedPersonWithDeal({
      name: 'דנה לוי',
      phone: '0521234567',
      jobTitle: 'Data Engineer',
      stage: 'Sourced',
    });
    render(<PipelineView />);
    const link = within(screen.getByTestId('column-Sourced')).getByTestId(
      'wa-link',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://wa.me/972521234567');

    fireEvent.click(link);
    const stored = usePipelineStore.getState().persons.find((p) => p.id === person.id)!;
    const contacted = stored.contactEvents.filter((e) => e.kind === 'contacted');
    expect(contacted).toHaveLength(1);
    expect((contacted[0] as { messageHash?: string }).messageHash).toBe(hashMessage(''));
  });
});

// ------------------------------------------------------------------
// 3. Undo seams through the rendered UI
// ------------------------------------------------------------------

describe('undo restores state across UI surfaces', () => {
  it('accept next_action → card shows it → undo → queue pending again AND card reset', () => {
    const { person, deal } = seedPersonWithDeal({
      name: 'יוסי לוי',
      jobTitle: 'DevOps Engineer',
      stage: 'Screened',
    });
    usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'next_action',
      dealId: deal.id,
      personId: person.id,
      title: 'לקבוע שיחת היכרות',
      body: 'מומלץ ליצור קשר השבוע.',
    });

    render(<PipelineView />);
    fireEvent.click(screen.getByTestId('inbox-badge'));
    const queue = screen.getByTestId('suggestions-queue');
    fireEvent.click(within(queue).getByText('אישור'));

    // Card now shows the stamped next action (single-writer applied effect).
    const column = screen.getByTestId('column-Screened');
    expect(within(column).getByText(/לקבוע שיחת היכרות/)).toBeTruthy();
    expect(
      usePipelineStore.getState().deals.find((d) => d.id === deal.id)?.nextAction
        ?.label,
    ).toBe('לקבוע שיחת היכרות');

    act(() => {
      expect(usePipelineStore.getState().undoLast()).toBe(true);
    });

    // Queue: pending again. Card: next action gone.
    expect(within(queue).getByText('אישור')).toBeTruthy();
    expect(
      usePipelineStore.getState().suggestions.find((s) => s.dealId === deal.id)
        ?.status,
    ).toBe('pending');
    expect(
      usePipelineStore.getState().deals.find((d) => d.id === deal.id)?.nextAction,
    ).toBeUndefined();
    expect(within(column).getByText('אין פעולה מוגדרת')).toBeTruthy();
  });

  it('reject → bench rail shows the person → undo → rail empties and column restores', () => {
    const { deal } = seedPersonWithDeal({
      name: 'רות אלון',
      jobTitle: 'QA Lead',
      stage: 'ClientInterview',
    });
    render(<PipelineView />);
    act(() => {
      usePipelineStore.getState().moveDeal(deal.id, 'Rejected', { reason: 'שכר גבוה מדי' });
    });
    const rail = screen.getByTestId('bench-rail');
    expect(within(rail).getByText('רות אלון')).toBeTruthy();
    expect(screen.getByTestId('count-ClientInterview').textContent).toBe('0');

    act(() => {
      usePipelineStore.getState().undoLast();
    });
    expect(within(rail).queryByText('רות אלון')).toBeNull();
    expect(screen.getByTestId('count-ClientInterview').textContent).toBe('1');
    // The person is un-benched in the store, not just hidden.
    expect(usePipelineStore.getState().persons.every((p) => !p.bench)).toBe(true);
  });
});

// ------------------------------------------------------------------
// 4. Single-writer: queue accept mutates only via the store
// ------------------------------------------------------------------

describe('accept-suggestion mutates only via store', () => {
  it('pre-click objects stay frozen-untouched; the store swaps in new objects and audits', () => {
    const { person, deal } = seedPersonWithDeal({
      name: 'תמר גל',
      jobTitle: 'Frontend Engineer',
      stage: 'Screened',
    });
    const sug = usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'next_action',
      dealId: deal.id,
      personId: person.id,
      title: 'לשלוח תיאום',
      body: '',
    });

    // Deep-freeze the live objects: any in-place mutation by a component
    // (instead of a store action) would throw or silently fail below.
    const frozenSug = usePipelineStore.getState().suggestions.find((s) => s.id === sug.id)!;
    const frozenDeal = usePipelineStore.getState().deals.find((d) => d.id === deal.id)!;
    Object.freeze(frozenSug);
    Object.freeze(frozenDeal);
    const auditBefore = usePipelineStore.getState().auditLog.length;

    render(<PipelineView />);
    fireEvent.click(screen.getByTestId('inbox-badge'));
    fireEvent.click(within(screen.getByTestId('suggestions-queue')).getByText('אישור'));

    // Old objects untouched (immutability held), new objects installed.
    expect(frozenSug.status).toBe('pending');
    expect(frozenDeal.nextAction).toBeUndefined();
    const nextSug = usePipelineStore.getState().suggestions.find((s) => s.id === sug.id)!;
    const nextDeal = usePipelineStore.getState().deals.find((d) => d.id === deal.id)!;
    expect(nextSug).not.toBe(frozenSug);
    expect(nextSug.status).toBe('accepted');
    expect(nextDeal.nextAction?.label).toBe('לשלוח תיאום');

    // The mutation is audited (append-only log grew, right action).
    const audit = usePipelineStore.getState().auditLog;
    expect(audit.length).toBeGreaterThan(auditBefore);
    expect(audit.some((e) => e.action === 'suggestion.accepted' && e.entityId === sug.id)).toBe(true);

    // And persisted under the v3 namespace, matching the store.
    const persisted = JSON.parse(localStorage.getItem('revital_v3_suggestions')!);
    expect(persisted.find((s: { id: string }) => s.id === sug.id).status).toBe('accepted');
  });
});

// ------------------------------------------------------------------
// 5. BiDi: dir="auto" on user-content nodes
// ------------------------------------------------------------------

describe('dir="auto" on user content', () => {
  it('card name/title, queue title/body/evidence, and bench reason all carry dir="auto"', () => {
    const { person, deal } = seedPersonWithDeal({
      name: 'נועה כהן', // worst case: Hebrew name + English title on one card line
      phone: '0501234567',
      jobTitle: 'Senior Backend Engineer',
      stage: 'Screened',
    });
    usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'flag',
      dealId: deal.id,
      personId: person.id,
      title: 'דגל: פער שכר מול Budget',
      body: 'הציפייה 45K, התקציב 38K.',
      evidence: [{ claim: 'ניתוח שכר: 45K vs 38K', sourceType: 'analysis', sourceId: 'a1' }],
    });
    const benched = seedPersonWithDeal({
      name: 'David Katz',
      jobTitle: 'Platform Engineer',
      stage: 'Sourced',
    });
    usePipelineStore.getState().moveDeal(benched.deal.id, 'Rejected', { reason: 'לא זמין כרגע' });

    render(<PipelineView />);
    fireEvent.click(screen.getByTestId('inbox-badge'));

    const requireDirAuto = (el: Element | null, what: string) => {
      expect(el, what).toBeTruthy();
      expect(el!.getAttribute('dir'), `${what} must have dir="auto"`).toBe('auto');
    };

    // DealCard: candidate name + job title.
    const card = within(screen.getByTestId('column-Screened')).getAllByTestId('deal-card')[0];
    requireDirAuto(within(card).getByText('נועה כהן'), 'card candidate name');
    requireDirAuto(within(card).getByText('Senior Backend Engineer'), 'card job title');

    // SuggestionsQueue: title, body, evidence claim.
    const queue = screen.getByTestId('suggestions-queue');
    requireDirAuto(within(queue).getByText('דגל: פער שכר מול Budget'), 'suggestion title');
    requireDirAuto(within(queue).getByText('הציפייה 45K, התקציב 38K.'), 'suggestion body');
    requireDirAuto(within(queue).getByText(/ניתוח שכר/), 'evidence claim');

    // Bench rail: person name + reason.
    const rail = screen.getByTestId('bench-rail');
    requireDirAuto(within(rail).getByText('David Katz'), 'bench person name');
    requireDirAuto(within(rail).getByText('לא זמין כרגע'), 'bench reason');
  });
});
