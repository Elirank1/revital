/**
 * @deprecated Wave-3 absorption (D-036): the store's
 * `acceptSuggestion(id, opts?: { editedBody?: string })` now owns the
 * edit-before-accept semantics this module used to pre-patch (body
 * replacement, `editedBeforeAccept` stamping, the human 'suggestion.edit'
 * audit entry BEFORE the accept entry). The Wave-2 pre-patch helper has
 * been DELETED; this file remains only as a thin alias so existing test
 * imports keep resolving. New code calls the store action directly.
 */

import { usePipelineStore } from '../../store/pipelineStore';

/** @deprecated Import from '../../store/pipelineStore' instead. */
export type { SuggestionWithEditMarker } from '../../store/pipelineStore';

/**
 * @deprecated Call `usePipelineStore.getState().acceptSuggestion(id,
 * { editedBody })` directly. Alias semantics are byte-identical to the
 * retired pre-patch: `editedBody === null` ⇒ accepted as-is (marker
 * false); a body different from the current one replaces it and stamps
 * true; missing/resolved/tombstoned ids return false with zero mutation.
 */
export function acceptSuggestionWithEdit(
  id: string,
  editedBody: string | null = null,
): boolean {
  return usePipelineStore
    .getState()
    .acceptSuggestion(id, { editedBody: editedBody ?? undefined });
}
