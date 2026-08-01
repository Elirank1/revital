/**
 * Pit Boss determinism (quality-gate, Wave 2 batch C).
 *
 * Contract (wave2-contract §Pit Boss): deterministic, auditable — same
 * inputs ⇒ identical output, always. The owner's suite checks behavior;
 * this suite pins DETERMINISM itself, independently:
 *
 *  - repeated calls: 25 runs over the same inputs are byte-identical
 *    (order, weights, claims, evidence — full JSON equality);
 *  - input-order independence: permuting the deals and contacts arrays
 *    must not change the output (the total order is
 *    evAtRisk desc → riskWeight desc → dealId asc — no hidden reliance
 *    on Map/insertion order);
 *  - tiebreaks land exactly as specified on crafted ties;
 *  - suggestion building is deterministic too: same item ⇒ same id and
 *    deep-equal SuggestionInput;
 *  - ₪ hard rule at the ranker level: uncalibrated items carry ev:null /
 *    evAtRisk:0 and not a single ₪ in their serialized form or their
 *    suggestions, while a calibrated item's suggestion DOES carry ₪
 *    (sensitivity control — the sweep is proven able to see ₪).
 *
 * Pure-function testing, node env, fixed clock. Synthetic fixtures only.
 */
import { describe, it, expect } from 'vitest';
import type { Deal } from '../types/pipeline';
import type { MandateFee } from '../lib/money/mandateFee';
import { DEFAULT_STAGE_PRIORS } from '../lib/money/priors';
import type { ContactRef } from '../lib/metrics/leadingIndicators';
import {
  pitBossSuggestionId,
  pitBossSuggestionInput,
  rankMoveTheMoney,
} from './pitboss';
import { useMoneyStore } from '../lib/money';

// Wave-3 C-seed seam (platform-data, lead-granted): mandateCalibrated now
// ALSO requires the mandate to be seeded (D-042). Seeding BOTH fixture
// mandates keeps every case below testing its ORIGINAL gate — job-Y stays
// uncalibrated purely for its missing fee, exactly as designed.
for (const jobId of ['job-X', 'job-Y']) {
  useMoneyStore.getState().markMandateSeeded(jobId);
}

const NOW = '2026-07-31T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY_MS).toISOString();
}

function mkDeal(
  id: string,
  jobId: string,
  stage: Deal['stage'],
  ageDays: number,
  extra: Partial<Deal> = {},
): Deal {
  return {
    id,
    v: 1,
    updatedAt: NOW,
    personId: `person-${id}`,
    jobId,
    jobTitle: `תפקיד ${jobId}`,
    stage,
    stageEnteredAt: daysAgo(ageDays),
    createdAt: daysAgo(ageDays + 10),
    ...extra,
  };
}

// Calibrated mandate job-X (fixed ₪30,000) + uncalibrated job-Y (no fee).
const FEES: Record<string, MandateFee> = {
  'job-X': {
    jobId: 'job-X',
    kind: 'fixed',
    fixedAmount: 30_000,
    currency: 'ILS',
    guaranteeDays: 0,
    invoiceStatus: 'none',
    updatedAt: NOW,
  },
};

/**
 * The fixture is built to exercise every ordering rule:
 *  - da/db: identical Submitted deals 12d old (feedback weight exactly 1,
 *    no aging — both AT the cohort median) → evAtRisk tie 8,250 → dealId asc;
 *  - dc: Offer 4d → EV 19,500 × offer weight 0.4 = 7,800 (below the tie);
 *  - ds1/ds2/ds3: Sourced cohort ages 1/2/9 → median 2; only ds3 ranks
 *    (aging weight clamps to 1); ds1/ds2 have no reasons → absent;
 *  - dy-conv/dy-out: uncalibrated 6d-silent deals (weight 6/7 each) →
 *    evAtRisk 0 tie → riskWeight tie → dealId asc ('dy-conv' < 'dy-out');
 *  - excluded by construction: unparsable stageEnteredAt, tombstone,
 *    Bench, Paid, Rejected.
 */
function fixtureDeals(): Deal[] {
  return [
    mkDeal('da', 'job-X', 'Submitted', 12),
    mkDeal('db', 'job-X', 'Submitted', 12),
    mkDeal('dc', 'job-X', 'Offer', 4),
    mkDeal('ds1', 'job-Y', 'Sourced', 1),
    mkDeal('ds2', 'job-Y', 'Sourced', 2),
    mkDeal('ds3', 'job-Y', 'Sourced', 9),
    mkDeal('dy-conv', 'job-Y', 'InConversation', 9),
    mkDeal('dy-out', 'job-Y', 'Outreach', 8),
    mkDeal('dz-bad', 'job-Y', 'Submitted', 0, { stageEnteredAt: 'not-a-date' }),
    mkDeal('dz-del', 'job-X', 'Submitted', 30, { deleted: true, deletedAt: NOW }),
    mkDeal('dz-bench', 'job-Y', 'Bench', 30),
    mkDeal('dz-paid', 'job-X', 'Paid', 50),
    mkDeal('dz-rej', 'job-X', 'Rejected', 30, {
      rejection: { reason: 'לא רלוונטי', ts: NOW },
    }),
  ];
}

function fixtureContacts(): ContactRef[] {
  return [
    { kind: 'contacted', ts: daysAgo(6), personId: 'person-dy-out', channel: 'whatsapp' },
    { kind: 'contacted', ts: daysAgo(6), personId: 'person-dy-conv', channel: 'whatsapp' },
    // A reply on an unrelated person — noise that must change nothing.
    { kind: 'replied', ts: daysAgo(1), personId: 'person-ds1' },
  ];
}

const PRIORS = DEFAULT_STAGE_PRIORS;

function run(deals = fixtureDeals(), contacts = fixtureContacts()) {
  return rankMoveTheMoney(deals, FEES, PRIORS, contacts, new Date(NOW));
}

describe('rankMoveTheMoney determinism', () => {
  it('produces the exact specified order with the specified numbers', () => {
    const items = run();
    expect(items.map((i) => i.dealId)).toEqual([
      'da',
      'db',
      'dc',
      'ds3',
      'dy-conv',
      'dy-out',
    ]);

    // Hand arithmetic (fee 30,000; priors are the exported defaults):
    // Submitted mid 0.275 → EV 8,250; feedback weight (12−6)/6 = 1.
    expect(items[0].ev).toBeCloseTo(8_250, 8);
    expect(items[0].riskWeight).toBeCloseTo(1, 8);
    expect(items[0].evAtRisk).toBeCloseTo(8_250, 8);
    expect(items[1].evAtRisk).toBeCloseTo(8_250, 8);
    // Offer mid 0.65 → EV 19,500; offer weight (4−2)/5 = 0.4 → 7,800.
    expect(items[2].ev).toBeCloseTo(19_500, 8);
    expect(items[2].evAtRisk).toBeCloseTo(7_800, 8);
    // Uncalibrated: silence weight 6/7; aging clamped to 1 for ds3.
    expect(items[3].riskWeight).toBeCloseTo(1, 8);
    expect(items[4].riskWeight).toBeCloseTo(6 / 7, 8);
    expect(items[5].riskWeight).toBeCloseTo(6 / 7, 8);

    // Reason kinds are exactly what the fixture forces.
    expect(items[0].reasons.map((r) => r.kind)).toEqual(['client_feedback_overdue']);
    expect(items[2].reasons.map((r) => r.kind)).toEqual(['offer_decaying']);
    expect(items[3].reasons.map((r) => r.kind)).toEqual(['aging_past_median']);
    expect(items[4].reasons.map((r) => r.kind)).toEqual(['followup_due']);
  });

  it('25 repeated calls are byte-identical', () => {
    const first = JSON.stringify(run());
    for (let i = 0; i < 25; i++) {
      expect(JSON.stringify(run())).toBe(first);
    }
  });

  it('is independent of input array order (deals AND contacts permuted)', () => {
    const first = JSON.stringify(run());

    const reversedDeals = [...fixtureDeals()].reverse();
    expect(JSON.stringify(run(reversedDeals))).toBe(first);

    const rotated = fixtureDeals();
    rotated.push(...rotated.splice(0, 5));
    expect(JSON.stringify(run(rotated))).toBe(first);

    const sortedByTitle = [...fixtureDeals()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    expect(JSON.stringify(run(sortedByTitle))).toBe(first);

    const reversedContacts = [...fixtureContacts()].reverse();
    expect(JSON.stringify(run(fixtureDeals(), reversedContacts))).toBe(first);
  });

  it('suggestion building is deterministic: stable episode ids, deep-equal inputs', () => {
    const deals = fixtureDeals();
    const byId = new Map(deals.map((d) => [d.id, d]));
    const a = run();
    const b = run();
    for (let i = 0; i < a.length; i++) {
      const deal = byId.get(a[i].dealId)!;
      const inputA = pitBossSuggestionInput(a[i], deal);
      const inputB = pitBossSuggestionInput(b[i], deal);
      expect(inputA).toEqual(inputB);
      expect(inputA.id).toBe(pitBossSuggestionId(deal.id, deal.stageEnteredAt));
    }
  });

  it('₪ never attaches to uncalibrated items — and DOES attach to calibrated ones', () => {
    const deals = fixtureDeals();
    const byId = new Map(deals.map((d) => [d.id, d]));
    const items = run();

    for (const item of items) {
      if (item.jobId !== 'job-X') {
        expect(item.calibrated).toBe(false);
        expect(item.ev).toBeNull();
        expect(item.evAtRisk).toBe(0);
        expect(JSON.stringify(item)).not.toContain('₪');
        const input = pitBossSuggestionInput(item, byId.get(item.dealId)!);
        expect(JSON.stringify(input)).not.toContain('₪');
      }
    }

    // Sensitivity control: the calibrated top item's suggestion carries ₪
    // in body AND evidence — proving the no-₪ checks above can detect ₪.
    const top = items[0];
    expect(top.calibrated).toBe(true);
    const input = pitBossSuggestionInput(top, byId.get(top.dealId)!);
    expect(input.body).toContain('₪');
    expect(JSON.stringify(input.evidence)).toContain('₪');
  });

  it('with empty fees (the server tick reality) NO item ranks with money', () => {
    const items = rankMoveTheMoney(
      fixtureDeals(),
      {},
      PRIORS,
      fixtureContacts(),
      new Date(NOW),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.ev).toBeNull();
      expect(item.evAtRisk).toBe(0);
    }
    expect(JSON.stringify(items)).not.toContain('₪');
  });
});
