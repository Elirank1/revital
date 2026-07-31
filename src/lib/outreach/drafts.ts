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
 * Hebrew numeral grammar: יומיים for 2, X ימים for 3–10, X יום for 11+.
 */
function daysAgoHebrew(days: number): string | null {
  const n = Math.floor(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 1) return 'אתמול';
  if (n === 2) return 'לפני יומיים';
  if (n <= 10) return `לפני ${n} ימים`;
  return `לפני ${n} יום`;
}

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
      ? `עברתי על הפרופיל שלך והניסיון נראה רלוונטי מאוד לתפקיד ${jobTitle} שאני מגייסת אליו.`
      : `אני מגייסת כרגע לתפקיד ${jobTitle} וחשבתי שזה עשוי לעניין אותך.`;

  const text = sanitizeMessageText(
    [
      `היי ${first},`,
      `זו רויטל קרן, מגייסת עצמאית. ${middle}`,
      `יש לך כמה דקות השבוע לשיחה קצרה? מבטיחה להיות עניינית.`,
    ].join('\n')
  );

  const evidence: SuggestionEvidence[] = [
    {
      claim: `מועמדות פעילה לתפקיד ${jobTitle} (שלב: ${deal.stage})`,
      sourceType: 'deal',
      sourceId: deal.id,
    },
  ];
  if (analysis !== undefined) {
    evidence.push({
      claim: `ניתוח התאמה קיים — ציון ${analysis.matchScore} (${analysis.verdict})`,
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
      title: sanitizeMessageText(`טיוטת פנייה ראשונה: ${clean(person.name)} — ${jobTitle}`),
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
      ? `שלחתי לך הודעה ${timeRef} לגבי תפקיד ${jobTitle} — רציתי לוודא שלא התפספסה.`
      : `שלחתי לך הודעה לגבי תפקיד ${jobTitle} — רציתי לוודא שלא התפספסה.`;

  const text = sanitizeMessageText(
    [
      `היי ${first}, זו שוב רויטל 🙂`,
      sentLine,
      `אם זה רלוונטי, אשמח לכמה דקות לשיחה. ואם התזמון לא מתאים — לגמרי בסדר, אשמח לדעת ולא אציק.`,
    ].join('\n')
  );

  const days = Math.max(0, Math.floor(Number.isFinite(daysSilent) ? daysSilent : 0));
  const evidence: SuggestionEvidence[] = [
    {
      claim:
        days > 0
          ? `${days} ימים ללא מענה מאז הפנייה האחרונה`
          : 'טרם התקבל מענה לפנייה האחרונה',
      sourceType: 'person',
      sourceId: person.id,
    },
    {
      claim: `מועמדות פעילה לתפקיד ${jobTitle} (שלב: ${deal.stage})`,
      sourceType: 'deal',
      sourceId: deal.id,
    },
  ];

  return {
    text,
    suggestionInput: {
      agent: 'outreach_runner',
      kind: 'draft_message',
      dealId: deal.id,
      personId: person.id,
      title: sanitizeMessageText(
        days > 0
          ? `טיוטת פולו-אפ: ${clean(person.name)} — ${jobTitle} (${days} ימים ללא מענה)`
          : `טיוטת פולו-אפ: ${clean(person.name)} — ${jobTitle}`
      ),
      body: text,
      evidence,
    },
  };
}
