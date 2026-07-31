/**
 * Accept-with-edit instrumentation — Wave 2 (kanban-ui).
 *
 * The metrics lib's `suggestionEditRate` (platform-data D-029) reads an
 * `editedBeforeAccept: boolean` marker riding the persisted Suggestion
 * JSON ahead of the lead-owned type (the D-018 pattern). kanban-ui owns
 * stamping it at accept time.
 *
 * The store's `acceptSuggestion(id)` takes no options (checked — Wave 2A
 * store surface), so this helper pre-patches the PENDING suggestion in
 * store state (new objects, no in-place mutation) and immediately routes
 * through `acceptSuggestion`, whose `{ ...sug }` spread carries the
 * marker (and any edited body) into the accepted, persisted, dirty-marked
 * record. Persistence/audit/undo of the ACCEPT itself stay 100% store-owned.
 * An actual edit additionally writes a human 'suggestion.edit' audit entry
 * (append-only log) with the before/after bodies.
 *
 * EVERY UI accept goes through here — unedited accepts stamp `false`
 * (a correct denominator: "not edited" is data, absence is "not measured").
 *
 * FIX(platform-data) filed in BOARD-STATUS: absorb this into
 * `acceptSuggestion(id, opts?)` and delete this helper.
 */

import { usePipelineStore } from '../../store/pipelineStore';
import type { Suggestion } from '../../types/pipeline';

/** Suggestion + the metrics marker riding ahead of the lead-owned type. */
export type SuggestionWithEditMarker = Suggestion & {
  editedBeforeAccept?: boolean;
};

/**
 * Accept a pending suggestion, stamping `editedBeforeAccept`.
 * `editedBody === null` ⇒ accepted as-is (marker false).
 * A non-null body different from the current one replaces the body
 * (the wa.me glue then hashes/renders the EDITED text) and stamps true.
 * Returns false (no mutation at all) when the suggestion is missing,
 * resolved, or tombstoned.
 */
export function acceptSuggestionWithEdit(
  id: string,
  editedBody: string | null = null,
): boolean {
  const store = usePipelineStore.getState();
  const sug = store.suggestions.find((x) => x.id === id);
  if (!sug || sug.status !== 'pending' || sug.deleted) return false;

  const edited = editedBody !== null && editedBody !== sug.body;
  const patched: SuggestionWithEditMarker = {
    ...sug,
    ...(edited ? { body: editedBody } : {}),
    editedBeforeAccept: edited,
    updatedAt: new Date().toISOString(),
  };
  usePipelineStore.setState((s) => ({
    suggestions: s.suggestions.map((x) => (x.id === id ? patched : x)),
  }));

  if (edited) {
    store.appendAudit({
      actor: 'human',
      action: 'suggestion.edit',
      before: { body: sug.body },
      after: { body: editedBody, editedBeforeAccept: true },
      entityType: 'suggestion',
      entityId: id,
    });
  }

  // The store action persists, dirty-marks, audits and pushes undo —
  // its spread of the patched record carries body + marker along.
  usePipelineStore.getState().acceptSuggestion(id);
  return true;
}
