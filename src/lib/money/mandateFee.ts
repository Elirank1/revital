// ============================================================
// Revital V3 — MandateFee + feeAmount (Wave 2, platform-data)
//
// BINDING contract: docs/waves/wave2-contract.md §Fee/EV model.
// MandateFee is keyed by jobId (the mandate) and is the ONLY input to
// money math. The legacy per-deal `Deal.fee` (FeeTerms) is untouched and
// never consulted by EV computation.
//
// CALIBRATION HARD RULE: no ₪ value is ever computable for an
// incomplete fee — feeAmount returns null, never 0 or a guess.
// ============================================================

export type MandateFeeKind = 'percent' | 'fixed';

/** Invoice lifecycle per the Wave-2 contract (note: 'due', not 'pending'). */
export type MandateInvoiceStatus = 'none' | 'due' | 'sent' | 'paid';

export interface MandateFee {
  /** Legacy JobDescription.id — the mandate this fee belongs to. */
  jobId: string;
  kind: MandateFeeKind;
  /** Percent of expected annual salary (kind === 'percent'). */
  percent?: number;
  /** Expected annual salary in ILS — basis for percent fees. */
  expectedSalary?: number;
  /** Fixed fee in ILS (kind === 'fixed'). */
  fixedAmount?: number;
  currency: 'ILS';
  /** Guarantee period in days (timer runs on Placed/Paid). */
  guaranteeDays: number;
  invoiceStatus: MandateInvoiceStatus;
  /** ISO date the invoice is/was due, when known. */
  invoiceDueAt?: string;
  /** ISO timestamp of the last edit (display only — no merge semantics). */
  updatedAt: string;
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * The fee in ILS for a complete fee definition, or null.
 *
 *  - kind 'percent' → percent × expectedSalary / 100 (both must be > 0);
 *  - kind 'fixed'   → fixedAmount (must be > 0);
 *  - anything incomplete, non-finite, or non-positive → null.
 *
 * Null is the calibration signal — callers must render "no ₪", never 0.
 */
export function feeAmount(fee: MandateFee | null | undefined): number | null {
  if (!fee) return null;
  if (fee.kind === 'percent') {
    if (!isPositiveFinite(fee.percent) || !isPositiveFinite(fee.expectedSalary)) {
      return null;
    }
    return (fee.percent * fee.expectedSalary) / 100;
  }
  if (fee.kind === 'fixed') {
    return isPositiveFinite(fee.fixedAmount) ? fee.fixedAmount : null;
  }
  return null;
}
