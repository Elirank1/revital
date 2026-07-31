// Wave-2 Pit Boss: aging×EV ordering, feedback-overdue, silence, offer decay,
// determinism, calibration hard rule (docs/waves/wave2-contract.md §Pit Boss).
import { describe, it, expect } from 'vitest';
import type { Deal } from '../types/pipeline';
import type { MandateFee } from '../lib/money/mandateFee';
import type { ContactRef } from '../lib/metrics/leadingIndicators';
import { DEFAULT_STAGE_PRIORS } from '../lib/money/priors';
import {
  FEEDBACK_OVERDUE_DAYS,
  OFFER_DECAY_GRACE_DAYS,
  rankMoveTheMoney,
  pitBossSuggestionId,
  pitBossSuggestionInput,
} from './pitboss';

const NOW = '2026-07-31T12:00:00.000Z';
const PRIORS = DEFAULT_STAGE_PRIORS;

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString();
}

let seq = 0;
function makeDeal(overrides: Partial<Deal> = {}): Deal {
  seq += 1;
  return {
    id: `d${seq}`,
    v: seq,
    updatedAt: daysAgo(1),
    personId: `p${seq}`,
    jobId: 'job-a',
    jobTitle: 'Backend Engineer',
    stage: 'Submitted',
    stageEnteredAt: daysAgo(1),
    createdAt: daysAgo(30),
    ...overrides,
  };
}

function fee(jobId: string, fixedAmount: number): MandateFee {
  return {
    jobId,
    kind: 'fixed',
    fixedAmount,
    currency: 'ILS',
    guaranteeDays: 30,
    invoiceStatus: 'none',
    updatedAt: NOW,
  };
}

// ------------------------------------------------------------------
// Reasons
// ------------------------------------------------------------------

describe('rankMoveTheMoney reasons', () => {
  it('flags aging past the stage-median with the numbers in evidence', () => {
    const a = makeDeal({ id: 'a', stage: 'Submitted', stageEnteredAt: daysAgo(20) });
    const b = makeDeal({ id: 'b', stage: 'Submitted', stageEnteredAt: daysAgo(10) });
    const c = makeDeal({ id: 'c', stage: 'Submitted', stageEnteredAt: daysAgo(2) });
    const items = rankMoveTheMoney([a, b, c], {}, PRIORS, [], NOW);
    const itemA = items.find((i) => i.dealId === 'a');
    const aging = itemA?.reasons.find((r) => r.kind === 'aging_past_median');
    expect(aging).toBeDefined();
    expect(aging!.inputs.ageDays).toBeCloseTo(20, 5);
    expect(aging!.inputs.medianAgeDays).toBeCloseTo(10, 5);
    expect(aging!.claim).toMatch(/20(\.0)?/);
    // The median deal itself does not overshoot its own median.
    const itemB = items.find((i) => i.dealId === 'b');
    expect(itemB?.reasons.find((r) => r.kind === 'aging_past_median')).toBeUndefined();
  });

  it('a single deal in a stage defines the median — never flags itself', () => {
    const only = makeDeal({ id: 'solo', stage: 'Sourced', stageEnteredAt: daysAgo(40) });
    const items = rankMoveTheMoney([only], {}, PRIORS, [], NOW);
    expect(items).toHaveLength(0);
  });

  it(`flags client feedback overdue past ${FEEDBACK_OVERDUE_DAYS}d in Submitted/ClientInterview`, () => {
    const overdue = makeDeal({ id: 'o', stage: 'Submitted', stageEnteredAt: daysAgo(8) });
    const fresh = makeDeal({ id: 'f', stage: 'Submitted', stageEnteredAt: daysAgo(5) });
    const items = rankMoveTheMoney([overdue, fresh], {}, PRIORS, [], NOW);
    const reason = items
      .find((i) => i.dealId === 'o')
      ?.reasons.find((r) => r.kind === 'client_feedback_overdue');
    expect(reason).toBeDefined();
    expect(reason!.inputs.daysWaiting).toBeCloseTo(8, 5);
    expect(reason!.inputs.thresholdDays).toBe(FEEDBACK_OVERDUE_DAYS);
    expect(
      items.find((i) => i.dealId === 'f')?.reasons.some((r) => r.kind === 'client_feedback_overdue') ??
        false,
    ).toBe(false);
  });

  it('flags follow-up due on 3d+ silence via the shared SLA detection', () => {
    const deal = makeDeal({ id: 'd1', personId: 'p1', stage: 'Outreach', stageEnteredAt: daysAgo(4) });
    const other = makeDeal({ id: 'd2', personId: 'p2', stage: 'Outreach', stageEnteredAt: daysAgo(4) });
    const contacts: ContactRef[] = [
      { kind: 'contacted', ts: daysAgo(4), dealId: 'd1', personId: 'p1' },
      { kind: 'contacted', ts: daysAgo(4), dealId: 'd2', personId: 'p2' },
      { kind: 'replied', ts: daysAgo(3), personId: 'p2' },
    ];
    const items = rankMoveTheMoney([deal, other], {}, PRIORS, contacts, NOW);
    const silent = items.find((i) => i.dealId === 'd1');
    expect(silent?.reasons.some((r) => r.kind === 'followup_due')).toBe(true);
    expect(
      items.find((i) => i.dealId === 'd2')?.reasons.some((r) => r.kind === 'followup_due') ?? false,
    ).toBe(false);
  });

  it(`flags offers decaying past the ${OFFER_DECAY_GRACE_DAYS}d grace window`, () => {
    const decaying = makeDeal({ id: 'x', stage: 'Offer', stageEnteredAt: daysAgo(4) });
    const fresh = makeDeal({ id: 'y', stage: 'Offer', stageEnteredAt: daysAgo(1) });
    const items = rankMoveTheMoney([decaying, fresh], {}, PRIORS, [], NOW);
    const reason = items
      .find((i) => i.dealId === 'x')
      ?.reasons.find((r) => r.kind === 'offer_decaying');
    expect(reason).toBeDefined();
    expect(reason!.inputs.daysInOffer).toBeCloseTo(4, 5);
    expect(items.find((i) => i.dealId === 'y')).toBeUndefined();
  });

  it('never ranks Bench, Rejected, Paid, or tombstoned deals', () => {
    const deals = [
      makeDeal({ id: 'b', stage: 'Bench', stageEnteredAt: daysAgo(50) }),
      makeDeal({ id: 'r', stage: 'Rejected', stageEnteredAt: daysAgo(50) }),
      makeDeal({ id: 'p', stage: 'Paid', stageEnteredAt: daysAgo(50) }),
      makeDeal({ id: 't', stage: 'Offer', stageEnteredAt: daysAgo(50), deleted: true }),
    ];
    expect(rankMoveTheMoney(deals, {}, PRIORS, [], NOW)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Ordering + determinism
// ------------------------------------------------------------------

describe('rankMoveTheMoney ordering', () => {
  it('orders by evAtRisk: same risk profile, bigger fee first (aging×EV)', () => {
    // Two mandates, identical aging overshoot, fees 100k vs 20k.
    const deals = [
      makeDeal({ id: 'big', jobId: 'job-big', stage: 'Submitted', stageEnteredAt: daysAgo(20) }),
      makeDeal({ id: 'big2', jobId: 'job-big', stage: 'Submitted', stageEnteredAt: daysAgo(2) }),
      makeDeal({ id: 'small', jobId: 'job-small', stage: 'Submitted', stageEnteredAt: daysAgo(20) }),
      makeDeal({ id: 'small2', jobId: 'job-small', stage: 'Submitted', stageEnteredAt: daysAgo(2) }),
    ];
    const fees = { 'job-big': fee('job-big', 100_000), 'job-small': fee('job-small', 20_000) };
    const items = rankMoveTheMoney(deals, fees, PRIORS, [], NOW);
    expect(items[0].dealId).toBe('big');
    expect(items[1].dealId).toBe('small');
    expect(items[0].evAtRisk).toBeGreaterThan(items[1].evAtRisk);
    // evAtRisk = EV × riskWeight, EV from the money lib (fee × stage mid).
    const mid = (PRIORS.Submitted.lo + PRIORS.Submitted.hi) / 2;
    expect(items[0].ev).toBeCloseTo(100_000 * mid, 5);
    expect(items[0].evAtRisk).toBeCloseTo(items[0].ev! * items[0].riskWeight, 5);
  });

  it('is deterministic: same inputs give the same order; ties break by dealId', () => {
    const deals = [
      makeDeal({ id: 'z', jobId: 'job-a', stage: 'Submitted', stageEnteredAt: daysAgo(20) }),
      makeDeal({ id: 'a', jobId: 'job-a', stage: 'Submitted', stageEnteredAt: daysAgo(20) }),
      makeDeal({ id: 'm', jobId: 'job-a', stage: 'Submitted', stageEnteredAt: daysAgo(2) }),
    ];
    const fees = { 'job-a': fee('job-a', 50_000) };
    const run1 = rankMoveTheMoney(deals, fees, PRIORS, [], NOW);
    const run2 = rankMoveTheMoney(deals, fees, PRIORS, [], NOW);
    expect(run1).toEqual(run2);
    // 'a' and 'z' are identical in every number → dealId ascending.
    expect(run1.map((i) => i.dealId)).toEqual(['a', 'z']);
  });
});

// ------------------------------------------------------------------
// Calibration hard rule
// ------------------------------------------------------------------

describe('rankMoveTheMoney calibration', () => {
  it('uncalibrated mandates rank with ev:null, evAtRisk:0 — after calibrated ones', () => {
    const deals = [
      makeDeal({ id: 'nofee', jobId: 'job-nofee', stage: 'Submitted', stageEnteredAt: daysAgo(20) }),
      makeDeal({ id: 'nofee2', jobId: 'job-nofee', stage: 'Submitted', stageEnteredAt: daysAgo(2) }),
      makeDeal({ id: 'paid', jobId: 'job-paid', stage: 'Submitted', stageEnteredAt: daysAgo(20) }),
      makeDeal({ id: 'paid2', jobId: 'job-paid', stage: 'Submitted', stageEnteredAt: daysAgo(2) }),
    ];
    const fees = { 'job-paid': fee('job-paid', 30_000) };
    const items = rankMoveTheMoney(deals, fees, PRIORS, [], NOW);
    const noFee = items.find((i) => i.dealId === 'nofee')!;
    expect(noFee.calibrated).toBe(false);
    expect(noFee.ev).toBeNull();
    expect(noFee.evAtRisk).toBe(0);
    expect(noFee.reasons.length).toBeGreaterThan(0); // signals still surface
    expect(items[0].dealId).toBe('paid'); // ₪-ranked first
  });

  it('a complete fee with no deal past Screened stays uncalibrated (hard rule)', () => {
    const deals = [
      makeDeal({ id: 's1', jobId: 'job-early', stage: 'Sourced', stageEnteredAt: daysAgo(30) }),
      makeDeal({ id: 's2', jobId: 'job-early', stage: 'Sourced', stageEnteredAt: daysAgo(2) }),
    ];
    const fees = { 'job-early': fee('job-early', 40_000) };
    const items = rankMoveTheMoney(deals, fees, PRIORS, [], NOW);
    const aged = items.find((i) => i.dealId === 's1')!;
    expect(aged.calibrated).toBe(false);
    expect(aged.ev).toBeNull();
    expect(aged.evAtRisk).toBe(0);
  });
});

// ------------------------------------------------------------------
// Suggestion building
// ------------------------------------------------------------------

describe('pitBossSuggestionInput', () => {
  it('cites every numeric input in evidence; ₪ appears only when calibrated', () => {
    const deal = makeDeal({ id: 'd1', jobId: 'job-a', stage: 'Submitted', stageEnteredAt: daysAgo(10) });
    const filler = makeDeal({ id: 'd2', jobId: 'job-a', stage: 'Submitted', stageEnteredAt: daysAgo(1) });
    const fees = { 'job-a': fee('job-a', 60_000) };
    const items = rankMoveTheMoney([deal, filler], fees, PRIORS, [], NOW);
    const item = items.find((i) => i.dealId === 'd1')!;
    const input = pitBossSuggestionInput(item, deal);

    expect(input.id).toBe(pitBossSuggestionId('d1', deal.stageEnteredAt));
    expect(input.agent).toBe('pit_boss');
    expect(input.kind).toBe('next_action');
    // One evidence entry per reason + the calibrated ₪ entry.
    expect(input.evidence).toHaveLength(item.reasons.length + 1);
    for (const r of item.reasons) {
      expect(input.evidence!.some((e) => e.claim.includes(r.claim))).toBe(true);
      expect(r.claim).toMatch(/\d/); // every claim carries its numbers
    }
    const feeEvidence = input.evidence!.find((e) => e.sourceType === 'fee');
    expect(feeEvidence).toBeDefined();
    expect(feeEvidence!.claim).toContain('₪');
    expect(input.body).toContain('₪');
  });

  it('NEVER mentions ₪ for an uncalibrated mandate (calibration hard rule)', () => {
    const deal = makeDeal({ id: 'd1', jobId: 'job-nofee', stage: 'Submitted', stageEnteredAt: daysAgo(10) });
    const filler = makeDeal({ id: 'd2', jobId: 'job-nofee', stage: 'Submitted', stageEnteredAt: daysAgo(1) });
    const items = rankMoveTheMoney([deal, filler], {}, PRIORS, [], NOW);
    const item = items.find((i) => i.dealId === 'd1')!;
    const input = pitBossSuggestionInput(item, deal);
    const everything = [input.title, input.body, ...(input.evidence ?? []).map((e) => e.claim)].join('\n');
    expect(everything).not.toContain('₪');
    expect(input.evidence!.every((e) => e.sourceType !== 'fee')).toBe(true);
  });

  it('deterministic per-episode id changes when the deal enters a new stage', () => {
    expect(pitBossSuggestionId('d1', daysAgo(10))).toBe(pitBossSuggestionId('d1', daysAgo(10)));
    expect(pitBossSuggestionId('d1', daysAgo(10))).not.toBe(pitBossSuggestionId('d1', daysAgo(3)));
  });

  it('strips BiDi override controls from interpolated job titles', () => {
    const deal = makeDeal({
      id: 'd1',
      jobId: 'job-x',
      jobTitle: 'Dev‮loper',
      stage: 'Submitted',
      stageEnteredAt: daysAgo(10),
    });
    const filler = makeDeal({ id: 'd2', jobId: 'job-x', stage: 'Submitted', stageEnteredAt: daysAgo(1) });
    const items = rankMoveTheMoney([deal, filler], {}, PRIORS, [], NOW);
    const input = pitBossSuggestionInput(items.find((i) => i.dealId === 'd1')!, deal);
    expect(input.title).not.toContain('‮');
    expect(input.body).not.toContain('‮');
  });
});
