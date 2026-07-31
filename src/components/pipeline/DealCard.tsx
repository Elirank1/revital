/**
 * DealCard — card front for the V3 board — Wave 1 (kanban-ui).
 *
 * Renders: candidate name + role (worst case Hebrew name + English title on
 * one line, both `dir="auto"`), match score/verdict chip (from the legacy
 * analysis, when linked), days-in-stage aging ring (CSS, amber ≥5d / red
 * ≥10d), next-action line, pending-suggestion badge, a one-tap wa.me
 * button, and the three reply chips השיב/ה · אין מענה · נקבעה שיחה.
 *
 * G4 rail: the WhatsApp action is a plain `<a href>` composed by
 * `src/lib/outreach` — NEVER window.open / location / navigate. The click
 * handler only LOGS (composeAndLog with the injected ContactLogger);
 * navigation is the browser following the human-clicked anchor.
 *
 * Prop-driven by design (store actions arrive as callbacks, the logger is
 * injectable) so DOM tests run without dnd-kit or store scaffolding.
 * BiDi: every user-content node carries dir="auto"; logical CSS only.
 */

import { useMemo } from 'react';
import type { Deal, Person, Suggestion } from '../../types/pipeline';
import type { CandidateAnalysis } from '../../types';
import {
  composeAndLog,
  composeWaMeUrl,
  suggestionToComposeArgs,
  type ComposeWhatsAppArgs,
  type ContactLogger,
} from '../../lib/outreach';
import { daysInStage } from './aging';
import { AgingRing } from './AgingRing';

export type ReplyChipState = 'replied' | 'no_reply' | 'meeting_set';

/** The three reply chips (charter labels, exact). */
export const REPLY_CHIPS: readonly { state: ReplyChipState; label: string }[] = [
  { state: 'replied', label: 'השיב/ה' },
  { state: 'no_reply', label: 'אין מענה' },
  { state: 'meeting_set', label: 'נקבעה שיחה' },
] as const;

const VERDICT_CHIP_CLASS: Record<CandidateAnalysis['verdict'], string> = {
  'Strong Fit':
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  Potential: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  Reject: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
};

export interface DealCardProps {
  deal: Deal;
  /** The candidate; undefined only for orphaned data. */
  person?: Person;
  /** Legacy analysis linked via deal.analysisId (read-only). */
  analysis?: Pick<CandidateAnalysis, 'matchScore' | 'verdict'>;
  /** Pending suggestions targeting this deal/person. */
  pendingSuggestionCount: number;
  /** Latest ACCEPTED draft_message for this deal — becomes the wa.me text. */
  acceptedDraft?: Pick<Suggestion, 'kind' | 'body' | 'personId'>;
  /** Store's setReplyState, passed down by the board. */
  onSetReplyState: (personId: string, state: ReplyChipState) => void;
  /** Contact logger for composeAndLog (store adapter in prod, stub in tests). */
  contactLogger: ContactLogger;
  /** Injectable clock for deterministic aging in tests. */
  now?: () => number;
}

/** Latest reply-state event on the person, for chip highlighting. */
function currentReplyState(person?: Person): ReplyChipState | null {
  if (!person) return null;
  for (let i = person.contactEvents.length - 1; i >= 0; i--) {
    const kind = person.contactEvents[i].kind;
    if (kind === 'replied' || kind === 'no_reply' || kind === 'meeting_set') {
      return kind;
    }
  }
  return null;
}

export function DealCard({
  deal,
  person,
  analysis,
  pendingSuggestionCount,
  acceptedDraft,
  onSetReplyState,
  contactLogger,
  now = Date.now,
}: DealCardProps) {
  const days = daysInStage(deal.stageEnteredAt, now());
  const replyState = currentReplyState(person);

  // One-tap WhatsApp: an accepted draft supplies the message text (hash on
  // click === hash of the accepted suggestion body, via the glue); with no
  // draft the chat opens empty. Unusable/missing phone ⇒ no anchor at all.
  const composeArgs = useMemo<ComposeWhatsAppArgs | null>(() => {
    if (!person?.phone) return null;
    if (acceptedDraft) {
      const fromDraft = suggestionToComposeArgs(acceptedDraft, {
        id: person.id,
        phone: person.phone,
      });
      if (fromDraft) return fromDraft;
    }
    return {
      channel: 'whatsapp',
      personId: person.id,
      phone: person.phone,
      message: '',
    };
  }, [person, acceptedDraft]);

  const waHref = composeArgs
    ? composeWaMeUrl(composeArgs.phone, composeArgs.message)
    : null;

  return (
    <article
      data-testid="deal-card"
      data-deal-id={deal.id}
      className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm ps-3 pe-3 py-2.5 flex flex-col gap-2"
    >
      {/* Top row: aging ring + name/role + suggestion badge */}
      <div className="flex items-center gap-2.5">
        <AgingRing days={days} />
        <div className="min-w-0 flex-1">
          {/* Worst case on ONE line: Hebrew name + English title */}
          <p className="truncate text-sm leading-snug">
            <span dir="auto" className="font-semibold text-slate-900 dark:text-white">
              {person?.name ?? '—'}
            </span>{' '}
            <span dir="auto" className="text-slate-500 dark:text-slate-400">
              {deal.jobTitle}
            </span>
          </p>
          {analysis && (
            <span
              dir="auto"
              data-testid="score-chip"
              className={`inline-block mt-0.5 rounded-full px-1.5 py-px text-[10px] font-medium ${VERDICT_CHIP_CLASS[analysis.verdict] ?? VERDICT_CHIP_CLASS.Potential}`}
            >
              {analysis.matchScore} · {analysis.verdict}
            </span>
          )}
        </div>
        {pendingSuggestionCount > 0 && (
          <span
            data-testid="suggestion-badge"
            title="הצעות ממתינות לאישור"
            className="shrink-0 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300 px-1.5 py-px text-[10px] font-semibold tabular-nums"
          >
            {pendingSuggestionCount}
          </span>
        )}
      </div>

      {/* Next-action line */}
      <p dir="auto" className="text-xs text-slate-600 dark:text-slate-300 text-start truncate">
        {deal.nextAction ? (
          <>
            <span className="font-medium">הבא:</span> {deal.nextAction.label}{' '}
            <span className="text-slate-400 dark:text-slate-500">
              ({deal.nextAction.owner === 'revital' ? 'רויטל' : 'סוכן'})
            </span>
          </>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">אין פעולה מוגדרת</span>
        )}
      </p>

      {/* Actions: wa.me anchor + reply chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {waHref && composeArgs && (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="wa-link"
            onClick={() => {
              // Log-only side effect; navigation is the anchor itself (G4).
              composeAndLog(composeArgs, contactLogger, now);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-xs font-medium"
          >
            <span dir="auto">וואטסאפ</span>
          </a>
        )}
        {person &&
          REPLY_CHIPS.map(({ state, label }) => {
            const active = replyState === state;
            return (
              <button
                key={state}
                type="button"
                aria-pressed={active}
                onClick={() => onSetReplyState(person.id, state)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300 font-semibold'
                    : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span dir="auto">{label}</span>
              </button>
            );
          })}
      </div>
    </article>
  );
}

export default DealCard;
