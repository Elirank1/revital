// ============================================================
// Revital V3 — Money store slice (Waves 2–3, platform-data)
//
// Zustand slice for MandateFee (persisted `revital_v3_fees`), the
// editable stage priors (persisted `revital_v3_priors`) and — Wave-3
// C-seed (D-042) — per-mandate seeding state (persisted
// `revital_v3_seeding`, same pattern as fees). Additive: touches ONLY
// revital_v3_* keys; legacy behavior byte-identical.
//
// Fee/prior/seeding edits are money-critical → every mutation writes an
// audit entry through the pipeline store's append-only audit log.
// Fees + seeding are LOCAL state (not part of PipelineSyncPayload —
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
import {
  SEEDING_KEY,
  commitSeeding,
  currentSeeding,
  isSeeded,
  type MandateSeeding,
  type SeedingState,
} from './seeding';

export const MONEY_KEYS = {
  fees: 'revital_v3_fees',
  priors: PRIORS_KEY,
  seeding: SEEDING_KEY,
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
  /** Per-mandate seeding state (Wave-3 C-seed, D-042). */
  seeding: SeedingState;

  /** Upsert the mandate's fee. Stamps updatedAt; audits before/after. */
  setFee: (input: MandateFeeInput) => MandateFee;
  /** Remove the mandate's fee (mandate returns to uncalibrated). Audited. */
  clearFee: (jobId: string) => void;

  /**
   * Mark a mandate seeded (first-open wizard completed). Idempotent:
   * re-marking returns the existing entry with NO new audit entry and
   * NO seededAt re-stamp. First mark is audited ('seeding.mark').
   * Seeding is one-way — there is no unseed action (the wizard cannot
   * be un-completed; a data reset clears the revital_v3_* keys).
   */
  markMandateSeeded: (jobId: string) => MandateSeeding;

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
  seeding: currentSeeding(),

  markMandateSeeded: (jobId) => {
    const existing = get().seeding[jobId];
    if (existing) return existing; // idempotent — no re-stamp, no audit noise
    const entry: MandateSeeding = { jobId, seededAt: nowIso() };
    const seeding = { ...get().seeding, [jobId]: entry };
    commitSeeding(seeding); // registry + revital_v3_seeding
    set({ seeding });
    usePipelineStore.getState().appendAudit({
      actor: 'human',
      action: 'seeding.mark',
      before: null,
      after: entry,
      entityType: 'mandate',
      entityId: jobId,
    });
    return entry;
  },

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

/** Has the mandate been seeded? (live store state; contract selector). */
export function isMandateSeeded(jobId: string): boolean {
  return isSeeded(jobId, useMoneyStore.getState().seeding);
}

/**
 * Mandates present on the board (live deals) that are NOT yet seeded —
 * the first-open wizard's worklist. First-appearance order, deduped.
 */
export function unseededMandates(): string[] {
  const { deals } = usePipelineStore.getState();
  const { seeding } = useMoneyStore.getState();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of deals) {
    if (d.deleted || seen.has(d.jobId)) continue;
    seen.add(d.jobId);
    if (!isSeeded(d.jobId, seeding)) out.push(d.jobId);
  }
  return out;
}

/** Calibration predicate over live store state (contract: mandateCalibrated). */
export function isMandateCalibrated(jobId: string): boolean {
  const { deals } = usePipelineStore.getState();
  const { seeding } = useMoneyStore.getState();
  return mandateCalibrated(jobId, feeForJob(jobId), deals, seeding);
}

/**
 * Header money block snapshot: qualified Σ EV (Submitted+) + early-range
 * footnote, computed over live deals/events/fees/priors/seeding with
 * observed blending from the stage-event log.
 */
export function qualifiedPipelineSnapshot(): QualifiedPipelineResult {
  const { deals, stageEvents } = usePipelineStore.getState();
  const { fees, priors, seeding } = useMoneyStore.getState();
  return qualifiedPipeline(
    deals,
    fees,
    priors,
    observedStageStats(stageEvents),
    seeding,
  );
}
