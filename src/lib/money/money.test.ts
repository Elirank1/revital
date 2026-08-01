// Wave 2 — money lib: feeAmount / priors / effectiveProbability / dealEV /
// qualifiedPipeline / calibration gating (Wave-3 C-seed: + seeding gate).
// Pure functions, node env — seeding is passed EXPLICITLY everywhere.
import { describe, it, expect } from 'vitest';
import type { Deal, DealStage, StageEvent } from '../../types/pipeline';
import { feeAmount, type MandateFee } from './mandateFee';
import { type SeedingState } from './seeding';
import {
  BLEND_MIN_OBSERVATIONS,
  DEFAULT_STAGE_PRIORS,
  effectiveProbability,
  effectiveProbabilityRange,
  observedStageStats,
  priorMidpoint,
  sanitizePriors,
} from './priors';
import {
  EARLY_STAGES,
  QUALIFIED_STAGES,
  dealEV,
  isPastScreened,
  mandateCalibrated,
  qualifiedPipeline,
} from './ev';

const T0 = '2026-07-01T10:00:00.000Z';

/** Explicit seeding fixture — pure tests never touch the module registry. */
function seeded(...jobIds: string[]): SeedingState {
  const out: SeedingState = {};
  for (const jobId of jobIds) out[jobId] = { jobId, seededAt: T0 };
  return out;
}

function fee(over: Partial<MandateFee> = {}): MandateFee {
  return {
    jobId: 'job-1',
    kind: 'percent',
    percent: 20,
    expectedSalary: 480_000,
    currency: 'ILS',
    guaranteeDays: 90,
    invoiceStatus: 'none',
    updatedAt: T0,
    ...over,
  };
}

let dealSeq = 0;
function deal(
  stage: DealStage,
  over: Partial<Deal> = {},
): Deal {
  dealSeq += 1;
  return {
    id: over.id ?? `d${dealSeq}`,
    v: 0,
    updatedAt: T0,
    personId: 'p1',
    jobId: 'job-1',
    jobTitle: 'Backend',
    stage,
    stageEnteredAt: T0,
    createdAt: T0,
    ...over,
  };
}

let evSeq = 0;
function ev(
  dealId: string,
  from: StageEvent['from'],
  to: DealStage,
  ts: string,
): StageEvent {
  evSeq += 1;
  return {
    id: `e${evSeq}`,
    v: 0,
    updatedAt: ts,
    dealId,
    from,
    to,
    ts,
    actor: 'human',
    skippedStages: [],
  };
}

describe('feeAmount', () => {
  it('computes percent × salary / 100', () => {
    expect(feeAmount(fee())).toBe(96_000);
  });

  it('computes fixed fees', () => {
    expect(feeAmount(fee({ kind: 'fixed', fixedAmount: 30_000 }))).toBe(30_000);
  });

  it('returns null — never 0 — for every incomplete shape', () => {
    expect(feeAmount(null)).toBeNull();
    expect(feeAmount(undefined)).toBeNull();
    expect(feeAmount(fee({ percent: undefined }))).toBeNull();
    expect(feeAmount(fee({ expectedSalary: undefined }))).toBeNull();
    expect(feeAmount(fee({ percent: 0 }))).toBeNull();
    expect(feeAmount(fee({ percent: -5 }))).toBeNull();
    expect(feeAmount(fee({ expectedSalary: Number.NaN }))).toBeNull();
    expect(feeAmount(fee({ kind: 'fixed' }))).toBeNull();
    expect(feeAmount(fee({ kind: 'fixed', fixedAmount: 0 }))).toBeNull();
    expect(
      feeAmount(fee({ kind: 'fixed', fixedAmount: Number.POSITIVE_INFINITY })),
    ).toBeNull();
  });
});

describe('priors', () => {
  it('sanitize falls back per-stage on corrupt values and keeps valid edits', () => {
    const out = sanitizePriors({
      Submitted: { lo: 0.25, hi: 0.4 },
      Offer: { lo: 0.9, hi: 0.2 }, // lo > hi → default
      Sourced: { lo: -1, hi: 2 }, // out of range → default
    });
    expect(out.Submitted).toEqual({ lo: 0.25, hi: 0.4 });
    expect(out.Offer).toEqual(DEFAULT_STAGE_PRIORS.Offer);
    expect(out.Sourced).toEqual(DEFAULT_STAGE_PRIORS.Sourced);
    expect(out.Paid).toEqual({ lo: 1, hi: 1 });
  });

  it('midpoint of the default Submitted prior', () => {
    expect(priorMidpoint(DEFAULT_STAGE_PRIORS.Submitted)).toBeCloseTo(0.275, 10);
  });
});

describe('effectiveProbability — blend boundary (contract: ≥10)', () => {
  const priors = DEFAULT_STAGE_PRIORS;
  const mid = priorMidpoint(priors.Submitted);

  it('9 observations → pure prior midpoint, range stays a range', () => {
    const observed = { n: 9, successes: 9, rate: 1 };
    expect(effectiveProbability('Submitted', observed, priors)).toBeCloseTo(
      mid,
      10,
    );
    const range = effectiveProbabilityRange('Submitted', observed, priors);
    expect(range.blended).toBe(false);
    expect(range).toMatchObject(priors.Submitted);
  });

  it('10 observations → 50/50 blend, range collapses to a point', () => {
    expect(BLEND_MIN_OBSERVATIONS).toBe(10);
    const observed = { n: 10, successes: 10, rate: 1 };
    const blended = effectiveProbability('Submitted', observed, priors);
    expect(blended).toBeCloseTo(0.5 * mid + 0.5, 10);
    const range = effectiveProbabilityRange('Submitted', observed, priors);
    expect(range.blended).toBe(true);
    expect(range.lo).toBeCloseTo(blended, 10);
    expect(range.hi).toBeCloseTo(blended, 10);
  });

  it('no observations → midpoint', () => {
    expect(effectiveProbability('Submitted', null, priors)).toBeCloseTo(mid, 10);
    expect(effectiveProbability('Submitted', undefined, priors)).toBeCloseTo(
      mid,
      10,
    );
  });
});

describe('observedStageStats', () => {
  it('counts only resolved deals; censors in-flight and Bench; excludes skips', () => {
    const events: StageEvent[] = [
      // A: Sourced → Screened → ... → Paid (success)
      ev('A', null, 'Sourced', '2026-07-01T10:00:00Z'),
      ev('A', 'Sourced', 'Screened', '2026-07-02T10:00:00Z'),
      ev('A', 'Screened', 'Submitted', '2026-07-03T10:00:00Z'),
      ev('A', 'Submitted', 'Paid', '2026-07-04T10:00:00Z'),
      // B: Sourced → Rejected (failure)
      ev('B', null, 'Sourced', '2026-07-01T10:00:00Z'),
      ev('B', 'Sourced', 'Rejected', '2026-07-02T10:00:00Z'),
      // C: in-flight (censored)
      ev('C', null, 'Sourced', '2026-07-01T10:00:00Z'),
      ev('C', 'Sourced', 'Outreach', '2026-07-02T10:00:00Z'),
      // D: created straight at Submitted (skipped everything before) → Rejected
      {
        ...ev('D', null, 'Submitted', '2026-07-01T10:00:00Z'),
        skippedStages: ['Sourced', 'Screened', 'Outreach', 'InConversation'],
      },
      ev('D', 'Submitted', 'Rejected', '2026-07-05T10:00:00Z'),
      // E: benched last (censored)
      ev('E', null, 'Sourced', '2026-07-01T10:00:00Z'),
      ev('E', 'Sourced', 'Bench', '2026-07-02T10:00:00Z'),
    ];

    const stats = observedStageStats(events);
    // Sourced: A success, B failure (C and E censored) → 1/2
    expect(stats.Sourced).toEqual({ n: 2, successes: 1, rate: 0.5 });
    // Screened: only A → 1/1
    expect(stats.Screened).toEqual({ n: 1, successes: 1, rate: 1 });
    // Submitted: A success + D failure → 1/2; D's skipped stages contribute nothing
    expect(stats.Submitted).toEqual({ n: 2, successes: 1, rate: 0.5 });
    expect(stats.Outreach).toBeUndefined(); // only C (censored) sat there
    expect(stats.InConversation).toBeUndefined();
  });
});

describe('calibration predicate (hard rule)', () => {
  it('isPastScreened: Outreach+ yes; Sourced/Screened/Bench/Rejected no', () => {
    expect(isPastScreened('Outreach')).toBe(true);
    expect(isPastScreened('Paid')).toBe(true);
    expect(isPastScreened('Screened')).toBe(false);
    expect(isPastScreened('Sourced')).toBe(false);
    expect(isPastScreened('Bench')).toBe(false);
    expect(isPastScreened('Rejected')).toBe(false);
  });

  it('requires seeded AND complete fee AND a live deal past Screened', () => {
    const f = fee();
    const s = seeded('job-1');
    expect(mandateCalibrated('job-1', f, [deal('Outreach')], s)).toBe(true);
    expect(mandateCalibrated('job-1', f, [deal('Screened')], s)).toBe(false);
    expect(mandateCalibrated('job-1', null, [deal('Offer')], s)).toBe(false);
    expect(
      mandateCalibrated('job-1', fee({ percent: undefined }), [deal('Offer')], s),
    ).toBe(false);
    // tombstoned deal never calibrates
    expect(
      mandateCalibrated('job-1', f, [deal('Offer', { deleted: true })], s),
    ).toBe(false);
    // fee belonging to another mandate never calibrates
    expect(
      mandateCalibrated(
        'job-2',
        f,
        [deal('Offer', { jobId: 'job-2' })],
        seeded('job-1', 'job-2'),
      ),
    ).toBe(false);
  });

  it('C-seed (D-042): UNSEEDED blocks calibration even with fee + deep deal', () => {
    const f = fee();
    // Complete fee, deal at Offer — everything the OLD rule wanted…
    expect(mandateCalibrated('job-1', f, [deal('Offer')], {})).toBe(false);
    // …and the default seeding source (empty registry in node) fails
    // closed too: the 3-arg call form cannot leak ₪ for unseeded mandates.
    expect(mandateCalibrated('job-1', f, [deal('Offer')])).toBe(false);
    // Seeding exactly this mandate flips it (sensitivity control).
    expect(mandateCalibrated('job-1', f, [deal('Offer')], seeded('job-1'))).toBe(
      true,
    );
    // Seeding a DIFFERENT mandate does not.
    expect(
      mandateCalibrated('job-1', f, [deal('Offer')], seeded('job-9')),
    ).toBe(false);
  });
});

describe('dealEV', () => {
  const priors = DEFAULT_STAGE_PRIORS;

  it('fee × stage midpoint for a live pipeline deal', () => {
    const evVal = dealEV(deal('Submitted'), fee(), priors);
    expect(evVal).toBeCloseTo(96_000 * 0.275, 6);
  });

  it('null when the fee is incomplete — NEVER 0 or a guess', () => {
    expect(dealEV(deal('Submitted'), null, priors)).toBeNull();
    expect(dealEV(deal('Submitted'), fee({ percent: undefined }), priors)).toBeNull();
  });

  it('Rejected → 0 (truthfully dead); Bench → null (no model); tombstone → null', () => {
    expect(dealEV(deal('Rejected'), fee(), priors)).toBe(0);
    expect(dealEV(deal('Bench'), fee(), priors)).toBeNull();
    expect(dealEV(deal('Submitted', { deleted: true }), fee(), priors)).toBeNull();
  });

  it('probabilityOverride (0..1) wins over the stage probability', () => {
    expect(
      dealEV(deal('Submitted', { probabilityOverride: 0.5 }), fee(), priors),
    ).toBeCloseTo(48_000, 6);
    // invalid override falls back to the stage probability
    expect(
      dealEV(deal('Submitted', { probabilityOverride: 7 }), fee(), priors),
    ).toBeCloseTo(96_000 * 0.275, 6);
  });

  it('applies observed blending at n≥10', () => {
    const observed = { Submitted: { n: 10, successes: 10, rate: 1 } };
    const p = 0.5 * 0.275 + 0.5 * 1;
    expect(dealEV(deal('Submitted'), fee(), priors, observed)).toBeCloseTo(
      96_000 * p,
      6,
    );
  });
});

describe('qualifiedPipeline', () => {
  const priors = DEFAULT_STAGE_PRIORS;
  const f1 = fee({ jobId: 'J1', kind: 'fixed', fixedAmount: 100_000 });

  it('headline = Σ EV over Submitted+ of calibrated mandates only; earlier stages are a range footnote', () => {
    const deals = [
      deal('Submitted', { jobId: 'J1' }), // 100000 × .275
      deal('Offer', { jobId: 'J1' }), //     100000 × .65
      deal('Sourced', { jobId: 'J1' }), //   footnote 2000..5000
      deal('Rejected', { jobId: 'J1' }), //  nothing
      deal('Bench', { jobId: 'J1' }), //     nothing
      deal('Offer', { jobId: 'J2' }), //     UNCALIBRATED (no fee) — nothing
    ];
    const out = qualifiedPipeline(deals, { J1: f1 }, priors, undefined, seeded('J1', 'J2'));
    expect(out.qualifiedEV).toBeCloseTo(27_500 + 65_000, 6);
    expect(out.qualifiedDealCount).toBe(2);
    expect(out.earlyRange?.lo).toBeCloseTo(2_000, 6);
    expect(out.earlyRange?.hi).toBeCloseTo(5_000, 6);
    expect(out.earlyDealCount).toBe(1);
    expect(out.calibratedJobIds).toEqual(['J1']);
    expect(out.uncalibratedJobIds).toEqual(['J2']);
  });

  it('CALIBRATION LEAK SWEEP: an uncalibrated mandate contributes to no figure', () => {
    // J2 has a COMPLETE fee but no deal past Screened → still uncalibrated.
    const f2 = fee({ jobId: 'J2', kind: 'fixed', fixedAmount: 999_999 });
    const deals = [
      deal('Submitted', { jobId: 'J1' }),
      deal('Screened', { jobId: 'J2' }),
      deal('Sourced', { jobId: 'J2' }),
    ];
    const out = qualifiedPipeline(deals, { J1: f1, J2: f2 }, priors, undefined, seeded('J1', 'J2'));
    expect(out.qualifiedEV).toBeCloseTo(27_500, 6);
    expect(out.earlyRange).toBeNull(); // J2's early deals must NOT leak a range
    expect(out.uncalibratedJobIds).toEqual(['J2']);
  });

  it('C-SEED LEAK SWEEP: an UNSEEDED mandate contributes to no figure, even with fee + deep deals', () => {
    // J2: complete fee, Submitted+ AND early deals — but never seeded.
    const f2 = fee({ jobId: 'J2', kind: 'fixed', fixedAmount: 999_999 });
    const deals = [
      deal('Submitted', { jobId: 'J1' }),
      deal('Offer', { jobId: 'J2' }),
      deal('Sourced', { jobId: 'J2' }),
    ];
    const out = qualifiedPipeline(deals, { J1: f1, J2: f2 }, priors, undefined, seeded('J1'));
    expect(out.qualifiedEV).toBeCloseTo(27_500, 6); // J1 only
    expect(out.qualifiedDealCount).toBe(1);
    expect(out.earlyRange).toBeNull(); // J2's Sourced deal leaks no range
    expect(out.calibratedJobIds).toEqual(['J1']);
    expect(out.uncalibratedJobIds).toEqual(['J2']);
    // Empty seeding (fresh board / server): NOTHING is calibrated.
    const cold = qualifiedPipeline(deals, { J1: f1, J2: f2 }, priors, undefined, {});
    expect(cold.qualifiedEV).toBeNull();
    expect(cold.earlyRange).toBeNull();
    expect(cold.calibratedJobIds).toEqual([]);
  });

  it('no calibrated mandate anywhere → null headline, null footnote (never 0)', () => {
    const deals = [deal('Offer', { jobId: 'J9' })];
    const out = qualifiedPipeline(deals, {}, priors, undefined, seeded('J9'));
    expect(out.qualifiedEV).toBeNull();
    expect(out.earlyRange).toBeNull();
    expect(out.calibratedJobIds).toEqual([]);
    expect(out.uncalibratedJobIds).toEqual(['J9']);
  });

  it('calibrated mandate with only early/past-Screened-but-pre-Submitted deals → truthful 0 headline + footnote', () => {
    const deals = [deal('Outreach', { jobId: 'J1' })]; // past Screened → calibrated
    const out = qualifiedPipeline(deals, { J1: f1 }, priors, undefined, seeded('J1'));
    expect(out.qualifiedEV).toBe(0);
    expect(out.earlyRange?.lo).toBeCloseTo(100_000 * 0.05, 6);
    expect(out.earlyRange?.hi).toBeCloseTo(100_000 * 0.1, 6);
  });

  it('tombstoned deals count nowhere', () => {
    const deals = [
      deal('Outreach', { jobId: 'J1' }),
      deal('Submitted', { jobId: 'J1', deleted: true }),
    ];
    const out = qualifiedPipeline(deals, { J1: f1 }, priors, undefined, seeded('J1'));
    expect(out.qualifiedEV).toBe(0);
    expect(out.qualifiedDealCount).toBe(0);
  });

  it('stage partitions cover exactly the nine pipeline stages', () => {
    expect([...EARLY_STAGES, ...QUALIFIED_STAGES]).toEqual([
      'Sourced',
      'Screened',
      'Outreach',
      'InConversation',
      'Submitted',
      'ClientInterview',
      'Offer',
      'Placed',
      'Paid',
    ]);
  });
});
