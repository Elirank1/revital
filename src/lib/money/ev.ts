// ============================================================
// Revital V3 — dealEV / calibration / qualified pipeline (Wave 2)
//
// BINDING contract: docs/waves/wave2-contract.md §Fee/EV model,
// EXTENDED by wave3-tasks §Batch C-seed (D-042).
//
// CALIBRATION MODE (hard rule): a mandate shows ₪/EV ONLY when
//   the mandate is SEEDED (in-product seeding, `revital_v3_seeding`)
//   AND feeAmount(fee) != null  AND  ≥1 of its deals is past Screened.
// Otherwise NO ₪ is computable for it — every function here returns
// null for uncalibrated inputs, never 0 and never a guess.
//
// Qualified-pipeline headline = Σ EV over stages Submitted+ only;
// earlier stages surface only as a range footnote.
// ============================================================

import {
  PIPELINE_STAGES,
  type Deal,
  type DealStage,
  type PipelineStage,
} from '../../types/pipeline';
import { feeAmount, type MandateFee } from './mandateFee';
import {
  effectiveProbability,
  effectiveProbabilityRange,
  loadPriors,
  type ObservedStageStats,
  type StagePriors,
} from './priors';
import { currentSeeding, isSeeded, type SeedingState } from './seeding';

export type ObservedByStage = Partial<Record<PipelineStage, ObservedStageStats>>;

const SCREENED_IDX = PIPELINE_STAGES.indexOf('Screened');
const SUBMITTED_IDX = PIPELINE_STAGES.indexOf('Submitted');

/** Stages whose EV counts toward the qualified-pipeline headline. */
export const QUALIFIED_STAGES: readonly PipelineStage[] =
  PIPELINE_STAGES.slice(SUBMITTED_IDX);

/** Earlier stages — range-footnote territory, never headline ₪. */
export const EARLY_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.slice(
  0,
  SUBMITTED_IDX,
);

/** Strictly after Screened in the pipeline (Outreach..Paid). Bench/Rejected: no. */
export function isPastScreened(stage: DealStage): boolean {
  const idx = PIPELINE_STAGES.indexOf(stage as PipelineStage);
  return idx > SCREENED_IDX;
}

/**
 * Calibration predicate (contract, C-seed-extended): the mandate is
 * SEEDED (D-042) AND has a complete fee AND ≥1 live deal past Screened.
 * Tombstoned deals never calibrate a mandate.
 *
 * `seeding` defaults to the module registry (localStorage-backed, kept
 * in sync by the money store) so existing 3-arg callers — kanban money
 * helpers, Pit Boss — enforce the seeding gate without signature churn.
 * Unknown/absent seeding fails CLOSED: no ₪ for an unseeded mandate,
 * ever.
 */
export function mandateCalibrated(
  jobId: string,
  fee: MandateFee | null | undefined,
  deals: Deal[],
  seeding: SeedingState = currentSeeding(),
): boolean {
  if (!isSeeded(jobId, seeding)) return false;
  if (!fee || fee.jobId !== jobId) return false;
  if (feeAmount(fee) === null) return false;
  return deals.some(
    (d) => !d.deleted && d.jobId === jobId && isPastScreened(d.stage),
  );
}

/**
 * Expected value of one deal: feeAmount × effectiveProbability(stage).
 *
 *  - incomplete fee → null (calibration — never 0, never a guess);
 *  - tombstoned deal → null;
 *  - Rejected → 0 (truthful: the deal is dead, its EV is exactly zero);
 *  - Bench → null (parked; we have no probability model for the bench rail
 *    and refuse to invent one);
 *  - deal.probabilityOverride (finite, 0..1) wins over the stage probability.
 */
export function dealEV(
  deal: Deal,
  fee: MandateFee | null | undefined,
  priors: StagePriors = loadPriors(),
  observed?: ObservedByStage,
): number | null {
  const amount = feeAmount(fee);
  if (amount === null) return null;
  if (deal.deleted) return null;
  if (deal.stage === 'Rejected') return 0;
  if (deal.stage === 'Bench') return null;

  const stage = deal.stage as PipelineStage;
  const p =
    typeof deal.probabilityOverride === 'number' &&
    Number.isFinite(deal.probabilityOverride) &&
    deal.probabilityOverride >= 0 &&
    deal.probabilityOverride <= 1
      ? deal.probabilityOverride
      : effectiveProbability(stage, observed?.[stage] ?? null, priors);
  return amount * p;
}

export interface QualifiedPipelineResult {
  /**
   * Σ EV over Submitted+ deals of CALIBRATED mandates.
   * null ⇔ no calibrated mandate exists (nothing may be shown);
   * 0 is returned only when calibrated mandates exist but none has a
   * Submitted+ deal — a truthful zero, not a placeholder.
   */
  qualifiedEV: number | null;
  qualifiedDealCount: number;
  /**
   * Range footnote over earlier stages (Sourced..InConversation) of
   * calibrated mandates: Σ fee×prior.lo .. Σ fee×prior.hi (a blended stage
   * collapses its contribution to a point). null when no such deals.
   */
  earlyRange: { lo: number; hi: number } | null;
  earlyDealCount: number;
  calibratedJobIds: string[];
  /** Mandates present on the board with NO ₪ permitted anywhere. */
  uncalibratedJobIds: string[];
}

/**
 * The header money block's data source. Calibration is enforced HERE, not
 * only in the UI: uncalibrated mandates contribute nothing to any figure.
 */
export function qualifiedPipeline(
  deals: Deal[],
  fees: Record<string, MandateFee>,
  priors: StagePriors = loadPriors(),
  observed?: ObservedByStage,
  seeding: SeedingState = currentSeeding(),
): QualifiedPipelineResult {
  const live = deals.filter((d) => !d.deleted);
  const jobIds = Array.from(new Set(live.map((d) => d.jobId)));

  const calibratedJobIds: string[] = [];
  const uncalibratedJobIds: string[] = [];
  for (const jobId of jobIds) {
    if (mandateCalibrated(jobId, fees[jobId] ?? null, live, seeding)) {
      calibratedJobIds.push(jobId);
    } else {
      uncalibratedJobIds.push(jobId);
    }
  }
  const calibrated = new Set(calibratedJobIds);

  let qualifiedEV: number | null = calibratedJobIds.length > 0 ? 0 : null;
  let qualifiedDealCount = 0;
  let earlyLo = 0;
  let earlyHi = 0;
  let earlyDealCount = 0;

  const qualifiedSet = new Set<DealStage>(QUALIFIED_STAGES);
  const earlySet = new Set<DealStage>(EARLY_STAGES);

  for (const deal of live) {
    if (!calibrated.has(deal.jobId)) continue; // no ₪ for uncalibrated, ever
    const fee = fees[deal.jobId];

    if (qualifiedSet.has(deal.stage)) {
      const ev = dealEV(deal, fee, priors, observed);
      if (ev !== null) {
        qualifiedEV = (qualifiedEV ?? 0) + ev;
        qualifiedDealCount += 1;
      }
    } else if (earlySet.has(deal.stage)) {
      const amount = feeAmount(fee);
      if (amount === null) continue; // unreachable for calibrated, belt+braces
      const stage = deal.stage as PipelineStage;
      const hasOverride =
        typeof deal.probabilityOverride === 'number' &&
        Number.isFinite(deal.probabilityOverride) &&
        deal.probabilityOverride >= 0 &&
        deal.probabilityOverride <= 1;
      const range = hasOverride
        ? {
            lo: deal.probabilityOverride as number,
            hi: deal.probabilityOverride as number,
          }
        : effectiveProbabilityRange(stage, observed?.[stage] ?? null, priors);
      earlyLo += amount * range.lo;
      earlyHi += amount * range.hi;
      earlyDealCount += 1;
    }
    // Bench / Rejected deals of calibrated mandates contribute nothing here.
  }

  return {
    qualifiedEV,
    qualifiedDealCount,
    earlyRange: earlyDealCount > 0 ? { lo: earlyLo, hi: earlyHi } : null,
    earlyDealCount,
    calibratedJobIds,
    uncalibratedJobIds,
  };
}
