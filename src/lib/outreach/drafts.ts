/**
 * Hebrew next-step draft builders — pure functions, no LLM call (Wave 1).
 *
 * Every builder returns `{ text, suggestionInput }`: the WhatsApp-ready
 * Hebrew message plus a ready-to-file input for the store's
 * `addSuggestion` (the ONLY way agent output reaches the UI — plan §3
 * single-writer). Nothing here navigates, sends, or touches the store.
 *
 * Grounding rule (charter): placeholders are filled from fields that
 * actually exist on the Person / Deal / CandidateAnalysis passed in —
 * no invented facts. The one deliberate constant is the signature
 * "רויטל" / "רויטל קרן": the product has exactly one daily user
 * (Revital Keren, independent recruiter) per the mission contract.
 *
 * BiDi safety: every interpolated field AND the final text pass through
 * `sanitizeMessageText`, so direction-override/embed/isolate controls
 * can never be injected via a candidate name or job title. No direction
 * marks are ever ADDED either — mixed Hebrew/English renders with
 * `dir="auto"` at the UI layer, not with control characters in the text.
 */

import type { Person, Deal, Suggestion, SuggestionEvidence } from '../../types/pipeline';
import type { CandidateAnalysis } from '../../types';
import { sanitizeMessageText } from './waMe';
import { t, daysAgoHe, daysCountHe } from '../../i18n/he';

// ------------------------------------------------------------
// SuggestionInput — local structural definition
// ------------------------------------------------------------

/**
 * Input shape for the store contract's `addSuggestion(input)`
 * (docs/waves/wave1-store-contract.md). platform-data implements the
 * store concurrently, so the canonical `SuggestionInput` export does not
 * exist yet; this Omit-derivation from the canonical `Suggestion` keeps
 * the shape structurally assignable: the semantic core minus everything
 * the store itself assigns (id/version envelope, status, timestamps).
 * TODO(lead): once platform-data exports SuggestionInput from
 * types/pipeline.ts, re-point this alias at the canonical type.
 */
export type SuggestionInput = Omit<
  Suggestion,
  'id' | 'v' | 'updatedAt' | 'deleted' | 'deletedAt' | 'status' | 'createdAt' | 'resolvedAt'
>;

// ------------------------------------------------------------
// Draft result shape
// ------------------------------------------------------------

export interface OutreachDraft {
  /** WhatsApp-ready Hebrew message text (BiDi-sanitized). */
  text: string;
  /** Ready for `usePipelineStore.addSuggestion` — body === text. */
  suggestionInput: SuggestionInput;
}

// ------------------------------------------------------------
// Internals
// ------------------------------------------------------------

/** Sanitize + trim a user-content field before interpolation. */
function clean(field: string): string {
  return sanitizeMessageText(field).trim();
}

/** First name only — a WhatsApp opener addressing a full name reads like a bot. */
function firstName(fullName: string): string {
  const cleaned = clean(fullName);
  const first = cleaned.split(/\s+/)[0] ?? '';
  return first !== '' ? first : cleaned;
}

/**
 * Natural-Hebrew time reference for "N days ago".
 * Implementation moved to the shared lexicon (src/i18n/he.ts, Wave 3);
 * re-exported here to keep the Wave-1 import surface stable.
 */
export const daysAgoHebrew = daysAgoHe;

// ------------------------------------------------------------
// openerDraft — first outreach message
// ------------------------------------------------------------

/**
 * First-touch WhatsApp draft for a deal's candidate.
 *
 * With an analysis present, the message may truthfully say her review of
 * the profile happened (the analysis IS that review) — it never mentions
 * the match score or that the candidate was "analyzed". Without one, the
 * message makes no claim of having reviewed anything.
 */
export function openerDraft(
  person: Person,
  deal: Deal,
  analysis?: CandidateAnalysis
): OutreachDraft {
  const first = firstName(person.name);
  const jobTitle = clean(deal.jobTitle);

  const middle =
    analysis !== undefined
      ? t('draft.opener.reviewed', { jobTitle })
      : t('draft.opener.cold', { jobTitle });

  const text = sanitizeMessageText(
    [
      t('draft.opener.greeting', { firstName: first }),
      `${t('draft.opener.intro')} ${middle}`,
      t('draft.opener.cta'),
    ].join('\n')
  );

  const evidence: SuggestionEvidence[] = [
    {
      claim: t('evidence.activeDeal', { jobTitle, stage: deal.stage }),
      sourceType: 'deal',
      sourceId: deal.id,
    },
  ];
  if (analysis !== undefined) {
    evidence.push({
      claim: t('evidence.analysisScore', {
        score: analysis.matchScore,
        verdict: analysis.verdict,
      }),
      sourceType: 'analysis',
      sourceId: analysis.id,
    });
  }

  return {
    text,
    suggestionInput: {
      agent: 'outreach_runner',
      kind: 'draft_message',
      dealId: deal.id,
      personId: person.id,
      title: sanitizeMessageText(t('draft.opener.title', { name: clean(person.name), jobTitle })),
      body: text,
      evidence,
    },
  };
}

// ------------------------------------------------------------
// followUpDraft — no-reply follow-up
// ------------------------------------------------------------

/**
 * Follow-up draft after `daysSilent` days without a reply.
 *
 * Callers must only invoke this after a real opener was sent (the text
 * references a previous message — an outreach_runner precondition, and
 * the evidence cites the person's contact history). `daysSilent <= 0`
 * or non-finite drops the time reference rather than inventing one.
 */
export function followUpDraft(person: Person, deal: Deal, daysSilent: number): OutreachDraft {
  const first = firstName(person.name);
  const jobTitle = clean(deal.jobTitle);
  const timeRef = daysAgoHebrew(daysSilent);

  const sentLine =
    timeRef !== null
      ? t('draft.followUp.sent', { timeRef, jobTitle })
      : t('draft.followUp.sentNoTime', { jobTitle });

  const text = sanitizeMessageText(
    [
      t('draft.followUp.greeting', { firstName: first }),
      sentLine,
      t('draft.followUp.cta'),
    ].join('\n')
  );

  const days = Math.max(0, Math.floor(Number.isFinite(daysSilent) ? daysSilent : 0));
  const evidence: SuggestionEvidence[] = [
    {
      claim:
        days > 0
          ? t('evidence.daysNoReply', { daysPhrase: daysCountHe(days) })
          : t('evidence.noReplyYet'),
      sourceType: 'person',
      sourceId: person.id,
    },
    {
      claim: t('evidence.activeDeal', { jobTitle, stage: deal.stage }),
      sourceType: 'deal',
      sourceId: deal.id,
    },
  ];

  const name = clean(person.name);
  return {
    text,
    suggestionInput: {
      agent: 'outreach_runner',
      kind: 'draft_message',
      dealId: deal.id,
      personId: person.id,
      title: sanitizeMessageText(
        days > 0
          ? t('draft.followUp.titleSilent', { name, jobTitle, daysPhrase: daysCountHe(days) })
          : t('draft.followUp.title', { name, jobTitle })
      ),
      body: text,
      evidence,
    },
  };
}
