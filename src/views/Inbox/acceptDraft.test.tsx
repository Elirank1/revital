// @vitest-environment jsdom
/**
 * Accept-with-edit instrumentation tests (jsdom) — kanban-ui, Wave 2.
 *
 * The D-029 handoff: kanban-ui stamps `editedBeforeAccept` at accept time
 * so `suggestionEditRate` can measure. Covered: marker true/false, edited
 * body persistence (the wa.me link carries the EDITED text — hash chain),
 * the human 'suggestion.edit' audit entry, refusal shapes, the queue's
 * edit UI end-to-end, and the metrics lib reading the stamped markers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { computeLeadingIndicators } from '../../lib/metrics/leadingIndicators';
import { acceptSuggestionWithEdit, type SuggestionWithEditMarker } from './acceptDraft';
import { SuggestionsQueue } from './SuggestionsQueue';
import { resetPipelineStore } from '../Pipeline/storeTestKit';

beforeEach(() => resetPipelineStore());
afterEach(cleanup);

function seedDraft(body = 'היי נועה, ראיתי את הפרופיל שלך') {
  const { person } = usePipelineStore.getState().addPerson({
    name: 'נועה כהן',
    phone: '0501234567',
  });
  return usePipelineStore.getState().addSuggestion({
    agent: 'outreach_runner',
    kind: 'draft_message',
    personId: person.id,
    title: 'טיוטת פנייה לנועה',
    body,
  });
}

function storedSuggestion(id: string): SuggestionWithEditMarker | undefined {
  return usePipelineStore
    .getState()
    .suggestions.find((s) => s.id === id) as SuggestionWithEditMarker | undefined;
}

describe('acceptSuggestionWithEdit (unit)', () => {
  it('edited accept: replaces the body, stamps true, audits the edit, persists', () => {
    const sug = seedDraft();
    const ok = acceptSuggestionWithEdit(sug.id, 'היי נועה, נעים מאוד');
    expect(ok).toBe(true);

    const after = storedSuggestion(sug.id)!;
    expect(after.status).toBe('accepted');
    expect(after.body).toBe('היי נועה, נעים מאוד');
    expect(after.editedBeforeAccept).toBe(true);

    // marker + body survive the store's persistence (metrics read this JSON)
    const persisted = JSON.parse(localStorage.getItem('revital_v3_suggestions')!);
    const record = persisted.find((s: { id: string }) => s.id === sug.id);
    expect(record.editedBeforeAccept).toBe(true);
    expect(record.body).toBe('היי נועה, נעים מאוד');

    const actions = usePipelineStore.getState().auditLog.map((e) => e.action);
    expect(actions).toContain('suggestion.edit');
    expect(actions.indexOf('suggestion.edit')).toBeLessThan(
      actions.indexOf('suggestion.accepted'),
    );
  });

  it('unedited accept (null) stamps false and adds NO edit audit entry', () => {
    const sug = seedDraft();
    acceptSuggestionWithEdit(sug.id, null);
    const after = storedSuggestion(sug.id)!;
    expect(after.status).toBe('accepted');
    expect(after.body).toBe(sug.body);
    expect(after.editedBeforeAccept).toBe(false);
    expect(
      usePipelineStore.getState().auditLog.some((e) => e.action === 'suggestion.edit'),
    ).toBe(false);
  });

  it('a body identical to the original counts as NOT edited', () => {
    const sug = seedDraft('טקסט מקורי');
    acceptSuggestionWithEdit(sug.id, 'טקסט מקורי');
    expect(storedSuggestion(sug.id)!.editedBeforeAccept).toBe(false);
  });

  it('refuses missing/resolved suggestions without touching anything', () => {
    expect(acceptSuggestionWithEdit('ghost', 'x')).toBe(false);
    const sug = seedDraft();
    usePipelineStore.getState().dismissSuggestion(sug.id);
    expect(acceptSuggestionWithEdit(sug.id, 'x')).toBe(false);
    expect(storedSuggestion(sug.id)!.status).toBe('dismissed');
    expect(storedSuggestion(sug.id)!.editedBeforeAccept).toBeUndefined();
  });

  it('suggestionEditRate becomes measurable: one edited + one as-is = 0.5', () => {
    const a = seedDraft('טיוטה ראשונה');
    const { person } = usePipelineStore.getState().addPerson({ name: 'דנה לוי' });
    const b = usePipelineStore.getState().addSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      personId: person.id,
      title: 'טיוטה לדנה',
      body: 'טיוטה שנייה',
    });
    acceptSuggestionWithEdit(a.id, 'טיוטה ראשונה — ערוכה');
    acceptSuggestionWithEdit(b.id, null);
    const metrics = computeLeadingIndicators(
      [],
      [],
      usePipelineStore.getState().suggestions,
    );
    expect(metrics.suggestionEditRate).toBe(0.5);
  });
});

describe('queue edit flow (DOM)', () => {
  it('edit → accept stamps true and the wa.me link carries the EDITED text', () => {
    seedDraft('שלום נועה');
    render(<SuggestionsQueue />);

    fireEvent.click(screen.getByTestId('draft-edit-toggle'));
    const textarea = screen.getByTestId('draft-edit') as HTMLTextAreaElement;
    expect(textarea.value).toBe('שלום נועה');
    fireEvent.change(textarea, { target: { value: 'שלום נועה, ערכתי את זה' } });
    fireEvent.click(screen.getByText('אישור'));

    const accepted = usePipelineStore
      .getState()
      .suggestions.find((s) => s.status === 'accepted') as SuggestionWithEditMarker;
    expect(accepted.editedBeforeAccept).toBe(true);
    expect(accepted.body).toBe('שלום נועה, ערכתי את זה');

    // the accepted-drafts wa.me anchor renders the edited body's text
    const link = screen.getByTestId('accepted-wa-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain(
      encodeURIComponent('שלום נועה, ערכתי את זה'),
    );
  });

  it('accepting without opening the editor stamps false', () => {
    seedDraft();
    render(<SuggestionsQueue />);
    fireEvent.click(screen.getByText('אישור'));
    const accepted = usePipelineStore
      .getState()
      .suggestions.find((s) => s.status === 'accepted') as SuggestionWithEditMarker;
    expect(accepted.editedBeforeAccept).toBe(false);
  });

  it('the edit toggle appears only on draft_message suggestions', () => {
    usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'flag',
      title: 'שים לב',
      body: 'פער שכר',
    });
    render(<SuggestionsQueue />);
    expect(screen.queryByTestId('draft-edit-toggle')).toBeNull();
  });
});
