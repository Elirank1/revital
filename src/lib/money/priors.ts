// ============================================================
// Revital V3 — Stage priors + effective probability (Wave 2, platform-data)
//
// BINDING contract: docs/waves/wave2-contract.md §Fee/EV model.
//  - DEFAULT_STAGE_PRIORS: editable {lo,hi} per pipeline stage, persisted
//    under `revital_v3_priors` (localStorage is already per-user/access-code).
//  - effectiveProbability(stage, observed) = midpoint of the prior range
//    UNLESS ≥ BLEND_MIN_OBSERVATIONS observed transitions for that stage,
//    then blend 50/50 with the observed rate.
//  - Display stays a RANGE until blended — effectiveProbabilityRange
//    exposes exactly that (blended ⇒ the range collapses to a point).
//
// Observed transitions come from StageEvents. A deal contributes an
// observation to stage S only if it actually ENTERED S (skip-events
// exclude skipped intervals by construction: skipped stages never appear
// as an event's `to`) AND the deal is RESOLVED — reached Paid (success)
// or sits in Rejected (failure). In-flight and Bench deals are censored,
// never counted: unfinished journeys must not fake a conversion rate.
// ============================================================

import {
  PIPELINE_STAGES,
  type PipelineStage,
  type StageEvent,
} from '../../types/pipeline';
import { loadV3, saveV3 } from '../persistence/keys';

export interface StagePriorRange {
  /** Lower bound, probability of eventually reaching Paid (0..1). */
  lo: number;
  /** Upper bound (0..1, lo ≤ hi). */
  hi: number;
}

export type StagePriors = Record<PipelineStage, StagePriorRange>;

/** localStorage key for edited priors (contract: `revital_v3_priors`). */
export const PRIORS_KEY = 'revital_v3_priors';

/** Blend threshold: ≥ this many observed transitions for a stage. */
export const BLEND_MIN_OBSERVATIONS = 10;

/**
 * Editable defaults — probability that a deal sitting in the stage
 * eventually reaches Paid. Deliberately conservative; the seeding session
 * with Revital replaces these with her numbers (stored, not hardcoded).
 */
export const DEFAULT_STAGE_PRIORS: StagePriors = {
  Sourced: { lo: 0.02, hi: 0.05 },
  Screened: { lo: 0.04, hi: 0.08 },
  Outreach: { lo: 0.05, hi: 0.1 },
  InConversation: { lo: 0.1, hi: 0.18 },
  Submitted: { lo: 0.2, hi: 0.35 },
  ClientInterview: { lo: 0.3, hi: 0.5 },
  Offer: { lo: 0.55, hi: 0.75 },
  Placed: { lo: 0.85, hi: 0.95 },
  Paid: { lo: 1, hi: 1 },
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Sanitize an unknown priors payload against the defaults: every stage
 * present, lo/hi finite in [0,1], lo ≤ hi. Bad entries fall back to the
 * default for that stage — a corrupt localStorage value can never poison
 * money math.
 */
export function sanitizePriors(raw: unknown): StagePriors {
  const out = {} as StagePriors;
  const source = (raw ?? {}) as Record<string, unknown>;
  for (const stage of PIPELINE_STAGES) {
    const candidate = source[stage] as StagePriorRange | undefined;
    if (
      candidate &&
      typeof candidate.lo === 'number' &&
      typeof candidate.hi === 'number' &&
      Number.isFinite(candidate.lo) &&
      Number.isFinite(candidate.hi) &&
      candidate.lo >= 0 &&
      candidate.hi <= 1 &&
      candidate.lo <= candidate.hi
    ) {
      out[stage] = { lo: candidate.lo, hi: candidate.hi };
    } else {
      out[stage] = { ...DEFAULT_STAGE_PRIORS[stage] };
    }
  }
  return out;
}

/** Load edited priors (falls back to defaults, always fully sanitized). */
export function loadPriors(): StagePriors {
  return sanitizePriors(loadV3<unknown>(PRIORS_KEY, null));
}

/** Persist edited priors under `revital_v3_priors`. */
export function savePriors(priors: StagePriors): void {
  saveV3(PRIORS_KEY, sanitizePriors(priors));
}

/** Midpoint of a prior range, clamped to [0,1]. */
export function priorMidpoint(range: StagePriorRange): number {
  return clamp01((range.lo + range.hi) / 2);
}

// ------------------------------------------------------------
// Observed transitions from StageEvents
// ------------------------------------------------------------

export interface ObservedStageStats {
  /** Resolved deals that actually sat in this stage. */
  n: number;
  /** Of those, how many eventually reached Paid. */
  successes: number;
  /** successes / n. */
  rate: number;
}

const PIPELINE_STAGE_SET = new Set<string>(PIPELINE_STAGES);

/**
 * Per-stage observed outcomes from the append-only StageEvent log.
 * Only RESOLVED deals count (Paid = success, currently-Rejected = failure);
 * in-flight/Bench deals are censored. Skipped stages contribute nothing
 * (a deal that never sat in S is not an observation of S).
 */
export function observedStageStats(
  events: StageEvent[],
): Partial<Record<PipelineStage, ObservedStageStats>> {
  const byDeal = new Map<string, StageEvent[]>();
  for (const e of events) {
    if (!e || typeof e.dealId !== 'string') continue;
    const list = byDeal.get(e.dealId);
    if (list) list.push(e);
    else byDeal.set(e.dealId, [e]);
  }

  const counts = new Map<PipelineStage, { n: number; successes: number }>();

  for (const list of byDeal.values()) {
    const ordered = [...list].sort((a, b) => a.ts.localeCompare(b.ts));
    const entered = new Set<PipelineStage>();
    let reachedPaid = false;
    for (const e of ordered) {
      if (PIPELINE_STAGE_SET.has(e.to)) {
        entered.add(e.to as PipelineStage);
        if (e.to === 'Paid') reachedPaid = true;
      }
    }
    const last = ordered[ordered.length - 1];
    const success = reachedPaid;
    const failure = !reachedPaid && last?.to === 'Rejected';
    if (!success && !failure) continue; // censored — in flight / Bench

    for (const stage of entered) {
      const c = counts.get(stage) ?? { n: 0, successes: 0 };
      c.n += 1;
      if (success) c.successes += 1;
      counts.set(stage, c);
    }
  }

  const out: Partial<Record<PipelineStage, ObservedStageStats>> = {};
  for (const [stage, c] of counts) {
    out[stage] = { n: c.n, successes: c.successes, rate: c.successes / c.n };
  }
  return out;
}

// ------------------------------------------------------------
// Effective probability
// ------------------------------------------------------------

function usableObserved(
  observed: ObservedStageStats | null | undefined,
): observed is ObservedStageStats {
  return (
    !!observed &&
    typeof observed.n === 'number' &&
    observed.n >= BLEND_MIN_OBSERVATIONS &&
    typeof observed.rate === 'number' &&
    Number.isFinite(observed.rate)
  );
}

/**
 * Effective probability for a stage (contract):
 * prior-range midpoint, UNLESS ≥10 observed transitions for that stage —
 * then a 50/50 blend of midpoint and observed rate.
 * Priors default to the persisted (or default) set.
 */
export function effectiveProbability(
  stage: PipelineStage,
  observed?: ObservedStageStats | null,
  priors: StagePriors = loadPriors(),
): number {
  const mid = priorMidpoint(priors[stage] ?? DEFAULT_STAGE_PRIORS[stage]);
  if (usableObserved(observed)) {
    return clamp01(0.5 * mid + 0.5 * clamp01(observed.rate));
  }
  return mid;
}

export interface EffectiveProbabilityRange {
  lo: number;
  hi: number;
  /** true ⇒ ≥10 observations blended in; the range collapsed to a point. */
  blended: boolean;
}

/**
 * Range form for display: the prior {lo,hi} until blended; once blended
 * the range collapses to the blended point (contract: "display always as
 * a range until blended").
 */
export function effectiveProbabilityRange(
  stage: PipelineStage,
  observed?: ObservedStageStats | null,
  priors: StagePriors = loadPriors(),
): EffectiveProbabilityRange {
  if (usableObserved(observed)) {
    const v = effectiveProbability(stage, observed, priors);
    return { lo: v, hi: v, blended: true };
  }
  const range = priors[stage] ?? DEFAULT_STAGE_PRIORS[stage];
  return { lo: clamp01(range.lo), hi: clamp01(range.hi), blended: false };
}
