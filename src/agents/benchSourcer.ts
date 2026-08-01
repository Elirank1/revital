// ============================================================
// Revital V3 — Bench Sourcer (Wave 3 Batch B, agents-engine)
//
// BINDING contract: docs/waves/wave3-tasks.md §Bench Sourcer —
// nightly tick pass + on-new-JD trigger. Matching is Claude-over-JSON
// through the SAME server-side path as /api/analyze (env key), spend-
// capped via checkAndCount(code,'claude') — the ONLY LLM allowed in
// the tick. Incremental (new/changed persons + open mandates since the
// last cursor), batched few-at-a-time within budgetMs. Precision
// throttle: accept-rate of its suggestions < 1/5 ⇒ next run's volume
// halves (floor 1). Output: 'bench_match' Suggestions with "why
// matched" evidence citing person fields. NEVER creates deals.
//
// Architecture rails:
//   * The LLM is an injected transport (BenchMatchTransport). This
//     module NEVER fetches, never touches an API key, never imports a
//     vendor SDK — the server transport lives in api/_lib/ and is
//     spend-capped by construction; tests ALWAYS mock it (zero real
//     network, pinned by a source-scan test).
//   * The LLM's output is treated as UNTRUSTED DATA: JSON-schema'd in
//     the prompt, parsed defensively (never throws), and every match
//     must GROUND itself — each citation quote must appear verbatim in
//     the cited person field or the citation is dropped; a match with
//     zero surviving citations is discarded as ungrounded.
//   * Output is SuggestionInput[] only. There is no code path from
//     this module to persons/deals/events (single-writer, plan §3) —
//     the bridge store makes card state unreachable anyway.
//   * Idempotency: deterministic suggestion id per (person, mandate)
//     pair — `s_bench_{personId}_{jobId}`. A pair is suggested at most
//     once; a dismissal stays final for the pair (the LWW merge drops
//     re-emissions; the planner skips them before spending tokens).
//     The manual escape hatch is kanban-ui's re-match CTA.
// ============================================================

import type {
  AgentRun,
  Deal,
  Person,
  Suggestion,
  SuggestionEvidence,
} from '../types/pipeline';
import type { SuggestionInput } from '../store/pipelineStore';
import { sanitizeMessageText } from '../lib/outreach';
import { t } from '../i18n';

export const BENCH_AGENT = 'bench_sourcer' as const;
export const BENCH_KIND = 'bench_match' as const;

/** Full per-run suggestion volume when precision is healthy/unknown. */
export const BENCH_BASE_VOLUME = 5;
/** Accept-rate floor: STRICTLY below this halves the next run's volume. */
export const BENCH_THROTTLE_ACCEPT_FLOOR = 0.2;
/** Matches scoring below this are never filed (prompt asks ≥ this too). */
export const BENCH_MIN_SCORE = 60;
/** Bench persons per LLM call — "batched few-at-a-time". */
export const BENCH_BATCH_PERSONS = 4;

// Prompt trimming bounds — keep calls cheap and within budget.
const JD_TEXT_MAX = 2400;
const FIELD_TEXT_MAX = 600;
const WHY_MAX = 600;

/** Pipeline stages in which a mandate counts as OPEN (pre-Placed). */
const OPEN_MANDATE_STAGES = new Set<string>([
  'Sourced',
  'Screened',
  'Outreach',
  'InConversation',
  'Submitted',
  'ClientInterview',
  'Offer',
]);
const FILLED_STAGES = new Set<string>(['Placed', 'Paid']);

// ------------------------------------------------------------
// Transport + spend-cap error (thrown by the server transport)
// ------------------------------------------------------------

/** The ONLY door to the LLM. Server impl: api/_lib/benchTransport.ts
 *  (spend-capped). Tests: always a mock. */
export interface BenchMatchTransport {
  complete(prompt: string): Promise<string>;
}

/** Raised by the transport when the per-code daily Claude cap (or an
 *  upstream 429) blocks the call — the run records outcome 'capped'. */
export class BenchSpendCapError extends Error {
  readonly code = 'spend_cap' as const;
  constructor(message = 'Daily Claude spend cap reached') {
    super(message);
    this.name = 'BenchSpendCapError';
  }
}

export function isSpendCapError(err: unknown): boolean {
  if (err instanceof BenchSpendCapError) return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'spend_cap'
  );
}

// ------------------------------------------------------------
// View types (structural — satisfied by the api/_lib AgentStoreView;
// src never imports from api/)
// ------------------------------------------------------------

/** Legacy JobDescription reference (blob `savedJobs`) — JD content. */
export interface BenchJobRef {
  id: string;
  title: string;
  rawText?: string;
}

/** Legacy CandidateAnalysis reference (blob `analyses`) — person content. */
export interface BenchAnalysisRef {
  id: string;
  timestamp?: string;
  profileSummary?: string;
  matchScore?: number;
  verdict?: string;
}

/** `cursor`/`volume` now live on the lead-owned AgentRun; alias kept
 *  so downstream call sites stay unchanged. */
export type BenchRunMeta = AgentRun;

export interface BenchSourcerView {
  persons: readonly Person[];
  deals: readonly Deal[];
  suggestions: readonly Suggestion[];
  agentRuns: readonly BenchRunMeta[];
  jobs?: readonly BenchJobRef[];
  analyses?: readonly BenchAnalysisRef[];
}

// ------------------------------------------------------------
// Throttle + cursor (pure)
// ------------------------------------------------------------

export interface BenchAcceptStats {
  accepted: number;
  dismissed: number;
  resolved: number;
  /** accepted / resolved; null until anything has been resolved. */
  acceptRate: number | null;
}

/**
 * Accept-rate of bench_match suggestions from suggestion statuses —
 * the server-side mirror of the store's agentAcceptStats('bench_sourcer')
 * (same math; this one takes data instead of reading the zustand store).
 */
export function benchAcceptStats(
  suggestions: readonly Suggestion[],
): BenchAcceptStats {
  let accepted = 0;
  let dismissed = 0;
  for (const s of suggestions) {
    if (s.deleted || s.agent !== BENCH_AGENT || s.kind !== BENCH_KIND) continue;
    if (s.status === 'accepted') accepted += 1;
    else if (s.status === 'dismissed') dismissed += 1;
  }
  const resolved = accepted + dismissed;
  return {
    accepted,
    dismissed,
    resolved,
    acceptRate: resolved > 0 ? accepted / resolved : null,
  };
}

/**
 * Precision throttle (contract): acceptRate < 0.2 halves the PREVIOUS
 * run's volume (floor 1) — consecutive low-precision runs compound
 * (5 → 2 → 1 → 1). null acceptRate (nothing resolved yet) = full
 * volume; recovery to ≥ 0.2 restores full volume immediately.
 */
export function throttledVolume(
  acceptRate: number | null,
  prevVolume?: number | null,
  base: number = BENCH_BASE_VOLUME,
): number {
  if (acceptRate === null || acceptRate >= BENCH_THROTTLE_ACCEPT_FLOOR) {
    return base;
  }
  const prev =
    typeof prevVolume === 'number' && Number.isFinite(prevVolume) && prevVolume > 0
      ? Math.min(Math.floor(prevVolume), base)
      : base;
  return Math.max(1, Math.floor(prev / 2));
}

/** Highest incremental cursor any live bench run has recorded. */
export function lastBenchCursor(runs: readonly BenchRunMeta[]): number {
  let cursor = 0;
  for (const r of runs) {
    if (r.deleted || r.agent !== BENCH_AGENT) continue;
    if (typeof r.cursor === 'number' && r.cursor > cursor) cursor = r.cursor;
  }
  return cursor;
}

/** Volume recorded by the newest live bench run (by v, then startedAt). */
export function lastBenchVolume(runs: readonly BenchRunMeta[]): number | null {
  let best: BenchRunMeta | null = null;
  for (const r of runs) {
    if (r.deleted || r.agent !== BENCH_AGENT) continue;
    if (typeof r.volume !== 'number' || !(r.volume > 0)) continue;
    if (
      best === null ||
      r.v > best.v ||
      (r.v === best.v && r.startedAt > best.startedAt)
    ) {
      best = r;
    }
  }
  return best ? Math.floor(best.volume as number) : null;
}

// ------------------------------------------------------------
// Incremental pair planning (pure)
// ------------------------------------------------------------

export interface BenchMandate {
  jobId: string;
  jobTitle: string;
  /** Legacy JD text when the mandate exists in savedJobs. */
  rawText?: string;
  /** max v across the mandate's live deals (0 when deal-less new JD). */
  mandateV: number;
  /** Named in the on-new-JD trigger — treated as changed regardless of v. */
  isNewJd: boolean;
}

/** The person data the LLM sees AND the grounding source for citations. */
export interface BenchPersonSnapshot {
  personId: string;
  personV: number;
  name: string;
  silver: boolean;
  /** Citable fields — a citation's quote must appear in one of these. */
  fields: {
    name: string;
    benchReason?: string;
    notes?: string;
    profileSummary?: string;
  };
  /** Analysis backing fields.profileSummary, when present. */
  analysisId?: string;
}

export interface BenchPair {
  snapshot: BenchPersonSnapshot;
  mandate: BenchMandate;
}

export type BenchSkipReason = 'exists' | 'already_on_job';

export interface BenchPairPlan {
  pairs: BenchPair[];
  mandates: BenchMandate[];
  /** Incremental read position consumed by this plan. */
  cursor: number;
  skipped: Array<{ personId: string; jobId: string; reason: BenchSkipReason }>;
  /** Pairs omitted because neither side changed since the cursor. */
  unchanged: number;
}

/** Deterministic id per (person, mandate) pair — the idempotency rail. */
export function benchSuggestionId(personId: string, jobId: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '');
  return `s_bench_${clean(personId)}_${clean(jobId)}`;
}

/**
 * Open mandates derived from live deals + legacy savedJobs content.
 * OPEN ⇔ ≥1 live deal in a pre-Placed pipeline stage AND no live deal
 * in Placed/Paid (filled mandates close). A jobId named in
 * `newJdJobIds` is open by fiat even with zero deals (brand-new JD) —
 * unless already filled.
 */
export function openMandates(
  deals: readonly Deal[],
  jobs: readonly BenchJobRef[] = [],
  newJdJobIds: readonly string[] = [],
): BenchMandate[] {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const newJdSet = new Set(newJdJobIds);

  interface Acc {
    maxV: number;
    open: boolean;
    filled: boolean;
    title: string;
    titleUpdatedAt: string;
  }
  const acc = new Map<string, Acc>();
  for (const d of deals) {
    if (d.deleted) continue;
    let a = acc.get(d.jobId);
    if (!a) {
      a = { maxV: 0, open: false, filled: false, title: '', titleUpdatedAt: '' };
      acc.set(d.jobId, a);
    }
    if (d.v > a.maxV) a.maxV = d.v;
    if (OPEN_MANDATE_STAGES.has(d.stage)) a.open = true;
    if (FILLED_STAGES.has(d.stage)) a.filled = true;
    if (d.jobTitle && d.updatedAt >= a.titleUpdatedAt) {
      a.title = d.jobTitle;
      a.titleUpdatedAt = d.updatedAt;
    }
  }

  const out: BenchMandate[] = [];
  const seen = new Set<string>();
  for (const [jobId, a] of acc) {
    if (a.filled) continue;
    const isNewJd = newJdSet.has(jobId);
    if (!a.open && !isNewJd) continue;
    const jobRef = jobById.get(jobId);
    out.push({
      jobId,
      jobTitle: a.title || jobRef?.title || jobId,
      ...(jobRef?.rawText ? { rawText: jobRef.rawText } : {}),
      mandateV: a.maxV,
      isNewJd,
    });
    seen.add(jobId);
  }
  // Deal-less brand-new JDs named by the trigger.
  for (const jobId of newJdSet) {
    if (seen.has(jobId) || acc.has(jobId)) continue;
    const jobRef = jobById.get(jobId);
    out.push({
      jobId,
      jobTitle: jobRef?.title || jobId,
      ...(jobRef?.rawText ? { rawText: jobRef.rawText } : {}),
      mandateV: 0,
      isNewJd: true,
    });
  }
  out.sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
  return out;
}

function trimText(s: string, max: number): string {
  const clean = sanitizeMessageText(s).trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Build the snapshot the LLM sees for one bench person. */
export function benchPersonSnapshot(
  person: Person,
  analyses: readonly BenchAnalysisRef[] = [],
): BenchPersonSnapshot {
  const bench = person.bench;
  const benchReason = bench?.benchReason ?? bench?.reason;

  // Latest linked analysis by timestamp — person content for matching.
  let latest: BenchAnalysisRef | undefined;
  if (person.analysisIds.length > 0) {
    const linked = new Set(person.analysisIds);
    for (const a of analyses) {
      if (!linked.has(a.id)) continue;
      if (typeof a.profileSummary !== 'string' || a.profileSummary === '') continue;
      if (!latest || (a.timestamp ?? '') >= (latest.timestamp ?? '')) latest = a;
    }
  }

  return {
    personId: person.id,
    personV: person.v,
    name: person.name,
    silver: bench?.silverMedalist === true,
    fields: {
      name: person.name,
      ...(benchReason ? { benchReason } : {}),
      ...(person.notes ? { notes: person.notes } : {}),
      ...(latest?.profileSummary ? { profileSummary: latest.profileSummary } : {}),
    },
    ...(latest ? { analysisId: latest.id } : {}),
  };
}

/**
 * Incremental pair selection: (bench persons changed since cursor × all
 * open mandates) ∪ (all bench persons × mandates changed since cursor
 * or named by the new-JD trigger). cursor 0 = first run = everything is
 * new. Pairs whose deterministic suggestion id already exists (ANY
 * status — dismissals are final) or whose person already has ANY live
 * deal on that mandate (incl. Rejected-for-that-job) are skipped before
 * a single token is spent.
 */
export function planBenchPairs(
  view: BenchSourcerView,
  opts: { newJdJobIds?: readonly string[] } = {},
): BenchPairPlan {
  const cursor = lastBenchCursor(view.agentRuns);
  const changed = (v: number) => cursor === 0 || v > cursor;

  const mandates = openMandates(view.deals, view.jobs ?? [], opts.newJdJobIds ?? []);

  const benchPersons = view.persons.filter((p) => !p.deleted && !!p.bench);
  const snapshots = benchPersons
    .map((p) => benchPersonSnapshot(p, view.analyses ?? []))
    .sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));

  const existingIds = new Set(view.suggestions.map((s) => s.id));
  const dealsByPerson = new Map<string, Set<string>>();
  for (const d of view.deals) {
    if (d.deleted) continue;
    let set = dealsByPerson.get(d.personId);
    if (!set) {
      set = new Set();
      dealsByPerson.set(d.personId, set);
    }
    set.add(d.jobId);
  }

  const pairs: BenchPair[] = [];
  const skipped: BenchPairPlan['skipped'] = [];
  let unchanged = 0;

  for (const mandate of mandates) {
    const mandateChanged = mandate.isNewJd || changed(mandate.mandateV);
    for (const snapshot of snapshots) {
      const pairRelevant = mandateChanged || changed(snapshot.personV);
      if (!pairRelevant) {
        unchanged += 1;
        continue;
      }
      const id = benchSuggestionId(snapshot.personId, mandate.jobId);
      if (existingIds.has(id)) {
        skipped.push({ personId: snapshot.personId, jobId: mandate.jobId, reason: 'exists' });
        continue;
      }
      if (dealsByPerson.get(snapshot.personId)?.has(mandate.jobId)) {
        skipped.push({
          personId: snapshot.personId,
          jobId: mandate.jobId,
          reason: 'already_on_job',
        });
        continue;
      }
      pairs.push({ snapshot, mandate });
    }
  }

  return { pairs, mandates, cursor, skipped, unchanged };
}

// ------------------------------------------------------------
// Prompt (JSON-schema'd) + defensive parsing
// ------------------------------------------------------------

export const BENCH_CITABLE_FIELDS = [
  'name',
  'benchReason',
  'notes',
  'profileSummary',
] as const;
export type BenchCitableField = (typeof BENCH_CITABLE_FIELDS)[number];

const FIELD_LABEL_HE: Record<BenchCitableField, string> = {
  name: 'שם',
  benchReason: 'סיבת ספסל',
  notes: 'הערות',
  profileSummary: 'תקציר פרופיל',
};

/** One mandate × up-to-BENCH_BATCH_PERSONS snapshots per LLM call. */
export function buildBenchPrompt(
  mandate: BenchMandate,
  snapshots: readonly BenchPersonSnapshot[],
): string {
  const jd = mandate.rawText
    ? trimText(mandate.rawText, JD_TEXT_MAX)
    : '(אין תיאור מלא — כותרת בלבד)';
  const people = snapshots
    .map((s) => {
      const f = s.fields;
      return [
        `- personId: ${s.personId}`,
        `  שם: ${trimText(f.name, FIELD_TEXT_MAX)}`,
        `  סיבת ספסל: ${f.benchReason ? trimText(f.benchReason, FIELD_TEXT_MAX) : '—'}`,
        `  מדליית כסף (הגיע/ה לשלב מתקדם בתהליך קודם): ${s.silver ? 'כן' : 'לא'}`,
        `  הערות: ${f.notes ? trimText(f.notes, FIELD_TEXT_MAX) : '—'}`,
        `  תקציר פרופיל: ${f.profileSummary ? trimText(f.profileSummary, FIELD_TEXT_MAX) : '—'}`,
      ].join('\n');
    })
    .join('\n');

  return [
    'אתה מנוע התאמה עבור מגייסת עצמאית. המשימה: לבדוק אילו מהמועמדים שעל "הספסל" מתאימים למשרה הפתוחה שלהלן.',
    '',
    '[משרה]',
    `תפקיד: ${trimText(mandate.jobTitle, FIELD_TEXT_MAX)}`,
    `תיאור: ${jd}`,
    '',
    '[מועמדים על הספסל]',
    people,
    '',
    'החזר JSON בלבד, ללא טקסט נוסף וללא Markdown, בסכמה הבאה:',
    '{"matches":[{"personId":"<personId מהרשימה>","score":<מספר 0-100>,"whyMatched":"<נימוק קצר בעברית: למה ההתאמה הגיונית>","citations":[{"field":"name" | "benchReason" | "notes" | "profileSummary","quote":"<ציטוט מדויק, מועתק מילה במילה מתוך השדה המצוין>"}]}]}',
    '',
    'חוקים:',
    `- כלול רק מועמדים עם התאמה סבירה (score ${BENCH_MIN_SCORE} ומעלה); אם אין — החזר {"matches":[]}.`,
    '- לכל match לפחות ציטוט אחד; ה-quote חייב להופיע מילה במילה בשדה המצוטט.',
    '- אל תמציא עובדות שאינן מופיעות בנתוני המועמד.',
  ].join('\n');
}

export interface BenchCitation {
  field: BenchCitableField;
  quote: string;
  sourceType: 'person' | 'analysis';
  sourceId: string;
}

export interface BenchParsedMatch {
  personId: string;
  jobId: string;
  score: number;
  whyMatched: string;
  silver: boolean;
  citations: BenchCitation[];
}

export type BenchParseDropReason =
  | 'invalid_json'
  | 'not_an_object'
  | 'unknown_person'
  | 'duplicate_person'
  | 'bad_score'
  | 'empty_why'
  | 'ungrounded';

export interface BenchParseResult {
  matches: BenchParsedMatch[];
  dropped: Array<{ reason: BenchParseDropReason; personId?: string }>;
}

/** Whitespace-normalized, BiDi-sanitized comparison space for grounding. */
function normalizeForGrounding(s: string): string {
  return sanitizeMessageText(s).replace(/\s+/g, ' ').trim();
}

function stripCodeFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
}

/**
 * Parse one LLM response for one mandate batch. NEVER throws. Every
 * entry is validated: personId must be in the batch (dedup, first
 * wins), score must be a finite number (clamped to 0..100), whyMatched
 * non-empty (BiDi-sanitized, length-capped), and each citation's quote
 * must appear verbatim (whitespace-normalized) in the cited field —
 * ungrounded citations are dropped, and a match with zero surviving
 * citations is discarded entirely.
 */
export function parseBenchResponse(
  text: string,
  mandate: BenchMandate,
  snapshots: readonly BenchPersonSnapshot[],
): BenchParseResult {
  const dropped: BenchParseResult['dropped'] = [];
  const byPerson = new Map(snapshots.map((s) => [s.personId, s]));

  let root: unknown;
  try {
    const cleaned = stripCodeFences(text);
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object');
    root = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return { matches: [], dropped: [{ reason: 'invalid_json' }] };
  }

  const rawMatches = (root as { matches?: unknown }).matches;
  if (!Array.isArray(rawMatches)) {
    return { matches: [], dropped: [{ reason: 'invalid_json' }] };
  }

  const matches: BenchParsedMatch[] = [];
  const seen = new Set<string>();

  for (const raw of rawMatches) {
    if (typeof raw !== 'object' || raw === null) {
      dropped.push({ reason: 'not_an_object' });
      continue;
    }
    const m = raw as Record<string, unknown>;
    const personId = typeof m.personId === 'string' ? m.personId : '';
    const snapshot = byPerson.get(personId);
    if (!snapshot) {
      dropped.push({ reason: 'unknown_person', ...(personId ? { personId } : {}) });
      continue;
    }
    if (seen.has(personId)) {
      dropped.push({ reason: 'duplicate_person', personId });
      continue;
    }
    if (typeof m.score !== 'number' || !Number.isFinite(m.score)) {
      dropped.push({ reason: 'bad_score', personId });
      continue;
    }
    const score = Math.round(Math.min(100, Math.max(0, m.score)));
    const whyMatched = trimText(
      typeof m.whyMatched === 'string' ? m.whyMatched : '',
      WHY_MAX,
    );
    if (whyMatched === '') {
      dropped.push({ reason: 'empty_why', personId });
      continue;
    }

    const citations: BenchCitation[] = [];
    const rawCitations = Array.isArray(m.citations) ? m.citations : [];
    for (const rawC of rawCitations) {
      if (typeof rawC !== 'object' || rawC === null) continue;
      const c = rawC as Record<string, unknown>;
      const field = c.field as BenchCitableField;
      if (!BENCH_CITABLE_FIELDS.includes(field)) continue;
      const fieldText = snapshot.fields[field];
      if (typeof fieldText !== 'string' || fieldText === '') continue;
      const quote =
        typeof c.quote === 'string' ? normalizeForGrounding(c.quote) : '';
      if (quote === '') continue;
      // GROUNDING: the quote must actually exist in the person field.
      if (!normalizeForGrounding(fieldText).includes(quote)) continue;
      citations.push({
        field,
        quote,
        sourceType: field === 'profileSummary' ? 'analysis' : 'person',
        sourceId:
          field === 'profileSummary'
            ? (snapshot.analysisId ?? snapshot.personId)
            : snapshot.personId,
      });
    }
    if (citations.length === 0) {
      dropped.push({ reason: 'ungrounded', personId });
      continue;
    }

    seen.add(personId);
    matches.push({
      personId,
      jobId: mandate.jobId,
      score,
      whyMatched,
      silver: snapshot.silver,
      citations,
    });
  }

  return { matches, dropped };
}

// ------------------------------------------------------------
// Suggestion building
// ------------------------------------------------------------

/**
 * A 'bench_match' Suggestion input: Hebrew title/body from the shared
 * lexicon (src/i18n — adopted per the Wave-3A offer), evidence citing
 * the exact person fields the match is grounded in plus the open
 * mandate. personId only — NO dealId: accepting is the human's move
 * and card creation is the client's (single-writer, plan §3).
 */
export function buildBenchSuggestion(
  match: BenchParsedMatch,
  snapshot: BenchPersonSnapshot,
  mandate: BenchMandate,
): SuggestionInput {
  const evidence: SuggestionEvidence[] = [
    {
      claim: `מנדט פתוח: ${sanitizeMessageText(mandate.jobTitle)}`,
      sourceType: 'job',
      sourceId: mandate.jobId,
    },
    ...match.citations.map((c) => ({
      claim: `${FIELD_LABEL_HE[c.field]}: "${c.quote}"`,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
    })),
    ...(match.silver
      ? [
          {
            claim: t('bench.silverMedalist'),
            sourceType: 'person',
            sourceId: snapshot.personId,
          },
        ]
      : []),
  ];

  const bodyParts = [
    t('bench.match.header', { jobTitle: mandate.jobTitle }),
    '',
    match.whyMatched,
    ...(match.silver ? [t('bench.silverMedalist')] : []),
    '',
    `ציון התאמה: ${match.score}/100`,
  ];

  return {
    id: benchSuggestionId(snapshot.personId, mandate.jobId),
    agent: BENCH_AGENT,
    kind: BENCH_KIND,
    personId: snapshot.personId,
    title: t('bench.match.title', {
      name: snapshot.name,
      jobTitle: mandate.jobTitle,
    }),
    body: bodyParts.join('\n'),
    evidence,
  };
}

// ------------------------------------------------------------
// The pass — batched, budget-aware, throttled, no-throw
// ------------------------------------------------------------

export interface BenchPassDeps {
  transport: BenchMatchTransport;
  /** Time budget for LLM batches (elapsed checked BEFORE each call). */
  budgetMs?: number;
  /** On-new-JD trigger: jobIds to re-match regardless of the cursor. */
  newJdJobIds?: readonly string[];
  baseVolume?: number;
  minScore?: number;
  /** Injectable clock for budget tests. */
  nowMs?: () => number;
}

export interface BenchPassResult {
  /** Volume-capped, ranked (score desc → silver → personId) inputs. */
  suggestions: SuggestionInput[];
  /** Pairs whose LLM evaluation completed. */
  itemsProcessed: number;
  pairsPlanned: number;
  outcome: 'ok' | 'capped' | 'error';
  error?: string;
  /** True when the budget stopped the pass with batches remaining. */
  partial: boolean;
  /** Throttle-resolved suggestion cap for this run. */
  volume: number;
  acceptRate: number | null;
  /** Incremental cursor consumed (from prior bench runs). */
  cursor: number;
  matchesConsidered: number;
  dropped: BenchParseResult['dropped'];
}

export const BENCH_DEFAULT_BUDGET_MS = 8000;

interface BenchBatch {
  mandate: BenchMandate;
  snapshots: BenchPersonSnapshot[];
}

function toBatches(pairs: readonly BenchPair[]): BenchBatch[] {
  const byMandate = new Map<string, BenchBatch[]>();
  const order: string[] = [];
  for (const pair of pairs) {
    let chunks = byMandate.get(pair.mandate.jobId);
    if (!chunks) {
      chunks = [];
      byMandate.set(pair.mandate.jobId, chunks);
      order.push(pair.mandate.jobId);
    }
    const last = chunks[chunks.length - 1];
    if (!last || last.snapshots.length >= BENCH_BATCH_PERSONS) {
      chunks.push({ mandate: pair.mandate, snapshots: [pair.snapshot] });
    } else {
      last.snapshots.push(pair.snapshot);
    }
  }
  return order.flatMap((jobId) => byMandate.get(jobId) ?? []);
}

/**
 * Run the Bench Sourcer over one code's view. Never throws: transport
 * failures land in `outcome`/`error` and matches gathered before the
 * failure are still ranked and filed (a capped run keeps its work).
 */
export async function runBenchPass(
  view: BenchSourcerView,
  deps: BenchPassDeps,
): Promise<BenchPassResult> {
  const budgetMs = deps.budgetMs ?? BENCH_DEFAULT_BUDGET_MS;
  const nowMs = deps.nowMs ?? Date.now;
  const minScore = deps.minScore ?? BENCH_MIN_SCORE;

  const stats = benchAcceptStats(view.suggestions);
  const volume = throttledVolume(
    stats.acceptRate,
    lastBenchVolume(view.agentRuns),
    deps.baseVolume ?? BENCH_BASE_VOLUME,
  );

  const plan = planBenchPairs(view, { newJdJobIds: deps.newJdJobIds ?? [] });
  const batches = toBatches(plan.pairs);

  const startedMs = nowMs();
  let itemsProcessed = 0;
  let outcome: BenchPassResult['outcome'] = 'ok';
  let error: string | undefined;
  let partial = false;
  const allMatches: BenchParsedMatch[] = [];
  const dropped: BenchParseResult['dropped'] = [];
  const snapshotById = new Map<string, BenchPersonSnapshot>();
  const mandateById = new Map<string, BenchMandate>();

  for (const batch of batches) {
    if (nowMs() - startedMs >= budgetMs) {
      partial = true;
      break;
    }
    try {
      const prompt = buildBenchPrompt(batch.mandate, batch.snapshots);
      const text = await deps.transport.complete(prompt);
      itemsProcessed += batch.snapshots.length;
      const parsed = parseBenchResponse(text, batch.mandate, batch.snapshots);
      dropped.push(...parsed.dropped);
      for (const m of parsed.matches) {
        allMatches.push(m);
      }
      for (const s of batch.snapshots) snapshotById.set(s.personId, s);
      mandateById.set(batch.mandate.jobId, batch.mandate);
    } catch (err) {
      if (isSpendCapError(err)) {
        outcome = 'capped';
        error = err instanceof Error ? err.message : String(err);
      } else {
        outcome = 'error';
        error = err instanceof Error ? err.message : String(err);
      }
      break;
    }
  }

  // Rank: score desc → silver medalists first → personId asc; then the
  // throttle cap and the score floor.
  const ranked = allMatches
    .filter((m) => m.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.silver !== b.silver) return a.silver ? -1 : 1;
      return a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0;
    })
    .slice(0, volume);

  const suggestions = ranked.flatMap((m) => {
    const snapshot = snapshotById.get(m.personId);
    const mandate = mandateById.get(m.jobId);
    return snapshot && mandate ? [buildBenchSuggestion(m, snapshot, mandate)] : [];
  });

  return {
    suggestions,
    itemsProcessed,
    pairsPlanned: plan.pairs.length,
    outcome,
    ...(error !== undefined ? { error } : {}),
    partial,
    volume,
    acceptRate: stats.acceptRate,
    cursor: plan.cursor,
    matchesConsidered: allMatches.length,
    dropped,
  };
}
