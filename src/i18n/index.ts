/**
 * i18n barrel — the import surface for the shared Hebrew lexicon.
 *
 * Scope (Wave 3, deliberate): Hebrew OUTPUTS only. The product ships
 * Hebrew agent output + BiDi-safe rendering; full UI i18n is on the cut
 * list, so `chrome.*` keys are catalogued in `he.ts` without any view
 * rewiring. There is no locale switch and no second language — `t` is a
 * typed lookup into the single Hebrew lexicon, not a framework.
 */

export { he, t, daysAgoHe, durationHe, daysCountHe, candidatesHe, toCandidatesHe } from './he';
export type { HeKey, TParams } from './he';
