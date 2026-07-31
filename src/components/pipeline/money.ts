/**
 * Money display helpers — Wave 2 (kanban-ui).
 *
 * Pure COMPOSITION of the platform-data money lib (`src/lib/money`) into
 * display-ready shapes for the board surfaces. No probability or fee math
 * is reimplemented here: every number flows through `feeAmount` /
 * `effectiveProbabilityRange` / `dealEV`, and a unit test pins the range
 * midpoint to `dealEV` for every guard case so the two can never drift.
 *
 * CALIBRATION HARD RULE (wave2-contract §Fee/EV): an uncalibrated mandate
 * shows NO ₪ anywhere. Every helper here returns `null` for "nothing may
 * be rendered" — callers render nothing (not 0, not a placeholder amount).
 */

import type { Deal, PipelineStage } from '../../types/pipeline';
import {
  effectiveProbabilityRange,
  feeAmount,
  mandateCalibrated,
  type MandateFee,
  type ObservedByStage,
  type StagePriors,
} from '../../lib/money';

// ------------------------------------------------------------
// Formatting
// ------------------------------------------------------------

/** ₪ with thousands separators, rounded to whole shekels. Render inside dir="ltr". */
export function formatILS(amount: number): string {
  return `₪${Math.round(amount).toLocaleString('en-US')}`;
}

export interface EvRange {
  lo: number;
  hi: number;
}

/** "₪lo–₪hi", collapsing to a single "₪x" when the rounded bounds agree. */
export function formatEvRange(range: EvRange): string {
  const lo = Math.round(range.lo);
  const hi = Math.round(range.hi);
  return lo === hi ? formatILS(lo) : `${formatILS(lo)}–${formatILS(hi)}`;
}

// ------------------------------------------------------------
// Per-deal EV as a RANGE (contract: display as a range until blended)
// ------------------------------------------------------------

/**
 * EV range for one deal: feeAmount × effectiveProbabilityRange(stage).
 * Guard order mirrors `dealEV` exactly (parity unit-tested):
 *  - incomplete fee → null; tombstone → null; Bench → null;
 *  - Rejected → {0,0} (truthfully dead — dealEV returns 0);
 *  - valid probabilityOverride → point range;
 *  - blended stage → the range collapses to the blended point (lib behavior).
 *
 * Callers MUST additionally gate on mandate calibration — use
 * `calibratedJobIds` or `mandateCalibrated`; `evRangeForCalibratedDeal`
 * bakes the gate in.
 */
export function evRangeForDeal(
  deal: Deal,
  fee: MandateFee | null | undefined,
  priors: StagePriors,
  observed?: ObservedByStage,
): EvRange | null {
  const amount = feeAmount(fee);
  if (amount === null) return null;
  if (deal.deleted) return null;
  if (deal.stage === 'Rejected') return { lo: 0, hi: 0 };
  if (deal.stage === 'Bench') return null;

  const o = deal.probabilityOverride;
  if (typeof o === 'number' && Number.isFinite(o) && o >= 0 && o <= 1) {
    return { lo: amount * o, hi: amount * o };
  }
  const stage = deal.stage as PipelineStage;
  const range = effectiveProbabilityRange(stage, observed?.[stage] ?? null, priors);
  return { lo: amount * range.lo, hi: amount * range.hi };
}

/** evRangeForDeal with the calibration gate baked in (belt + braces). */
export function evRangeForCalibratedDeal(
  deal: Deal,
  calibrated: ReadonlySet<string>,
  fees: Record<string, MandateFee>,
  priors: StagePriors,
  observed?: ObservedByStage,
): EvRange | null {
  if (!calibrated.has(deal.jobId)) return null;
  return evRangeForDeal(deal, fees[deal.jobId] ?? null, priors, observed);
}

/**
 * Σ EV range over a column's deals — CALIBRATED mandates only.
 * null ⇔ no calibrated deal contributed ⇒ the column keeps its "ΣEV —"
 * placeholder (never a fake figure, never 0-for-empty).
 */
export function columnEvRange(
  deals: Deal[],
  calibrated: ReadonlySet<string>,
  fees: Record<string, MandateFee>,
  priors: StagePriors,
  observed?: ObservedByStage,
): EvRange | null {
  let lo = 0;
  let hi = 0;
  let contributed = 0;
  for (const deal of deals) {
    const r = evRangeForCalibratedDeal(deal, calibrated, fees, priors, observed);
    if (r === null) continue;
    lo += r.lo;
    hi += r.hi;
    contributed += 1;
  }
  return contributed > 0 ? { lo, hi } : null;
}

/** Calibrated jobIds present among the given deals (live deals only). */
export function calibratedJobIdSet(
  deals: Deal[],
  fees: Record<string, MandateFee>,
): Set<string> {
  const live = deals.filter((d) => !d.deleted);
  const set = new Set<string>();
  for (const d of live) {
    if (set.has(d.jobId)) continue;
    if (mandateCalibrated(d.jobId, fees[d.jobId] ?? null, live)) set.add(d.jobId);
  }
  return set;
}

// ------------------------------------------------------------
// Expected this month (invoice-dated, never a probability guess)
// ------------------------------------------------------------

export interface ExpectedThisMonth {
  total: number;
  invoiceCount: number;
}

/**
 * Σ feeAmount over CALIBRATED mandates whose invoice is outstanding
 * ('due' | 'sent') and dated (invoiceDueAt) inside the current calendar
 * month. Deliberately invoice-based: no invented close-timing math.
 * null ⇔ no such dated invoice exists — render "no dated invoices",
 * never ₪0 (an undated pipeline is unmeasured, not worthless).
 */
export function expectedThisMonth(
  fees: Record<string, MandateFee>,
  calibratedJobIds: readonly string[],
  now: number,
): ExpectedThisMonth | null {
  const d = new Date(now);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  let total = 0;
  let invoiceCount = 0;
  for (const jobId of calibratedJobIds) {
    const fee = fees[jobId];
    if (!fee) continue;
    const amount = feeAmount(fee);
    if (amount === null) continue;
    if (fee.invoiceStatus !== 'due' && fee.invoiceStatus !== 'sent') continue;
    if (!fee.invoiceDueAt || fee.invoiceDueAt.slice(0, 7) !== month) continue;
    total += amount;
    invoiceCount += 1;
  }
  return invoiceCount > 0 ? { total, invoiceCount } : null;
}
