// ============================================================
// Revital V3 — Backfill: legacy analyses → Person + Deal (Wave 1)
//
// Plan §2: backfill can only place cards in **Screened** — her real
// pipeline lives in her head/WhatsApp and is seeded by hand.
//
// Safety (Wave-0 criteria (e)/(f)):
//   - dry-run FIRST: backfillDryRun() reports, never mutates;
//   - apply is flag-gated (revital_v3_flag on) AND requires an explicit
//     { confirm: true } argument;
//   - apply takes an automatic backup of the v3 collections before touching
//     anything (localStorage key revital_v3_backfill_backup);
//   - rollback = flag off, nothing else. Legacy data is only READ.
// ============================================================

import type { CandidateAnalysis } from '../types';
import type { Deal, Person } from '../types/pipeline';
import { usePipelineStore } from '../store/pipelineStore';
import { findDuplicatePerson, normalizeName } from './persistence/dedupe';
import { V3_KEYS, isV3Enabled, loadV3, saveV3 } from './persistence/keys';

/** Deterministic ids — re-running backfill can never duplicate. */
export function backfillPersonId(candidateId: string): string {
  return `p_bf_${candidateId}`;
}
export function backfillDealId(analysisId: string): string {
  return `d_bf_${analysisId}`;
}

export const BACKFILL_BACKUP_KEY = 'revital_v3_backfill_backup';

export interface BackfillItemPlan {
  analysisId: string;
  candidateName: string;
  jobTitle: string;
  /** 'create' = new Person; 'attach' = exact dedupe hit on an existing Person;
   *  'flag' = name-only collision → create + merge_person Suggestion. */
  personAction: 'create' | 'attach' | 'flag';
  existingPersonId?: string;
}

export interface BackfillSkip {
  analysisId: string;
  reason: 'already_carded' | 'missing_fields';
}

export interface BackfillReport {
  totalAnalyses: number;
  wouldCreatePersons: number;
  wouldAttachPersons: number;
  /** Name-only collisions: person still created, merge Suggestion filed. */
  wouldFlagMergePersons: number;
  wouldCreateDeals: number;
  skipped: BackfillSkip[];
  items: BackfillItemPlan[];
}

export interface BackfillApplyResult {
  applied: boolean;
  reason?: 'flag_off' | 'not_confirmed';
  report: BackfillReport;
  createdPersonIds: string[];
  createdDealIds: string[];
}

function alreadyCarded(deals: Deal[], analysis: CandidateAnalysis): boolean {
  // Tombstoned cards count as carded — backfill must never resurrect.
  return deals.some(
    (d) => d.id === backfillDealId(analysis.id) || d.analysisId === analysis.id,
  );
}

/**
 * Plan the backfill without mutating anything. Persons are simulated with the
 * same dedupe used by the store, over live persons + persons planned earlier
 * in this run (grouped by legacy candidateId).
 */
export function backfillDryRun(
  analyses: CandidateAnalysis[],
  state: { persons: Person[]; deals: Deal[] } = usePipelineStore.getState(),
): BackfillReport {
  const report: BackfillReport = {
    totalAnalyses: analyses.length,
    wouldCreatePersons: 0,
    wouldAttachPersons: 0,
    wouldFlagMergePersons: 0,
    wouldCreateDeals: 0,
    skipped: [],
    items: [],
  };

  // Simulated persons: existing live ones + ones this run would create.
  const simulated: Person[] = state.persons.filter((p) => !p.deleted);
  const plannedByCandidate = new Map<string, string>(); // candidateId → simulated person id

  for (const a of analyses) {
    if (!a?.id || !a.candidateName) {
      report.skipped.push({ analysisId: a?.id ?? '(no id)', reason: 'missing_fields' });
      continue;
    }
    if (alreadyCarded(state.deals, a)) {
      report.skipped.push({ analysisId: a.id, reason: 'already_carded' });
      continue;
    }

    let personAction: BackfillItemPlan['personAction'];
    let existingPersonId: string | undefined;

    const plannedId = plannedByCandidate.get(a.candidateId);
    if (plannedId) {
      // Same legacy candidate already planned in this run → same Person.
      personAction = 'attach';
      existingPersonId = plannedId;
    } else {
      const match = findDuplicatePerson(simulated, { name: a.candidateName });
      if (match?.kind === 'exact') {
        personAction = 'attach';
        existingPersonId = match.person.id;
        plannedByCandidate.set(a.candidateId, match.person.id);
        report.wouldAttachPersons += 1;
      } else {
        personAction = match?.kind === 'name_only' ? 'flag' : 'create';
        if (match?.kind === 'name_only') {
          existingPersonId = match.person.id;
          report.wouldFlagMergePersons += 1;
        }
        report.wouldCreatePersons += 1;
        const newId = backfillPersonId(a.candidateId || a.id);
        plannedByCandidate.set(a.candidateId, newId);
        simulated.push({
          id: newId,
          v: 0,
          updatedAt: a.timestamp,
          name: a.candidateName,
          normalizedName: '', // findDuplicatePerson only reads normalizedName
          analysisIds: [a.id],
          contactEvents: [],
        } as Person);
        // Keep simulated dedupe faithful: recompute via the same normalizer.
        simulated[simulated.length - 1].normalizedName =
          simulatedNormalizedName(a.candidateName);
      }
    }

    report.wouldCreateDeals += 1;
    report.items.push({
      analysisId: a.id,
      candidateName: a.candidateName,
      jobTitle: a.jobTitle,
      personAction,
      ...(existingPersonId ? { existingPersonId } : {}),
    });
  }

  return report;
}

function simulatedNormalizedName(name: string): string {
  return normalizeName(name);
}

/**
 * Apply the backfill through the store contract (addPerson dedupe + addDeal),
 * cards in **Screened only**. Runs ONLY when the v3 flag is on AND
 * `{ confirm: true }` is passed; otherwise returns the dry-run report
 * untouched. Takes an automatic backup of all v3 collections first.
 */
export function backfillApply(
  analyses: CandidateAnalysis[],
  opts?: { confirm?: boolean },
): BackfillApplyResult {
  const report = backfillDryRun(analyses);
  if (!isV3Enabled()) {
    return { applied: false, reason: 'flag_off', report, createdPersonIds: [], createdDealIds: [] };
  }
  if (opts?.confirm !== true) {
    return { applied: false, reason: 'not_confirmed', report, createdPersonIds: [], createdDealIds: [] };
  }

  // Automatic backup before any mutation (criterion (e)). Latest-run backup
  // only — rollback remains "flag off", this is a belt-and-braces snapshot.
  saveV3(BACKFILL_BACKUP_KEY, {
    takenAt: new Date().toISOString(),
    persons: loadV3(V3_KEYS.persons, []),
    deals: loadV3(V3_KEYS.deals, []),
    events: loadV3(V3_KEYS.events, []),
    suggestions: loadV3(V3_KEYS.suggestions, []),
    audit: loadV3(V3_KEYS.audit, []),
  });

  const store = usePipelineStore.getState();
  const createdPersonIds: string[] = [];
  const createdDealIds: string[] = [];
  const personIdByCandidate = new Map<string, string>();
  const plannedAnalyses = new Set(report.items.map((i) => i.analysisId));

  for (const a of analyses) {
    if (!plannedAnalyses.has(a?.id)) continue; // skipped by the plan

    let personId = personIdByCandidate.get(a.candidateId);
    if (!personId) {
      const { person, duplicateOf } = usePipelineStore.getState().addPerson({
        id: backfillPersonId(a.candidateId || a.id),
        name: a.candidateName,
        analysisIds: [a.id],
      });
      personId = person.id;
      personIdByCandidate.set(a.candidateId, personId);
      if (!duplicateOf || person.id !== duplicateOf.id) {
        createdPersonIds.push(person.id);
      }
    }

    const deal = store.addDeal({
      id: backfillDealId(a.id),
      personId,
      jobId: a.jobId,
      jobTitle: a.jobTitle,
      stage: 'Screened', // plan §2 — backfill places cards in Screened ONLY
      analysisId: a.id,
    });
    createdDealIds.push(deal.id);
  }

  return { applied: true, report, createdPersonIds, createdDealIds };
}
