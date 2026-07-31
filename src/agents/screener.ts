// ============================================================
// Revital V3 — Screener agent (Wave 1, agents-engine)
//
// Client-side, event-driven (plan §3): scores land as cards, words land
// as Suggestions. The Screener's ONLY Act power is creating a Person
// (deduped via the store's addPerson) plus a Deal in **Screened**, through
// the sanctioned client store path — audit-attributed actor:'ai',
// agent:'screener'. Flag explanations become Suggestions (kind 'flag').
//
// Hard rails honored here:
//   - never moves or edits existing cards/persons — creation only;
//   - reads legacy analyses via the injected appStore getState()/subscribe
//     ONLY (never mutates the legacy store);
//   - idempotent: deterministic ids (p_scr_/d_scr_) + already-carded check
//     that is a superset of backfill's (src/lib/backfill.ts uses
//     p_bf_<candidateId>/d_bf_<analysisId> and links deals via analysisId),
//     so the same analysis can never double-card across either path;
//   - flag-gated: no-op while revital_v3_flag is off (store never touched);
//   - no send path: the Screener emits store records, nothing else.
// ============================================================

import type { CandidateAnalysis } from '../types';
import type { Deal, Person, Suggestion } from '../types/pipeline';
import {
  usePipelineStore,
  type AddPersonResult,
  type DealInput,
  type PersonInput,
  type SuggestionInput,
} from '../store/pipelineStore';
import { backfillDealId, backfillPersonId } from '../lib/backfill';
import { sanitizeMessageText } from '../lib/outreach';

export const SCREENER_AGENT = 'screener' as const;

// ------------------------------------------------------------
// Deterministic ids — re-running the Screener can never duplicate.
// Distinct prefixes from backfill (p_bf_/d_bf_) keep provenance readable;
// dedupe against backfill cards happens in analysisAlreadyCarded below.
// ------------------------------------------------------------

export function screenerPersonId(candidateId: string): string {
  return `p_scr_${candidateId}`;
}

export function screenerDealId(analysisId: string): string {
  return `d_scr_${analysisId}`;
}

export function screenerFlagSuggestionId(analysisId: string): string {
  return `s_scr_flags_${analysisId}`;
}

// ------------------------------------------------------------
// Structural store contracts (satisfied by useAppStore / usePipelineStore;
// injectable for tests — the Screener never imports the legacy store).
// ------------------------------------------------------------

export interface LegacyAnalysesState {
  analyses: CandidateAnalysis[];
}

/** Read-only view of the legacy app store. The Screener NEVER mutates it. */
export interface LegacyAnalysesStore {
  getState(): LegacyAnalysesState;
  subscribe(
    listener: (state: LegacyAnalysesState, prevState: LegacyAnalysesState) => void,
  ): () => void;
}

export interface ScreenerPipelineState {
  v3Enabled: boolean;
  persons: Person[];
  deals: Deal[];
  addPerson(input: PersonInput): AddPersonResult;
  addDeal(input: DealInput): Deal;
  addSuggestion(input: SuggestionInput): Suggestion;
}

export interface ScreenerPipelineStore {
  getState(): ScreenerPipelineState;
}

// ------------------------------------------------------------
// Run result
// ------------------------------------------------------------

export interface ScreenerSkip {
  analysisId: string;
  reason: 'already_carded' | 'missing_fields';
}

export interface ScreenerCardedItem {
  analysisId: string;
  personId: string;
  dealId: string;
  /** 'create' = new Person; 'attach' = existing Person reused (deterministic
   *  id or exact contact dedupe); 'flag' = name-only collision → new Person
   *  plus a store-filed 'merge_person' Suggestion (never auto-merged, D-014). */
  personAction: 'create' | 'attach' | 'flag';
  /** Present when the analysis carried red flags → 'flag' Suggestion filed. */
  flagSuggestionId?: string;
}

export interface ScreenerRunResult {
  ran: boolean;
  reason?: 'flag_off';
  /** Analyses examined this run (carded + skipped). */
  processed: number;
  carded: ScreenerCardedItem[];
  skipped: ScreenerSkip[];
}

// ------------------------------------------------------------
// Carded check — MUST stay a superset of backfill's alreadyCarded so the
// same analysis never double-cards regardless of which path ran first:
//   - deal.analysisId link (both paths set it on every card they create);
//   - this agent's deterministic deal id;
//   - backfill's deterministic deal id (belt-and-braces).
// Tombstoned deals count as carded — the Screener must never resurrect.
// ------------------------------------------------------------

export function analysisAlreadyCarded(
  deals: readonly Deal[],
  analysisId: string,
): boolean {
  return deals.some(
    (d) =>
      d.analysisId === analysisId ||
      d.id === screenerDealId(analysisId) ||
      d.id === backfillDealId(analysisId),
  );
}

// ------------------------------------------------------------
// Flag explanations (the Screener's Propose column, plan §3)
// ------------------------------------------------------------

interface ScreenerFlag {
  claim: string;
  severity: 'warning' | 'critical';
}

/** Collect every red flag the analysis carries — real fields only, no
 *  invented facts (grounded policy, D-017). */
function collectFlags(a: CandidateAnalysis): ScreenerFlag[] {
  const flags: ScreenerFlag[] = [];
  for (const f of a.autoRedFlags ?? []) {
    if (f?.description) {
      flags.push({ claim: f.description, severity: f.severity ?? 'warning' });
    }
  }
  for (const text of a.redFlags ?? []) {
    if (text) flags.push({ claim: text, severity: 'warning' });
  }
  if (a.verdict === 'Reject') {
    flags.push({
      claim: `פסק הדין של הניתוח: Reject (ציון התאמה ${a.matchScore})`,
      severity: 'critical',
    });
  }
  return flags;
}

/** Hebrew flag-explanation Suggestion. Interpolated user content is passed
 *  through sanitizeMessageText (strips BiDi override/embed/isolate controls —
 *  D-017 policy); rendering direction is the UI's dir="auto" job. */
function buildFlagSuggestion(
  a: CandidateAnalysis,
  dealId: string,
  personId: string,
  flags: ScreenerFlag[],
): SuggestionInput {
  const name = sanitizeMessageText(a.candidateName);
  const jobTitle = sanitizeMessageText(a.jobTitle);
  const lines = flags.map(
    (f) =>
      `• ${sanitizeMessageText(f.claim)}${f.severity === 'critical' ? ' (חמור)' : ''}`,
  );
  const body = [
    `ה-Screener יצר כרטיס עבור ${name} במשרת "${jobTitle}" (ציון התאמה: ${a.matchScore}, פסק דין: ${a.verdict}).`,
    'דגלים שדורשים את תשומת לבך:',
    ...lines,
    'הכרטיס נוצר בעמודת Screened. הדגלים אינם משנים את מצב הכרטיס — ההחלטה אצלך.',
  ].join('\n');

  return {
    id: screenerFlagSuggestionId(a.id),
    agent: SCREENER_AGENT,
    kind: 'flag',
    dealId,
    personId,
    title: `דגלים לבדיקה: ${name} · ${jobTitle}`,
    body,
    evidence: [
      {
        claim: `ציון התאמה ${a.matchScore}, פסק דין ${a.verdict}`,
        sourceType: 'analysis',
        sourceId: a.id,
      },
      ...flags.map((f) => ({
        claim: sanitizeMessageText(f.claim),
        sourceType: 'analysis',
        sourceId: a.id,
      })),
    ],
  };
}

// ------------------------------------------------------------
// runScreener — the whole Act surface
// ------------------------------------------------------------

/**
 * Idempotently ensure Person + Deal-in-Screened for each analysis not yet
 * carded. Safe to call with the same analyses any number of times, before or
 * after backfill, in any interleaving — deterministic ids plus the
 * analysisAlreadyCarded superset check guarantee zero duplicates.
 *
 * Flag-gated: while the v3 flag is off this returns { ran: false } without
 * touching the store.
 */
export function runScreener(
  analyses: readonly CandidateAnalysis[],
  pipelineStore: ScreenerPipelineStore = usePipelineStore,
): ScreenerRunResult {
  if (!pipelineStore.getState().v3Enabled) {
    return { ran: false, reason: 'flag_off', processed: 0, carded: [], skipped: [] };
  }

  const carded: ScreenerCardedItem[] = [];
  const skipped: ScreenerSkip[] = [];

  for (const a of analyses) {
    // Stricter than backfill's id+name guard: the Screener runs unattended,
    // so a card it creates must be renderable (job title/id present).
    if (!a?.id || !a.candidateName || !a.jobId || !a.jobTitle) {
      skipped.push({ analysisId: a?.id ?? '(no id)', reason: 'missing_fields' });
      continue;
    }

    // Re-read state every iteration — earlier iterations mutate it, which is
    // also what makes a duplicated analysis id inside one batch card once.
    const s = pipelineStore.getState();
    if (analysisAlreadyCarded(s.deals, a.id)) {
      skipped.push({ analysisId: a.id, reason: 'already_carded' });
      continue;
    }

    // ---- Person resolution ------------------------------------------
    // Same legacy candidateId ⇒ same Person, definitionally (D-021). The
    // deterministic id IS the cross-run map: a live person carded earlier by
    // the Screener or by backfill is reused directly, because name-only
    // re-adds would otherwise create a duplicate + merge flag (exact dedupe
    // needs a phone/email hit that legacy analyses don't carry).
    const candidateKey = a.candidateId || a.id;
    const wantId = screenerPersonId(candidateKey);
    const byDeterministicId = s.persons.find(
      (p) =>
        (p.id === wantId || p.id === backfillPersonId(candidateKey)) && !p.deleted,
    );

    let personId: string;
    let personAction: ScreenerCardedItem['personAction'];
    if (byDeterministicId) {
      personId = byDeterministicId.id;
      personAction = 'attach';
    } else {
      // Never reuse an id already present (even tombstoned — no resurrection,
      // no two records under one id): fall back to a store-generated id.
      const idTaken = s.persons.some((p) => p.id === wantId);
      const result = s.addPerson({
        ...(idTaken ? {} : { id: wantId }),
        name: a.candidateName,
        analysisIds: [a.id],
        actor: 'ai',
        agent: SCREENER_AGENT,
      });
      personId = result.person.id;
      personAction = !result.duplicateOf
        ? 'create'
        : result.person.id === result.duplicateOf.id
          ? 'attach' // exact dedupe hit — store attached additively
          : 'flag'; // name-only collision — store filed merge_person (D-014)
    }

    // ---- Deal in Screened (the ONLY stage the Screener may card into) ----
    const deal = pipelineStore.getState().addDeal({
      id: screenerDealId(a.id),
      personId,
      jobId: a.jobId,
      jobTitle: a.jobTitle,
      stage: 'Screened',
      analysisId: a.id,
      actor: 'ai',
      agent: SCREENER_AGENT,
    });

    // ---- Flag explanations → Suggestion (Propose, never Act) ----
    const flags = collectFlags(a);
    let flagSuggestionId: string | undefined;
    if (flags.length > 0) {
      flagSuggestionId = pipelineStore
        .getState()
        .addSuggestion(buildFlagSuggestion(a, deal.id, personId, flags)).id;
    }

    carded.push({
      analysisId: a.id,
      personId,
      dealId: deal.id,
      personAction,
      ...(flagSuggestionId ? { flagSuggestionId } : {}),
    });
  }

  return { ran: true, processed: analyses.length, carded, skipped };
}

// ------------------------------------------------------------
// attachScreener — event-driven subscription (the lead wires this)
// ------------------------------------------------------------

export interface AttachScreenerOptions {
  /**
   * Also card analyses that already exist at attach time. Default FALSE:
   * historical analyses are backfill's territory, which is dry-run-first and
   * confirm-gated (plan §2) — the Screener must not become a silent backfill
   * at app boot. Event-driven means: analyses added AFTER attach.
   */
  processExisting?: boolean;
}

/**
 * Subscribe the Screener to the legacy app store. Read-only on appStore:
 * getState()/subscribe() only, never setState.
 *
 * - Analyses present at attach form the seen-baseline (not carded unless
 *   opts.processExisting).
 * - Analyses appearing later are carded as they arrive (CV analyzed on this
 *   device, or synced in from the cloud while the app is open).
 * - Runs gated by the v3 flag are retried on the next analyses change —
 *   nothing is lost while the flag is off (idempotency makes retries free).
 *
 * Returns a detach function.
 */
export function attachScreener(
  appStore: LegacyAnalysesStore,
  pipelineStore: ScreenerPipelineStore = usePipelineStore,
  opts: AttachScreenerOptions = {},
): () => void {
  const seen = new Set<string>();
  /** Ids awaiting a successful (non-flag-gated) run. */
  const pending = new Set<string>();

  const initial = appStore.getState().analyses;
  for (const a of initial) {
    if (!a?.id) continue;
    seen.add(a.id);
    if (opts.processExisting) pending.add(a.id);
  }

  const drain = (analyses: readonly CandidateAnalysis[]): void => {
    if (pending.size === 0) return;
    const batch = analyses.filter((a) => a?.id && pending.has(a.id));
    const result = runScreener(batch, pipelineStore);
    // Flag off ⇒ keep pending for the next event; otherwise the batch is
    // done (already-carded skips included — those need no retry).
    if (result.ran) pending.clear();
  };

  if (opts.processExisting) drain(initial);

  return appStore.subscribe((state) => {
    for (const a of state.analyses) {
      if (a?.id && !seen.has(a.id)) {
        seen.add(a.id);
        pending.add(a.id);
      }
    }
    drain(state.analyses);
  });
}
