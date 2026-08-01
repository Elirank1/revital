// Wave 3 C-seed (D-042) — seeding state sanitization, baseline
// auto-derivation (nulls over fiction) and the async Hebrew seeding form
// (pure, BiDi-safe, no ₪). Node env; everything passed explicitly.
import { describe, it, expect } from 'vitest';
import type { Deal, DealStage, StageEvent } from '../../types/pipeline';
import type { ContactRef } from '../metrics/leadingIndicators';
import type { MandateFee } from './mandateFee';
import {
  asyncSeedingFormText,
  buildPendingSeeding,
  deriveBaseline,
  isSeeded,
  sanitizeSeeding,
  type LegacyHistoryRef,
  type PendingSeeding,
} from './seeding';

const T0 = '2026-07-01T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function at(days: number): string {
  return new Date(Date.parse(T0) + days * DAY_MS).toISOString();
}

let dealSeq = 0;
function deal(stage: DealStage, over: Partial<Deal> = {}): Deal {
  dealSeq += 1;
  return {
    id: over.id ?? `d${dealSeq}`,
    v: 0,
    updatedAt: T0,
    personId: over.personId ?? `p${dealSeq}`,
    jobId: over.jobId ?? 'J1',
    jobTitle: over.jobTitle ?? 'Backend Engineer',
    stage,
    stageEnteredAt: T0,
    createdAt: T0,
    ...over,
  };
}

let evSeq = 0;
function ev(dealId: string, from: StageEvent['from'], to: DealStage, ts: string): StageEvent {
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

function hist(id: string, ts: string): LegacyHistoryRef {
  return { id, timestamp: ts };
}

function fixedFee(jobId: string, amount: number): MandateFee {
  return {
    jobId,
    kind: 'fixed',
    fixedAmount: amount,
    currency: 'ILS',
    guaranteeDays: 0,
    invoiceStatus: 'none',
    updatedAt: T0,
  };
}

const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/;

// ------------------------------------------------------------------
// sanitizeSeeding / isSeeded
// ------------------------------------------------------------------

describe('sanitizeSeeding — corrupt storage can never poison the gate', () => {
  it('keeps only well-formed entries whose jobId matches the key', () => {
    const out = sanitizeSeeding({
      J1: { jobId: 'J1', seededAt: T0 },
      J2: { jobId: 'MISMATCH', seededAt: T0 }, // key/jobId mismatch → drop
      J3: { jobId: 'J3', seededAt: 'not-a-date' }, // unparsable → drop
      J4: { jobId: 'J4' }, // missing seededAt → drop
      J5: 'garbage', // wrong shape → drop
      J6: null,
    });
    expect(Object.keys(out)).toEqual(['J1']);
    expect(isSeeded('J1', out)).toBe(true);
    expect(isSeeded('J2', out)).toBe(false);
  });

  it('non-object payloads read as nothing seeded (fail-closed)', () => {
    expect(sanitizeSeeding(null)).toEqual({});
    expect(sanitizeSeeding('[]')).toEqual({});
    expect(sanitizeSeeding(42)).toEqual({});
  });
});

// ------------------------------------------------------------------
// deriveBaseline
// ------------------------------------------------------------------

describe('deriveBaseline — synthetic history', () => {
  it('candidates/day from analyses ∪ log deduped by id, over the span', () => {
    // 5 distinct analyses over exactly 4 days; the log mirrors two of
    // them (same ids — createLogEntry) and adds one whose analysis was
    // deleted from the analyses list.
    const analyses = [
      hist('a1', at(0)),
      hist('a2', at(1)),
      hist('a3', at(2)),
      hist('a4', at(4)),
    ];
    const log = [hist('a1', at(0)), hist('a4', at(4)), hist('a5', at(3))];
    const out = deriveBaseline(analyses, log, [], []);
    expect(out.basis.analysisCount).toBe(5);
    expect(out.basis.analysisSpanDays).toBeCloseTo(4, 8);
    expect(out.candidatesPerDay).toBeCloseTo(5 / 4, 8);
  });

  it('nulls over fiction: <2 observations or <1 day of history', () => {
    expect(deriveBaseline([], [], [], []).candidatesPerDay).toBeNull();
    expect(
      deriveBaseline([hist('a1', at(0))], [], [], []).candidatesPerDay,
    ).toBeNull();
    // Two analyses 6 hours apart — no honest DAILY rate exists.
    const burst = deriveBaseline(
      [hist('a1', at(0)), hist('a2', at(0.25))],
      [],
      [],
      [],
    );
    expect(burst.candidatesPerDay).toBeNull();
    expect(burst.basis.analysisSpanDays).toBeCloseTo(0.25, 8);
    // Unparsable timestamps are dropped, not counted.
    expect(
      deriveBaseline([hist('a1', 'garbage'), hist('a2', at(1))], [], [], [])
        .candidatesPerDay,
    ).toBeNull();
  });

  it('follow-up latency: median of contact→contact chases; replies close the window', () => {
    const contacts: ContactRef[] = [
      // p1: contacted d0 → contacted d3 (chase: 3d) → replied → contacted
      // d10 (NOT a chase — the reply closed the window).
      { kind: 'contacted', ts: at(0), personId: 'p1' },
      { kind: 'contacted', ts: at(3), personId: 'p1' },
      { kind: 'replied', ts: at(4), personId: 'p1' },
      { kind: 'contacted', ts: at(10), personId: 'p1' },
      // p2: contacted d0 → no_reply logged → contacted d5 (chase: 5d —
      // a no_reply keeps the chase open).
      { kind: 'contacted', ts: at(0), personId: 'p2' },
      { kind: 'no_reply', ts: at(2), personId: 'p2' },
      { kind: 'contacted', ts: at(5), personId: 'p2' },
      // p3: single contact — measures nothing.
      { kind: 'contacted', ts: at(1), personId: 'p3' },
      // unattributable contact — ignored, never guessed into a pair.
      { kind: 'contacted', ts: at(2) },
    ];
    const out = deriveBaseline([], [], [], contacts);
    expect(out.basis.followUpPairs).toBe(2);
    expect(out.followUpLatencyDays).toBeCloseTo(4, 8); // median(3, 5)
    expect(out.basis.contactedKeys).toBe(3);
  });

  it('board shape only when deals are provided — never inferred from events', () => {
    const deals = [
      deal('Sourced', { jobId: 'J1' }),
      deal('Submitted', { jobId: 'J1' }),
      deal('Outreach', { jobId: 'J2' }),
      deal('Paid', { jobId: 'J3' }), // banked — not in flight
      deal('Bench', { jobId: 'J4' }), // parked — not in flight
      deal('Rejected', { jobId: 'J5' }), // dead — not in flight
      deal('Offer', { jobId: 'J6', deleted: true }), // tombstone
    ];
    const withDeals = deriveBaseline([], [], [], [], { deals });
    expect(withDeals.inFlightDealCount).toBe(3);
    expect(withDeals.activeMandateCount).toBe(2); // J1, J2

    const without = deriveBaseline([], [], [], []);
    expect(without.inFlightDealCount).toBeNull();
    expect(without.activeMandateCount).toBeNull();
  });

  it('reuses computeLeadingIndicators for the indicator block', () => {
    const d = deal('Sourced', { id: 'dx', personId: 'px' });
    const events = [ev('dx', null, 'Sourced', at(0))];
    const contacts: ContactRef[] = [
      { kind: 'contacted', ts: at(2), personId: 'px' },
    ];
    const out = deriveBaseline([], [], events, contacts, {
      deals: [d],
      now: at(3),
    });
    expect(out.indicators.timeToFirstTouchDays).toBeCloseTo(2, 8);
    expect(out.indicators.slaHitRate).toBe(1);
    expect(out.indicators.suggestionAcceptRate).toBeNull();
  });

  it('empty history → all-null metrics, zeroed basis (never fake numbers)', () => {
    const out = deriveBaseline([], [], [], []);
    expect(out.candidatesPerDay).toBeNull();
    expect(out.followUpLatencyDays).toBeNull();
    expect(out.activeMandateCount).toBeNull();
    expect(out.inFlightDealCount).toBeNull();
    expect(out.indicators.timeToFirstTouchDays).toBeNull();
    expect(out.indicators.slaHitRate).toBeNull();
    expect(out.indicators.clientFeedbackLatencyDays).toBeNull();
    expect(out.basis).toEqual({
      analysisCount: 0,
      analysisSpanDays: null,
      followUpPairs: 0,
      contactedKeys: 0,
    });
  });
});

// ------------------------------------------------------------------
// buildPendingSeeding
// ------------------------------------------------------------------

describe('buildPendingSeeding', () => {
  const persons = [
    { id: 'p1', name: 'נועה כהן' },
    { id: 'p2', name: 'דנה לוי' },
    { id: 'p3', name: 'gone', deleted: true as const },
  ];

  it('collects fee/stage questions per mandate; fully answered mandates drop out', () => {
    const deals = [
      // J1: fee complete + seeded → no questions at all.
      deal('Submitted', { jobId: 'J1', jobTitle: 'Backend', personId: 'p1' }),
      // J2: fee missing + unseeded → both question kinds.
      deal('Screened', { jobId: 'J2', jobTitle: 'Data', personId: 'p2' }),
      // J3: fee complete but unseeded → stage confirmation only.
      deal('Outreach', { jobId: 'J3', jobTitle: 'QA', personId: 'p1' }),
      // Bench/Rejected cards never ask for stage confirmation.
      deal('Bench', { jobId: 'J2', personId: 'p1' }),
      deal('Rejected', { jobId: 'J2', personId: 'p1' }),
      // Tombstones are invisible.
      deal('Submitted', { jobId: 'J4', deleted: true }),
    ];
    const pending = buildPendingSeeding({
      deals,
      persons,
      fees: { J1: fixedFee('J1', 40_000), J3: fixedFee('J3', 30_000) },
      seeding: { J1: { jobId: 'J1', seededAt: T0 } },
    });
    expect(pending.mandates.map((m) => m.jobId)).toEqual(['J2', 'J3']);
    const j2 = pending.mandates[0];
    expect(j2.needsFee).toBe(true);
    expect(j2.candidates).toEqual([{ name: 'דנה לוי', stage: 'Screened' }]);
    const j3 = pending.mandates[1];
    expect(j3.needsFee).toBe(false);
    expect(j3.candidates).toEqual([{ name: 'נועה כהן', stage: 'Outreach' }]);
  });

  it('an INCOMPLETE fee record still counts as needing the fee question', () => {
    const pending = buildPendingSeeding({
      deals: [deal('Submitted', { jobId: 'J1', personId: 'p1' })],
      persons,
      fees: {
        J1: { ...fixedFee('J1', 1), fixedAmount: undefined },
      },
      seeding: { J1: { jobId: 'J1', seededAt: T0 } },
    });
    expect(pending.mandates).toHaveLength(1);
    expect(pending.mandates[0].needsFee).toBe(true);
    expect(pending.mandates[0].candidates).toEqual([]); // seeded — no stage Qs
  });
});

// ------------------------------------------------------------------
// asyncSeedingFormText
// ------------------------------------------------------------------

describe('asyncSeedingFormText — shareable Hebrew form', () => {
  const pending: PendingSeeding = {
    mandates: [
      {
        jobId: 'J2',
        jobTitle: 'Data Engineer',
        needsFee: true,
        candidates: [
          { name: 'דנה לוי', stage: 'Screened' },
          { name: 'נועה כהן', stage: 'Outreach' },
        ],
      },
      { jobId: 'J3', jobTitle: 'QA Lead', needsFee: false, candidates: [] },
    ],
    baseline: {
      candidatesPerDay: 3.2, // derived — must NOT be re-asked
      followUpLatencyDays: null,
      activeMandateCount: null,
      inFlightDealCount: 7, // derived — must NOT be re-asked
    },
  };

  it('golden shape: numbered questions, only for what is actually missing', () => {
    const text = asyncSeedingFormText(pending);
    // Header + continuous numbering.
    expect(text).toContain('שאלון השלמת נתונים');
    expect(text).toContain('1. Data Engineer — עמלה:');
    expect(text).toContain('2. Data Engineer — אישור שלבים:');
    expect(text).toContain('- דנה לוי (כרגע בלוח: Screened)');
    expect(text).toContain('- נועה כהן (כרגע בלוח: Outreach)');
    // J3 needs neither fee nor stages → no J3/QA Lead question at all.
    expect(text).not.toContain('QA Lead');
    // Baseline: ONLY the two null metrics become questions (3 and 4).
    expect(text).toContain('3. אחרי כמה ימים בלי מענה');
    expect(text).toContain('4. כמה משרות פתוחות');
    expect(text).not.toContain('כמה מועמדים חדשים'); // derived
    expect(text).not.toContain('כמה מועמדויות פעילות'); // derived
    expect(text).not.toMatch(/^5\./m);
  });

  it('is BiDi-safe: no direction-control chars, even smuggled via inputs', () => {
    const hostile: PendingSeeding = {
      mandates: [
        {
          jobId: 'J9',
          jobTitle: 'Dev‮loper', // RLO smuggled into the title
          needsFee: true,
          candidates: [{ name: '⁦דנה⁩ לוי', stage: 'Sourced' }],
        },
      ],
    };
    const text = asyncSeedingFormText(hostile);
    expect(text).not.toMatch(BIDI);
    expect(text).toContain('Devloper'); // stripped, not reordered
    expect(asyncSeedingFormText(pending)).not.toMatch(BIDI);
  });

  it('never emits ₪ — no money figure exists before calibration', () => {
    expect(asyncSeedingFormText(pending)).not.toContain('₪');
  });

  it('returns the empty string when nothing is pending', () => {
    expect(asyncSeedingFormText({ mandates: [] })).toBe('');
    expect(
      asyncSeedingFormText({
        mandates: [
          { jobId: 'J1', jobTitle: 'X', needsFee: false, candidates: [] },
        ],
        baseline: {
          candidatesPerDay: 1,
          followUpLatencyDays: 2,
          activeMandateCount: 3,
          inFlightDealCount: 4,
        },
      }),
    ).toBe('');
  });

  it('is deterministic (pure function of its input)', () => {
    expect(asyncSeedingFormText(pending)).toBe(asyncSeedingFormText(pending));
  });
});
