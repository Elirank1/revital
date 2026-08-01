/**
 * Money display helpers (Wave 2, kanban-ui) — node env.
 *
 * The critical property: these helpers COMPOSE the money lib, never fork
 * it — the range midpoint is pinned to `dealEV` for every guard case so
 * UI figures can never drift from the lib's math. Calibration gating is
 * asserted null-shaped (nothing renderable), never 0.
 */
import { describe, it, expect } from 'vitest';
import type { Deal, DealStage } from '../../types/pipeline';
import {
  DEFAULT_STAGE_PRIORS,
  dealEV,
  type MandateFee,
  type ObservedByStage,
} from '../../lib/money';
import {
  calibratedJobIdSet,
  columnEvRange,
  evRangeForCalibratedDeal,
  evRangeForDeal,
  expectedThisMonth,
  formatEvRange,
  formatILS,
} from './money';
import { useMoneyStore } from '../../lib/money';

// Wave-3 C-seed seam (platform-data, lead-granted): mandateCalibrated now
// ALSO requires the mandate to be seeded (D-042). Seeding every fixture
// mandate keeps each case below testing its ORIGINAL gate (fee / stage /
// tombstone) rather than the new seeding gate.
for (const jobId of ['J1', 'CAL', 'FEE_ONLY', 'NO_FEE', 'TOMB']) {
  useMoneyStore.getState().markMandateSeeded(jobId);
}

const PRIORS = DEFAULT_STAGE_PRIORS;

function deal(over: Partial<Deal> & { stage: DealStage }): Deal {
  return {
    id: over.id ?? 'd1',
    v: 0,
    updatedAt: '2026-07-01T00:00:00.000Z',
    personId: 'p1',
    jobId: over.jobId ?? 'J1',
    jobTitle: 'Backend Engineer',
    stageEnteredAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function fee(over: Partial<MandateFee> = {}): MandateFee {
  return {
    jobId: 'J1',
    kind: 'percent',
    percent: 20,
    expectedSalary: 480_000,
    currency: 'ILS',
    guaranteeDays: 0,
    invoiceStatus: 'none',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

const AMOUNT = 96_000; // 20% × 480,000

describe('formatILS / formatEvRange', () => {
  it('rounds to whole shekels with thousands separators', () => {
    expect(formatILS(0)).toBe('₪0');
    expect(formatILS(96_000)).toBe('₪96,000');
    expect(formatILS(123_456.7)).toBe('₪123,457');
  });

  it('collapses a range whose rounded bounds agree to a single amount', () => {
    expect(formatEvRange({ lo: 100, hi: 100.4 })).toBe('₪100');
    expect(formatEvRange({ lo: 19_200, hi: 33_600 })).toBe('₪19,200–₪33,600');
  });
});

describe('evRangeForDeal — midpoint pinned to dealEV (no drift, ever)', () => {
  const observedBlended: ObservedByStage = {
    Submitted: { n: 10, successes: 5, rate: 0.5 },
  };

  const cases: { name: string; d: Deal; f: MandateFee | null; obs?: ObservedByStage }[] = [
    { name: 'Sourced', d: deal({ stage: 'Sourced' }), f: fee() },
    { name: 'Submitted', d: deal({ stage: 'Submitted' }), f: fee() },
    { name: 'Paid', d: deal({ stage: 'Paid' }), f: fee() },
    { name: 'Rejected', d: deal({ stage: 'Rejected' }), f: fee() },
    {
      name: 'override 0.5',
      d: deal({ stage: 'Offer', probabilityOverride: 0.5 }),
      f: fee(),
    },
    {
      name: 'blended Submitted',
      d: deal({ stage: 'Submitted' }),
      f: fee(),
      obs: observedBlended,
    },
  ];

  for (const c of cases) {
    it(`midpoint === dealEV (${c.name})`, () => {
      const range = evRangeForDeal(c.d, c.f, PRIORS, c.obs);
      const ev = dealEV(c.d, c.f, PRIORS, c.obs);
      expect(range).not.toBeNull();
      expect((range!.lo + range!.hi) / 2).toBeCloseTo(ev!, 8);
    });
  }

  it('null exactly where dealEV is null: no fee, incomplete fee, tombstone, Bench', () => {
    const d = deal({ stage: 'Submitted' });
    expect(evRangeForDeal(d, null, PRIORS)).toBeNull();
    expect(dealEV(d, null, PRIORS)).toBeNull();

    const incomplete = fee({ percent: undefined });
    expect(evRangeForDeal(d, incomplete, PRIORS)).toBeNull();
    expect(dealEV(d, incomplete, PRIORS)).toBeNull();

    const dead = deal({ stage: 'Submitted', deleted: true });
    expect(evRangeForDeal(dead, fee(), PRIORS)).toBeNull();
    expect(dealEV(dead, fee(), PRIORS)).toBeNull();

    const bench = deal({ stage: 'Bench' });
    expect(evRangeForDeal(bench, fee(), PRIORS)).toBeNull();
    expect(dealEV(bench, fee(), PRIORS)).toBeNull();
  });

  it('uses the prior RANGE until blended, a point after', () => {
    const d = deal({ stage: 'Submitted' });
    const r = evRangeForDeal(d, fee(), PRIORS)!;
    expect(r.lo).toBeCloseTo(AMOUNT * 0.2, 6);
    expect(r.hi).toBeCloseTo(AMOUNT * 0.35, 6);

    const blended = evRangeForDeal(d, fee(), PRIORS, observedBlended)!;
    expect(blended.lo).toBeCloseTo(blended.hi, 8); // collapsed to a point
  });

  it('probabilityOverride collapses to a point', () => {
    const d = deal({ stage: 'Offer', probabilityOverride: 0.5 });
    const r = evRangeForDeal(d, fee(), PRIORS)!;
    expect(r.lo).toBe(AMOUNT * 0.5);
    expect(r.hi).toBe(AMOUNT * 0.5);
  });
});

describe('calibratedJobIdSet', () => {
  it('requires a complete fee AND a live deal past Screened', () => {
    const deals = [
      deal({ id: 'a', jobId: 'CAL', stage: 'Outreach' }),
      deal({ id: 'b', jobId: 'FEE_ONLY', stage: 'Screened' }),
      deal({ id: 'c', jobId: 'NO_FEE', stage: 'Submitted' }),
      deal({ id: 'd', jobId: 'TOMB', stage: 'Submitted', deleted: true }),
    ];
    const fees = {
      CAL: fee({ jobId: 'CAL' }),
      FEE_ONLY: fee({ jobId: 'FEE_ONLY' }),
      TOMB: fee({ jobId: 'TOMB' }),
    };
    const set = calibratedJobIdSet(deals, fees);
    expect(set.has('CAL')).toBe(true);
    expect(set.has('FEE_ONLY')).toBe(false); // nothing past Screened
    expect(set.has('NO_FEE')).toBe(false); // no fee
    expect(set.has('TOMB')).toBe(false); // tombstones never calibrate
  });
});

describe('evRangeForCalibratedDeal / columnEvRange — calibration gate', () => {
  const deals = [
    deal({ id: 'a', jobId: 'CAL', stage: 'Submitted' }),
    deal({ id: 'b', jobId: 'NO_FEE', stage: 'Submitted' }),
  ];
  const fees = { CAL: fee({ jobId: 'CAL' }) };
  const calibrated = calibratedJobIdSet(deals, fees);

  it('an uncalibrated deal yields null even if a fee record exists', () => {
    const withFeeButUncal = calibratedJobIdSet(
      [deal({ id: 'x', jobId: 'FEE_ONLY', stage: 'Screened' })],
      { FEE_ONLY: fee({ jobId: 'FEE_ONLY' }) },
    );
    expect(
      evRangeForCalibratedDeal(
        deal({ id: 'x', jobId: 'FEE_ONLY', stage: 'Screened' }),
        withFeeButUncal,
        { FEE_ONLY: fee({ jobId: 'FEE_ONLY' }) },
        PRIORS,
      ),
    ).toBeNull();
  });

  it('sums only calibrated deals; null when none contribute', () => {
    const r = columnEvRange(deals, calibrated, fees, PRIORS)!;
    expect(r.lo).toBeCloseTo(AMOUNT * 0.2, 6); // only CAL's deal
    expect(r.hi).toBeCloseTo(AMOUNT * 0.35, 6);

    expect(
      columnEvRange([deals[1]], calibrated, fees, PRIORS),
    ).toBeNull(); // the uncalibrated deal alone ⇒ placeholder, not ₪0
  });
});

describe('expectedThisMonth — dated outstanding invoices only', () => {
  const NOW = new Date('2026-07-15T10:00:00.000Z').getTime();

  it('sums due/sent invoices dated in the current month, for calibrated mandates', () => {
    const fees = {
      A: fee({ jobId: 'A', invoiceStatus: 'due', invoiceDueAt: '2026-07-20' }),
      B: fee({ jobId: 'B', invoiceStatus: 'sent', invoiceDueAt: '2026-07-02' }),
      C: fee({ jobId: 'C', invoiceStatus: 'paid', invoiceDueAt: '2026-07-10' }),
      D: fee({ jobId: 'D', invoiceStatus: 'due', invoiceDueAt: '2026-08-01' }),
      E: fee({ jobId: 'E', invoiceStatus: 'due' }), // undated — unmeasured
    };
    const result = expectedThisMonth(fees, ['A', 'B', 'C', 'D', 'E'], NOW);
    expect(result).toEqual({ total: AMOUNT * 2, invoiceCount: 2 });
  });

  it('ignores mandates outside the calibrated list', () => {
    const fees = {
      A: fee({ jobId: 'A', invoiceStatus: 'due', invoiceDueAt: '2026-07-20' }),
    };
    expect(expectedThisMonth(fees, [], NOW)).toBeNull();
  });

  it('null (not ₪0) when nothing is dated this month', () => {
    const fees = {
      A: fee({ jobId: 'A', invoiceStatus: 'none' }),
    };
    expect(expectedThisMonth(fees, ['A'], NOW)).toBeNull();
  });
});
