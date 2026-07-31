// @vitest-environment jsdom
/**
 * SuggestionsQueue DOM tests (jsdom) — kanban-ui, Wave 1.
 *
 * Real store integration: accept/dismiss mutate ONLY via the store
 * (single-writer, plan §3); accepted drafts render as wa.me anchors via
 * the integrations glue and clicking logs through pipelineContactLogger.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { hashMessage } from '../../lib/outreach';
import { SuggestionsQueue } from './SuggestionsQueue';
import { resetPipelineStore } from '../Pipeline/storeTestKit';

beforeEach(() => resetPipelineStore());
afterEach(cleanup);

function seedSuggestion(overrides: Partial<Parameters<ReturnType<typeof usePipelineStore.getState>['addSuggestion']>[0]> = {}) {
  return usePipelineStore.getState().addSuggestion({
    agent: 'screener',
    kind: 'flag',
    title: 'כפילות אפשרית: נועה כהן',
    body: 'קיים מועמד נוסף עם שם זהה.',
    evidence: [{ claim: 'שם זהה לאחר נרמול', sourceType: 'person', sourceId: 'p9' }],
    ...overrides,
  });
}

describe('pending list', () => {
  it('renders title, body and evidence with dir="auto" on user content', () => {
    seedSuggestion();
    render(<SuggestionsQueue />);
    const title = screen.getByText('כפילות אפשרית: נועה כהן');
    expect(title.getAttribute('dir')).toBe('auto');
    const body = screen.getByText('קיים מועמד נוסף עם שם זהה.');
    expect(body.getAttribute('dir')).toBe('auto');
    expect(screen.getByText(/שם זהה לאחר נרמול/).getAttribute('dir')).toBe('auto');
    expect(screen.getByText('screener')).toBeTruthy();
  });

  it('shows the empty state when nothing is pending', () => {
    render(<SuggestionsQueue />);
    expect(screen.getByText(/אין הצעות ממתינות/)).toBeTruthy();
  });
});

describe('accept flow (single-writer via store)', () => {
  it('אישור resolves the suggestion through acceptSuggestion and empties the list', () => {
    const sug = seedSuggestion();
    render(<SuggestionsQueue />);
    fireEvent.click(screen.getByText('אישור'));
    const stored = usePipelineStore.getState().suggestions.find((s) => s.id === sug.id);
    expect(stored?.status).toBe('accepted');
    expect(screen.queryByTestId('suggestion-item')).toBeNull();
    // Audit entry written by the store, attributed to the human click.
    const audit = usePipelineStore.getState().auditLog.at(-1);
    expect(audit?.action).toBe('suggestion.accepted');
    expect(audit?.actor).toBe('human');
  });

  it('דחייה resolves via dismissSuggestion', () => {
    const sug = seedSuggestion();
    render(<SuggestionsQueue />);
    fireEvent.click(screen.getByText('דחייה'));
    const stored = usePipelineStore.getState().suggestions.find((s) => s.id === sug.id);
    expect(stored?.status).toBe('dismissed');
    expect(screen.queryByTestId('suggestion-item')).toBeNull();
  });
});

describe('accepted drafts → wa.me links (G4)', () => {
  it('renders an accepted draft as an <a href="https://wa.me/..."> and logs contact on click', () => {
    const { person } = usePipelineStore
      .getState()
      .addPerson({ name: 'נועה כהן', phone: '050-1234567' });
    const body = 'היי נועה, יש לי משרה שמתאימה לך בדיוק.';
    const sug = usePipelineStore.getState().addSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      personId: person.id,
      title: 'טיוטת פתיחה לנועה',
      body,
    });
    usePipelineStore.getState().acceptSuggestion(sug.id);

    render(<SuggestionsQueue />);
    const link = screen.getByTestId('accepted-wa-link');
    expect(link.tagName).toBe('A');
    const href = link.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/972501234567?text=')).toBe(true);
    expect(decodeURIComponent(href.split('?text=')[1])).toBe(body);

    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    const stored = usePipelineStore
      .getState()
      .persons.find((p) => p.id === person.id)!;
    expect(stored.contactEvents).toHaveLength(1);
    expect(stored.contactEvents[0].kind).toBe('contacted');
    expect(stored.contactEvents[0].messageHash).toBe(hashMessage(body));
  });

  it('shows a no-phone note instead of a link when the person has no number', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'אבי גל' });
    const sug = usePipelineStore.getState().addSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      personId: person.id,
      title: 'טיוטה לאבי',
      body: 'שלום אבי',
    });
    usePipelineStore.getState().acceptSuggestion(sug.id);
    render(<SuggestionsQueue />);
    expect(screen.queryByTestId('accepted-wa-link')).toBeNull();
    expect(screen.getByText('אין מספר טלפון')).toBeTruthy();
  });
});
