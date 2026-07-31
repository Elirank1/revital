// Wave 2 — leading indicators over synthetic events. Node env, pure.
import { describe, it, expect } from 'vitest';
import type {
  Deal,
  StageEvent,
  Suggestion,
} from '../../types/pipeline';
import {
  FIRST_TOUCH_SLA_DAYS,
  computeLeadingIndicators,
  flattenContacts,
  type ContactRef,
} from './leadingIndicators';

let evSeq = 0;
function ev(
  dealId: string,
  from: StageEvent['from'],
  to: StageEvent['to'],
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

function contact(ts: string, over: Partial<ContactRef> = {}): ContactRef {
  return { kind: 'contacted', ts, ...over };
}

let sugSeq = 0;
function suggestion(
  status: Suggestion['status'],
  extra: Record<string, unknown> = {},
): Suggestion {
  sugSeq += 1;
  return {
    id: `s${sugSeq}`,
    v: 0,
    updatedAt: '2026-07-01T10:00:00.000Z',
    agent: 'screener',
    kind: 'draft_message',
    title: 't',
    body: 'b',
    evidence: [],
    status,
    createdAt: '2026-07-01T10:00:00.000Z',
    ...extra,
  } as Suggestion;
}

function makeDeal(id: string, personId: string): Deal {
  return {
    id,
    v: 0,
    updatedAt: '2026-07-01T00:00:00.000Z',
    personId,
    jobId: 'J1',
    jobTitle: 'Backend',
    stage: 'Outreach',
    stageEnteredAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

const NOW = '2026-07-20T00:00:00.000Z';

describe('computeLeadingIndicators — insufficient data', () => {
  it('returns null for every metric on empty inputs — never a fake number', () => {
    const out = computeLeadingIndicators([], [], [], { now: NOW });
    expect(out).toEqual({
      timeToFirstTouchDays: null,
      slaHitRate: null,
      clientFeedbackLatencyDays: null,
      suggestionAcceptRate: null,
      suggestionEditRate: null,
    });
  });
});

describe('timeToFirstTouchDays', () => {
  it('median days from creation event to first attributable contact (dealId link)', () => {
    const events = [
      ev('A', null, 'Sourced', '2026-07-01T00:00:00Z'),
      ev('B', null, 'Sourced', '2026-07-01T00:00:00Z'),
    ];
    const contacts = [
      contact('2026-07-02T00:00:00Z', { dealId: 'A' }), // 1 day
      contact('2026-07-05T00:00:00Z', { dealId: 'B' }), // 4 days
      contact('2026-07-06T00:00:00Z', { dealId: 'B' }), // later — ignored
    ];
    const out = computeLeadingIndicators(events, contacts, [], { now: NOW });
    expect(out.timeToFirstTouchDays).toBeCloseTo(2.5, 10); // median of [1, 4]
  });

  it('attributes person-level contacts via opts.deals; pre-carding contact clamps to 0', () => {
    const events = [ev('A', null, 'Sourced', '2026-07-10T00:00:00Z')];
    const contacts = [contact('2026-07-08T00:00:00Z', { personId: 'p1' })];
    const out = computeLeadingIndicators(events, contacts, [], {
      deals: [makeDeal('A', 'p1')],
      now: NOW,
    });
    expect(out.timeToFirstTouchDays).toBe(0);
  });

  it('flattenContacts stamps personId and skips tombstoned persons', () => {
    const flat = flattenContacts([
      {
        id: 'p1',
        contactEvents: [{ kind: 'contacted', ts: '2026-07-02T00:00:00Z' }],
      },
      {
        id: 'p2',
        deleted: true,
        contactEvents: [{ kind: 'contacted', ts: '2026-07-02T00:00:00Z' }],
      },
    ]);
    expect(flat).toEqual([
      { kind: 'contacted', ts: '2026-07-02T00:00:00Z', personId: 'p1' },
    ]);
  });
});

describe('slaHitRate', () => {
  it('hits within the SLA window; old untouched deals are misses; young untouched are pending', () => {
    expect(FIRST_TOUCH_SLA_DAYS).toBe(3);
    const events = [
      ev('hit', null, 'Sourced', '2026-07-01T00:00:00Z'),
      ev('late', null, 'Sourced', '2026-07-01T00:00:00Z'),
      ev('never', null, 'Sourced', '2026-07-01T00:00:00Z'), // old, untouched → miss
      ev('young', null, 'Sourced', '2026-07-19T00:00:00Z'), // pending → excluded
    ];
    const contacts = [
      contact('2026-07-02T00:00:00Z', { dealId: 'hit' }), // 1d → hit
      contact('2026-07-09T00:00:00Z', { dealId: 'late' }), // 8d → miss
    ];
    const out = computeLeadingIndicators(events, contacts, [], { now: NOW });
    expect(out.slaHitRate).toBeCloseTo(1 / 3, 10);
  });

  it('deals created directly at Submitted+ are not SLA-eligible (outreach already happened)', () => {
    const events = [ev('sub', null, 'Submitted', '2026-07-01T00:00:00Z')];
    const out = computeLeadingIndicators(events, [], [], { now: NOW });
    expect(out.slaHitRate).toBeNull();
  });
});

describe('clientFeedbackLatencyDays', () => {
  it('median days from entering Submitted to the next transition; waiting deals censored', () => {
    const events = [
      // A: Submitted → ClientInterview after 2 days
      ev('A', null, 'Sourced', '2026-07-01T00:00:00Z'),
      ev('A', 'Sourced', 'Submitted', '2026-07-02T00:00:00Z'),
      ev('A', 'Submitted', 'ClientInterview', '2026-07-04T00:00:00Z'),
      // B: Submitted → Rejected after 6 days (feedback is feedback)
      ev('B', null, 'Submitted', '2026-07-01T00:00:00Z'),
      ev('B', 'Submitted', 'Rejected', '2026-07-07T00:00:00Z'),
      // C: still sitting in Submitted → censored
      ev('C', null, 'Submitted', '2026-07-10T00:00:00Z'),
    ];
    const out = computeLeadingIndicators(events, [], [], { now: NOW });
    expect(out.clientFeedbackLatencyDays).toBeCloseTo(4, 10); // median of [2, 6]
  });
});

describe('suggestion rates', () => {
  it('acceptRate = accepted / resolved; pending and tombstoned excluded', () => {
    const suggestions = [
      suggestion('accepted'),
      suggestion('accepted'),
      suggestion('dismissed'),
      suggestion('pending'),
      suggestion('accepted', { deleted: true }),
    ];
    const out = computeLeadingIndicators([], [], suggestions, { now: NOW });
    expect(out.suggestionAcceptRate).toBeCloseTo(2 / 3, 10);
  });

  it('editRate is null until the editedBeforeAccept marker exists — absence is "not measured", not 0%', () => {
    const unmeasured = computeLeadingIndicators(
      [],
      [],
      [suggestion('accepted'), suggestion('accepted')],
      { now: NOW },
    );
    expect(unmeasured.suggestionEditRate).toBeNull();

    const measured = computeLeadingIndicators(
      [],
      [],
      [
        suggestion('accepted', { editedBeforeAccept: true }),
        suggestion('accepted', { editedBeforeAccept: false }),
        suggestion('accepted'), // not instrumented — excluded from denominator
        suggestion('dismissed', { editedBeforeAccept: true }), // not accepted
      ],
      { now: NOW },
    );
    expect(measured.suggestionEditRate).toBeCloseTo(0.5, 10);
  });
});
