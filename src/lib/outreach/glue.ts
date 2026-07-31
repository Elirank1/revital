/**
 * Glue between drafts, the Suggestion queue, and the wa.me composer —
 * so kanban-ui renders ACCEPTED drafts as plain `<a href>` wa.me links.
 *
 * G4 rail: everything here returns strings/objects. Navigation happens
 * only when a human clicks the rendered anchor; the click handler then
 * calls `composeAndLog` with the SAME message text, so the logged
 * `messageHash` always equals `suggestionMessageHash(suggestion)`.
 */

import type { Person, Suggestion } from '../../types/pipeline';
import type { OutreachDraft, SuggestionInput } from './drafts';
import { composeWaMeUrl } from './waMe';
import { hashMessage, type ComposeWhatsAppArgs } from './contactLog';

/**
 * Extract the store-ready `SuggestionInput` from a draft.
 *
 * Returns a defensive copy (fresh object + evidence array) so the store
 * never shares mutable references with the draft that produced it, and
 * pins `body === text` — the invariant that keeps the hash logged on
 * click identical to the hash of the accepted suggestion body.
 */
export function draftToSuggestion(draft: OutreachDraft): SuggestionInput {
  const { suggestionInput } = draft;
  return {
    ...suggestionInput,
    body: draft.text,
    evidence: suggestionInput.evidence.map((e) => ({ ...e })),
  };
}

/**
 * Stable hash of the message a suggestion would send — the same value
 * `composeAndLog` will log when the human clicks the link.
 */
export function suggestionMessageHash(suggestion: Pick<Suggestion, 'body'>): string {
  return hashMessage(suggestion.body);
}

/**
 * wa.me href for an accepted draft-message suggestion, for rendering as
 * `<a href>` (NEVER window.open). Returns `null` when there is nothing
 * sendable: wrong suggestion kind, empty body, missing/unusable phone.
 */
export function suggestionToWaHref(
  suggestion: Pick<Suggestion, 'kind' | 'body'>,
  person: Pick<Person, 'phone'>
): string | null {
  if (suggestion.kind !== 'draft_message') return null;
  if (suggestion.body === '') return null;
  if (person.phone === undefined || person.phone === '') return null;
  return composeWaMeUrl(person.phone, suggestion.body);
}

/**
 * Ready-made args for `composeAndLog` from an accepted suggestion — the
 * one-tap click handler builds these instead of hand-assembling, which
 * guarantees the logged hash matches the suggestion body. Returns `null`
 * under the same conditions as `suggestionToWaHref`.
 */
export function suggestionToComposeArgs(
  suggestion: Pick<Suggestion, 'kind' | 'body' | 'personId'>,
  person: Pick<Person, 'id' | 'phone'>
): ComposeWhatsAppArgs | null {
  if (suggestionToWaHref(suggestion, person) === null) return null;
  return {
    channel: 'whatsapp',
    personId: suggestion.personId ?? person.id,
    phone: person.phone as string,
    message: suggestion.body,
  };
}
