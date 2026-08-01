// ============================================================
// Revital V3 — Progressive in-product seeding (Wave 3 C-seed, platform-data)
//
// BINDING contract: docs/waves/wave3-tasks.md §Batch C-seed (D-042).
// The human seeding session is replaced by in-product seeding:
//   - per-mandate seeding state { jobId, seededAt }, persisted under
//     `revital_v3_seeding` (same pattern as the fees slice);
//   - `mandateCalibrated` (ev.ts) now ALSO requires the mandate to be
//     seeded — the invariant is absolute: no ₪ ever renders for an
//     unseeded mandate;
//   - `deriveBaseline(analyses, log, events, contacts)` auto-derives
//     baseline metrics from existing history — nulls over fiction;
//   - `asyncSeedingFormText(pending)` renders the REMAINING questions
//     (what auto-derivation could not answer) as shareable Hebrew plain
//     text for async WhatsApp/email — pure, BiDi-safe, no LLM.
//
// In-memory registry: the calibration predicate is consumed by pure
// 3-arg callers (kanban money helpers, Pit Boss) that cannot pass the
// seeding state explicitly. Like `loadPriors()`, the default source is
// this module — hydrated lazily from localStorage and kept in sync by
// the money store's `markMandateSeeded`. On the server (no storage,
// no store) the registry stays empty ⇒ nothing is seeded ⇒ fail-closed,
// which matches the tick's already-money-free reality (empty fees).
// ============================================================

import {
  PIPELINE_STAGES,
  type Deal,
  type DealStage,
  type StageEvent,
  type Suggestion,
} from '../../types/pipeline';
import { loadV3, saveV3 } from '../persistence/keys';
import {
  computeLeadingIndicators,
  type ContactRef,
  type LeadingIndicators,
} from '../metrics/leadingIndicators';
import { feeAmount, type MandateFee } from './mandateFee';

// ------------------------------------------------------------
// Seeding state + persistence (`revital_v3_seeding`)
// ------------------------------------------------------------

/** localStorage key for per-mandate seeding state (contract). */
export const SEEDING_KEY = 'revital_v3_seeding';

export interface MandateSeeding {
  /** Legacy JobDescription.id — the mandate that was seeded. */
  jobId: string;
  /** ISO timestamp — when the first-open wizard marked it seeded. */
  seededAt: string;
}

/** Keyed by jobId, exactly like the fees record. */
export type SeedingState = Record<string, MandateSeeding>;

/**
 * Sanitize an unknown persisted payload: keep only entries whose value is
 * `{ jobId, seededAt }` with jobId matching its key and a parsable
 * seededAt. A corrupt localStorage value can never poison the calibration
 * gate — bad entries simply read as "not seeded" (fail-closed).
 */
export function sanitizeSeeding(raw: unknown): SeedingState {
  const out: SeedingState = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<MandateSeeding> | null;
    if (
      entry &&
      typeof entry === 'object' &&
      entry.jobId === key &&
      typeof entry.seededAt === 'string' &&
      Number.isFinite(Date.parse(entry.seededAt))
    ) {
      out[key] = { jobId: entry.jobId, seededAt: entry.seededAt };
    }
  }
  return out;
}

let registry: SeedingState | null = null;

/** The current seeding state (module registry, lazily hydrated). */
export function currentSeeding(): SeedingState {
  if (registry === null) {
    registry = sanitizeSeeding(loadV3<unknown>(SEEDING_KEY, null));
  }
  return registry;
}

/**
 * Replace the seeding state (registry + localStorage). STORE-INTERNAL:
 * production code must go through the audited `markMandateSeeded` store
 * action — this is the persistence primitive underneath it (and the
 * test-kit reset hook). Deliberately NOT exported from the lib index.
 */
export function commitSeeding(next: SeedingState): void {
  registry = next;
  saveV3(SEEDING_KEY, next);
}

/** Drop the registry and re-hydrate from localStorage (test resets). */
export function reloadSeeding(): SeedingState {
  registry = null;
  return currentSeeding();
}

/** Has this mandate been seeded? Fail-closed for unknown ids. */
export function isSeeded(
  jobId: string,
  seeding: SeedingState = currentSeeding(),
): boolean {
  return !!seeding[jobId];
}

// ------------------------------------------------------------
// Baseline auto-derivation (nulls over fiction)
// ------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PIPELINE_STAGE_SET = new Set<string>(PIPELINE_STAGES);

/** Minimal structural shape of a legacy CandidateAnalysis / AnalysisLog
 *  row — all deriveBaseline reads. AnalysisLog rows share the analysis id
 *  (engine/analyzer createLogEntry), so the union dedupes on id. */
export interface LegacyHistoryRef {
  id: string;
  timestamp: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Why each figure is (or is not) a number — surfaced on the baseline card. */
export interface BaselineBasis {
  /** Distinct legacy analyses observed (analyses ∪ log, deduped by id). */
  analysisCount: number;
  /** Days between first and last analysis; null below 2 observations. */
  analysisSpanDays: number | null;
  /** Follow-up chase pairs actually measured. */
  followUpPairs: number;
  /** Distinct persons/deals with at least one outbound contact. */
  contactedKeys: number;
}

export interface BaselineMetrics {
  /** Distinct analyses ÷ span days. null under 2 observations or <1 day
   *  of history — a daily rate cannot honestly be claimed from less. */
  candidatesPerDay: number | null;
  /** Median days between an unanswered outbound contact and her NEXT
   *  contact to the same person (the follow-up chase). Replies close a
   *  chase window; single contacts measure nothing. null when no pairs. */
  followUpLatencyDays: number | null;
  /** Distinct mandates with a live in-flight deal. null without deals. */
  activeMandateCount: number | null;
  /** Live deals in a pipeline stage before Paid. null without deals. */
  inFlightDealCount: number | null;
  /** Wave-2 leading indicators over the same history (reused, not forked). */
  indicators: LeadingIndicators;
  basis: BaselineBasis;
}

export interface DeriveBaselineOptions {
  /** Enables activeMandateCount / inFlightDealCount + contact→deal
   *  attribution inside the indicators. Absent ⇒ those metrics are null
   *  (unmeasured, never guessed). */
  deals?: Deal[];
  /** Feeds suggestion accept/edit rates in `indicators`. Default []. */
  suggestions?: Suggestion[];
  /** Clock for SLA classification. Defaults to wall time. */
  now?: string | Date;
}

/**
 * Auto-derive baseline metrics from existing history (D-042): whatever
 * the data already answers is never asked again — and whatever it does
 * NOT answer stays null and becomes a question in the async form.
 * Pure; deterministic given `opts.now`.
 */
export function deriveBaseline(
  analyses: LegacyHistoryRef[],
  log: LegacyHistoryRef[],
  events: StageEvent[],
  contacts: ContactRef[],
  opts?: DeriveBaselineOptions,
): BaselineMetrics {
  // --- candidates/day from the legacy analysis history -----------------
  const seenIds = new Set<string>();
  const stamps: number[] = [];
  for (const rec of [...analyses, ...log]) {
    if (!rec || typeof rec.id !== 'string' || seenIds.has(rec.id)) continue;
    seenIds.add(rec.id);
    const ms = Date.parse(rec.timestamp);
    if (Number.isFinite(ms)) stamps.push(ms);
  }
  let analysisSpanDays: number | null = null;
  let candidatesPerDay: number | null = null;
  if (stamps.length >= 2) {
    analysisSpanDays =
      (Math.max(...stamps) - Math.min(...stamps)) / MS_PER_DAY;
    if (analysisSpanDays >= 1) {
      candidatesPerDay = stamps.length / analysisSpanDays;
    }
  }

  // --- follow-up latency from the contact history -----------------------
  // A chase pair = two consecutive outbound contacts to the same person
  // with NO candidate response between them. A reply/meeting closes the
  // window (the next contact starts a new thread, not a follow-up).
  const byKey = new Map<string, Array<{ kind: ContactRef['kind']; ms: number }>>();
  for (const c of contacts) {
    const key = c.personId ?? c.dealId;
    if (!key) continue; // unattributable — pairing it would be fiction
    const ms = Date.parse(c.ts);
    if (!Number.isFinite(ms)) continue;
    const list = byKey.get(key);
    const item = { kind: c.kind, ms };
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  const chaseDeltas: number[] = [];
  let contactedKeys = 0;
  for (const list of byKey.values()) {
    list.sort((a, b) => a.ms - b.ms);
    let openChaseMs: number | null = null;
    let touched = false;
    for (const c of list) {
      if (c.kind === 'contacted') {
        touched = true;
        if (openChaseMs !== null) {
          chaseDeltas.push((c.ms - openChaseMs) / MS_PER_DAY);
        }
        openChaseMs = c.ms;
      } else if (c.kind === 'replied' || c.kind === 'meeting_set') {
        openChaseMs = null; // answered — chase window closed
      }
      // 'no_reply' keeps the chase window open
    }
    if (touched) contactedKeys += 1;
  }
  const followUpLatencyDays = median(chaseDeltas);

  // --- board shape (only when deals are actually provided) --------------
  let activeMandateCount: number | null = null;
  let inFlightDealCount: number | null = null;
  if (opts?.deals) {
    const activeJobs = new Set<string>();
    let inFlight = 0;
    for (const d of opts.deals) {
      if (d.deleted) continue;
      if (!PIPELINE_STAGE_SET.has(d.stage) || d.stage === 'Paid') continue;
      inFlight += 1;
      activeJobs.add(d.jobId);
    }
    activeMandateCount = activeJobs.size;
    inFlightDealCount = inFlight;
  }

  const indicators = computeLeadingIndicators(
    events,
    contacts,
    opts?.suggestions ?? [],
    { deals: opts?.deals, now: opts?.now },
  );

  return {
    candidatesPerDay,
    followUpLatencyDays,
    activeMandateCount,
    inFlightDealCount,
    indicators,
    basis: {
      analysisCount: stamps.length,
      analysisSpanDays,
      followUpPairs: chaseDeltas.length,
      contactedKeys,
    },
  };
}

// ------------------------------------------------------------
// Async seeding form (Hebrew plain text, BiDi-safe, no LLM)
// ------------------------------------------------------------

/** All direction-control characters (override/embed/isolate + marks +
 *  ALM) — the form must neither contain nor pass any of them through
 *  (same policy as sanitizeMessageText / the i18n lexicon). */
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;

function clean(text: string): string {
  return text.replace(BIDI_CONTROLS, '').trim();
}

export interface PendingSeedingCandidate {
  name: string;
  /** The stage currently on the card (backfill guess) — to confirm. */
  stage: DealStage;
}

export interface PendingSeedingMandate {
  jobId: string;
  jobTitle: string;
  /** No complete fee exists — the fee question is asked. */
  needsFee: boolean;
  /** Cards awaiting her stage confirmation. Empty when already seeded. */
  candidates: PendingSeedingCandidate[];
}

export interface PendingSeeding {
  mandates: PendingSeedingMandate[];
  /** Null metrics become questions. Omit/null skips the section. */
  baseline?: Pick<
    BaselineMetrics,
    | 'candidatesPerDay'
    | 'followUpLatencyDays'
    | 'activeMandateCount'
    | 'inFlightDealCount'
  > | null;
}

/**
 * Compute what still needs Revital's answer: mandates missing a complete
 * fee and/or not yet seeded (their live pipeline cards need stage
 * confirmation), plus the baseline questions auto-derivation left null.
 * Pure — pass the relevant store snapshots in.
 */
export function buildPendingSeeding(args: {
  deals: Deal[];
  persons: Array<{ id: string; name: string; deleted?: true }>;
  fees: Record<string, MandateFee>;
  seeding?: SeedingState;
  baseline?: BaselineMetrics | null;
}): PendingSeeding {
  const seeding = args.seeding ?? currentSeeding();
  const nameById = new Map<string, string>();
  for (const p of args.persons) {
    if (!p.deleted) nameById.set(p.id, p.name);
  }

  const byJob = new Map<string, { title: string; deals: Deal[] }>();
  for (const d of args.deals) {
    if (d.deleted) continue;
    const entry = byJob.get(d.jobId);
    if (entry) entry.deals.push(d);
    else byJob.set(d.jobId, { title: d.jobTitle, deals: [d] });
  }

  const mandates: PendingSeedingMandate[] = [];
  for (const [jobId, { title, deals }] of byJob) {
    const needsFee = feeAmount(args.fees[jobId] ?? null) === null;
    const seeded = isSeeded(jobId, seeding);
    if (!needsFee && seeded) continue; // fully answered — no questions
    const candidates: PendingSeedingCandidate[] = seeded
      ? []
      : deals
          .filter((d) => PIPELINE_STAGE_SET.has(d.stage))
          .map((d) => ({
            name: nameById.get(d.personId) ?? d.jobTitle,
            stage: d.stage,
          }));
    mandates.push({ jobId, jobTitle: title, needsFee, candidates });
  }

  return {
    mandates,
    ...(args.baseline !== undefined ? { baseline: args.baseline } : {}),
  };
}

const BASELINE_QUESTIONS: Array<{
  key: keyof NonNullable<PendingSeeding['baseline']>;
  question: string;
}> = [
  {
    key: 'candidatesPerDay',
    question: 'כמה מועמדים חדשים עוברים אצלך ביום עבודה רגיל, בערך?',
  },
  {
    key: 'followUpLatencyDays',
    question: 'אחרי כמה ימים בלי מענה את בדרך כלל שולחת תזכורת למועמד?',
  },
  {
    key: 'activeMandateCount',
    question: 'כמה משרות פתוחות את מגייסת אליהן כרגע?',
  },
  {
    key: 'inFlightDealCount',
    question: 'כמה מועמדויות פעילות (בתהליך) יש כרגע בסך הכול, בכל המשרות?',
  },
];

/**
 * Shareable Hebrew plain-text form of the REMAINING seeding questions —
 * for Revital to answer async over WhatsApp/email instead of a meeting
 * (D-042). Pure; deterministic; BiDi-safe (no direction-control chars);
 * carries NO money figures (nothing is calibrated yet — there are none).
 * Returns '' when nothing is pending.
 */
export function asyncSeedingFormText(pending: PendingSeeding): string {
  const lines: string[] = [];
  let n = 0;

  for (const m of pending.mandates) {
    const title = clean(m.jobTitle) || clean(m.jobId);
    if (m.needsFee) {
      n += 1;
      lines.push(`${n}. ${title} — עמלה:`);
      lines.push(
        '   מה גובה העמלה על המשרה? (אחוז מהשכר השנתי + הערכת שכר, או סכום קבוע בש"ח)',
      );
    }
    if (m.candidates.length > 0) {
      n += 1;
      lines.push(`${n}. ${title} — אישור שלבים:`);
      lines.push('   באיזה שלב נמצא כל מועמד בפועל?');
      for (const c of m.candidates) {
        lines.push(`   - ${clean(c.name)} (כרגע בלוח: ${c.stage})`);
      }
    }
  }

  if (pending.baseline) {
    for (const { key, question } of BASELINE_QUESTIONS) {
      if (pending.baseline[key] !== null) continue; // derived — never re-ask
      n += 1;
      lines.push(`${n}. ${question}`);
    }
  }

  if (n === 0) return '';

  const header = [
    'שאלון השלמת נתונים — לוח המשרות',
    '',
    'חסרים כמה פרטים כדי שהלוח יוכל להציג תחזית כספית אמינה.',
    'אפשר לענות כאן בהודעה חוזרת, לפי המספרים:',
    '',
  ];
  const footer = [
    '',
    'זהו. ברגע שהתשובות נקלטות, הלוח מתחיל לעבוד עם המספרים האמיתיים שלך.',
  ];
  return [...header, ...lines, ...footer].join('\n');
}
