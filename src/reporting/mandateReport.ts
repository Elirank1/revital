/**
 * Client Reporter — deterministic Hebrew mandate status report (Wave 2).
 *
 * `buildMandateReport(mandate, deals, events, contacts, opts)` renders a
 * client-facing Hebrew status update as RTL HTML + plain text. This is
 * the repeat-mandate machine: it must read like a serious recruiting
 * status update written by a human, not a template dump.
 *
 * Evidence discipline (wave2-contract, BINDING): EVERY claim carries at
 * least one evidence ref (deal/event/person/job/analysis id). The report
 * body is assembled EXCLUSIVELY from `ReportLine`s; a line is either a
 * `frame` (static connective tissue — greeting, section headers,
 * sign-off) or a `claim` (anything derived from records) whose `refs`
 * tuple type makes an empty ref list unrepresentable. Tests prove
 * coverage by reconstructing the text from the lines and whitelisting
 * the frames.
 *
 * No LLM in this module — the deterministic core is the source of truth.
 * Optional polish lives in ./polish (default OFF).
 *
 * BiDi safety: every interpolated field passes `sanitizeMessageText`
 * (strips direction-override/embed/isolate controls); no direction
 * marks are ever ADDED. HTML gets `dir` attributes + logical CSS
 * (text-align:start, padding-inline-start) instead of control chars,
 * and all dynamic content is HTML-escaped.
 */

import type { CandidateAnalysis, JobDescription } from '../types';
import type {
  Deal,
  Person,
  PipelineStage,
  StageEvent,
  SuggestionEvidence,
} from '../types/pipeline';
import { PIPELINE_STAGES } from '../types/pipeline';
import { sanitizeMessageText } from '../lib/outreach';
import type { SuggestionInput } from '../lib/outreach';
import { t, daysAgoHe, durationHe, candidatesHe, toCandidatesHe } from '../i18n';

// ------------------------------------------------------------
// Public shapes
// ------------------------------------------------------------

/** A single record backing a claim. */
export interface EvidenceRef {
  /** 'deal' | 'event' | 'person' | 'job' | 'analysis' */
  sourceType: string;
  sourceId: string;
}

export type ReportSection =
  | 'header'
  | 'opening'
  | 'funnel'
  | 'submitted'
  | 'feedback'
  | 'next'
  | 'closing';

/**
 * One line of report body. `frame` lines are static connective text;
 * `claim` lines carry data and MUST cite at least one record — the
 * non-empty tuple type makes a ref-less claim a compile error.
 */
export type ReportLine =
  | { kind: 'frame'; section: ReportSection; text: string; indent?: true }
  | {
      kind: 'claim';
      section: ReportSection;
      text: string;
      refs: [EvidenceRef, ...EvidenceRef[]];
      indent?: true;
    };

export interface MandateReportOptions {
  /** Clock injection — defaults to `new Date()`; tests pass a fixed date. */
  now?: Date;
  /** Client display name for the greeting (opts-supplied, not a record claim). */
  clientName?: string;
  /**
   * Days at Submitted/ClientInterview without movement before a
   * feedback-pending nudge appears. Default 6 (Pit Boss threshold).
   */
  feedbackPendingDays?: number;
  /** Legacy analyses — source for short candidate summaries (deal.analysisId). */
  analyses?: CandidateAnalysis[];
}

export interface MandateReport {
  /** Suggestion/report title (Hebrew). */
  title: string;
  /** Hebrew RTL HTML (email-pasteable fragment, inline styles). */
  html: string;
  /** Plain-text version (WhatsApp-pasteable). */
  text: string;
  /** The structured body — tests prove text ⊆ lines and claim coverage. */
  lines: ReportLine[];
  /** Flattened claim×ref evidence — one entry per (claim line, ref). */
  evidence: SuggestionEvidence[];
  /** Ready for the store's addSuggestion (agent client_reporter, kind report). */
  suggestionInput: SuggestionInput;
}

// ------------------------------------------------------------
// Hebrew / formatting helpers
// ------------------------------------------------------------

/** Sanitize + trim a user-content field before interpolation. */
function clean(field: string): string {
  return sanitizeMessageText(field).trim();
}

/** Deterministic D.M.YYYY (UTC parts — timezone-stable in tests). */
function formatDateHe(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

/** Whole days elapsed since `iso` (clamped at 0); null on bad input. */
function daysSince(now: Date, iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

// durationHe / candidatesHe / toCandidatesHe moved to the shared lexicon
// (src/i18n/he.ts, Wave 3) — imported above; behavior unchanged.

/** HTML-escape dynamic content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ------------------------------------------------------------
// Line builders
// ------------------------------------------------------------

function frame(section: ReportSection, text: string, indent?: true): ReportLine {
  return indent ? { kind: 'frame', section, text, indent } : { kind: 'frame', section, text };
}

function claim(
  section: ReportSection,
  text: string,
  refs: EvidenceRef[],
  indent?: true
): ReportLine {
  if (refs.length === 0) {
    // Unreachable through the public API (tuple-typed), but a claim
    // without a ref is a BUG by contract — fail loudly, never render.
    throw new Error(`report claim without evidence ref: ${text}`);
  }
  const tuple = refs as [EvidenceRef, ...EvidenceRef[]];
  return indent
    ? { kind: 'claim', section, text, refs: tuple, indent }
    : { kind: 'claim', section, text, refs: tuple };
}

const dealRef = (d: Deal): EvidenceRef => ({ sourceType: 'deal', sourceId: d.id });
const eventRef = (e: StageEvent): EvidenceRef => ({ sourceType: 'event', sourceId: e.id });
const personRef = (p: Person): EvidenceRef => ({ sourceType: 'person', sourceId: p.id });

// ------------------------------------------------------------
// Stage semantics
// ------------------------------------------------------------

const STAGE_ORDER: Record<PipelineStage, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s, i) => [s, i])
) as Record<PipelineStage, number>;

const SUBMITTED_INDEX = STAGE_ORDER.Submitted;

/**
 * Client-facing funnel buckets. Deliberately NOT the raw nine columns:
 * a client report groups internal stages into language a client reads
 * naturally, and internal money state (Paid) collapses into "placed" —
 * invoice status is never a client's business.
 */
const FUNNEL_BUCKETS: { label: string; stages: PipelineStage[] }[] = [
  { label: t('report.funnel.sourcing'), stages: ['Sourced', 'Screened'] },
  { label: t('report.funnel.conversations'), stages: ['Outreach', 'InConversation'] },
  { label: t('report.funnel.submitted'), stages: ['Submitted'] },
  { label: t('report.funnel.clientInterview'), stages: ['ClientInterview'] },
  { label: t('report.funnel.offer'), stages: ['Offer'] },
  { label: t('report.funnel.placed'), stages: ['Placed', 'Paid'] },
];

// ------------------------------------------------------------
// Internal record wiring
// ------------------------------------------------------------

interface DealCtx {
  deal: Deal;
  person: Person | undefined;
  /** Latest event that put the deal at/past Submitted, if any. */
  submitEvent: StageEvent | undefined;
  /** Latest event whose `to` equals the deal's current stage, if any. */
  entryEvent: StageEvent | undefined;
}

function latestBy(events: StageEvent[], pred: (e: StageEvent) => boolean): StageEvent | undefined {
  let best: StageEvent | undefined;
  for (const e of events) {
    if (!pred(e)) continue;
    if (best === undefined || Date.parse(e.ts) > Date.parse(best.ts)) best = e;
  }
  return best;
}

function crossedSubmitted(e: StageEvent): boolean {
  const toIdx = STAGE_ORDER[e.to as PipelineStage];
  if (toIdx !== undefined && toIdx >= SUBMITTED_INDEX) return true;
  return e.skippedStages.includes('Submitted');
}

/** Display name for a deal's candidate; gender-neutral fallback. */
function candidateName(ctx: DealCtx): string {
  const name = ctx.person !== undefined ? clean(ctx.person.name) : '';
  return name !== '' ? name : 'מועמד/ת';
}

/** refs for a claim naming the candidate and citing the deal (+event). */
function candidateRefs(ctx: DealCtx, extra?: StageEvent): EvidenceRef[] {
  const refs: EvidenceRef[] = [dealRef(ctx.deal)];
  if (ctx.person !== undefined) refs.push(personRef(ctx.person));
  if (extra !== undefined) refs.push(eventRef(extra));
  return refs;
}

// ------------------------------------------------------------
// buildMandateReport
// ------------------------------------------------------------

export function buildMandateReport(
  mandate: JobDescription,
  deals: Deal[],
  events: StageEvent[],
  contacts: Person[],
  opts: MandateReportOptions = {}
): MandateReport {
  const now = opts.now ?? new Date();
  const pendingDays = opts.feedbackPendingDays ?? 6;
  const jobTitle = clean(mandate.title);
  const jobRef: EvidenceRef = { sourceType: 'job', sourceId: mandate.id };

  // ---- scope to THIS mandate, drop tombstones --------------------------
  const mandateDeals = deals.filter((d) => d.jobId === mandate.id && d.deleted !== true);
  const activeDeals = mandateDeals
    .filter((d): d is Deal & { stage: PipelineStage } => (d.stage as PipelineStage) in STAGE_ORDER)
    .sort((a, b) => {
      const s = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
      if (s !== 0) return s;
      const t = Date.parse(a.stageEnteredAt) - Date.parse(b.stageEnteredAt);
      if (t !== 0 && Number.isFinite(t)) return t;
      return a.id < b.id ? -1 : 1;
    });
  const rejectedDeals = mandateDeals.filter((d) => d.stage === 'Rejected');

  const dealIds = new Set(mandateDeals.map((d) => d.id));
  const liveEvents = events.filter((e) => e.deleted !== true && dealIds.has(e.dealId));
  const personById = new Map<string, Person>();
  for (const p of contacts) if (p.deleted !== true) personById.set(p.id, p);
  const analysisById = new Map<string, CandidateAnalysis>();
  for (const a of opts.analyses ?? []) analysisById.set(a.id, a);

  const ctxOf = (deal: Deal): DealCtx => ({
    deal,
    person: personById.get(deal.personId),
    submitEvent: latestBy(liveEvents, (e) => e.dealId === deal.id && crossedSubmitted(e)),
    entryEvent: latestBy(liveEvents, (e) => e.dealId === deal.id && e.to === deal.stage),
  });

  const submittedPlus = activeDeals
    .filter((d) => STAGE_ORDER[d.stage] >= SUBMITTED_INDEX)
    .map(ctxOf);

  const lines: ReportLine[] = [];

  // ---- header ----------------------------------------------------------
  lines.push(claim('header', t('report.header', { jobTitle }), [jobRef]));
  const dateStr = formatDateHe(now.toISOString());
  if (dateStr !== null) lines.push(frame('header', t('report.asOf', { date: dateStr })));

  // ---- opening ---------------------------------------------------------
  const clientName = opts.clientName !== undefined ? clean(opts.clientName) : '';
  lines.push(
    frame(
      'opening',
      clientName !== '' ? t('report.greeting', { name: clientName }) : t('report.greetingGeneric')
    )
  );

  // "In active process" honestly excludes completed placements.
  const openDeals = activeDeals.filter((d) => STAGE_ORDER[d.stage] < STAGE_ORDER.Placed);
  const placedDeals = activeDeals.filter((d) => STAGE_ORDER[d.stage] >= STAGE_ORDER.Placed);

  if (openDeals.length > 0) {
    const n = openDeals.length;
    lines.push(
      claim(
        'opening',
        n === 1
          ? `נכון להיום, מועמד אחד נמצא בתהליך פעיל עבור משרת ${jobTitle}. להלן תמונת המצב.`
          : `נכון להיום, ${candidatesHe(n)} נמצאים בתהליך פעיל עבור משרת ${jobTitle}. להלן תמונת המצב.`,
        [jobRef, ...openDeals.map(dealRef)]
      )
    );
  } else if (placedDeals.length > 0) {
    lines.push(
      claim(
        'opening',
        `תהליך הגיוס למשרת ${jobTitle} הושלם — ההשמה בוצעה. להלן הסיכום.`,
        [jobRef, ...placedDeals.map(dealRef)]
      )
    );
  } else {
    lines.push(
      claim(
        'opening',
        `בשלב זה אין מועמדים בתהליך פעיל עבור משרת ${jobTitle} — האיתור נמשך, ונעדכן על כל התקדמות.`,
        [jobRef]
      )
    );
  }

  // ---- funnel ----------------------------------------------------------
  if (activeDeals.length > 0 || rejectedDeals.length > 0) {
    lines.push(frame('funnel', t('report.section.funnel')));

    for (const bucket of FUNNEL_BUCKETS) {
      const inBucket = activeDeals.filter((d) =>
        bucket.stages.includes(d.stage as PipelineStage)
      );
      if (inBucket.length === 0) continue;
      lines.push(
        claim('funnel', `${bucket.label}: ${candidatesHe(inBucket.length)}`, inBucket.map(dealRef))
      );
    }

    // Recent outreach activity — shows the work behind the numbers.
    const contactedPersons = [...personById.values()]
      .filter((p) => activeDeals.some((d) => d.personId === p.id))
      .filter((p) =>
        p.contactEvents.some((e) => {
          if (e.kind !== 'contacted') return false;
          if (e.dealId !== undefined && !dealIds.has(e.dealId)) return false;
          const age = daysSince(now, e.ts);
          return age !== null && age <= 7;
        })
      );
    if (contactedPersons.length > 0) {
      lines.push(
        claim(
          'funnel',
          `בשבוע האחרון פנינו ${toCandidatesHe(contactedPersons.length)} עבור המשרה.`,
          contactedPersons.map(personRef)
        )
      );
    }

    if (rejectedDeals.length > 0) {
      const n = rejectedDeals.length;
      lines.push(
        claim(
          'funnel',
          n === 1
            ? 'בנוסף, מועמד אחד נבחן ולא נמצא מתאים בשלב זה.'
            : `בנוסף, ${candidatesHe(n)} נבחנו ולא נמצאו מתאימים בשלב זה.`,
          rejectedDeals.map(dealRef)
        )
      );
    }
  }

  // ---- submitted candidates -------------------------------------------
  if (submittedPlus.length > 0) {
    lines.push(frame('submitted', t('report.section.submitted')));

    for (const ctx of submittedPlus) {
      const name = candidateName(ctx);
      const stage = ctx.deal.stage as PipelineStage;

      let statusText: string;
      let refs: EvidenceRef[];
      if (stage === 'Submitted') {
        const when = ctx.submitEvent?.ts ?? ctx.deal.stageEnteredAt;
        const date = formatDateHe(when);
        const ago = daysSince(now, when);
        const agoText = ago !== null && ago > 0 ? ` (${daysAgoHe(ago) ?? ''})` : '';
        statusText =
          date !== null
            ? `${name} — המועמדות הוגשה לבחינתכם ב-${date}${agoText}.`
            : `${name} — המועמדות הוגשה לבחינתכם.`;
        refs = candidateRefs(ctx, ctx.submitEvent);
      } else if (stage === 'ClientInterview') {
        const date = formatDateHe(ctx.deal.stageEnteredAt);
        statusText =
          date !== null
            ? `${name} — בתהליך ראיונות אצלכם מאז ${date}.`
            : `${name} — בתהליך ראיונות אצלכם.`;
        refs = candidateRefs(ctx, ctx.entryEvent);
      } else if (stage === 'Offer') {
        const date = formatDateHe(ctx.deal.stageEnteredAt);
        statusText =
          date !== null ? `${name} — בשלב הצעה מאז ${date}.` : `${name} — בשלב הצעה.`;
        refs = candidateRefs(ctx, ctx.entryEvent);
      } else {
        // Placed / Paid — client-facing: the placement is done.
        const date = formatDateHe(ctx.deal.stageEnteredAt);
        statusText =
          date !== null ? `${name} — ההשמה הושלמה ב-${date}.` : `${name} — ההשמה הושלמה.`;
        refs = candidateRefs(ctx, ctx.entryEvent);
      }
      lines.push(claim('submitted', statusText, refs));

      // Short summary from the candidate's analysis, when one exists.
      const analysis =
        ctx.deal.analysisId !== undefined ? analysisById.get(ctx.deal.analysisId) : undefined;
      if (analysis !== undefined) {
        const summary = shortSummary(analysis.profileSummary);
        if (summary !== '') {
          lines.push(
            claim(
              'submitted',
              summary,
              [{ sourceType: 'analysis', sourceId: analysis.id }, dealRef(ctx.deal)],
              true
            )
          );
        }
      }
    }
  }

  // ---- feedback-pending nudges ----------------------------------------
  const pending = submittedPlus
    .filter((ctx) => ctx.deal.stage === 'Submitted' || ctx.deal.stage === 'ClientInterview')
    .map((ctx) => ({ ctx, days: daysSince(now, ctx.deal.stageEnteredAt) }))
    .filter((x): x is { ctx: DealCtx; days: number } => x.days !== null && x.days > pendingDays)
    .sort((a, b) => b.days - a.days || (a.ctx.deal.id < b.ctx.deal.id ? -1 : 1));

  if (pending.length > 0) {
    lines.push(frame('feedback', t('report.section.feedback')));
    for (const { ctx, days } of pending) {
      const name = candidateName(ctx);
      const text =
        ctx.deal.stage === 'Submitted'
          ? `${name} — המועמדות הוגשה ${daysAgoHe(days) ?? `לפני ${days} ימים`} וטרם התקבל משוב; נשמח לעדכון כדי שנוכל להתקדם.`
          : `${name} — בתהליך הראיונות מזה ${durationHe(days)} ללא עדכון; נשמח לסטטוס.`;
      lines.push(claim('feedback', text, candidateRefs(ctx, ctx.entryEvent)));
    }
  }

  // ---- next steps ------------------------------------------------------
  lines.push(frame('next', t('report.section.next')));
  let anyStep = false;

  if (pending.length > 0) {
    anyStep = true;
    const n = pending.length;
    lines.push(
      claim(
        'next',
        n === 1
          ? 'קבלת משוב על המועמדות הממתינה תאפשר לנו להתקדם ולשמור על רצף מול המועמד.'
          : `קבלת משוב על ${n === 2 ? 'שני' : n} המועמדים הממתינים תאפשר לנו להתקדם ולשמור על רצף מול המועמדים.`,
        pending.map(({ ctx }) => dealRef(ctx.deal))
      )
    );
  }

  const inConversations = activeDeals.filter(
    (d) => d.stage === 'Outreach' || d.stage === 'InConversation'
  );
  if (inConversations.length > 0) {
    anyStep = true;
    lines.push(
      claim(
        'next',
        `אנחנו ממשיכים במקביל את השיחות עם ${candidatesHe(inConversations.length)}, ונעדכן על כל הגשה נוספת.`,
        inConversations.map(dealRef)
      )
    );
  }

  const inSourcing = activeDeals.filter((d) => d.stage === 'Sourced' || d.stage === 'Screened');
  if (inSourcing.length > 0) {
    anyStep = true;
    const n = inSourcing.length;
    lines.push(
      claim(
        'next',
        n === 1
          ? 'האיתור נמשך — מועמד אחד נוסף נמצא בסינון ראשוני.'
          : `האיתור נמשך — ${candidatesHe(n)} נוספים נמצאים בסינון ראשוני.`,
        inSourcing.map(dealRef)
      )
    );
  }

  const inOffer = activeDeals.filter((d) => d.stage === 'Offer');
  if (inOffer.length > 0) {
    anyStep = true;
    lines.push(
      claim('next', 'אנחנו מלווים באופן צמוד את שלב ההצעה עד לסגירה.', inOffer.map(dealRef))
    );
  }

  if (!anyStep) {
    lines.push(frame('next', t('report.next.fallback')));
  }

  // ---- closing ---------------------------------------------------------
  lines.push(frame('closing', t('report.closing.help')));
  lines.push(frame('closing', t('report.closing.regards')));
  lines.push(frame('closing', t('report.closing.signature')));

  // ---- render ----------------------------------------------------------
  const text = renderText(lines);
  const html = renderHtml(lines);
  const evidence: SuggestionEvidence[] = [];
  for (const line of lines) {
    if (line.kind !== 'claim') continue;
    for (const ref of line.refs) {
      evidence.push({ claim: line.text, sourceType: ref.sourceType, sourceId: ref.sourceId });
    }
  }

  const title = sanitizeMessageText(t('report.title', { jobTitle }));
  return {
    title,
    html,
    text,
    lines,
    evidence,
    suggestionInput: {
      agent: 'client_reporter',
      kind: 'report',
      title,
      body: text,
      evidence: evidence.map((e) => ({ ...e })),
    },
  };
}

// ------------------------------------------------------------
// Summary trimming
// ------------------------------------------------------------

/** First ~160 chars of a profile summary, cut at a word boundary. */
function shortSummary(raw: string): string {
  const s = clean(raw).replace(/\s+/g, ' ');
  if (s.length <= 160) return s;
  const cut = s.slice(0, 160);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : 160).trimEnd()}…`;
}

// ------------------------------------------------------------
// Renderers — text and HTML are BOTH assembled from `lines` only.
// ------------------------------------------------------------

const LIST_SECTIONS: ReadonlySet<ReportSection> = new Set(['funnel', 'submitted', 'feedback', 'next']);

function renderText(lines: ReportLine[]): string {
  const parts: string[] = [];
  let prevSection: ReportSection | null = null;
  for (const line of lines) {
    if (prevSection !== null && line.section !== prevSection && line.section !== 'closing') {
      parts.push('');
    }
    if (prevSection !== 'closing' && line.section === 'closing') parts.push('');
    const isHeaderLine = line.kind === 'frame' && LIST_SECTIONS.has(line.section);
    const bullet =
      LIST_SECTIONS.has(line.section) && !isHeaderLine ? (line.indent === true ? '  ' : '• ') : '';
    parts.push(`${bullet}${line.text}`);
    prevSection = line.section;
  }
  return sanitizeMessageText(parts.join('\n'));
}

function renderHtml(lines: ReportLine[]): string {
  const P_STYLE = 'margin: 0 0 10px;';
  const out: string[] = [];
  out.push(
    '<div dir="rtl" style="direction: rtl; text-align: start; ' +
      "font-family: Arial, 'Segoe UI', sans-serif; line-height: 1.65; color: #1f2937; max-width: 640px;\">"
  );

  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const safe = escapeHtml(line.text);

    if (line.section === 'header') {
      closeList();
      if (line.kind === 'claim') {
        out.push(`<h2 dir="auto" style="margin: 0 0 2px; font-size: 20px;">${safe}</h2>`);
      } else {
        out.push(`<p style="margin: 0 0 18px; font-size: 13px; color: #6b7280;">${safe}</p>`);
      }
      continue;
    }

    if (line.section === 'opening') {
      closeList();
      out.push(`<p dir="auto" style="${P_STYLE}">${safe}</p>`);
      continue;
    }

    if (LIST_SECTIONS.has(line.section)) {
      if (line.kind === 'frame') {
        // Section header.
        closeList();
        out.push(
          '<h3 style="margin: 18px 0 8px; font-size: 16px; ' +
            `border-inline-start: 3px solid #2563eb; padding-inline-start: 8px;">${safe}</h3>`
        );
        // A frame directly after a section header inside `next` is a
        // contentless placeholder ("נמשיך לעדכן…") — render as plain p.
        const next = lines[i + 1];
        if (next !== undefined && next.kind === 'frame' && next.section === line.section) {
          out.push(`<p dir="auto" style="${P_STYLE}">${escapeHtml(next.text)}</p>`);
          i += 1;
        }
        continue;
      }
      if (line.indent === true) {
        // Fold the summary into the previous <li>.
        const prev = out.pop() ?? '';
        out.push(
          prev.replace(
            /<\/li>$/,
            `<br><span dir="auto" style="color: #4b5563; font-size: 13px;">${safe}</span></li>`
          )
        );
        continue;
      }
      if (!listOpen) {
        out.push('<ul style="margin: 0; padding-inline-start: 20px;">');
        listOpen = true;
      }
      out.push(`<li dir="auto" style="margin: 0 0 6px;">${safe}</li>`);
      continue;
    }

    // closing
    closeList();
    if (line.text === t('report.closing.regards')) {
      out.push(`<p dir="auto" style="margin: 18px 0 0;">${safe}</p>`);
    } else if (line.text === t('report.closing.signature')) {
      out.push(`<p dir="auto" style="margin: 0;"><strong>${safe}</strong></p>`);
    } else {
      out.push(`<p dir="auto" style="margin: 18px 0 4px;">${safe}</p>`);
    }
  }
  closeList();
  out.push('</div>');
  return out.join('\n');
}
