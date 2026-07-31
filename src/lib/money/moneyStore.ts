// ============================================================
// Revital V3 — Money store slice (Wave 2, platform-data)
//
// Zustand slice for MandateFee (persisted `revital_v3_fees`) and the
// editable stage priors (persisted `revital_v3_priors`). Additive:
// touches ONLY revital_v3_* keys; legacy behavior byte-identical.
//
// Fee/prior edits are money-critical → every mutation writes an audit
// entry through the pipeline store's append-only audit log.
// Fees are LOCAL state in Wave 2 (not part of PipelineSyncPayload —
// lead-owned type); history reaches Supabase via the flag-gated
// agent-store importer's fee ledger.
// ============================================================

import { create } from 'zustand';
import type { PipelineStage } from '../../types/pipeline';
import { loadV3, saveV3 } from '../persistence/keys';
import { usePipelineStore } from '../../store/pipelineStore';
import {
  feeAmount,
  type MandateFee,
  type MandateFeeKind,
  type MandateInvoiceStatus,
} from './mandateFee';
import {
  DEFAULT_STAGE_PRIORS,
  PRIORS_KEY,
  loadPriors,
  observedStageStats,
  sanitizePriors,
  savePriors,
  type StagePriorRange,
  type StagePriors,
} from './priors';
import {
  mandateCalibrated,
  qualifiedPipeline,
  type QualifiedPipelineResult,
} from './ev';

export const MONEY_KEYS = {
  fees: 'revital_v3_fees',
  priors: PRIORS_KEY,
} as const;

export interface MandateFeeInput {
  jobId: string;
  kind: MandateFeeKind;
  percent?: number;
  expectedSalary?: number;
  fixedAmount?: number;
  /** Defaults to 0 (no guarantee) — never invents a guarantee period. */
  guaranteeDays?: number;
  invoiceStatus?: MandateInvoiceStatus;
  invoiceDueAt?: string;
}

export interface MoneyState {
  fees: Record<string, MandateFee>;
  priors: StagePriors;

  /** Upsert the mandate's fee. Stamps updatedAt; audits before/after. */
  setFee: (input: MandateFeeInput) => MandateFee;
  /** Remove the mandate's fee (mandate returns to uncalibrated). Audited. */
  clearFee: (jobId: string) => void;

  /** Edit one stage's prior range (validated/clamped via sanitize). Audited. */
  setStagePrior: (stage: PipelineStage, range: StagePriorRange) => void;
  /** Restore DEFAULT_STAGE_PRIORS. Audited. */
  resetPriors: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useMoneyStore = create<MoneyState>((set, get) => ({
  fees: loadV3<Record<string, MandateFee>>(MONEY_KEYS.fees, {}),
  priors: loadPriors(),

  setFee: (input) => {
    const prev = get().fees[input.jobId] ?? null;
    const next: MandateFee = {
      jobId: input.jobId,
      kind: input.kind,
      ...(input.percent !== undefined ? { percent: input.percent } : {}),
      ...(input.expectedSalary !== undefined
        ? { expectedSalary: input.expectedSalary }
        : {}),
      ...(input.fixedAmount !== undefined
        ? { fixedAmount: input.fixedAmount }
        : {}),
      currency: 'ILS',
      guaranteeDays: input.guaranteeDays ?? prev?.guaranteeDays ?? 0,
      invoiceStatus: input.invoiceStatus ?? prev?.invoiceStatus ?? 'none',
      ...(input.invoiceDueAt !== undefined
        ? { invoiceDueAt: input.invoiceDueAt }
        : prev?.invoiceDueAt !== undefined
          ? { invoiceDueAt: prev.invoiceDueAt }
          : {}),
      updatedAt: nowIso(),
    };
    const fees = { ...get().fees, [input.jobId]: next };
    saveV3(MONEY_KEYS.fees, fees);
    set({ fees });
    usePipelineStore.getState().appendAudit({
      actor: 'human',
      action: prev ? 'fee.update' : 'fee.set',
      before: prev,
      after: next,
      entityType: 'mandate',
      entityId: input.jobId,
    });
    return next;
  },

  clearFee: (jobId) => {
    const prev = get().fees[jobId];
    if (!prev) return;
    const fees = { ...get().fees };
    delete fees[jobId];
    saveV3(MONEY_KEYS.fees, fees);
    set({ fees });
    usePipelineStore.getState().appendAudit({
      actor: 'human',
      action: 'fee.clear',
      before: prev,
      after: null,
      entityType: 'mandate',
      entityId: jobId,
    });
  },

  setStagePrior: (stage, range) => {
    const before = get().priors;
    const priors = sanitizePriors({ ...before, [stage]: range });
    savePriors(priors);
    set({ priors });
    usePipelineStore.getState().appendAudit({
      actor: 'human',
      action: 'priors.set',
      before: { stage, range: before[stage] },
      after: { stage, range: priors[stage] },
      entityType: 'priors',
      entityId: stage,
    });
  },

  resetPriors: () => {
    const before = get().priors;
    const priors = sanitizePriors(DEFAULT_STAGE_PRIORS);
    savePriors(priors);
    set({ priors });
    usePipelineStore.getState().appendAudit({
      actor: 'human',
      action: 'priors.reset',
      before,
      after: priors,
      entityType: 'priors',
      entityId: 'all',
    });
  },
}));

// ------------------------------------------------------------
// Bound selectors — plain functions over getState() (store convention).
// Pure equivalents live in ev.ts / priors.ts for prop-driven callers.
// ------------------------------------------------------------

export function feeForJob(jobId: string): MandateFee | null {
  return useMoneyStore.getState().fees[jobId] ?? null;
}

/** feeAmount for a mandate — null when absent/incomplete (calibration). */
export function feeAmountForJob(jobId: string): number | null {
  return feeAmount(feeForJob(jobId));
}

/** Calibration predicate over live store state (contract: mandateCalibrated). */
export function isMandateCalibrated(jobId: string): boolean {
  const { deals } = usePipelineStore.getState();
  return mandateCalibrated(jobId, feeForJob(jobId), deals);
}

/**
 * Header money block snapshot: qualified Σ EV (Submitted+) + early-range
 * footnote, computed over live deals/events/fees/priors with observed
 * blending from the stage-event log.
 */
export function qualifiedPipelineSnapshot(): QualifiedPipelineResult {
  const { deals, stageEvents } = usePipelineStore.getState();
  const { fees, priors } = useMoneyStore.getState();
  return qualifiedPipeline(deals, fees, priors, observedStageStats(stageEvents));
}
