/**
 * SuggestionsQueue — the approvals inbox — Wave 1 + 2 (kanban-ui).
 *
 * Minimal list of PENDING suggestions: agent chip, title, body, evidence
 * claims, one-tap accept/dismiss straight into the store (acceptSuggestion
 * is the ONLY path where agent output mutates card state — plan §3).
 * Wave 2/3: draft_message bodies are editable before accepting — accepts
 * route through the store's `acceptSuggestion(id, { editedBody })`
 * (Wave-3 absorption, D-036), which stamps the `editedBeforeAccept`
 * marker (true/false) for the edit-rate metric and persists an edited
 * body so the wa.me link carries EXACTLY what she approved. The full
 * Wave-3 approvals surface (grouping, batch ops, digest) lives in
 * `ApprovalsInbox.tsx`; this queue stays the compact embedded panel.
 * Below, recently ACCEPTED drafts render as plain wa.me
 * `<a href>` links via the integrations glue — clicking logs the contact
 * through `composeAndLog` (hash always equals the accepted body's hash)
 * and the browser follows the anchor. No window.open, ever (G4).
 *
 * Used standalone (lead-wired view) or embedded in the board's inbox
 * panel. All user content dir="auto"; logical CSS only.
 */

import { useState } from 'react';
import { usePipelineStore, pipelineContactLogger } from '../../store/pipelineStore';
import type { Person, Suggestion } from '../../types/pipeline';
import {
  composeAndLog,
  suggestionToComposeArgs,
  suggestionToWaHref,
} from '../../lib/outreach';

/** Pending suggestions, newest first. */
export function pendingSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return suggestions
    .filter((s) => s.status === 'pending' && !s.deleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const ACCEPTED_DRAFTS_SHOWN = 5;

function acceptedDrafts(suggestions: Suggestion[]): Suggestion[] {
  return suggestions
    .filter((s) => s.status === 'accepted' && s.kind === 'draft_message' && !s.deleted)
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
    .slice(0, ACCEPTED_DRAFTS_SHOWN);
}

function personFor(persons: Person[], s: Suggestion): Person | undefined {
  return persons.find((p) => p.id === s.personId && !p.deleted);
}

function SuggestionItem({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  /** editedBody null = accepted as-is; string = accepted with this body. */
  onAccept: (id: string, editedBody: string | null) => void;
  onDismiss: (id: string) => void;
}) {
  const editable = suggestion.kind === 'draft_message';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(suggestion.body);

  return (
    <li
      data-testid="suggestion-item"
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-3 pe-3 py-2.5 flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-px text-[10px] font-mono text-slate-500 dark:text-slate-400">
          {suggestion.agent}
        </span>
        <h4 dir="auto" className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white text-start">
          {suggestion.title}
        </h4>
      </div>
      {editing ? (
        <textarea
          dir="auto"
          data-testid="draft-edit"
          aria-label="עריכת טיוטה"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2 py-1.5 text-xs text-start"
        />
      ) : (
        suggestion.body !== '' && (
          <p
            dir="auto"
            className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap text-start"
          >
            {suggestion.body}
          </p>
        )
      )}
      {suggestion.evidence.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {suggestion.evidence.map((e, i) => (
            <li
              key={i}
              dir="auto"
              className="text-[11px] text-slate-500 dark:text-slate-400 text-start"
            >
              • {e.claim}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => onAccept(suggestion.id, editing ? draft : null)}
          className="rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 text-xs font-medium"
        >
          אישור
        </button>
        <button
          type="button"
          onClick={() => onDismiss(suggestion.id)}
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
        >
          דחייה
        </button>
        {editable && (
          <button
            type="button"
            data-testid="draft-edit-toggle"
            aria-pressed={editing}
            onClick={() => {
              if (!editing) setDraft(suggestion.body);
              setEditing((v) => !v);
            }}
            className="ms-auto rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
          >
            {editing ? 'ביטול עריכה' : 'עריכה'}
          </button>
        )}
      </div>
    </li>
  );
}

export function SuggestionsQueue() {
  const suggestions = usePipelineStore((s) => s.suggestions);
  const persons = usePipelineStore((s) => s.persons);
  const acceptSuggestion = usePipelineStore((s) => s.acceptSuggestion);
  const dismissSuggestion = usePipelineStore((s) => s.dismissSuggestion);

  const pending = pendingSuggestions(suggestions);
  const accepted = acceptedDrafts(suggestions);

  return (
    <div className="flex flex-col gap-3" data-testid="suggestions-queue">
      <header className="flex items-baseline gap-2">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          <span dir="auto">הצעות ממתינות</span>
        </h3>
        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {pending.length}
        </span>
      </header>

      {pending.length === 0 ? (
        <p dir="auto" className="text-sm text-slate-400 dark:text-slate-500 text-start">
          אין הצעות ממתינות — הסוכנים לא הציעו דבר חדש.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((s) => (
            <SuggestionItem
              key={s.id}
              suggestion={s}
              onAccept={(id, editedBody) =>
                acceptSuggestion(id, { editedBody: editedBody ?? undefined })
              }
              onDismiss={dismissSuggestion}
            />
          ))}
        </ul>
      )}

      {accepted.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 dir="auto" className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start">
            טיוטות שאושרו — מוכנות לשליחה
          </h4>
          <ul className="flex flex-col gap-1.5">
            {accepted.map((s) => {
              const person = personFor(persons, s);
              const href = person ? suggestionToWaHref(s, person) : null;
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300 text-start">
                    {s.title}
                  </span>
                  {href && person ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="accepted-wa-link"
                      onClick={() => {
                        const args = suggestionToComposeArgs(s, person);
                        if (args) composeAndLog(args, pipelineContactLogger);
                      }}
                      className="shrink-0 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 text-[11px] font-medium"
                    >
                      <span dir="auto">שליחה בוואטסאפ</span>
                    </a>
                  ) : (
                    <span dir="auto" className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                      אין מספר טלפון
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export default SuggestionsQueue;
