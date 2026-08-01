/**
 * CardBack — per-deal activity trail + paste-a-thread — Wave 3 (kanban-ui).
 *
 * The "back" of a deal card, opened from the board. Two jobs:
 *
 * 1. TRAIL — the deal's full story, merged chronologically from the three
 *    truth sources (task contract): StageEvents (moves, skip-events,
 *    rejection reasons), the person's ContactEvents (outreach + reply
 *    states), and the append-only auditLog (suggestion lifecycle rows for
 *    suggestions targeting this deal/person, undo, other deal-entity
 *    entries). deal.move / deal.create / person.contact audit rows are
 *    EXCLUDED — StageEvents/ContactEvents already tell those truths once.
 *    Suggestion rows carry their evidence claims with source references
 *    (sourceType:sourceId chips) — agent attribution comes from the audit
 *    log / suggestion records only (no presence theater, cut list).
 *
 * 2. PASTE-A-THREAD — a textarea for a WhatsApp thread she copied by
 *    hand. Parsing is 100% client-side and PURE (`parseThreadToPlan`,
 *    integrations lib). The UI shows a parse report (parsed/skipped
 *    counts + derived latest state) and NOTHING touches the store until
 *    the explicit apply button walks the plan through the contract
 *    actions `logContact` / `setReplyState`. The raw paste itself is
 *    NEVER persisted or sent anywhere — only derived events (message
 *    HASHES, not texts) reach the store (G4 + privacy by construction).
 *    Paste-twice is idempotent: calls whose dedupe key already exists on
 *    the person are skipped, per the parser contract.
 *
 * BiDi: every user-content node dir="auto"; logical CSS only.
 */

import { useMemo, useState } from 'react';
import { usePipelineStore } from '../../store/pipelineStore';
import type {
  AuditEvent,
  ContactEvent,
  Deal,
  Person,
  StageEvent,
  Suggestion,
  SuggestionEvidence,
} from '../../types/pipeline';
import {
  DEFAULT_HER,
  parseThreadToPlan,
  type ParsedThread,
  type ThreadApplyPlan,
} from '../../lib/outreach';
import { stageLabel } from './stages';

// ------------------------------------------------------------
// Trail model (pure — exported for tests)
// ------------------------------------------------------------

export interface TrailEntry {
  /** Stable render key. */
  key: string;
  ts: string;
  kind: 'stage' | 'contact' | 'audit';
  /** Hebrew one-line description. */
  label: string;
  /** Actor chip: רויטל / סוכן / מערכת. */
  actor: 'human' | 'agent' | 'system';
  /** Agent name for attribution chips (audit log / suggestion source). */
  agent?: string;
  /** Secondary line (reason, skipped stages, edited body, …). */
  detail?: string;
  /** Evidence claims + source refs (suggestion rows). */
  evidence?: SuggestionEvidence[];
}

const CONTACT_LABEL: Record<ContactEvent['kind'], string> = {
  contacted: 'נשלחה פנייה',
  replied: 'התקבל מענה',
  no_reply: 'סומן: אין מענה',
  meeting_set: 'נקבעה שיחה',
};

const CHANNEL_LABEL: Record<NonNullable<ContactEvent['channel']>, string> = {
  whatsapp: 'וואטסאפ',
  email: 'אימייל',
};

const SUGGESTION_ACTION_LABEL: Record<string, string> = {
  'suggestion.create': 'הצעה חדשה',
  'suggestion.accepted': 'הצעה אושרה',
  'suggestion.dismissed': 'הצעה נדחתה',
  'suggestion.edit': 'הטיוטה נערכה לפני אישור',
};

/** Does this suggestion target the deal (directly or via its person)? */
function targetsDeal(s: Suggestion, deal: Deal): boolean {
  return s.dealId === deal.id || (!s.dealId && s.personId === deal.personId);
}

/**
 * Merge the three truth sources into one chronological trail
 * (newest first). Pure — the UI renders exactly this.
 */
export function buildDealTrail(args: {
  deal: Deal;
  person?: Person;
  stageEvents: StageEvent[];
  auditLog: AuditEvent[];
  suggestions: Suggestion[];
}): TrailEntry[] {
  const { deal, person, stageEvents, auditLog, suggestions } = args;
  const entries: TrailEntry[] = [];

  // 1) Stage history — moves + creation + skip-events.
  for (const e of stageEvents) {
    if (e.dealId !== deal.id || e.deleted) continue;
    const to = stageLabel(e.to).he;
    const label =
      e.from === null
        ? `הכרטיס נוצר בשלב ${to}`
        : `מעבר משלב ${stageLabel(e.from).he} לשלב ${to}`;
    const details: string[] = [];
    if (e.reason) details.push(`סיבה: ${e.reason}`);
    if (e.skippedStages.length > 0) {
      details.push(
        `דילוג על: ${e.skippedStages.map((s) => stageLabel(s).he).join(', ')}`,
      );
    }
    entries.push({
      key: `stage_${e.id}`,
      ts: e.ts,
      kind: 'stage',
      label,
      actor: e.actor,
      detail: details.length > 0 ? details.join(' · ') : undefined,
    });
  }

  // 2) Contact history — the person's outreach + reply states.
  if (person) {
    person.contactEvents.forEach((c, i) => {
      entries.push({
        key: `contact_${person.id}_${i}`,
        ts: c.ts,
        kind: 'contact',
        label: CONTACT_LABEL[c.kind],
        actor: 'human',
        detail: c.channel ? `ערוץ: ${CHANNEL_LABEL[c.channel]}` : undefined,
      });
    });
  }

  // 3) Audit rows — suggestion lifecycle for suggestions targeting this
  //    deal/person, plus deal-entity entries StageEvents don't cover.
  const sugById = new Map(suggestions.map((s) => [s.id, s]));
  for (const a of auditLog) {
    if (a.entityType === 'suggestion') {
      const sug = sugById.get(a.entityId);
      if (!sug || !targetsDeal(sug, deal)) continue;
      const action = SUGGESTION_ACTION_LABEL[a.action] ?? a.action;
      entries.push({
        key: `audit_${a.id}`,
        ts: a.ts,
        kind: 'audit',
        label: `${action}: ${sug.title}`,
        actor: a.actor === 'ai' ? 'agent' : 'human',
        agent: a.agent ?? sug.agent,
        evidence:
          a.action === 'suggestion.create' && sug.evidence.length > 0
            ? sug.evidence
            : undefined,
      });
    } else if (
      a.entityType === 'deal' &&
      a.entityId === deal.id &&
      a.action !== 'deal.move' &&
      a.action !== 'deal.create'
    ) {
      entries.push({
        key: `audit_${a.id}`,
        ts: a.ts,
        kind: 'audit',
        label: a.action === 'undo' ? 'בוצע ביטול (Undo)' : a.action,
        actor: a.actor === 'ai' ? 'agent' : 'human',
        agent: a.agent,
      });
    }
  }

  // Newest first; stable on ties by key so renders are deterministic.
  return entries.sort(
    (a, b) => b.ts.localeCompare(a.ts) || a.key.localeCompare(b.key),
  );
}

// ------------------------------------------------------------
// Thread apply (exported for tests)
// ------------------------------------------------------------

export interface ThreadApplyResult {
  appliedContacts: number;
  appliedReplies: number;
  skipped: number;
}

/**
 * Walk the parser's ApplyPlan through the store contract actions, in
 * order. Idempotency lives HERE (application time, parser stays pure):
 * a logContact whose `${ts}|${hash}` already exists on the person is
 * skipped; a 'replied' whose ts already exists is skipped.
 */
export function applyThreadPlan(
  plan: ThreadApplyPlan,
  person: Person,
  actions: {
    logContact: (
      personId: string,
      channel: 'whatsapp',
      messageHash: string,
      ts?: string,
    ) => void;
    setReplyState: (
      personId: string,
      state: 'replied',
      ts?: string,
    ) => void;
  },
): ThreadApplyResult {
  const existingContacts = new Set(
    person.contactEvents
      .filter((e) => e.kind === 'contacted' && e.messageHash)
      .map((e) => `${e.ts}|${e.messageHash}`),
  );
  const existingReplies = new Set(
    person.contactEvents.filter((e) => e.kind === 'replied').map((e) => e.ts),
  );

  const result: ThreadApplyResult = {
    appliedContacts: 0,
    appliedReplies: 0,
    skipped: 0,
  };
  for (const call of plan.calls) {
    if (call.action === 'logContact') {
      if (existingContacts.has(call.dedupeKey)) {
        result.skipped += 1;
        continue;
      }
      actions.logContact(call.personId, call.channel, call.messageHash, call.ts);
      existingContacts.add(call.dedupeKey);
      result.appliedContacts += 1;
    } else {
      if (existingReplies.has(call.ts)) {
        result.skipped += 1;
        continue;
      }
      actions.setReplyState(call.personId, call.state, call.ts);
      existingReplies.add(call.ts);
      result.appliedReplies += 1;
    }
  }
  return result;
}

const LATEST_LABEL: Record<ThreadApplyPlan['latest']['state'], string> = {
  replied: 'המועמד/ת הגיב/ה אחרון/ה',
  awaiting_reply: 'ממתינים לתשובת המועמד/ת',
  none: 'לא זוהו הודעות',
};

// ------------------------------------------------------------
// The component
// ------------------------------------------------------------

const ACTOR_LABEL: Record<TrailEntry['actor'], string> = {
  human: 'רויטל',
  agent: 'סוכן',
  system: 'מערכת',
};

function formatTs(ts: string): string {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return ts;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  // UTC on purpose: thread timestamps encode wall-clock-as-UTC (D-035);
  // mixing zones inside one trail would lie about ordering.
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

export interface CardBackProps {
  dealId: string;
  onClose: () => void;
}

export function CardBack({ dealId, onClose }: CardBackProps) {
  const deals = usePipelineStore((s) => s.deals);
  const persons = usePipelineStore((s) => s.persons);
  const stageEvents = usePipelineStore((s) => s.stageEvents);
  const auditLog = usePipelineStore((s) => s.auditLog);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const logContact = usePipelineStore((s) => s.logContact);
  const setReplyState = usePipelineStore((s) => s.setReplyState);

  const deal = deals.find((d) => d.id === dealId && !d.deleted);
  const person = deal
    ? persons.find((p) => p.id === deal.personId && !p.deleted)
    : undefined;

  const trail = useMemo(
    () =>
      deal
        ? buildDealTrail({ deal, person, stageEvents, auditLog, suggestions })
        : [],
    [deal, person, stageEvents, auditLog, suggestions],
  );

  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<{
    thread: ParsedThread;
    plan: ThreadApplyPlan;
  } | null>(null);
  const [applied, setApplied] = useState<ThreadApplyResult | null>(null);

  if (!deal) return null;

  const onParse = () => {
    setApplied(null);
    if (!person || raw.trim() === '') {
      setParsed(null);
      return;
    }
    // Pure parse — nothing leaves this component, nothing hits the store.
    setParsed(parseThreadToPlan(raw, DEFAULT_HER, person.id));
  };

  const onApply = () => {
    if (!parsed || !person) return;
    // Dedupe against the CURRENT person record at apply time.
    const current =
      usePipelineStore
        .getState()
        .persons.find((p) => p.id === person.id && !p.deleted) ?? person;
    setApplied(applyThreadPlan(parsed.plan, current, { logContact, setReplyState }));
  };

  const stage = stageLabel(deal.stage);

  return (
    <div
      data-testid="card-back"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="היסטוריית כרטיס"
        className="relative z-10 w-[30rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl ps-4 pe-4 py-3 flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
      >
        {/* Header */}
        <header className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
              <span dir="auto">{person?.name ?? '—'}</span>{' '}
              <span dir="auto" className="font-normal text-slate-500 dark:text-slate-400">
                {deal.jobTitle}
              </span>
            </h3>
            <p dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
              שלב נוכחי: {stage.he} · {stage.en}
            </p>
          </div>
          <button
            type="button"
            data-testid="card-back-close"
            onClick={onClose}
            className="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 py-0.5 text-xs"
          >
            <span dir="auto">סגירה</span>
          </button>
        </header>

        {/* Paste-a-thread */}
        <section className="flex flex-col gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 ps-3 pe-3 py-2.5">
          <h4 dir="auto" className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start">
            הדבקת שיחת וואטסאפ
          </h4>
          <p dir="auto" className="text-[11px] text-slate-500 dark:text-slate-400 text-start">
            הדביקי כאן שיחה שהעתקת מוואטסאפ — הניתוח נעשה כולו במכשיר שלך,
            הטקסט עצמו לא נשמר ולא נשלח לשום מקום. רק אירועי פנייה/מענה
            נגזרים ממנו לאחר אישור מפורש.
          </p>
          <textarea
            dir="auto"
            data-testid="thread-paste"
            aria-label="הדבקת שיחת וואטסאפ"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            placeholder="[31.7.2026, 21:45] רויטל קרן: היי..."
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2 py-1.5 text-xs text-start font-mono"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="thread-parse-button"
              disabled={!person || raw.trim() === ''}
              onClick={onParse}
              className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-xs font-medium"
            >
              <span dir="auto">ניתוח ההדבקה</span>
            </button>
            {parsed && parsed.plan.calls.length > 0 && !applied && (
              <button
                type="button"
                data-testid="thread-apply-button"
                onClick={onApply}
                className="rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 text-xs font-medium"
              >
                <span dir="auto">החלת ההיסטוריה על הכרטיס</span>
              </button>
            )}
          </div>

          {parsed && (
            <div
              data-testid="thread-report"
              className="flex flex-col gap-0.5 text-[11px] text-slate-600 dark:text-slate-300"
            >
              <p dir="auto" className="text-start">
                זוהו {parsed.thread.messages.length} הודעות (
                {parsed.plan.counts.her} שלך · {parsed.plan.counts.candidate} של
                המועמד/ת) · דולגו {parsed.thread.skipped.length} שורות
              </p>
              <p dir="auto" className="text-start">
                מצב נוכחי: {LATEST_LABEL[parsed.plan.latest.state]}
                {parsed.plan.latest.ts ? ` (${formatTs(parsed.plan.latest.ts)})` : ''}
              </p>
              {!parsed.thread.herMatched && parsed.thread.messages.length > 0 && (
                <p
                  dir="auto"
                  data-testid="thread-her-warning"
                  className="text-amber-700 dark:text-amber-400 text-start"
                >
                  אף הודעה לא זוהתה כשלך — בדקי ששם התצוגה בייצוא הוא
                  &quot;{DEFAULT_HER.name}&quot;
                </p>
              )}
              {applied && (
                <p
                  dir="auto"
                  data-testid="thread-apply-result"
                  className="rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 px-2 py-1 text-start"
                >
                  הוחל: {applied.appliedContacts} פניות · {applied.appliedReplies}{' '}
                  מענים · {applied.skipped} דולגו (כבר קיימים)
                </p>
              )}
            </div>
          )}
        </section>

        {/* Trail */}
        <section className="flex flex-col gap-1.5">
          <h4 dir="auto" className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start">
            מסלול הכרטיס
          </h4>
          {trail.length === 0 ? (
            <p dir="auto" className="text-xs text-slate-400 dark:text-slate-500 text-start">
              אין עדיין פעילות על הכרטיס.
            </p>
          ) : (
            <ol data-testid="card-trail" className="flex flex-col gap-1">
              {trail.map((entry) => (
                <li
                  key={entry.key}
                  data-testid="trail-entry"
                  data-kind={entry.kind}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 ps-2.5 pe-2.5 py-1.5 flex flex-col gap-0.5"
                >
                  <div className="flex items-center gap-2">
                    <p dir="auto" className="min-w-0 flex-1 text-xs font-medium text-slate-800 dark:text-slate-100 text-start">
                      {entry.label}
                    </p>
                    <span
                      dir="auto"
                      className={`shrink-0 rounded px-1.5 py-px text-[10px] ${
                        entry.actor === 'agent'
                          ? 'bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {entry.agent ?? ACTOR_LABEL[entry.actor]}
                    </span>
                  </div>
                  <p dir="ltr" className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 text-start">
                    {formatTs(entry.ts)}
                  </p>
                  {entry.detail && (
                    <p dir="auto" className="text-[11px] text-slate-500 dark:text-slate-400 text-start">
                      {entry.detail}
                    </p>
                  )}
                  {entry.evidence && entry.evidence.length > 0 && (
                    <ul className="flex flex-col gap-0.5 pt-0.5">
                      {entry.evidence.map((ev, i) => (
                        <li
                          key={i}
                          data-testid="trail-evidence"
                          className="flex items-baseline gap-1.5"
                        >
                          <span dir="auto" className="min-w-0 flex-1 text-[11px] text-slate-500 dark:text-slate-400 text-start">
                            • {ev.claim}
                          </span>
                          <span
                            dir="ltr"
                            title={`מקור: ${ev.sourceType} ${ev.sourceId}`}
                            className="shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1 py-px text-[9px] font-mono text-slate-400 dark:text-slate-500"
                          >
                            {ev.sourceType}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

export default CardBack;
